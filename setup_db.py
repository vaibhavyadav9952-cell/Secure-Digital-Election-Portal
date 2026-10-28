# setup_db.py - Create / migrate the SQLite database for the Election Portal
# Usage:  python setup_db.py
# Safe to run again — drops and recreates all portal tables cleanly.
# WARNING: Running this resets existing votes and blockchain records.

import sqlite3
import bcrypt
import os
from dotenv import load_dotenv

load_dotenv()  # Load .env secrets before importing blockchain

from config import DATABASE_PATH, ADMIN_USERNAME, ADMIN_PASSWORD, UPLOAD_FOLDER, TEMP_FOLDER


def setup():
    print("\n" + "=" * 55)
    print("  Election Portal -- Database Setup")
    print("=" * 55)

    # Create upload and session directories
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(TEMP_FOLDER,   exist_ok=True)
    os.makedirs("flask_session", exist_ok=True)
    os.makedirs(os.path.join("data", "photos"), exist_ok=True)
    os.makedirs(os.path.join("scripts"), exist_ok=True)
    print("[SETUP] Folders ready.")

    conn = sqlite3.connect(DATABASE_PATH)

    # Drop old tables that may have incompatible schemas
    old_tables = [
        "security_timeline", "fraud_logs", "votes", "blockchain",
        "kdf_config", "admins", "candidates", "users",
        "aadhaar_records", "voters", "otp_sessions",
        "elections", "blockchain_blocks", "audit_logs", "ai_anomaly_logs"
    ]
    for t in old_tables:
        conn.execute(f"DROP TABLE IF EXISTS {t}")
    conn.commit()
    print("[SETUP] Old tables cleared.")

    conn.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys = ON;

        -- Registered voters
        CREATE TABLE users (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            name           TEXT NOT NULL,
            email          TEXT UNIQUE NOT NULL,
            password_hash  TEXT NOT NULL,
            face_path      TEXT DEFAULT NULL,
            face_embedding TEXT DEFAULT NULL,
            has_voted      INTEGER DEFAULT 0,
            created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX idx_users_email ON users(email);

        -- Election candidates
        CREATE TABLE candidates (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            party      TEXT NOT NULL,
            votes      INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Authoritative vote records (links user to candidate)
        -- Duplicate-vote guard: UNIQUE on user_id prevents two rows for same user.
        CREATE TABLE votes (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            candidate_id INTEGER NOT NULL,
            block_hash   TEXT NOT NULL,
            timestamp    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id)      REFERENCES users(id),
            FOREIGN KEY (candidate_id) REFERENCES candidates(id),
            UNIQUE (user_id)
        );

        -- Encrypted blockchain ledger
        -- Stores anonymous_voter_id + encrypted_payload only.
        -- Raw user_id and plaintext candidate are NEVER stored here.
        CREATE TABLE blockchain (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            block_index         INTEGER NOT NULL UNIQUE,
            anonymous_voter_id  TEXT NOT NULL,
            encrypted_payload   TEXT NOT NULL,
            previous_hash       TEXT NOT NULL,
            current_hash        TEXT NOT NULL,
            created_at          TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_chain_index ON blockchain(block_index);

        -- KDF config: stores PBKDF2 salt for ballot encryption key derivation.
        -- The master password is NEVER stored here.
        CREATE TABLE kdf_config (
            config_key TEXT PRIMARY KEY,
            salt_hex   TEXT NOT NULL,
            iterations INTEGER NOT NULL
        );

        -- Admin accounts
        CREATE TABLE admins (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Fraud / anomaly logs
        CREATE TABLE fraud_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER,
            reason      TEXT NOT NULL,
            confidence  REAL DEFAULT 0,
            risk_score  INTEGER DEFAULT 0,
            timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Security event timeline
        CREATE TABLE security_timeline (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER,
            event_type  TEXT NOT NULL,
            description TEXT NOT NULL,
            timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    print("[SETUP] All tables created with new encrypted blockchain schema.")

    # Seed candidates (user-specified)
    candidates = [
        ("Rahul Gandhi",    "Indian National Congress"),
        ("Narendra Modi",   "Bharatiya Janata Party"),
        ("Abhijeet Dipke",  "Independent"),
        ("NOTA",            "None Of The Above"),
    ]
    for name, party in candidates:
        conn.execute(
            "INSERT OR IGNORE INTO candidates (name, party, votes) VALUES (?, ?, 0)",
            (name, party)
        )
    conn.commit()
    print(f"[SETUP] {len(candidates)} candidates seeded.")

    # Seed admin
    admin_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
    conn.execute(
        "INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)",
        (ADMIN_USERNAME, admin_hash)
    )
    conn.commit()
    print(f"[SETUP] Admin: {ADMIN_USERNAME} / {ADMIN_PASSWORD}")

    conn.close()

    # Create genesis block (uses .env keys)
    from blockchain import create_genesis_block
    create_genesis_block()

    print("\n" + "=" * 55)
    print("  Setup Complete!")
    print(f"  Database : {DATABASE_PATH}")
    print("  Run app  : python app.py")
    print(f"  Admin    : {ADMIN_USERNAME} / {ADMIN_PASSWORD}")
    print("  Import   : python scripts/import_users.py")
    print("=" * 55 + "\n")


if __name__ == "__main__":
    setup()
