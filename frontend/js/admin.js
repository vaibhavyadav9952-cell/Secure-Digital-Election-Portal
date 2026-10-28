/**
 * Member 2: Admin Election Management Controller
 */

const admin = {
  async loadDashboard() {
    if (!app.state.user || app.state.user.role !== 'admin') {
      app.showToast('Administrator access required.', 'error');
      app.navigateTo('tab-home');
      return;
    }

    await this.fetchCandidates();
    await this.fetchVoterDirectory();
  },

  async fetchCandidates() {
    try {
      const res = await fetch(`${API_BASE}/election`);
      const data = await res.json();

      if (data.success) {
        const tbody = document.getElementById('admin-candidates-tbody');
        tbody.innerHTML = data.candidates.map((c) => `
          <tr>
            <td style="font-size: 1.5rem;">${c.symbol}</td>
            <td><strong>${c.name}</strong></td>
            <td>${c.party}</td>
            <td>${c.constituency}</td>
            <td><strong style="color: #60a5fa;">${c.vote_count}</strong> votes</td>
            <td>
              <button class="btn btn-danger btn-sm" onclick="admin.handleDeleteCandidate(${c.id})">
                <i class="fa-solid fa-trash"></i> Delete
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.error('Failed to load admin candidates:', err);
    }
  },

  async fetchVoterDirectory() {
    try {
      const res = await fetch(`${API_BASE}/election/voters`, {
        headers: { 'Authorization': `Bearer ${app.state.token}` }
      });
      const data = await res.json();

      if (data.success) {
        const tbody = document.getElementById('admin-voters-tbody');
        tbody.innerHTML = data.voters.map((v) => `
          <tr>
            <td class="font-mono text-xs">${v.voter_id}</td>
            <td><strong>${v.full_name}</strong></td>
            <td class="text-xs text-muted">${v.email || 'N/A'}</td>
            <td class="text-xs text-muted">${v.mobile}</td>
            <td>
              <span class="badge-pill ${v.has_voted ? 'secure' : 'warn'}">
                ${v.has_voted ? 'Voted' : 'Not Voted'}
              </span>
            </td>
            <td class="text-xs text-muted font-mono">${v.voted_at ? new Date(v.voted_at).toLocaleTimeString() : '—'}</td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.error('Failed to fetch voter roster:', err);
    }
  },

  async setElectionStatus(status) {
    try {
      const res = await fetch(`${API_BASE}/election/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${app.state.token}`
        },
        body: JSON.stringify({ status })
      });
      const data = await res.json();

      if (data.success) {
        app.showToast(data.message, 'success');
        app.fetchSystemStats();
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('Failed to update election status.', 'error');
    }
  },

  showAddCandidateModal() {
    app.openModal('modal-add-candidate');
  },

  async handleAddCandidate() {
    const name = document.getElementById('add-cand-name').value.trim();
    const party = document.getElementById('add-cand-party').value.trim();
    const symbol = document.getElementById('add-cand-symbol').value.trim();
    const constituency = document.getElementById('add-cand-constituency').value.trim();
    const manifesto = document.getElementById('add-cand-manifesto').value.trim();

    if (!name || !party || !symbol) {
      app.showToast('Name, party, and symbol are required.', 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/election/candidates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${app.state.token}`
        },
        body: JSON.stringify({ name, party, symbol, constituency, manifesto })
      });
      const data = await res.json();

      if (data.success) {
        app.showToast(data.message, 'success');
        app.closeModal('modal-add-candidate');
        this.fetchCandidates();
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('Failed to add candidate.', 'error');
    }
  },

  async handleDeleteCandidate(id) {
    if (!confirm('Are you sure you want to delete this candidate?')) return;

    try {
      const res = await fetch(`${API_BASE}/election/candidates/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${app.state.token}` }
      });
      const data = await res.json();

      if (data.success) {
        app.showToast(data.message, 'info');
        this.fetchCandidates();
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('Failed to delete candidate.', 'error');
    }
  }
};
