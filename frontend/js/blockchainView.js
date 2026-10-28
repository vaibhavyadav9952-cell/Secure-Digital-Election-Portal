/**
 * Member 3: Blockchain & Security Core Controller
 */

const blockchainView = {
  chainData: [],
  isValid: true,
  validationDetail: null,

  async fetchChain() {
    try {
      const res = await fetch(`${API_BASE}/blockchain/chain`);
      const data = await res.json();

      if (data.success) {
        this.chainData = data.chain;
        this.isValid = data.isChainValid;
        this.validationDetail = data.validationDetail;
        this.renderBlocks();
        this.renderIntegrityBanner();
      }
    } catch (err) {
      console.error('Failed to fetch blockchain:', err);
    }
  },

  renderBlocks() {
    const container = document.getElementById('blockchain-blocks-flow');
    if (!container) return;

    if (this.chainData.length === 0) {
      container.innerHTML = '<p class="text-muted">No blocks on chain.</p>';
      return;
    }

    const corruptedIndex = this.validationDetail ? this.validationDetail.corruptedIndex : null;

    container.innerHTML = this.chainData.map((b, i) => {
      const isCorrupted = corruptedIndex !== null && b.index >= corruptedIndex;
      const isGenesis = b.index === 0;

      let txLabel = 'Genesis Seed';
      if (!isGenesis && Array.isArray(b.transactions)) {
        txLabel = `${b.transactions.length} Encrypted Ballot(s)`;
      }

      return `
        <div class="block-card ${isCorrupted ? 'tampered' : ''}">
          <div class="block-header">
            <span class="block-num"><i class="fa-solid fa-cube"></i> Block #${b.index}</span>
            <span class="badge-pill ${isCorrupted ? 'danger' : 'secure'}">
              ${isCorrupted ? 'TAMPERED' : isGenesis ? 'GENESIS' : 'VERIFIED'}
            </span>
          </div>

          <div class="block-prop">
            <div class="block-prop-label">Timestamp</div>
            <div class="block-prop-val">${new Date(b.timestamp).toLocaleTimeString()}</div>
          </div>

          <div class="block-prop">
            <div class="block-prop-label">Previous Hash</div>
            <div class="block-prop-val" title="${b.previousHash}">${b.previousHash.slice(0, 16)}...${b.previousHash.slice(-8)}</div>
          </div>

          <div class="block-prop">
            <div class="block-prop-label">Merkle Root</div>
            <div class="block-prop-val" title="${b.merkleRoot}">${b.merkleRoot ? b.merkleRoot.slice(0, 16) + '...' + b.merkleRoot.slice(-8) : 'N/A'}</div>
          </div>

          <div class="block-prop">
            <div class="block-prop-label">Block Hash (SHA-256)</div>
            <div class="block-prop-val" style="color: #38bdf8;" title="${b.hash}">${b.hash.slice(0, 16)}...${b.hash.slice(-8)}</div>
          </div>

          <div class="block-prop">
            <div class="block-prop-label">Proof-of-Work Nonce</div>
            <div class="block-prop-val">Nonce: ${b.nonce} | Data: ${txLabel}</div>
          </div>
        </div>
        ${i < this.chainData.length - 1 ? '<div class="chain-arrow"><i class="fa-solid fa-link"></i></div>' : ''}
      `;
    }).join('');
  },

  renderIntegrityBanner() {
    const banner = document.getElementById('chain-integrity-banner');
    const title = document.getElementById('chain-integrity-title');
    const desc = document.getElementById('chain-integrity-desc');

    if (this.isValid) {
      banner.className = 'alert-box alert-success';
      title.textContent = 'BLOCKCHAIN INTEGRITY: 100% SECURE & VERIFIED';
      desc.textContent = 'All SHA-256 hashes, previous hash pointers, and Merkle tree roots match cryptographic signatures across all blocks.';
    } else {
      banner.className = 'alert-box alert-danger';
      title.textContent = 'SECURITY ALERT: BLOCKCHAIN TAMPER DETECTED!';
      desc.textContent = this.validationDetail ? this.validationDetail.reason : 'Cryptographic mismatch discovered in ledger!';
    }
  },

  showTamperModal() {
    app.openModal('modal-tamper');
  },

  async executeTamper() {
    const blockIndex = document.getElementById('tamper-block-index').value;
    const fakeCand = document.getElementById('tamper-fake-candidate').value;

    try {
      const res = await fetch(`${API_BASE}/blockchain/tamper`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockIndex, fakeCandidateName: fakeCand })
      });
      const data = await res.json();

      if (data.success) {
        app.showToast('Tamper injected! Validating blockchain integrity...', 'warning');
        app.closeModal('modal-tamper');
        await this.fetchChain();
        await this.fetchAuditLogs();
        app.fetchSystemStats();
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('Tamper execution failed.', 'error');
    }
  },

  async repairChain() {
    try {
      const res = await fetch(`${API_BASE}/blockchain/repair`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        app.showToast('Blockchain successfully re-mined and cryptographic consensus restored!', 'success');
        await this.fetchChain();
        await this.fetchAuditLogs();
        app.fetchSystemStats();
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('Failed to repair chain.', 'error');
    }
  },

  async verifyReceiptInput() {
    const token = document.getElementById('verify-receipt-input').value.trim();
    if (!token) {
      app.showToast('Please enter a receipt token hash.', 'warning');
      return;
    }

    const resultBox = document.getElementById('receipt-verification-result');
    resultBox.style.display = 'block';
    resultBox.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Verifying cryptographic proof on chain...</div>';

    try {
      const res = await fetch(`${API_BASE}/blockchain/verify-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptToken: token })
      });
      const data = await res.json();

      if (data.success) {
        const d = data.receiptDetails;
        resultBox.innerHTML = `
          <div class="alert-box alert-success" style="margin-bottom: 0;">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Cryptographic Inclusion Proof Verified!</strong><br />
              <span class="text-xs">
                Found in <strong>Block #${d.blockIndex}</strong> | Timestamp: ${new Date(d.timestamp).toLocaleString()}<br />
                Block Hash: <span class="font-mono">${d.blockHash.slice(0, 24)}...</span><br />
                Status: <strong>Immutable on SHA-256 Ledger</strong> (Secret Ballot Preserved)
              </span>
            </div>
          </div>
        `;
      } else {
        resultBox.innerHTML = `
          <div class="alert-box alert-danger" style="margin-bottom: 0;">
            <i class="fa-solid fa-circle-xmark"></i>
            <div>
              <strong>Receipt Not Found</strong><br />
              <span class="text-xs">${data.message}</span>
            </div>
          </div>
        `;
      }
    } catch (err) {
      resultBox.innerHTML = '<div class="alert-box alert-danger">Error verifying receipt.</div>';
    }
  },

  async fetchAuditLogs() {
    try {
      const res = await fetch(`${API_BASE}/blockchain/audit-logs`);
      const data = await res.json();

      if (data.success) {
        const tbody = document.getElementById('audit-logs-tbody');
        if (tbody) {
          tbody.innerHTML = data.logs.map((log) => `
            <tr>
              <td class="text-xs font-mono text-muted">${new Date(log.timestamp).toLocaleTimeString()}</td>
              <td><strong>${log.event_type}</strong></td>
              <td class="text-xs">${log.actor}</td>
              <td>
                <span class="badge-pill ${log.severity === 'CRITICAL' ? 'danger' : log.severity === 'WARN' ? 'warn' : 'secure'}">
                  ${log.severity}
                </span>
              </td>
            </tr>
          `).join('');
        }
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    }
  }
};
