# fraud_detection.py - Rule-based AI Fraud Detection System

from database import log_fraud_event, get_all_fraud_logs, fetch_one
import time


# ---- Risk Score Points ----
# Each type of fraud event adds points to the risk score

RISK_POINTS = {
    'wrong_password': 20,
    'unknown_face': 40,
    'failed_liveness': 20,
    'duplicate_vote': 20,
    'multiple_failed_logins': 30,
    'suspicious_activity': 15
}


def calculate_risk_score(events):
    """
    Calculate total fraud risk score based on list of events.
    Each event type adds a fixed number of points.

    Returns:
        risk_score (int): 0-100
        risk_level (str): 'Safe', 'Suspicious', or 'High Risk'
    """
    total_score = 0

    for event in events:
        # Look up the risk points for each event type
        event_lower = event.lower().replace(' ', '_')
        for key, points in RISK_POINTS.items():
            if key in event_lower:
                total_score += points
                break

    # Cap the score at 100
    total_score = min(total_score, 100)

    # Determine risk level based on score
    if total_score <= 30:
        risk_level = "Safe"
    elif total_score <= 60:
        risk_level = "Suspicious"
    else:
        risk_level = "High Risk"

    return total_score, risk_level


def detect_fraud_on_login(user_id, password_correct, face_matched, liveness_passed, confidence):
    """
    Main fraud detection function called during login.
    Analyzes all login events and generates a fraud report.

    Args:
        user_id: The user attempting to login
        password_correct: True/False - was password correct?
        face_matched: True/False - did face recognition pass?
        liveness_passed: True/False - did liveness detection pass?
        confidence: Face match confidence percentage

    Returns:
        dict with fraud analysis results
    """
    fraud_events = []
    fraud_reasons = []

    # Check each condition and add to events list
    if not password_correct:
        fraud_events.append('wrong_password')
        fraud_reasons.append('Wrong Password')

    if not face_matched:
        fraud_events.append('unknown_face')
        fraud_reasons.append('Unknown Face')

    if not liveness_passed:
        fraud_events.append('failed_liveness')
        fraud_reasons.append('Failed Liveness Check')

    # Check for multiple failed login attempts in the last 10 minutes
    if check_multiple_failed_logins(user_id):
        fraud_events.append('multiple_failed_logins')
        fraud_reasons.append('Multiple Failed Login Attempts')

    # Calculate risk score
    risk_score, risk_level = calculate_risk_score(fraud_events)

    # Prepare the result
    result = {
        'events': fraud_events,
        'reasons': fraud_reasons,
        'risk_score': risk_score,
        'risk_level': risk_level,
        'confidence': confidence,
        'is_fraudulent': risk_score > 30
    }

    # Log to database if there are any fraud events
    if fraud_events and user_id:
        reason_str = ', '.join(fraud_reasons)
        log_fraud_event(user_id, reason_str, confidence, risk_score)
        print(f"[FRAUD] User {user_id} - Risk Score: {risk_score} - {risk_level}")

    return result


def detect_duplicate_vote(user_id):
    """
    Check if a user is trying to vote again after already voting.
    Returns: (is_duplicate, result_dict)
    """
    user = fetch_one("SELECT has_voted, name FROM users WHERE id = ?", (user_id,))

    if user and user['has_voted']:
        # This is a duplicate vote attempt - high fraud!
        risk_score, risk_level = calculate_risk_score(['duplicate_vote'])

        log_fraud_event(
            user_id,
            'Duplicate Vote Attempt',
            0,
            risk_score
        )

        return True, {
            'risk_score': risk_score,
            'risk_level': risk_level,
            'message': 'You have already cast your vote!'
        }

    return False, None


def check_multiple_failed_logins(user_id):
    """
    Check if user had more than 3 failed login attempts in the last 10 minutes.
    Uses SQLite datetime functions (not MySQL DATE_SUB/NOW).
    """
    if not user_id:
        return False

    try:
        result = fetch_one("""
            SELECT COUNT(*) as attempts
            FROM fraud_logs
            WHERE user_id = ?
            AND reason LIKE '%Wrong Password%'
            AND timestamp >= datetime('now', '-10 minutes')
        """, (user_id,))

        if result and result['attempts'] >= 3:
            print(f"[FRAUD] User {user_id} has {result['attempts']} failed logins in last 10 minutes!")
            return True

    except Exception as e:
        print(f"[FRAUD] Error checking failed logins: {e}")

    return False


def get_risk_badge_color(risk_score):
    """
    Get Bootstrap badge color class based on risk score.
    Used in templates to show colored risk badges.
    """
    if risk_score <= 30:
        return "success"   # Green
    elif risk_score <= 60:
        return "warning"   # Yellow
    else:
        return "danger"    # Red


def get_risk_level_text(risk_score):
    """Convert risk score to human-readable text."""
    if risk_score <= 30:
        return "Safe"
    elif risk_score <= 60:
        return "Suspicious"
    else:
        return "High Risk"


def get_fraud_summary():
    """
    Get a summary of all fraud events for the admin dashboard.
    Returns counts by type and overall stats.
    """
    logs = get_all_fraud_logs()
    if not logs:
        return {
            'total': 0,
            'safe': 0,
            'suspicious': 0,
            'high_risk': 0,
            'avg_score': 0
        }

    total = len(logs)
    safe = sum(1 for log in logs if log['risk_score'] <= 30)
    suspicious = sum(1 for log in logs if 30 < log['risk_score'] <= 60)
    high_risk = sum(1 for log in logs if log['risk_score'] > 60)
    avg_score = round(sum(log['risk_score'] for log in logs) / total, 1) if total > 0 else 0

    return {
        'total': total,
        'safe': safe,
        'suspicious': suspicious,
        'high_risk': high_risk,
        'avg_score': avg_score
    }
