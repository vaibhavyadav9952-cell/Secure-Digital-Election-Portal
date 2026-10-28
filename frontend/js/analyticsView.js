/**
 * Member 4: AI Fraud Detection & Analytics Dashboard Controller
 */

const analyticsView = {
  charts: {},

  async loadAnalytics() {
    try {
      const res = await fetch(`${API_BASE}/analytics/dashboard`);
      const data = await res.json();

      if (data.success) {
        this.renderScorecard(data.summary, data.recentAnomalies);
        this.renderCharts(data.charts);
        this.renderAnomalies(data.recentAnomalies);
      }
    } catch (err) {
      console.error('Failed to load analytics dashboard:', err);
    }
  },

  renderScorecard(summary, anomalies) {
    if (!summary) return;

    const circle = document.getElementById('ai-risk-circle');
    const scoreVal = document.getElementById('ai-risk-number');
    const badge = document.getElementById('ai-risk-badge');
    const summaryText = document.getElementById('ai-risk-summary-text');

    scoreVal.textContent = `${summary.aiIntegrityRiskScore}%`;

    if (summary.aiRiskLevel === 'CRITICAL' || !summary.isBlockchainSecure) {
      circle.className = 'risk-gauge-circle risk-critical';
      badge.className = 'badge-pill danger';
      badge.textContent = `STATUS: ${summary.aiRiskLevel} THREAT`;
      summaryText.textContent = 'CRITICAL ALERT: Potential malicious anomalies or cryptographic tampering detected! Immediate auditor review recommended.';
    } else {
      circle.className = 'risk-gauge-circle';
      badge.className = 'badge-pill secure';
      badge.textContent = `STATUS: ${summary.aiRiskLevel}`;
      summaryText.textContent = 'Statistical anomaly filters and machine learning risk scorers indicate healthy voting activity. Cryptographic chain integrity is intact.';
    }

    const duplicateCount = anomalies ? anomalies.filter((a) => a.anomaly_type.includes('DUPLICATE')).length : 0;
    const tamperCount = anomalies ? anomalies.filter((a) => a.anomaly_type.includes('TAMPER')).length : 0;

    document.getElementById('ai-duplicate-stat').textContent = `${duplicateCount} Blocked`;
    document.getElementById('ai-tamper-stat').textContent = `${tamperCount} Caught`;
  },

  renderCharts(chartsData) {
    if (!chartsData) return;

    // 1. Candidate Vote Share Doughnut Chart
    const candCtx = document.getElementById('chart-candidate-share');
    if (candCtx) {
      if (this.charts.candidateShare) this.charts.candidateShare.destroy();
      this.charts.candidateShare = new Chart(candCtx, {
        type: 'doughnut',
        data: {
          labels: chartsData.candidateDistribution.labels,
          datasets: [{
            data: chartsData.candidateDistribution.data,
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'],
            borderWidth: 2,
            borderColor: '#131b2e'
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } }
          }
        }
      });
    }

    // 2. Hourly Voting Velocity Line Chart
    const velCtx = document.getElementById('chart-hourly-velocity');
    if (velCtx) {
      if (this.charts.velocity) this.charts.velocity.destroy();
      this.charts.velocity = new Chart(velCtx, {
        type: 'line',
        data: {
          labels: chartsData.votingTimeline.labels,
          datasets: [{
            label: 'Votes Cast / Hour',
            data: chartsData.votingTimeline.data,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointBackgroundColor: '#60a5fa'
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } }
          },
          plugins: { legend: { display: false } }
        }
      });
    }

    // 3. Demographics by Age
    const ageCtx = document.getElementById('chart-age-demographics');
    if (ageCtx) {
      if (this.charts.age) this.charts.age.destroy();
      this.charts.age = new Chart(ageCtx, {
        type: 'bar',
        data: {
          labels: Object.keys(chartsData.demographics.ageGroups),
          datasets: [{
            label: 'Citizens Registered',
            data: Object.values(chartsData.demographics.ageGroups),
            backgroundColor: '#8b5cf6',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
            x: { grid: { display: false }, ticks: { color: '#64748b' } }
          },
          plugins: { legend: { display: false } }
        }
      });
    }

    // 4. Demographics by Gender
    const genCtx = document.getElementById('chart-gender-demographics');
    if (genCtx) {
      if (this.charts.gender) this.charts.gender.destroy();
      this.charts.gender = new Chart(genCtx, {
        type: 'bar',
        data: {
          labels: Object.keys(chartsData.demographics.genderSplit),
          datasets: [{
            label: 'Gender Split',
            data: Object.values(chartsData.demographics.genderSplit),
            backgroundColor: ['#38bdf8', '#f472b6', '#a78bfa'],
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
            x: { grid: { display: false }, ticks: { color: '#64748b' } }
          },
          plugins: { legend: { display: false } }
        }
      });
    }
  },

  renderAnomalies(anomalies) {
    const box = document.getElementById('ai-anomalies-list');
    if (!box) return;

    if (!anomalies || anomalies.length === 0) {
      box.innerHTML = '<p class="text-muted text-center text-sm">No security anomalies detected in this session.</p>';
      return;
    }

    box.innerHTML = anomalies.map((a) => `
      <div class="anomaly-item ${a.score >= 70 ? '' : 'severity-warn'}">
        <div>
          <div class="anomaly-item-title">${a.anomaly_type} (Threat Score: ${a.score}/100)</div>
          <div class="anomaly-item-desc">${a.details}</div>
        </div>
        <div class="anomaly-item-time">${new Date(a.timestamp).toLocaleTimeString()}</div>
      </div>
    `).join('');
  },

  async runPythonML() {
    app.showToast('Executing AI Machine Learning Anomaly Detection Model...', 'info');

    try {
      const res = await fetch(`${API_BASE}/analytics/run-ml-detection`, { method: 'POST' });
      const data = await res.json();

      if (data.success && data.analysis) {
        const a = data.analysis;
        alert(`🤖 AI FRAUD DETECTION INFERENCE REPORT\n` +
              `----------------------------------------\n` +
              `Model: ${a.model}\n` +
              `Risk Category: ${a.risk_level}\n` +
              `Integrity Risk Score: ${a.integrity_risk_score}%\n` +
              `Total Ballots Processed: ${a.total_votes_cast} / ${a.total_registered}\n\n` +
              `Key Findings:\n• ` + a.findings.join('\n• ')
        );
        this.loadAnalytics();
        app.fetchSystemStats();
      } else {
        app.showToast('ML execution completed.', 'info');
      }
    } catch (err) {
      app.showToast('Failed to execute AI ML model.', 'error');
    }
  },

  async openOfficialReportModal() {
    try {
      const res = await fetch(`${API_BASE}/analytics/export-report`);
      const data = await res.json();

      if (data.success) {
        const r = data.report;
        const printContent = document.getElementById('printable-report-content');

        printContent.innerHTML = `
          <div class="report-header">
            <div class="report-seal"><i class="fa-solid fa-landmark"></i></div>
            <h2 style="font-size: 1.5rem; font-weight: 800; margin: 0.5rem 0;">ELECTION COMMISSION OF INDIA</h2>
            <h3 style="font-size: 1.1rem; color: #1e3a8a; font-weight: 700;">${r.reportTitle}</h3>
            <p style="font-size: 0.8rem; color: #64748b;">Election: <strong>${r.electionTitle}</strong> | Generated on: ${new Date(r.generatedAt).toLocaleString()}</p>
          </div>

          <div class="report-winner-box">
            <h4 style="color: #15803d; font-size: 0.9rem; text-transform: uppercase; font-weight: 800;">Official Proclamation of Winner</h4>
            <div style="font-size: 1.6rem; font-weight: 800; color: #0f172a; margin: 0.3rem 0;">
              ${r.proclamationOfWinner.symbol || '🏆'} ${r.proclamationOfWinner.candidateName || 'TBD'}
            </div>
            <p style="font-size: 0.9rem; color: #334155;">
              Party: <strong>${r.proclamationOfWinner.party || 'N/A'}</strong> | Votes: <strong>${r.proclamationOfWinner.votesSecured || 0}</strong> (${r.proclamationOfWinner.percentage || '0%'})
            </p>
          </div>

          <h4 style="font-size: 1rem; font-weight: 700; margin: 1.5rem 0 0.5rem;">Official Candidate Tally</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1.5rem;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left;">
                <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">Candidate</th>
                <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">Party</th>
                <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">Total Votes</th>
                <th style="padding: 0.5rem; border: 1px solid #cbd5e1;">Vote Share</th>
              </tr>
            </thead>
            <tbody>
              ${r.candidateTally.map((c) => `
                <tr>
                  <td style="padding: 0.5rem; border: 1px solid #e2e8f0;">${c.symbol} <strong>${c.candidate}</strong></td>
                  <td style="padding: 0.5rem; border: 1px solid #e2e8f0;">${c.party}</td>
                  <td style="padding: 0.5rem; border: 1px solid #e2e8f0;"><strong>${c.votes}</strong></td>
                  <td style="padding: 0.5rem; border: 1px solid #e2e8f0;">${c.percentage}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <h4 style="font-size: 1rem; font-weight: 700; margin: 1.5rem 0 0.5rem;">Cryptographic Blockchain Verification Seal</h4>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 1rem; font-size: 0.8rem; font-family: monospace;">
            <div>• <strong>Consensus Protocol:</strong> ${r.cryptographicCertification.consensusAlgorithm}</div>
            <div>• <strong>Total Blocks Mined:</strong> ${r.cryptographicCertification.totalBlocksMined}</div>
            <div>• <strong>Ledger Tamper Status:</strong> <span style="color: ${r.cryptographicCertification.isBlockchainTamperFree ? '#16a34a' : '#dc2626'}; font-weight: bold;">${r.cryptographicCertification.blockchainIntegrityStatus}</span></div>
            <div>• <strong>Genesis Hash:</strong> ${r.cryptographicCertification.genesisHash}</div>
            <div>• <strong>Latest Block Hash:</strong> ${r.cryptographicCertification.latestBlockHash}</div>
          </div>

          <div style="margin-top: 2rem; display: flex; justify-content: space-between; font-size: 0.8rem; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
            <span>Digital Hash ID: ${Math.random().toString(36).substring(2, 15).toUpperCase()}</span>
            <span>Certified by Central Election Portal & AI Audit Subsystem</span>
          </div>
        `;

        app.openModal('modal-report');
      }
    } catch (err) {
      app.showToast('Failed to generate report.', 'error');
    }
  }
};
