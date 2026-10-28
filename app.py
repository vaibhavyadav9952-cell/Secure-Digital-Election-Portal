# app.py - Main Flask Application for Secure Digital Election Portal

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash
import bcrypt
import os
import time
from dotenv import load_dotenv

# Load .env secrets BEFORE importing blockchain (which reads env vars for keys)
load_dotenv()

# Import our custom modules
import config
import database as db
from blockchain import (add_vote_to_chain, get_full_chain, verify_chain,
                        get_chain_stats, create_genesis_block, decrypt_ledger)
from face_auth import register_face, verify_face, check_liveness_from_frames, check_single_frame_liveness
from fraud_detection import detect_fraud_on_login, detect_duplicate_vote, get_risk_badge_color, get_risk_level_text, get_fraud_summary

# Initialize Flask app
app = Flask(__name__)
# Use a strong secret key — cookie-based sessions (no filesystem required)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', config.SECRET_KEY)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 3600  # 1 hour
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32 MB (for base64 images)


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def is_logged_in():
    """Check if a user is currently logged in."""
    return 'user_id' in session


def is_admin_logged_in():
    """Check if admin is logged in."""
    return session.get('is_admin', False)


def get_current_user():
    """Get the currently logged-in user's data."""
    if is_logged_in():
        return db.get_user_by_id(session['user_id'])
    return None


# ============================================================
# HOME PAGE
# ============================================================

@app.route('/')
def index():
    """Landing page of the election portal."""
    stats = {
        'total_users': len(db.get_all_users() or []),
        'total_votes': db.get_total_votes(),
        'election_open': config.ELECTION_OPEN
    }
    return render_template('index.html', stats=stats)


# ============================================================
# USER REGISTRATION
# ============================================================

@app.route('/register', methods=['GET', 'POST'])
def register():
    """Handle user registration — Step 1: credentials form."""
    if is_logged_in():
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')
        confirm_password = request.form.get('confirm_password', '')

        # Basic field validation
        if not name or not email or not password:
            flash('All fields are required.', 'danger')
            return render_template('register.html')

        if password != confirm_password:
            flash('Passwords do not match.', 'danger')
            return render_template('register.html')

        if len(password) < 6:
            flash('Password must be at least 6 characters.', 'danger')
            return render_template('register.html')

        # STEP 1 — Email uniqueness check
        existing_user = db.get_user_by_email(email)
        if existing_user:
            flash('Email already registered. Please use another email or log in.', 'warning')
            return render_template('register.html')

        # Hash the password with bcrypt (never store plain text)
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        # Create user row — we need the user_id before face capture
        # If face capture fails, we roll back (delete) this row in api/save-face
        user_id = db.create_user(name, email, password_hash)

        if user_id:
            # Store temporarily in session for the face-capture step
            session.permanent = True          # keep session alive for 1 hour
            session['pending_register_id'] = user_id
            session['pending_register_name'] = name
            flash("Account info saved! Now let's capture your face for verification.", 'info')
            return redirect(url_for('capture_face_register'))
        else:
            flash('Registration failed due to a database error. Please try again.', 'danger')

    return render_template('register.html')


@app.route('/capture-face-register')
def capture_face_register():
    """Page where user captures their face during registration."""
    if 'pending_register_id' not in session:
        return redirect(url_for('register'))
    return render_template('capture_face.html',
                           mode='register',
                           user_name=session.get('pending_register_name', ''))


@app.route('/api/save-face', methods=['POST'])
def api_save_face():
    """
    Save face during registration. Liveness checked but retryable on fail.
    Session is NEVER cleared on liveness failure — user can retry blinking.
    Session only cleared after successful registration or face-processing error.
    """
    # Keep session alive regardless
    session.permanent = True
    session.modified = True

    if 'pending_register_id' not in session:
        return jsonify({
            'success': False,
            'message': 'Session expired. Please go back to register page and start again.',
            'redirect': '/register'
        })

    data = request.get_json(silent=True)
    if not data or 'image' not in data:
        return jsonify({'success': False, 'message': 'No image received. Please try again.'})

    user_id      = session['pending_register_id']
    base64_image = data.get('image', '')

    # ---- Liveness Check (retryable — does NOT clear session on fail) ----
    liveness_frames = data.get('liveness_frames', [])
    if liveness_frames and len(liveness_frames) >= 2:
        liveness_passed, liveness_message = check_liveness_from_frames(liveness_frames)
    else:
        liveness_passed, liveness_message = check_single_frame_liveness(base64_image)

    if not liveness_passed:
        session.modified = True   # keep session alive
        return jsonify({
            'success': False,
            'message': f'Please blink once and try again. ({liveness_message})'
        })

    # ---- Face registration ----
    existing_users = db.get_all_users_with_embeddings() or []
    success, message, filepath, encoding = register_face(
        base64_image, user_id, existing_users=existing_users
    )

    if success and filepath is not None and encoding is not None:
        from face_auth import embedding_to_json
        embedding_json = embedding_to_json(encoding)
        db.update_user_face_and_embedding(user_id, filepath, embedding_json)
        db.log_timeline_event(user_id, 'Face Registered', liveness_message)
        session.pop('pending_register_id', None)
        session.pop('pending_register_name', None)
        return jsonify({
            'success': True,
            'message': 'Registration complete! Your face is saved.',
            'redirect': '/login'
        })
    else:
        # Only rollback (delete user) on actual face processing failure
        db.delete_user(user_id)
        session.pop('pending_register_id', None)
        session.pop('pending_register_name', None)
        return jsonify({'success': False, 'message': message})


# ============================================================
# USER LOGIN
# ============================================================

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Handle user login."""
    if is_logged_in():
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')

        if not email or not password:
            flash('Please enter email and password.', 'danger')
            return render_template('login.html')

        # Find user by email
        user = db.get_user_by_email(email)

        if not user:
            flash('Email not registered. Please register first.', 'warning')
            return render_template('login.html')

        # Check password using bcrypt
        password_correct = bcrypt.checkpw(password.encode('utf-8'), user['password_hash'].encode('utf-8'))

        if not password_correct:
            # Log wrong password fraud event
            db.log_timeline_event(user['id'], 'Login Failed', 'Wrong password entered.')
            from fraud_detection import log_fraud_event
            db.log_fraud_event(user['id'], 'Wrong Password', 0, 20)
            flash('Invalid password. Please try again.', 'danger')
            return render_template('login.html')

        # Check if user has a face registered
        if not user.get('face_path'):
            flash('No face registered. Please complete registration with face capture.', 'warning')
            return render_template('login.html')

        # Store user info temporarily for face verification step
        session['pending_login_id'] = user['id']
        session['pending_login_email'] = email
        session['pending_face_path'] = user['face_path']

        return redirect(url_for('verify_face_login'))

    return render_template('login.html')


@app.route('/verify-face-login')
def verify_face_login():
    """Page where user verifies their face during login."""
    if 'pending_login_id' not in session:
        return redirect(url_for('login'))
    return render_template('capture_face.html', mode='login')


@app.route('/api/verify-face', methods=['POST'])
def api_verify_face():
    """API endpoint to verify face during login."""
    if 'pending_login_id' not in session:
        return jsonify({'success': False, 'message': 'Session expired. Please login again.'})

    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({'success': False, 'message': 'No image data received.'})

    user_id = session['pending_login_id']
    stored_face_path = session['pending_face_path']
    base64_image = data['image']
    liveness_frames = data.get('liveness_frames', [])

    # Step 1: Liveness Detection
    liveness_passed = False
    liveness_message = ""

    if liveness_frames and len(liveness_frames) >= 2:
        liveness_passed, liveness_message = check_liveness_from_frames(liveness_frames)
    else:
        # Fallback: single frame check
        liveness_passed, liveness_message = check_single_frame_liveness(base64_image)

    # Step 2: Face Verification
    face_matched, confidence, face_message = verify_face(base64_image, stored_face_path)

    # Step 3: Fraud Detection Analysis
    fraud_result = detect_fraud_on_login(
        user_id=user_id,
        password_correct=True,  # Already verified above
        face_matched=face_matched,
        liveness_passed=liveness_passed,
        confidence=confidence
    )

    # Step 4: Decide login success
    if face_matched and liveness_passed:
        # SUCCESS - complete the login
        session['user_id'] = user_id
        session['user_email'] = session.pop('pending_login_email', '')

        # Clear pending session data
        session.pop('pending_login_id', None)
        session.pop('pending_face_path', None)

        # Log successful events to timeline
        db.log_timeline_event(user_id, 'Login Successful', 'User logged in successfully.')
        db.log_timeline_event(user_id, 'Face Verified', f'Face match confidence: {confidence}%')
        db.log_timeline_event(user_id, 'Liveness Verified', liveness_message)

        return jsonify({
            'success': True,
            'message': face_message,
            'liveness_message': liveness_message,
            'confidence': confidence,
            'risk_score': fraud_result['risk_score'],
            'risk_level': fraud_result['risk_level'],
            'redirect': '/dashboard'
        })
    else:
        # FAILED LOGIN
        error_parts = []
        if not face_matched:
            error_parts.append(face_message)
        if not liveness_passed:
            error_parts.append(liveness_message)

        db.log_timeline_event(user_id, 'Login Failed', ' | '.join(error_parts))

        return jsonify({
            'success': False,
            'message': ' | '.join(error_parts),
            'confidence': confidence,
            'risk_score': fraud_result['risk_score'],
            'risk_level': fraud_result['risk_level'],
            'liveness_message': liveness_message
        })


# ============================================================
# DASHBOARD
# ============================================================

@app.route('/dashboard')
def dashboard():
    """User dashboard after successful login."""
    if not is_logged_in():
        flash('Please login to access the dashboard.', 'warning')
        return redirect(url_for('login'))

    user = get_current_user()
    if not user:
        session.clear()
        return redirect(url_for('login'))

    return render_template('dashboard.html', user=user)


# ============================================================
# VOTING
# ============================================================

@app.route('/vote', methods=['GET'])
def vote():
    """Display the voting page with candidate list."""
    if not is_logged_in():
        flash('Please login to vote.', 'warning')
        return redirect(url_for('login'))

    user = get_current_user()
    if not user:
        session.clear()
        return redirect(url_for('login'))

    # Check if user already voted
    if user['has_voted']:
        flash('You have already cast your vote!', 'info')
        return redirect(url_for('dashboard'))

    candidates = db.get_all_candidates()
    return render_template('vote.html', user=user, candidates=candidates)


@app.route('/cast-vote', methods=['POST'])
def cast_vote():
    """Process the vote submission."""
    if not is_logged_in():
        return redirect(url_for('login'))

    user_id = session['user_id']
    candidate_id = request.form.get('candidate_id')

    if not candidate_id:
        flash('Please select a candidate before voting.', 'warning')
        return redirect(url_for('vote'))

    # Double check: has this user already voted?
    is_duplicate, fraud_data = detect_duplicate_vote(user_id)
    if is_duplicate:
        flash('You have already voted! Each voter can only vote once.', 'danger')
        db.log_timeline_event(user_id, 'Duplicate Vote Blocked', 'User tried to vote twice.')
        return redirect(url_for('dashboard'))

    # Get candidate details
    candidate = db.get_candidate_by_id(candidate_id)
    if not candidate:
        flash('Invalid candidate selected.', 'danger')
        return redirect(url_for('vote'))

    # Add vote to blockchain
    block_hash = add_vote_to_chain(user_id, candidate['name'])

    # Record the vote in the database
    db.record_vote(user_id, candidate_id, block_hash)

    # Update candidate's vote count
    db.increment_candidate_votes(candidate_id)

    # Mark user as voted (prevents double voting)
    db.mark_user_voted(user_id)

    # Log timeline events
    db.log_timeline_event(user_id, 'Vote Cast', f'Voted for {candidate["name"]} ({candidate["party"]})')
    db.log_timeline_event(user_id, 'Block Added', f'Block hash: {block_hash[:20]}...')

    flash(f'Your vote for {candidate["name"]} has been recorded successfully!', 'success')
    return render_template('vote_success.html',
                           candidate=candidate,
                           block_hash=block_hash,
                           user=db.get_user_by_id(user_id))


# ============================================================
# RESULTS
# ============================================================

@app.route('/results')
def results():
    """Show election results with charts."""
    candidates = db.get_all_candidates()
    total_votes = db.get_total_votes()
    total_users = len(db.get_all_users() or [])

    # Calculate turnout
    turnout = round((total_votes / total_users * 100), 1) if total_users > 0 else 0

    return render_template('results.html',
                           candidates=candidates,
                           total_votes=total_votes,
                           total_users=total_users,
                           turnout=turnout)


# ============================================================
# BLOCKCHAIN PAGE
# ============================================================

@app.route('/blockchain')
def blockchain_view():
    """Display the blockchain for transparency."""
    chain = get_full_chain()
    stats = get_chain_stats()
    return render_template('blockchain.html', chain=chain, stats=stats)


@app.route('/api/verify-blockchain')
def api_verify_blockchain():
    """API endpoint to verify blockchain integrity."""
    is_valid, message = verify_chain()
    return jsonify({
        'is_valid': is_valid,
        'message': message if isinstance(message, str) else ' | '.join(message)
    })


# ============================================================
# FRAUD LOGS (accessible to logged-in users - admin only in real scenario)
# ============================================================

@app.route('/fraud-logs')
def fraud_logs():
    """Display fraud detection logs - Admin only."""
    if not is_admin_logged_in():
        flash('Admin access required.', 'danger')
        return redirect(url_for('admin_login'))

    logs = db.get_all_fraud_logs()
    summary = get_fraud_summary()

    # Add color class to each log for display
    for log in logs:
        log['badge_color'] = get_risk_badge_color(log['risk_score'])
        log['risk_level'] = get_risk_level_text(log['risk_score'])

    return render_template('fraud_logs.html', logs=logs, summary=summary)


# ============================================================
# ADMIN PANEL
# ============================================================

@app.route('/admin')
def admin_redirect():
    return redirect(url_for('admin_login'))


@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    """Admin login page."""
    if is_admin_logged_in():
        return redirect(url_for('admin_dashboard'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')

        admin = db.get_admin_by_username(username)

        if admin and bcrypt.checkpw(password.encode('utf-8'), admin['password_hash'].encode('utf-8')):
            session['is_admin'] = True
            session['admin_username'] = username
            flash('Admin login successful!', 'success')
            return redirect(url_for('admin_dashboard'))
        else:
            flash('Invalid admin credentials.', 'danger')

    return render_template('admin_login.html')


@app.route('/admin/dashboard')
def admin_dashboard():
    """Admin dashboard with all statistics."""
    if not is_admin_logged_in():
        flash('Admin access required.', 'danger')
        return redirect(url_for('admin_login'))

    stats = db.get_dashboard_stats()
    candidates = db.get_all_candidates()
    timeline_events = db.get_timeline_events(limit=20)
    users = db.get_all_users()
    fraud_summary = get_fraud_summary()

    return render_template('admin_dashboard.html',
                           stats=stats,
                           candidates=candidates,
                           timeline_events=timeline_events,
                           users=users,
                           fraud_summary=fraud_summary)


@app.route('/admin/logout')
def admin_logout():
    """Admin logout."""
    session.pop('is_admin', None)
    session.pop('admin_username', None)
    flash('Admin logged out.', 'info')
    return redirect(url_for('admin_login'))


@app.route('/admin/votes')
def admin_votes():
    """Admin view: see who voted and for whom (name + email visible to admin only)."""
    if not is_admin_logged_in():
        flash('Admin access required.', 'danger')
        return redirect(url_for('admin_login'))
    votes = db.get_all_votes()
    return render_template('admin_votes.html', votes=votes)


@app.route('/admin/audit', methods=['GET', 'POST'])
def admin_audit():
    """
    Restricted blockchain audit page.
    Admin must supply the BALLOT_MASTER_KEY to decrypt ledger entries.
    The master key is never stored — it is used only to derive the Fernet key in memory.
    """
    if not is_admin_logged_in():
        flash('Admin access required.', 'danger')
        return redirect(url_for('admin_login'))

    audit_results = None
    error_message = None
    chain_valid   = None

    # Always run chain integrity check (no decryption needed)
    is_valid, chain_msg = verify_chain()
    chain_valid = {"is_valid": is_valid, "message": chain_msg if isinstance(chain_msg, str) else " | ".join(chain_msg)}

    if request.method == 'POST':
        supplied_key = request.form.get('master_key', '').strip()
        if not supplied_key:
            error_message = "Please enter the master key."
        else:
            try:
                audit_results = decrypt_ledger(supplied_key)
                # Enrich with candidate names for display
                for entry in audit_results:
                    cand = db.get_candidate_by_id(entry['candidate_id'])
                    entry['candidate_name'] = cand['name'] if cand else f"ID {entry['candidate_id']}"
            except PermissionError as e:
                error_message = "Access denied: incorrect master key or tampered payload."
            except RuntimeError as e:
                error_message = "Configuration error. Has the database been initialized?"
            except Exception as e:
                error_message = "Audit failed. Check server logs."

    return render_template('admin_audit.html',
                           chain_valid=chain_valid,
                           audit_results=audit_results,
                           error_message=error_message)


# ============================================================
# USER LOGOUT
# ============================================================

@app.route('/logout')
def logout():
    """Log out the current user."""
    user_id = session.get('user_id')
    if user_id:
        db.log_timeline_event(user_id, 'Logout', 'User logged out.')
    session.clear()
    flash('You have been logged out successfully.', 'info')
    return redirect(url_for('index'))


# ============================================================
# API ENDPOINTS
# ============================================================

@app.route('/api/results-data')
def api_results_data():
    """API endpoint for Chart.js to get vote data."""
    candidates = db.get_all_candidates()
    data = {
        'labels': [c['name'] for c in candidates],
        'votes': [c['votes'] for c in candidates],
        'parties': [c['party'] for c in candidates]
    }
    return jsonify(data)


# ============================================================
# ERROR HANDLERS
# ============================================================

@app.errorhandler(404)
def page_not_found(e):
    return render_template('error.html', error_code=404, message="Page not found!"), 404


@app.errorhandler(500)
def internal_error(e):
    return render_template('error.html', error_code=500, message="Internal server error!"), 500


# ============================================================
# RUN THE APP
# ============================================================

if __name__ == '__main__':
    # Create session folder if it doesn't exist
    os.makedirs('./flask_session', exist_ok=True)

    print("=" * 50)
    print(" Secure Digital Election Portal")
    print(" Running at http://127.0.0.1:5000")
    print(" Admin: http://127.0.0.1:5000/admin/login")
    print("=" * 50)

    app.run(debug=True, host='0.0.0.0', port=5000)
