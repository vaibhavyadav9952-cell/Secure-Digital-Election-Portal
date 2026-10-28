const { spawn } = require('child_process');
const path = require('path');
const { db } = require('../config/database');

class AnomalyService {
  constructor() {
    this.recentVotesWindow = []; // Stores timestamps for velocity analysis
    this.ipVoteCounter = new Map(); // IP -> { count, windowStart }
    this.WINDOW_MS = 60000; // 1-minute sliding window
  }

  /**
   * Log an anomaly incident to SQLite
   */
  async logAnomaly(type, score, details, ipAddress = '127.0.0.1') {
    try {
      await db.asyncRun(`
        INSERT INTO ai_anomaly_logs (anomaly_type, score, details, ip_address)
        VALUES (?, ?, ?, ?)
      `, [type, score, details, ipAddress]);

      // Also record in general security audit logs
      await db.asyncRun(`
        INSERT INTO audit_logs (event_type, actor, ip_address, details_json, severity)
        VALUES (?, ?, ?, ?, ?)
      `, [
        `AI_ANOMALY_${type}`,
        'AI_FRAUD_MONITOR',
        ipAddress,
        JSON.stringify({ type, score, details }),
        score >= 70 ? 'CRITICAL' : score >= 40 ? 'WARN' : 'INFO'
      ]);

      console.warn(`[AI Security Alert] ${type} (Score: ${score}/100) - ${details}`);
    } catch (err) {
      console.error('[AI Anomaly Engine] Logging error:', err);
    }
  }

  /**
   * Evaluates real-time parameters whenever a vote is cast
   */
  async recordVoteEvent(voterId, ipAddress = '127.0.0.1') {
    const now = Date.now();

    // 1. Sliding Window Velocity Analysis
    this.recentVotesWindow.push(now);
    // Prune events older than 60s
    this.recentVotesWindow = this.recentVotesWindow.filter((t) => now - t <= this.WINDOW_MS);

    // If velocity exceeds 15 votes/min in demo (or burst rate)
    if (this.recentVotesWindow.length > 10) {
      const velocityScore = Math.min(95, this.recentVotesWindow.length * 8);
      await this.logAnomaly(
        'VOTING_VELOCITY_SPIKE',
        velocityScore,
        `Unusual burst of ${this.recentVotesWindow.length} votes cast in the last 60 seconds. Possible automated bot interaction.`,
        ipAddress
      );
    }

    // 2. IP Cluster / Proxy Flood Detection
    const ipData = this.ipVoteCounter.get(ipAddress) || { count: 0, windowStart: now };
    if (now - ipData.windowStart > this.WINDOW_MS) {
      ipData.count = 1;
      ipData.windowStart = now;
    } else {
      ipData.count += 1;
    }
    this.ipVoteCounter.set(ipAddress, ipData);

    if (ipData.count >= 4) {
      const ipScore = Math.min(90, ipData.count * 15);
      await this.logAnomaly(
        'IP_CONCENTRATION_CLUSTER',
        ipScore,
        `Single IP address (${ipAddress}) submitted ${ipData.count} votes in quick succession.`,
        ipAddress
      );
    }
  }

  /**
   * Flags duplicate voting attempts
   */
  async recordDuplicateAttempt(voterId, voterName, ipAddress = '127.0.0.1') {
    await this.logAnomaly(
      'DUPLICATE_VOTE_BLOCKED',
      85,
      `Voter "${voterName}" (ID: ${voterId}) attempted to vote a second time. Transaction rejected.`,
      ipAddress
    );
  }

  /**
   * Flags blockchain tamper incidents
   */
  async recordTamperEvent(blockIndex, details, ipAddress = '127.0.0.1') {
    await this.logAnomaly(
      'BLOCKCHAIN_INTEGRITY_TAMPER',
      99,
      `Block #${blockIndex} cryptographic signature failure: ${details}`,
      ipAddress
    );
  }

  /**
   * Runs the standalone Python ML fraud detector script
   */
  async runPythonMLAnalysis() {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, 'fraud_detector.py');
      const pyProcess = spawn('python', [scriptPath]);

      let output = '';
      let errorOutput = '';

      pyProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pyProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      pyProcess.on('close', (code) => {
        if (code === 0 && output) {
          try {
            const parsed = JSON.parse(output.trim());
            return resolve(parsed);
          } catch (e) {
            console.warn('[AI Engine] Failed to parse Python output, falling back to internal JS engine:', e.message);
          }
        }
        // Fallback internal Node.js ML stats calculation
        this.getInternalMLStats().then(resolve);
      });

      pyProcess.on('error', (err) => {
        console.warn('[AI Engine] Python execution error, using internal JS engine:', err.message);
        this.getInternalMLStats().then(resolve);
      });
    });
  }

  /**
   * Internal Node.js fallback for statistics and anomaly scoring
   */
  async getInternalMLStats() {
    try {
      const voters = await db.asyncAll('SELECT id, has_voted, voted_at FROM voters');
      const anomalies = await db.asyncAll('SELECT * FROM ai_anomaly_logs ORDER BY timestamp DESC LIMIT 20');
      const auditLogs = await db.asyncAll('SELECT * FROM audit_logs WHERE severity IN ("WARN", "CRITICAL")');

      const totalVoters = voters.length;
      const totalVoted = voters.filter((v) => v.has_voted === 1).length;
      const turnout = totalVoters > 0 ? (totalVoted / totalVoters) * 100 : 0;

      // Base risk calculation
      let calculatedRisk = 5.0;
      calculatedRisk += anomalies.length * 7.5;
      calculatedRisk += auditLogs.length * 5.0;
      calculatedRisk = Math.min(100, Math.round(calculatedRisk * 10) / 10);

      let riskCategory = 'LOW';
      if (calculatedRisk >= 65) riskCategory = 'CRITICAL';
      else if (calculatedRisk >= 35) riskCategory = 'ELEVATED';
      else if (calculatedRisk >= 20) riskCategory = 'MODERATE';

      const findings = [];
      if (anomalies.length > 0) {
        findings.push(`${anomalies.length} anomaly incident(s) flagged by AI heuristics.`);
      }
      if (turnout > 80) {
        findings.push('High voter engagement rate observed (>80% turnout).');
      }
      if (findings.length === 0) {
        findings.push('All voting patterns, velocity rates, and cryptographic trails are within normal baseline thresholds.');
      }

      return {
        status: 'success',
        timestamp: new Date().toISOString(),
        model: 'AI Statistical Anomaly & Risk Classifier (Node Real-Time Engine)',
        total_registered: totalVoters,
        total_votes_cast: totalVoted,
        turnout_percentage: Math.round(turnout * 100) / 100,
        integrity_risk_score: calculatedRisk,
        risk_level: riskCategory,
        security_flags: {
          duplicate_voting_attempts: anomalies.filter((a) => a.anomaly_type.includes('DUPLICATE')).length,
          tamper_incidents: anomalies.filter((a) => a.anomaly_type.includes('TAMPER')).length,
          critical_logs_count: auditLogs.length
        },
        findings
      };
    } catch (err) {
      console.error('[AI Engine] getInternalMLStats error:', err);
      return { status: 'error', message: err.message };
    }
  }
}

const anomalyServiceInstance = new AnomalyService();

module.exports = anomalyServiceInstance;
