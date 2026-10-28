/**
 * App Core Controller: Routing, State, Notifications, and Polling
 */

const API_BASE = '/api';

const app = {
  state: {
    token: localStorage.getItem('token') || null,
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    currentTab: 'tab-home',
    election: null,
    pollTimer: null
  },

  init() {
    this.setupEventListeners();
    this.checkSession();
    this.navigateTo('tab-home');
    this.fetchSystemStats();

    // Periodic live sync every 4 seconds
    this.state.pollTimer = setInterval(() => {
      this.fetchSystemStats();
    }, 4000);
  },

  setupEventListeners() {
    // Navigation tab click handlers
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        this.navigateTo(target);
      });
    });

    // Close modals on escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
      }
    });
  },

  navigateTo(tabId) {
    this.state.currentTab = tabId;

    document.querySelectorAll('.nav-tab').forEach((t) => {
      if (t.getAttribute('data-tab') === tabId) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-pane').forEach((p) => {
      if (p.id === tabId) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });

    // Trigger tab-specific loaders
    if (tabId === 'tab-vote') {
      voting.loadBallot();
    } else if (tabId === 'tab-blockchain') {
      blockchainView.fetchChain();
      blockchainView.fetchAuditLogs();
    } else if (tabId === 'tab-analytics') {
      analyticsView.loadAnalytics();
    } else if (tabId === 'tab-admin') {
      admin.loadDashboard();
    }
  },

  openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  },

  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check text-success';
    else if (type === 'error') icon = 'fa-circle-exclamation text-danger';
    else if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  async fetchSystemStats() {
    try {
      const res = await fetch(`${API_BASE}/analytics/dashboard`);
      const data = await res.json();
      if (data.success) {
        this.updateHeaderMetrics(data);
      }
    } catch (err) {
      console.warn('Live sync poll warning:', err.message);
    }
  },

  updateHeaderMetrics(data) {
    const { summary, election } = data;
    if (!summary) return;

    // Update system ribbon
    const statusEl = document.getElementById('ribbon-election-status');
    if (statusEl && election) {
      statusEl.textContent = election.status;
      statusEl.className = election.status === 'ACTIVE' ? 'text-success' : 'text-danger';
    }

    const blocksEl = document.getElementById('ribbon-blocks-count');
    if (blocksEl) blocksEl.textContent = summary.totalBlocksMined;

    const turnoutEl = document.getElementById('ribbon-turnout-pct');
    if (turnoutEl) turnoutEl.textContent = `${summary.turnoutPercentage}%`;

    const riskEl = document.getElementById('ribbon-risk-score');
    if (riskEl) {
      riskEl.textContent = `${summary.aiRiskLevel} (${summary.aiIntegrityRiskScore}%)`;
      riskEl.className = summary.aiRiskLevel === 'LOW' ? 'text-success' : 'text-danger';
    }

    // Update nav blockchain status
    const chainStatusNav = document.getElementById('nav-chain-status');
    if (chainStatusNav) {
      if (summary.isBlockchainSecure) {
        chainStatusNav.textContent = 'Secure';
        chainStatusNav.className = 'badge-pill secure';
      } else {
        chainStatusNav.textContent = 'Tampered!';
        chainStatusNav.className = 'badge-pill danger';
      }
    }

    // Update Hero Cards on Home
    const homeReg = document.getElementById('home-registered-count');
    if (homeReg) homeReg.textContent = summary.totalVoters;

    const homeVotes = document.getElementById('home-votes-cast-count');
    if (homeVotes) homeVotes.textContent = summary.totalVoted;

    const homeBlocks = document.getElementById('home-blocks-count');
    if (homeBlocks) homeBlocks.textContent = summary.totalBlocksMined;

    const homeHealth = document.getElementById('home-ai-health');
    if (homeHealth) homeHealth.textContent = summary.isBlockchainSecure ? '100% Secure' : 'Compromised!';
  },

  checkSession() {
    if (this.state.token && this.state.user) {
      auth.renderUserProfile(this.state.user);
    } else {
      auth.renderAnonymous();
    }
  },

  async showAadhaarDirectoryModal() {
    try {
      const res = await fetch(`${API_BASE}/auth/aadhaar-directory`);
      const data = await res.json();
      if (!data.success) return;

      const grid = document.getElementById('aadhaar-directory-grid');
      grid.innerHTML = data.records.map((c) => `
        <div class="aadhaar-sample-card" onclick="auth.selectDemoAadhaar('${c.aadhaar_no}')">
          <div class="flex-between">
            <strong style="color: #60a5fa;">${c.full_name}</strong>
            <span class="badge-pill ${c.is_registered ? 'secure' : 'warn'}">
              ${c.is_registered ? 'Registered' : 'Not Registered'}
            </span>
          </div>
          <div class="font-mono text-sm mt-2">Aadhaar: ${c.aadhaar_no}</div>
          <div class="text-xs text-muted">Phone: ${c.mobile} | DOB: ${c.dob} (${c.gender})</div>
          <div class="text-xs text-muted">${c.address}</div>
        </div>
      `).join('');

      this.openModal('modal-aadhaar-directory');
    } catch (err) {
      this.showToast('Failed to load Aadhaar directory', 'error');
    }
  },

  showDemoQuickLoginModal() {
    this.openModal('modal-login');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
