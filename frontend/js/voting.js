/**
 * Member 2: Voting Portal & Ballot Controller
 */

const voting = {
  candidates: [],
  selectedCandidateId: null,
  isCameraActive: false,

  async loadBallot() {
    try {
      const res = await fetch(`${API_BASE}/election`);
      const data = await res.json();

      if (data.success) {
        this.candidates = data.candidates;
        this.renderCandidates();
        this.updateVoterStatus();

        if (data.election) {
          document.getElementById('voting-election-title').textContent = data.election.title;
        }
      }
    } catch (err) {
      console.error('Failed to load ballot:', err);
    }
  },

  renderCandidates() {
    const list = document.getElementById('candidates-ballot-list');
    if (!list) return;

    if (this.candidates.length === 0) {
      list.innerHTML = '<p class="text-muted text-center">No active candidates listed for this election.</p>';
      return;
    }

    list.innerHTML = this.candidates.map((cand) => `
      <div class="candidate-ballot-card ${this.selectedCandidateId === cand.id ? 'selected' : ''}" 
           onclick="voting.selectCandidate(${cand.id})" id="cand-card-${cand.id}">
        <div class="cand-symbol-box">${cand.symbol}</div>
        <div class="cand-info">
          <h4>${cand.name}</h4>
          <div class="cand-party">${cand.party}</div>
          <div class="cand-manifesto">${cand.manifesto || ''}</div>
        </div>
        <div class="cand-radio-selector">
          ${this.selectedCandidateId === cand.id ? '<i class="fa-solid fa-check" style="font-size: 0.75rem;"></i>' : ''}
        </div>
      </div>
    `).join('');
  },

  selectCandidate(id) {
    if (!app.state.user) {
      app.showToast('Please login to cast your ballot.', 'warning');
      auth.showLoginModal();
      return;
    }

    if (app.state.user.has_voted) {
      app.showToast('You have already cast your ballot in this election.', 'error');
      return;
    }

    this.selectedCandidateId = id;
    this.renderCandidates();

    const chosen = this.candidates.find((c) => c.id === id);
    const summary = document.getElementById('selected-candidate-preview');
    if (chosen && summary) {
      summary.innerHTML = `Selected: <strong>${chosen.symbol} ${chosen.name}</strong> (${chosen.party})`;
      document.getElementById('btn-cast-vote').disabled = false;
    }
  },

  toggleCamera() {
    const box = document.getElementById('camera-box');
    const btnText = document.getElementById('camera-btn-text');

    this.isCameraActive = !this.isCameraActive;
    if (this.isCameraActive) {
      box.style.display = 'block';
      btnText.textContent = 'Stop Camera';
      app.showToast('Biometric face detector initialized.', 'info');
    } else {
      box.style.display = 'none';
      btnText.textContent = 'Start Camera Simulator';
    }
  },

  async submitVote() {
    if (!app.state.token || !app.state.user) {
      app.showToast('Please log in to cast your ballot.', 'warning');
      auth.showLoginModal();
      return;
    }

    if (!this.selectedCandidateId) {
      app.showToast('Please select a candidate to vote.', 'warning');
      return;
    }

    const candidate = this.candidates.find((c) => c.id === this.selectedCandidateId);
    const confirmed = confirm(`Are you sure you want to cast your ballot for:\n\n${candidate.symbol} ${candidate.name} (${candidate.party})?\n\nThis action is permanent and sealed onto the blockchain.`);
    if (!confirmed) return;

    const btn = document.getElementById('btn-cast-vote');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mining Block & Encrypting Vote...';

    try {
      const res = await fetch(`${API_BASE}/election/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${app.state.token}`
        },
        body: JSON.stringify({ candidateId: this.selectedCandidateId })
      });
      const data = await res.json();

      if (data.success) {
        app.showToast(data.message, 'success');

        // Update current local user state
        app.state.user.has_voted = 1;
        app.state.user.receipt_hash = data.receipt.receiptToken;
        localStorage.setItem('user', JSON.stringify(app.state.user));

        // Display Cryptographic Receipt in Sidebar
        this.displayReceipt(data.receipt);
        this.updateVoterStatus();
      } else {
        app.showToast(data.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-lock"></i> Seal & Cast Vote on Blockchain';
      }
    } catch (err) {
      app.showToast('Failed to connect to voting server.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock"></i> Seal & Cast Vote on Blockchain';
    }
  },

  displayReceipt(receipt) {
    const box = document.getElementById('sidebar-receipt-box');
    box.style.display = 'block';

    document.getElementById('receipt-token-text').textContent = receipt.receiptToken || receipt.receipt_hash;
    document.getElementById('receipt-block-index').textContent = `#${receipt.blockIndex || 'N/A'}`;
    document.getElementById('receipt-block-hash').textContent = receipt.blockHash || 'N/A';
  },

  updateVoterStatus() {
    const banner = document.getElementById('voter-status-banner');
    const msg = document.getElementById('voter-status-msg');
    const infoTable = document.getElementById('sidebar-voter-info');
    const castBtn = document.getElementById('btn-cast-vote');

    if (!app.state.user) {
      banner.className = 'alert-box alert-info';
      msg.innerHTML = 'Please log in with your Voter ID or registered Aadhaar to cast your ballot.';
      infoTable.innerHTML = '<p class="text-muted text-sm">Not logged in. Use "1-Click Demo Login" or register.</p>';
      if (castBtn) castBtn.disabled = true;
      return;
    }

    const u = app.state.user;

    infoTable.innerHTML = `
      <div class="voter-info-row"><span>Citizen:</span><strong>${u.full_name}</strong></div>
      <div class="voter-info-row"><span>Voter ID:</span><strong class="font-mono" style="color: #60a5fa;">${u.voter_id}</strong></div>
      <div class="voter-info-row"><span>Aadhaar:</span><span class="font-mono">**** **** ${u.aadhaar_no ? u.aadhaar_no.slice(-4) : '0000'}</span></div>
      <div class="voter-info-row"><span>Voting Status:</span>
        <span class="badge-pill ${u.has_voted ? 'secure' : 'warn'}">
          ${u.has_voted ? 'Voted' : 'Eligible To Vote'}
        </span>
      </div>
    `;

    if (u.has_voted) {
      banner.className = 'alert-box alert-success';
      msg.innerHTML = `<strong>Ballot Sealed & Recorded!</strong> You have successfully voted. Your cryptographic receipt is available on the right.`;
      if (castBtn) {
        castBtn.disabled = true;
        castBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Ballot Already Cast on Blockchain';
      }

      if (u.receipt_hash) {
        this.displayReceipt({
          receiptToken: u.receipt_hash,
          blockIndex: 'Mined',
          blockHash: 'Verified in Ledger'
        });
      }
    } else {
      banner.className = 'alert-box alert-info';
      msg.innerHTML = `Authenticated as <strong>${u.full_name}</strong> (${u.voter_id}). Please select your candidate and click "Seal & Cast Vote".`;
      if (castBtn) {
        castBtn.disabled = !this.selectedCandidateId;
        castBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Seal & Cast Vote on Blockchain';
      }
    }
  },

  verifyCurrentReceipt() {
    const token = document.getElementById('receipt-token-text').textContent;
    app.navigateTo('tab-blockchain');
    document.getElementById('verify-receipt-input').value = token;
    blockchainView.verifyReceiptInput();
  }
};
