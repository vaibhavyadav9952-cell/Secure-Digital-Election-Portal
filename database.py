# database.py - SQLite database helpers for the Election Portal
# Uses Python's built-in sqlite3 — no extra installation needed.

import sqlite3
import os
import config



def get_connection():
    """Open a SQLite connection with row_factory and WAL mode for concurrency."""
    conn = sqlite3.connect(config.DATABASE_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn



def _row_to_dict(row):
    return dict(row) if row else None


def _rows_to_dicts(rows):
    return [dict(r) for r in rows] if rows else []


# ── Generic helpers ───────────────────────────────────────────────────────────

def execute_query(query, params=()):
    """Run INSERT / UPDATE / DELETE. Returns lastrowid."""
    with get_connection() as conn:
        cur = conn.execute(query, params)
        conn.commit()
        return cur.lastrowid


def fetch_one(query, params=()):
    """Return one row as dict, or None."""
    with get_connection() as conn:
        cur = conn.execute(query, params)
        return _row_to_dict(cur.fetchone())


def fetch_all(query, params=()):
    """Return all rows as list of dicts."""
    with get_connection() as conn:
        cur = conn.execute(query, params)
        return _rows_to_dicts(cur.fetchall())


# ── User functions ────────────────────────────────────────────────────────────

def get_user_by_email(email):
    return fetch_one("SELECT * FROM users WHERE email = ?", (email,))


def get_user_by_id(user_id):
    return fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))


def create_user(name, email, password_hash):
    """Insert a new user. Returns new user ID."""
    return execute_query(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        (name, email, password_hash)
    )


def update_user_face(user_id, face_path):
    """Save face image path for a user."""
    execute_query("UPDATE users SET face_path = ? WHERE id = ?", (face_path, user_id))


def update_user_face_and_embedding(user_id, face_path, face_embedding_json):
    """
    Save BOTH face image path AND the 128-D face embedding (as JSON string).
    The embedding is used for duplicate-face checks at registration.
    """
    execute_query(
        "UPDATE users SET face_path = ?, face_embedding = ? WHERE id = ?",
        (face_path, face_embedding_json, user_id)
    )


def mark_user_voted(user_id):
    execute_query("UPDATE users SET has_voted = 1 WHERE id = ?", (user_id,))


def get_all_users():
    return fetch_all("SELECT id, name, email, has_voted, created_at FROM users")


def get_all_users_with_embeddings():
    """Return users with stored face embeddings — used for duplicate-face check."""
    return fetch_all(
        "SELECT id, name, email, face_embedding FROM users WHERE face_embedding IS NOT NULL"
    )


def delete_user(user_id):
    """
    Delete a user by ID.
    Used to roll back partial registration when face validation fails.
    """
    execute_query("DELETE FROM users WHERE id = ?", (user_id,))


# ── Candidate functions ───────────────────────────────────────────────────────

def get_all_candidates():
    return fetch_all("SELECT * FROM candidates ORDER BY id")


def get_candidate_by_id(candidate_id):
    return fetch_one("SELECT * FROM candidates WHERE id = ?", (candidate_id,))


def increment_candidate_votes(candidate_id):
    execute_query("UPDATE candidates SET votes = votes + 1 WHERE id = ?", (candidate_id,))


# ── Vote functions ────────────────────────────────────────────────────────────

def record_vote(user_id, candidate_id, block_hash):
    """Record a vote. Returns new vote ID."""
    return execute_query(
        "INSERT INTO votes (user_id, candidate_id, block_hash) VALUES (?, ?, ?)",
        (user_id, candidate_id, block_hash)
    )


def get_all_votes():
    """
    Return votes with voter name + email for admin audit.
    Note: showing voter identity in this view is intentional for admin oversight.
    Public-facing views should not expose this join.
    """
    return fetch_all("""
        SELECT v.id, u.name AS voter_name, u.email AS voter_email,
               c.name AS candidate_name, c.party,
               v.timestamp, v.block_hash
        FROM votes v
        JOIN users u ON v.user_id = u.id
        JOIN candidates c ON v.candidate_id = c.id
        ORDER BY v.timestamp ASC
    """)


def get_total_votes():
    r = fetch_one("SELECT COUNT(*) AS total FROM votes")
    return r['total'] if r else 0


# ── Fraud log functions ───────────────────────────────────────────────────────

def log_fraud_event(user_id, reason, confidence, risk_score):
    execute_query(
        "INSERT INTO fraud_logs (user_id, reason, confidence, risk_score) VALUES (?, ?, ?, ?)",
        (user_id, reason, confidence, risk_score)
    )


def get_all_fraud_logs():
    return fetch_all("""
        SELECT f.id, u.name AS user_name, u.email, f.reason,
               f.confidence, f.risk_score, f.timestamp
        FROM fraud_logs f
        LEFT JOIN users u ON f.user_id = u.id
        ORDER BY f.timestamp DESC
    """)


def get_fraud_count():
    r = fetch_one("SELECT COUNT(*) AS total FROM fraud_logs")
    return r['total'] if r else 0


# ── Security timeline functions ───────────────────────────────────────────────

def log_timeline_event(user_id, event_type, description):
    execute_query(
        "INSERT INTO security_timeline (user_id, event_type, description) VALUES (?, ?, ?)",
        (user_id, event_type, description)
    )


def get_timeline_events(limit=50):
    return fetch_all("""
        SELECT t.id, u.name AS user_name, t.event_type, t.description, t.timestamp
        FROM security_timeline t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.timestamp DESC
        LIMIT ?
    """, (limit,))


# ── Blockchain functions (encrypted ledger) ───────────────────────────────────

def get_last_blockchain_block():
    return fetch_one("SELECT * FROM blockchain ORDER BY block_index DESC LIMIT 1")


def insert_blockchain_block_v2(block_index, anonymous_voter_id, encrypted_payload,
                                previous_hash, current_hash):
    """
    Insert a new encrypted blockchain block.
    The ledger stores ONLY anonymous_voter_id + encrypted_payload — never raw user_id
    or plaintext candidate selection.
    """
    from datetime import datetime, timezone
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    execute_query("""
        INSERT INTO blockchain
            (block_index, anonymous_voter_id, encrypted_payload,
             previous_hash, current_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (block_index, anonymous_voter_id, encrypted_payload,
          previous_hash, current_hash, created_at))


# Legacy alias — kept so old code doesn't break
def insert_blockchain_block(block_index, timestamp, user_id, candidate,
                             prev_hash, curr_hash):
    """Deprecated: use insert_blockchain_block_v2 instead."""
    execute_query("""
        INSERT INTO blockchain
            (block_index, anonymous_voter_id, encrypted_payload,
             previous_hash, current_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (block_index, "GENESIS", "GENESIS", prev_hash, curr_hash, timestamp))


def get_full_chain():
    return fetch_all("SELECT * FROM blockchain ORDER BY block_index ASC")


# ── Admin / KDF config functions ──────────────────────────────────────────────

def get_admin_by_username(username):
    return fetch_one("SELECT * FROM admins WHERE username = ?", (username,))


def get_dashboard_stats():
    stats = {}
    stats['total_users']    = (fetch_one("SELECT COUNT(*) AS t FROM users") or {}).get('t', 0)
    stats['total_votes']    = (fetch_one("SELECT COUNT(*) AS t FROM votes") or {}).get('t', 0)
    stats['fraud_attempts'] = (fetch_one("SELECT COUNT(*) AS t FROM fraud_logs") or {}).get('t', 0)
    r = fetch_one("SELECT AVG(confidence) AS avg FROM fraud_logs WHERE reason LIKE '%Face%'")
    stats['avg_confidence'] = round(float(r['avg']), 1) if r and r['avg'] else 0
    return stats
