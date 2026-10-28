/**
 * Member 1: Authentication & User Management Controller
 */

const auth = {
  currentAadhaarData: null,

  showRegisterModal() {
    this.resetWizard();
    app.openModal('modal-register');
  },

  showLoginModal() {
    app.openModal('modal-login');
  },

  resetWizard() {
    document.getElementById('reg-step-1').style.display = 'block';
    document.getElementById('reg-step-2').style.display = 'none';
    document.getElementById('reg-step-3').style.display = 'none';
    document.getElementById('reg-step-success').style.display = 'none';

    document.getElementById('step-badge-1').className = 'step-badge active';
    document.getElementById('step-badge-2').className = 'step-badge';
    document.getElementById('step-badge-3').className = 'step-badge';

    document.getElementById('reg-aadhaar-input').value = '';
    document.getElementById('reg-otp-input').value = '';
    document.getElementById('aadhaar-verify-preview').style.display = 'none';
    this.currentAadhaarData = null;
  },

  selectDemoAadhaar(aadhaarNo) {
    app.closeModal('modal-aadhaar-directory');
    this.showRegisterModal();
    document.getElementById('reg-aadhaar-input').value = aadhaarNo;
    this.handleAadhaarLookup();
  },

  /**
   * Step 1: Aadhaar Lookup & Verification in UIDAI Database
   */
  async handleAadhaarLookup() {
    const aadhaarNo = document.getElementById('reg-aadhaar-input').value.trim();
    if (!aadhaarNo) {
      app.showToast('Please enter a 12-digit Aadhaar number.', 'warning');
      return;
    }

    const btn = document.getElementById('btn-verify-aadhaar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying with UIDAI...';

    try {
      const res = await fetch(`${API_BASE}/auth/aadhaar-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aadhaar_no: aadhaarNo })
      });
      const data = await res.json();

      if (!data.success) {
        app.showToast(data.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-fingerprint"></i> Verify Aadhaar with UIDAI';
        return;
      }

      this.currentAadhaarData = data.citizen;

      // Show preview
      const preview = document.getElementById('aadhaar-verify-preview');
      preview.innerHTML = `
        <img src="${data.citizen.photo_url}" class="citizen-photo" alt="Photo" />
        <div>
          <h4 style="color: #60a5fa;">${data.citizen.full_name}</h4>
          <div class="text-xs text-muted">DOB: ${data.citizen.dob} (Age: ${data.citizen.age} yrs - <span class="text-success">Eligible</span>)</div>
          <div class="text-xs text-muted">Mobile: ${data.citizen.maskedMobile}</div>
          <div class="text-xs text-muted">Address: ${data.citizen.address}</div>
        </div>
      `;
      preview.style.display = 'grid';

      // Automatically trigger OTP dispatch
      await this.sendOtp(aadhaarNo);

      // Transition to Step 2
      setTimeout(() => {
        document.getElementById('reg-step-1').style.display = 'none';
        document.getElementById('reg-step-2').style.display = 'block';
        document.getElementById('step-badge-1').className = 'step-badge';
        document.getElementById('step-badge-2').className = 'step-badge active';
      }, 1000);
    } catch (err) {
      app.showToast('Server connection error. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-fingerprint"></i> Verify Aadhaar with UIDAI';
    }
  },

  /**
   * Step 2: Send OTP
   */
  async sendOtp(aadhaarNo) {
    try {
      const res = await fetch(`${API_BASE}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aadhaar_no: aadhaarNo })
      });
      const data = await res.json();
      if (data.success) {
        // Show simulated SMS body
        const smsBox = document.getElementById('sms-sim-body');
        smsBox.innerHTML = `"Your Secure Election Portal OTP is <strong style="color: #38bdf8; font-size: 1.1rem;">${data.otpPreview}</strong>. Valid for 5 minutes."`;
        // Pre-fill OTP for immediate fast evaluation
        document.getElementById('reg-otp-input').value = data.otpPreview;
        app.showToast(data.message, 'success');
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('Failed to dispatch OTP.', 'error');
    }
  },

  async resendOtp() {
    if (this.currentAadhaarData) {
      await this.sendOtp(this.currentAadhaarData.aadhaar_no);
    }
  },

  /**
   * Step 3: Verify OTP
   */
  async handleVerifyOtp() {
    const otpCode = document.getElementById('reg-otp-input').value.trim();
    if (!otpCode) {
      app.showToast('Please enter the 6-digit OTP code.', 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aadhaar_no: this.currentAadhaarData.aadhaar_no,
          otp_code: otpCode
        })
      });
      const data = await res.json();

      if (data.success) {
        app.showToast(data.message, 'success');
        document.getElementById('reg-step-2').style.display = 'none';
        document.getElementById('reg-step-3').style.display = 'block';
        document.getElementById('step-badge-2').className = 'step-badge';
        document.getElementById('step-badge-3').className = 'step-badge active';
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('OTP verification failed.', 'error');
    }
  },

  /**
   * Step 4: Complete Registration and Issue Digital Voter Card
   */
  async handleFinalRegistration() {
    const email = document.getElementById('reg-email-input').value.trim();
    const pass = document.getElementById('reg-pass-input').value;
    const passConfirm = document.getElementById('reg-pass-confirm').value;

    if (!email || !pass) {
      app.showToast('Please fill in email and password.', 'warning');
      return;
    }

    if (pass !== passConfirm) {
      app.showToast('Passwords do not match.', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aadhaar_no: this.currentAadhaarData.aadhaar_no,
          email,
          password: pass
        })
      });
      const data = await res.json();

      if (data.success) {
        app.showToast(data.message, 'success');

        // Store session
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.voter));
        app.state.token = data.token;
        app.state.user = data.voter;

        // Render Generated Voter ID Card
        document.getElementById('card-voter-id').textContent = data.voter.voter_id;
        document.getElementById('card-name').textContent = data.voter.full_name;
        document.getElementById('card-aadhaar').textContent = `Aadhaar: **** **** ${data.voter.aadhaar_no.slice(-4)}`;
        document.getElementById('card-dob').textContent = `Email: ${data.voter.email}`;
        if (this.currentAadhaarData.photo_url) {
          document.getElementById('card-photo-img').src = this.currentAadhaarData.photo_url;
        }

        document.getElementById('reg-step-3').style.display = 'none';
        document.getElementById('reg-step-success').style.display = 'block';

        this.renderUserProfile(data.voter);
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('Registration failed. Please try again.', 'error');
    }
  },

  /**
   * User & Admin Login
   */
  async handleLogin() {
    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;

    if (!identifier || !password) {
      app.showToast('Please enter both identifier and password.', 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });
      const data = await res.json();

      if (data.success) {
        app.showToast(data.message, 'success');
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        app.state.token = data.token;
        app.state.user = data.user;

        app.closeModal('modal-login');
        this.renderUserProfile(data.user);

        if (data.user.role === 'admin') {
          app.navigateTo('tab-admin');
        } else {
          app.navigateTo('tab-vote');
        }
      } else {
        app.showToast(data.message, 'error');
      }
    } catch (err) {
      app.showToast('Login request failed.', 'error');
    }
  },

  fillDemoLogin(type) {
    if (type === 'voter') {
      document.getElementById('login-identifier').value = '112233445566';
      document.getElementById('login-password').value = 'voter123';
    } else {
      document.getElementById('login-identifier').value = 'admin';
      document.getElementById('login-password').value = 'admin123';
    }
  },

  renderUserProfile(user) {
    document.getElementById('nav-auth-buttons').style.display = 'none';
    const prof = document.getElementById('nav-user-profile');
    prof.style.display = 'flex';

    document.getElementById('nav-avatar').textContent = user.full_name ? user.full_name[0].toUpperCase() : 'U';
    document.getElementById('nav-user-name').textContent = user.full_name;
    document.getElementById('nav-user-role').textContent = user.role.toUpperCase();

    const adminBtn = document.getElementById('nav-admin-btn');
    if (user.role === 'admin') {
      adminBtn.style.display = 'flex';
    } else {
      adminBtn.style.display = 'none';
    }

    // Update ballot status if on voting page
    voting.updateVoterStatus();
  },

  renderAnonymous() {
    document.getElementById('nav-auth-buttons').style.display = 'flex';
    document.getElementById('nav-user-profile').style.display = 'none';
    document.getElementById('nav-admin-btn').style.display = 'none';
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    app.state.token = null;
    app.state.user = null;
    this.renderAnonymous();
    app.showToast('You have been logged out safely.', 'info');
    app.navigateTo('tab-home');
  }
};
