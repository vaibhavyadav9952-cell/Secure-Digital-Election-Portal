# tests/conftest.py - Shared pytest fixtures using TEMPORARY databases
# The production election_portal.db is NEVER touched by tests.

import os, sys, sqlite3, pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()


def _make_temp_db(db_path: str):
    """Create a fresh schema in the given path and return genesis block hash."""
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL, face_path TEXT DEFAULT NULL,
            face_embedding TEXT DEFAULT NULL, has_voted INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, party TEXT NOT NULL, votes INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL, candidate_id INTEGER NOT NULL,
            block_hash TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (user_id)
        );
        CREATE TABLE IF NOT EXISTS blockchain (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            block_index INTEGER NOT NULL UNIQUE,
            anonymous_voter_id TEXT NOT NULL, encrypted_payload TEXT NOT NULL,
            previous_hash TEXT NOT NULL, current_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kdf_config (
            config_key TEXT PRIMARY KEY,
            salt_hex TEXT NOT NULL, iterations INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS fraud_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            reason TEXT NOT NULL, confidence REAL DEFAULT 0,
            risk_score INTEGER DEFAULT 0,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS security_timeline (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            event_type TEXT NOT NULL, description TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    for name, party in [("Alice", "Party A"), ("Bob", "Party B"), ("NOTA", "None")]:
        conn.execute("INSERT OR IGNORE INTO candidates (name, party) VALUES (?, ?)", (name, party))
    conn.commit()
    conn.close()


@pytest.fixture(scope="function")
def temp_db(tmp_path):
    """
    Isolated per-test SQLite database. Patches config.DATABASE_PATH.
    Each test gets a completely fresh DB — no shared state, no residual tampering.
    The real election_portal.db is never modified.
    """
    db_path = str(tmp_path / "test_election.db")
    import config
    original_path = config.DATABASE_PATH
    config.DATABASE_PATH = db_path

    _make_temp_db(db_path)

    # Clear lru_cache before genesis so key is derived from THIS db's salt
    from blockchain import _derive_fernet_key, create_genesis_block
    _derive_fernet_key.cache_clear()
    create_genesis_block()
    _derive_fernet_key.cache_clear()  # clear again so decrypt also uses this db's salt

    yield db_path

    _derive_fernet_key.cache_clear()
    config.DATABASE_PATH = original_path


@pytest.fixture()
def test_user(temp_db):
    """Create a fresh test user; cleaned up after test."""
    import database as db
    uid = db.create_user("Test User", f"test_{os.urandom(4).hex()}@example.com", "fakehash")
    yield uid
    try:
        db.execute_query("DELETE FROM votes WHERE user_id=?", (uid,))
        db.delete_user(uid)
    except Exception:
        pass
