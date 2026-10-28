const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const blockchain = require('../blockchain/Blockchain');
const anomalyService = require('../ai_engine/anomalyService');

/**
 * Helper to compute age from DOB string
 */
function getAge(dobString) {
  const dob = new Date(dobString);
  const diff = Date.now() - dob.getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

/**
 * GET /api/analytics/dashboard
 * Aggregated analytics for Member 4 Live Dashboard (Chart.js feeds)
 */
router.get('/dashboard', async (req, res) => {
  try {
    const election = await db.asyncGet('SELECT * FROM elections ORDER BY id DESC LIMIT 1');
    const candidates = await db.asyncAll('SELECT id, name, party, symbol, vote_count FROM candidates ORDER BY vote_count DESC');
    const voters = await db.asyncAll('SELECT id, aadhaar_no, has_voted, voted_at FROM voters WHERE role = "voter"');
    const aadhaarRecords = await db.asyncAll('SELECT aadhaar_no, dob, gender FROM aadhaar_records');
    const anomalies = await db.asyncAll('SELECT * FROM ai_anomaly_logs ORDER BY id DESC LIMIT 10');

    const totalVoters = voters.length;
    const totalVoted = voters.filter((v) => v.has_voted === 1).length;
    const totalVotesInCandidates = candidates.reduce((sum, c) => sum + c.vote_count, 0);
    const turnout = totalVoters > 0 ? parseFloat(((totalVoted / totalVoters) * 100).toFixed(2)) : 0;

    // 1. Demographic Analysis
    const ageGroups = { '18-25': 0, '26-35': 0, '36-50': 0, '51+': 0 };
    const genderSplit = { Male: 0, Female: 0, Other: 0 };

    aadhaarRecords.forEach((rec) => {
      const age = getAge(rec.dob);
      if (age <= 25) ageGroups['18-25']++;
      else if (age <= 35) ageGroups['26-35']++;
      else if (age <= 50) ageGroups['36-50']++;
      else ageGroups['51+']++;

      if (rec.gender === 'Male') genderSplit.Male++;
      else if (rec.gender === 'Female') genderSplit.Female++;
      else genderSplit.Other++;
    });

    // 2. Candidate Distribution for Chart.js
    const candidateLabels = candidates.map((c) => `${c.symbol} ${c.name}`);
    const candidateVotes = candidates.map((c) => c.vote_count);
    const candidateColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6b7280'];

    // 3. Hourly / Recent Velocity Timeline (Simulated/Actual timeline aggregation)
    const hoursMap = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60 * 1000);
      const label = `${d.getHours().toString().padStart(2, '0')}:00`;
      hoursMap[label] = 0;
    }

    voters.forEach((v) => {
      if (v.has_voted && v.voted_at) {
        const vDate = new Date(v.voted_at);
        const label = `${vDate.getHours().toString().padStart(2, '0')}:00`;
        if (hoursMap[label] !== undefined) {
          hoursMap[label]++;
        } else {
          hoursMap[label] = 1;
        }
      }
    });

    // 4. AI Risk Score Evaluation
    const chainValidation = blockchain.isChainValid();
    let riskScore = 5.0;
    if (!chainValidation.isValid) riskScore += 50.0;
    riskScore += anomalies.length * 5.0;
    riskScore = Math.min(100, Math.round(riskScore * 10) / 10);

    let riskLevel = 'LOW';
    if (riskScore >= 65) riskLevel = 'CRITICAL';
    else if (riskScore >= 35) riskLevel = 'ELEVATED';
    else if (riskScore >= 20) riskLevel = 'MODERATE';

    res.json({
      success: true,
      election,
      summary: {
        totalVoters,
        totalVoted,
        totalVotesInCandidates,
        turnoutPercentage: turnout,
        totalBlocksMined: blockchain.chain.length,
        isBlockchainSecure: chainValidation.isValid,
        aiIntegrityRiskScore: riskScore,
        aiRiskLevel: riskLevel
      },
      charts: {
        candidateDistribution: {
          labels: candidateLabels,
          data: candidateVotes,
          colors: candidateColors.slice(0, candidateLabels.length)
        },
        votingTimeline: {
          labels: Object.keys(hoursMap),
          data: Object.values(hoursMap)
        },
        demographics: {
          ageGroups,
          genderSplit
        }
      },
      recentAnomalies: anomalies
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/analytics/anomalies
 * Return all AI anomaly detections
 */
router.get('/anomalies', async (req, res) => {
  try {
    const anomalies = await db.asyncAll('SELECT * FROM ai_anomaly_logs ORDER BY id DESC LIMIT 50');
    res.json({ success: true, count: anomalies.length, anomalies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/analytics/run-ml-detection
 * Triggers Python / Node ML statistical anomaly inference
 */
router.post('/run-ml-detection', async (req, res) => {
  try {
    const analysis = await anomalyService.runPythonMLAnalysis();
    res.json({ success: true, analysis });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/analytics/export-report
 * Certified Election Audit & Result Summary Report
 */
router.get('/export-report', async (req, res) => {
  try {
    const election = await db.asyncGet('SELECT * FROM elections ORDER BY id DESC LIMIT 1');
    const candidates = await db.asyncAll('SELECT name, party, symbol, vote_count FROM candidates ORDER BY vote_count DESC');
    const voters = await db.asyncAll('SELECT id, has_voted FROM voters WHERE role = "voter"');
    const auditCount = await db.asyncGet('SELECT COUNT(*) as count FROM audit_logs');
    const anomalyCount = await db.asyncGet('SELECT COUNT(*) as count FROM ai_anomaly_logs');
    const chainValidation = blockchain.isChainValid();

    const totalVotes = candidates.reduce((sum, c) => sum + c.vote_count, 0);
    const totalRegistered = voters.length;
    const turnout = totalRegistered > 0 ? ((totalVotes / totalRegistered) * 100).toFixed(2) : 0;
    const winner = candidates.length > 0 && totalVotes > 0 ? candidates[0] : null;

    const report = {
      reportTitle: 'CERTIFIED OFFICIAL ELECTION AUDIT REPORT',
      generatedAt: new Date().toISOString(),
      electionTitle: election ? election.title : 'General Election',
      status: election ? election.status : 'CLOSED',
      turnout: {
        totalRegistered,
        totalVotesCast: totalVotes,
        turnoutPercentage: `${turnout}%`
      },
      proclamationOfWinner: winner
        ? {
            candidateName: winner.name,
            party: winner.party,
            symbol: winner.symbol,
            votesSecured: winner.vote_count,
            percentage: totalVotes > 0 ? ((winner.vote_count / totalVotes) * 100).toFixed(2) + '%' : '0%'
          }
        : { message: 'No votes cast or election pending' },
      candidateTally: candidates.map((c) => ({
        candidate: c.name,
        party: c.party,
        symbol: c.symbol,
        votes: c.vote_count,
        percentage: totalVotes > 0 ? ((c.vote_count / totalVotes) * 100).toFixed(2) + '%' : '0%'
      })),
      cryptographicCertification: {
        totalBlocksMined: blockchain.chain.length,
        genesisHash: blockchain.chain[0].hash,
        latestBlockHash: blockchain.getLatestBlock().hash,
        isBlockchainTamperFree: chainValidation.isValid,
        blockchainIntegrityStatus: chainValidation.reason,
        consensusAlgorithm: 'Proof-of-Work (SHA-256 Chained Blocks with Merkle Roots)'
      },
      aiMonitoringSummary: {
        totalAuditTrailRecords: auditCount.count,
        totalFlaggedAnomalies: anomalyCount.count,
        securityStatus: chainValidation.isValid && anomalyCount.count === 0 ? 'CERTIFIED SECURE & UNCOMPROMISED' : 'FLAGGED AUDIT REVIEW'
      }
    };

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
