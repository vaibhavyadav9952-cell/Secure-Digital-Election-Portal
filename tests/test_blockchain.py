# tests/test_blockchain.py - Blockchain encryption, verification, and audit tests
# Uses isolated temp DBs for each test class to avoid cross-test contamination.

import os, sys, json, sqlite3, pytest, re
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from blockchain import (
    encrypt_payload, decrypt_payload,
    generate_anonymous_voter_id, calculate_block_hash,
    verify_chain, decrypt_ledger, add_block, create_genesis_block,
    _derive_fernet_key, GENESIS_PREV,
)
from cryptography.fernet import InvalidToken
import database as db
import config


def _fresh_db(tmp_path, name="test.db"):
    """Helper: create an isolated DB, patch config, create genesis, clear cache."""
    db_path = str(tmp_path / name)
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            face_path TEXT, face_embedding TEXT, has_voted INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE candidates (id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, party TEXT NOT NULL, votes INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE votes (id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE, candidate_id INTEGER NOT NULL,
            block_hash TEXT NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE blockchain (id INTEGER PRIMARY KEY AUTOINCREMENT,
            block_index INTEGER NOT NULL UNIQUE,
            anonymous_voter_id TEXT NOT NULL, encrypted_payload TEXT NOT NULL,
            previous_hash TEXT NOT NULL, current_hash TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE kdf_config (config_key TEXT PRIMARY KEY,
            salt_hex TEXT NOT NULL, iterations INTEGER NOT NULL);
        CREATE TABLE admins (id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE fraud_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, reason TEXT NOT NULL, confidence REAL DEFAULT 0,
            risk_score INTEGER DEFAULT 0, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE security_timeline (id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, event_type TEXT NOT NULL, description TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    """)
    conn.execute("INSERT INTO candidates (name,party) VALUES ('Alice','Party A')")
    conn.execute("INSERT INTO candidates (name,party) VALUES ('Bob','Party B')")
    conn.commit()
    conn.close()
    config.DATABASE_PATH = db_path
    _derive_fernet_key.cache_clear()
    create_genesis_block()
    _derive_fernet_key.cache_clear()
    return db_path


def _get_env_key():
    with open(".env") as f:
        for line in f:
            m = re.match(r"BALLOT_MASTER_KEY=(.+)", line.strip())
            if m:
                return m.group(1)
    return None


# ── Encryption / Decryption ────────────────────────────────────────────────────

class TestEncryption:
    def test_roundtrip(self):
        enc = encrypt_payload(1, "2024-01-01T00:00:00Z", "ref-abc")
        dec = decrypt_payload(enc)
        assert dec["candidate_id"] == 1
        assert dec["ballot_ref"] == "ref-abc"

    def test_payload_is_not_plaintext(self):
        enc = encrypt_payload(2, "2024-01-01T00:00:00Z")
        assert "candidate" not in enc.lower()

    def test_different_encryptions_differ(self):
        e1 = encrypt_payload(1, "2024-01-01T00:00:00Z")
        e2 = encrypt_payload(1, "2024-01-01T00:00:00Z")
        assert e1 != e2  # Fernet adds random IV

    def test_wrong_key_fails(self):
        import base64
        from cryptography.fernet import Fernet
        enc = encrypt_payload(1, "2024-01-01T00:00:00Z")
        bad = Fernet(base64.urlsafe_b64encode(b"z" * 32))
        with pytest.raises(InvalidToken):
            bad.decrypt(enc.encode())


# ── Anonymous Voter IDs ────────────────────────────────────────────────────────

class TestAnonymousVoterID:
    def test_deterministic(self):
        assert generate_anonymous_voter_id(42) == generate_anonymous_voter_id(42)

    def test_different_users_differ(self):
        assert generate_anonymous_voter_id(1) != generate_anonymous_voter_id(2)

    def test_is_hex_string(self):
        v = generate_anonymous_voter_id(10)
        assert all(c in "0123456789abcdef" for c in v)
        assert len(v) == 64

    def test_raw_id_not_visible(self):
        assert "999999" not in generate_anonymous_voter_id(999999)

    def test_invalid_input_raises(self):
        with pytest.raises((ValueError, TypeError)):
            generate_anonymous_voter_id(None)


# ── Block Hashing ──────────────────────────────────────────────────────────────

class TestBlockHashing:
    def test_deterministic(self):
        h1 = calculate_block_hash(1, "anon", "payload", "prev")
        h2 = calculate_block_hash(1, "anon", "payload", "prev")
        assert h1 == h2

    def test_changes_with_payload(self):
        assert (calculate_block_hash(1, "a", "A", "p") !=
                calculate_block_hash(1, "a", "B", "p"))

    def test_changes_with_voter_id(self):
        assert (calculate_block_hash(1, "A", "p", "p") !=
                calculate_block_hash(1, "B", "p", "p"))

    def test_output_is_sha256_hex(self):
        h = calculate_block_hash(0, "a", "b", "c")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


# ── Chain Verification ─────────────────────────────────────────────────────────

class TestVerifyChain:
    def test_genesis_only_is_valid(self, tmp_path):
        _fresh_db(tmp_path, "v1.db")
        valid, msg = verify_chain()
        assert valid, f"Expected valid, got: {msg}"

    def test_valid_chain_after_adding_block(self, tmp_path):
        _fresh_db(tmp_path, "v2.db")
        uid = db.create_user("V", "v@v.com", "h")
        add_block(uid, 1)
        valid, msg = verify_chain()
        assert valid, f"Expected valid, got: {msg}"

    def test_tampered_payload_detected(self, tmp_path):
        db_path = _fresh_db(tmp_path, "v3.db")
        uid = db.create_user("T", "t@t.com", "h")
        bh = add_block(uid, 1)
        conn = sqlite3.connect(db_path)
        conn.execute("UPDATE blockchain SET encrypted_payload='TAMPERED' WHERE current_hash=?", (bh,))
        conn.commit(); conn.close()
        valid, _ = verify_chain()
        assert not valid

    def test_tampered_voter_id_detected(self, tmp_path):
        db_path = _fresh_db(tmp_path, "v4.db")
        uid = db.create_user("T2", "t2@t.com", "h")
        bh = add_block(uid, 1)
        conn = sqlite3.connect(db_path)
        conn.execute("UPDATE blockchain SET anonymous_voter_id='TAMPERED' WHERE current_hash=?", (bh,))
        conn.commit(); conn.close()
        valid, _ = verify_chain()
        assert not valid

    def test_tampered_current_hash_detected(self, tmp_path):
        db_path = _fresh_db(tmp_path, "v5.db")
        uid = db.create_user("T3", "t3@t.com", "h")
        add_block(uid, 1)
        conn = sqlite3.connect(db_path)
        conn.execute("UPDATE blockchain SET current_hash='a'*64 WHERE block_index=1")
        conn.commit(); conn.close()
        valid, _ = verify_chain()
        assert not valid

    def test_verify_does_not_decrypt(self, tmp_path):
        _fresh_db(tmp_path, "v6.db")
        uid = db.create_user("VD", "vd@vd.com", "h")
        add_block(uid, 1)
        _, result = verify_chain()
        result_str = str(result)
        assert "candidate_id" not in result_str


# ── Ledger Decryption ──────────────────────────────────────────────────────────

class TestDecryptLedger:
    def test_correct_key_returns_list(self, tmp_path):
        _fresh_db(tmp_path, "d1.db")
        uid = db.create_user("D1", "d1@d.com", "h")
        add_block(uid, 1)
        key = _get_env_key()
        if not key:
            pytest.skip("No .env key")
        _derive_fernet_key.cache_clear()
        results = decrypt_ledger(key)
        assert isinstance(results, list)
        assert any(e["candidate_id"] == 1 for e in results)

    def test_wrong_key_raises_permission_error(self):
        with pytest.raises(PermissionError):
            decrypt_ledger("wrong_key_that_is_definitely_32_or_more_chars_long!")

    def test_short_key_raises(self):
        with pytest.raises(PermissionError):
            decrypt_ledger("tooshort")

    def test_decrypted_result_has_no_voter_identity(self, tmp_path):
        _fresh_db(tmp_path, "d2.db")
        uid = db.create_user("D2", "d2@d.com", "h")
        add_block(uid, 1)
        key = _get_env_key()
        if not key:
            pytest.skip("No .env key")
        _derive_fernet_key.cache_clear()
        results = decrypt_ledger(key)
        for e in results:
            assert "candidate_id" in e
            assert "user_id" not in e
            assert "email" not in e


# ── add_block Integrity ────────────────────────────────────────────────────────

class TestAddBlock:
    def test_block_hash_is_64_chars(self, tmp_path):
        _fresh_db(tmp_path, "a1.db")
        uid = db.create_user("A1", "a1@a.com", "h")
        h = add_block(uid, 1)
        assert len(h) == 64

    def test_no_raw_user_id_in_ledger(self, tmp_path):
        _fresh_db(tmp_path, "a2.db")
        uid = db.create_user("A2", "a2@a.com", "h")
        add_block(uid, 1)
        chain = db.get_full_chain()
        for block in chain:
            assert str(uid) != block["anonymous_voter_id"]

    def test_no_plaintext_candidate_in_ledger(self, tmp_path):
        _fresh_db(tmp_path, "a3.db")
        uid = db.create_user("A3", "a3@a.com", "h")
        add_block(uid, 1)
        for block in db.get_full_chain():
            if block["encrypted_payload"] != "GENESIS":
                assert "alice" not in block["encrypted_payload"].lower()
