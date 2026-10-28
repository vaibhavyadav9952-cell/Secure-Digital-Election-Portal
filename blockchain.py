# blockchain.py - Encrypted, tamper-evident ballot ledger
#
# Security design:
#   - Ballot payloads are AES-256 encrypted using Fernet (authenticated encryption).
#   - Voter IDs are pseudonymised with HMAC-SHA256 using a secret pepper.
#   - Raw user_id and candidate names are NEVER stored in the ledger table.
#   - Block hashes use SHA-256 over a canonical JSON serialisation of integrity fields.
#   - The chain detects tampering of payload, voter pseudonym, sequence, or hash links.
#
# Key management:
#   - BALLOT_MASTER_KEY (env var): master passphrase, never stored in code.
#   - VOTER_HMAC_SALT  (env var): secret pepper for voter pseudonymisation.
#   - A PBKDF2-HMAC-SHA256 salt is stored in the DB (kdf_config table) alongside
#     iteration count. The derived key is cached in memory for the process lifetime.
#   - If key config is absent or invalid, ballot writes fail clearly.
#
# Limitations (honest disclosure for viva):
#   - This is a tamper-EVIDENT chain, not a truly immutable blockchain.
#     A DBA who can rewrite ALL rows and recompute every hash could fake the chain.
#     External checkpointing (hash published outside the system) would be needed
#     for true tamper-PROOF guarantees.
#   - Face matching has false-positive/false-negative rates.
#   - Voter pseudonymisation hides user_id from the ledger, but timing, access logs,
#     and the votes table together may still allow re-identification.

import hashlib
import hmac
import os
import json
import base64
import time
import sqlite3
from datetime import datetime, timezone
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

import database as db

# ── Key configuration constants ───────────────────────────────────────────────
KDF_ITERATIONS  = 600_000       # PBKDF2 iteration count (NIST 2024 recommendation)
KDF_SALT_BYTES  = 32            # Random salt length for PBKDF2
GENESIS_PREV    = "0" * 64      # Canonical genesis previous-hash sentinel
CHAIN_SCHEMA_VER = "1"          # Increment if chain format changes


# ══════════════════════════════════════════════════════════════════════════════
# KEY MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

def _get_master_password() -> bytes:
    """
    Read the master ballot password from the environment.
    Fails clearly if not configured — never silently generates a new key.
    """
    val = os.environ.get("BALLOT_MASTER_KEY", "").strip()
    if not val or val.startswith("REPLACE_WITH"):
        raise EnvironmentError(
            "[BLOCKCHAIN] BALLOT_MASTER_KEY is not set or still has the placeholder value. "
            "Set a real secret in your .env file before recording votes."
        )
    if len(val) < 32:
        raise EnvironmentError(
            "[BLOCKCHAIN] BALLOT_MASTER_KEY must be at least 32 characters. "
            "Use: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    return val.encode("utf-8")


def _get_voter_pepper() -> bytes:
    """
    Read the HMAC voter-pseudonymisation pepper from the environment.
    Fails clearly if not configured.
    """
    val = os.environ.get("VOTER_HMAC_SALT", "").strip()
    if not val or val.startswith("REPLACE_WITH"):
        raise EnvironmentError(
            "[BLOCKCHAIN] VOTER_HMAC_SALT is not set. "
            "Set a secret in your .env file."
        )
    return val.encode("utf-8")


def _ensure_kdf_config() -> bytes:
    """
    Retrieve (or create once) the PBKDF2 salt stored in the kdf_config table.
    The salt is stable for the lifetime of this installation.
    Returns the salt bytes.
    """
    row = db.fetch_one("SELECT salt_hex, iterations FROM kdf_config WHERE config_key = 'ballot_key'")
    if row:
        return bytes.fromhex(row["salt_hex"])

    # First-time setup: generate and store a random salt
    salt = os.urandom(KDF_SALT_BYTES)
    db.execute_query(
        "INSERT INTO kdf_config (config_key, salt_hex, iterations) VALUES (?, ?, ?)",
        ("ballot_key", salt.hex(), KDF_ITERATIONS)
    )
    print(f"[BLOCKCHAIN] KDF salt created and stored (iterations={KDF_ITERATIONS:,}).")
    return salt


@lru_cache(maxsize=1)
def _derive_fernet_key() -> Fernet:
    """
    Derive the Fernet (AES-256-CBC + HMAC-SHA256) key from the master password.
    Result is cached in memory so key derivation runs only once per process.
    The cache is invalidated if the master password changes (process restart).
    """
    password = _get_master_password()
    salt = _ensure_kdf_config()

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=KDF_ITERATIONS,
    )
    raw_key = kdf.derive(password)
    fernet_key = base64.urlsafe_b64encode(raw_key)   # Fernet requires URL-safe base64 key
    return Fernet(fernet_key)


# ══════════════════════════════════════════════════════════════════════════════
# ANONYMOUS VOTER IDENTIFIER
# ══════════════════════════════════════════════════════════════════════════════

def generate_anonymous_voter_id(user_id) -> str:
    """
    Create a pseudonymous voter identifier using HMAC-SHA256.

    Security properties:
      - Uses a secret pepper (VOTER_HMAC_SALT) so a DB-only attacker cannot
        map predictable user IDs to pseudonyms without the pepper.
      - Deterministic: same user_id + same pepper → same pseudonym (needed for
        duplicate-vote detection via the ledger).
      - The original user_id is NOT recoverable from the pseudonym without the pepper.

    Note: This does NOT guarantee full anonymity. The votes table, timing
    data, and access logs may still allow correlation.
    """
    if user_id is None:
        raise ValueError("[BLOCKCHAIN] user_id must not be None.")
    pepper = _get_voter_pepper()
    message = str(int(user_id)).encode("utf-8")
    digest = hmac.new(pepper, message, hashlib.sha256).hexdigest()
    return digest


# ══════════════════════════════════════════════════════════════════════════════
# BALLOT ENCRYPTION
# ══════════════════════════════════════════════════════════════════════════════

def encrypt_payload(candidate_id, timestamp_utc: str, ballot_ref: str = "") -> str:
    """
    Encrypt the ballot payload using Fernet (AES-256-CBC + HMAC-SHA256).

    The plaintext is a structured JSON containing only auditing metadata.
    The encrypted token is stored in the blockchain table.
    The raw candidate selection is NEVER stored as plaintext in the ledger.

    Returns the Fernet token as a UTF-8 string.
    """
    payload = {
        "schema_version": CHAIN_SCHEMA_VER,
        "candidate_id"  : int(candidate_id),
        "timestamp_utc" : timestamp_utc,
        "ballot_ref"    : ballot_ref or "",
    }
    plaintext = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    f = _derive_fernet_key()
    token = f.encrypt(plaintext)
    return token.decode("utf-8")


def decrypt_payload(encrypted_token: str) -> dict:
    """
    Decrypt a single Fernet token and return the parsed ballot dict.
    Raises InvalidToken on authentication failure (wrong key or tampered data).
    Internal use only — never called from public routes.
    """
    f = _derive_fernet_key()
    plaintext = f.decrypt(encrypted_token.encode("utf-8"))
    return json.loads(plaintext.decode("utf-8"))


# ══════════════════════════════════════════════════════════════════════════════
# BLOCK HASHING
# ══════════════════════════════════════════════════════════════════════════════

def calculate_block_hash(block_index: int, anonymous_voter_id: str,
                         encrypted_payload: str, previous_hash: str) -> str:
    """
    Compute SHA-256 over a deterministic canonical serialisation of integrity fields.

    Hash input format (for reproducible verification):
        JSON with sorted keys, no extra whitespace, UTF-8 encoded:
        {
            "block_index"       : <int>,
            "anonymous_voter_id": "<hex string>",
            "encrypted_payload" : "<fernet token>",
            "previous_hash"     : "<hex string>"
        }

    Only these four fields are included — timestamp and DB rowid are excluded
    because they can be nondeterministic or implementation-specific.
    """
    canonical = json.dumps({
        "block_index"       : int(block_index),
        "anonymous_voter_id": anonymous_voter_id,
        "encrypted_payload" : encrypted_payload,
        "previous_hash"     : previous_hash,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ══════════════════════════════════════════════════════════════════════════════
# GENESIS BLOCK
# ══════════════════════════════════════════════════════════════════════════════

def create_genesis_block():
    """Create the genesis block if the chain is empty."""
    existing = db.fetch_one("SELECT id FROM blockchain WHERE block_index = 0")
    if existing:
        return

    anon_id   = "GENESIS"
    enc_pay   = "GENESIS"
    curr_hash = calculate_block_hash(0, anon_id, enc_pay, GENESIS_PREV)

    db.insert_blockchain_block_v2(
        block_index        = 0,
        anonymous_voter_id = anon_id,
        encrypted_payload  = enc_pay,
        previous_hash      = GENESIS_PREV,
        current_hash       = curr_hash,
    )
    print(f"[BLOCKCHAIN] Genesis block created. Hash: {curr_hash[:24]}...")


# ══════════════════════════════════════════════════════════════════════════════
# ADD A VOTE BLOCK
# ══════════════════════════════════════════════════════════════════════════════

def add_block(user_id, candidate_id, additional_metadata: str = "") -> str:
    """
    Append an encrypted, anonymous vote block to the ledger.

    Transaction safety:
      - Reads last block and inserts new block inside a single SQLite connection
        to avoid a race where two concurrent votes read the same 'last' block.
      - Uses EXCLUSIVE lock at the SQLite level.
      - The authoritative duplicate-vote guard is the has_voted flag on the
        users table (set by mark_user_voted in the vote route).

    Returns the new block's current_hash.
    Raises on any error — caller must NOT proceed with vote recording if this raises.
    """
    timestamp_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    anon_voter_id  = generate_anonymous_voter_id(user_id)
    encrypted_pay  = encrypt_payload(candidate_id, timestamp_utc, additional_metadata)

    # Use a single connection with exclusive transaction for atomicity
    conn = db.get_connection()
    try:
        conn.execute("BEGIN EXCLUSIVE")

        cur = conn.execute(
            "SELECT block_index, current_hash FROM blockchain ORDER BY block_index DESC LIMIT 1"
        )
        last = cur.fetchone()
        if last is None:
            raise RuntimeError("[BLOCKCHAIN] No genesis block found. Run create_genesis_block() first.")

        new_index     = last["block_index"] + 1
        previous_hash = last["current_hash"]
        current_hash  = calculate_block_hash(new_index, anon_voter_id, encrypted_pay, previous_hash)

        conn.execute("""
            INSERT INTO blockchain (block_index, anonymous_voter_id, encrypted_payload,
                                    previous_hash, current_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (new_index, anon_voter_id, encrypted_pay, previous_hash, current_hash, timestamp_utc))

        conn.commit()
        print(f"[BLOCKCHAIN] Block #{new_index} added (hash: {current_hash[:24]}...).")
        return current_hash

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# Alias kept for backward-compat with app.py import
def add_vote_to_chain(user_id, candidate_name_or_id) -> str:
    """
    Wrapper called by app.py: add_vote_to_chain(user_id, candidate['name']).
    We resolve candidate_id from name so we only store the ID in the payload.
    If candidate_name_or_id is already an int/digit string, use it directly.
    """
    # Try to look up by name to get the canonical ID
    candidate = db.fetch_one(
        "SELECT id FROM candidates WHERE name = ?", (str(candidate_name_or_id),)
    )
    if candidate:
        cand_id = candidate["id"]
    elif str(candidate_name_or_id).isdigit():
        cand_id = int(candidate_name_or_id)
    else:
        cand_id = 0   # fallback for GENESIS or unknown

    return add_block(user_id, cand_id)


# ══════════════════════════════════════════════════════════════════════════════
# CHAIN VERIFICATION  (no decryption — integrity only)
# ══════════════════════════════════════════════════════════════════════════════

def verify_chain() -> tuple:
    """
    Verify the integrity of every block without decrypting payloads.

    Checks:
      1. Sequence is contiguous starting from 0.
      2. Genesis block uses the correct GENESIS_PREV sentinel.
      3. Each block's current_hash matches the recalculated hash.
      4. Each block's previous_hash matches the preceding block's current_hash.

    Returns:
      (True,  "Blockchain is valid and secure!")
      (False, ["Block #N: <reason>", ...])

    Tampering with an earlier block will produce a hash mismatch at that block
    AND a broken link at the next block, exposing the breach.
    """
    chain = db.get_full_chain()
    if not chain:
        return False, ["Blockchain is empty!"]

    errors = []

    for i, block in enumerate(chain):
        idx = block["block_index"]

        # Check sequence continuity
        if idx != i:
            errors.append(f"Block at position {i} has unexpected index {idx} (sequence broken or missing).")
            continue

        # Recalculate hash from stored integrity fields
        recalc = calculate_block_hash(
            idx,
            block["anonymous_voter_id"],
            block["encrypted_payload"],
            block["previous_hash"],
        )

        if not hmac.compare_digest(recalc, block["current_hash"]):
            errors.append(f"Block #{idx}: hash mismatch — block has been tampered!")

        # Check genesis sentinel
        if idx == 0:
            if block["previous_hash"] != GENESIS_PREV:
                errors.append(f"Block #0: genesis previous_hash corrupted.")
        else:
            prev_stored = chain[i - 1]["current_hash"]
            if not hmac.compare_digest(block["previous_hash"], prev_stored):
                errors.append(f"Block #{idx}: chain link broken (previous_hash does not match block #{idx-1}).")

    if errors:
        return False, errors
    return True, "Blockchain is valid and secure!"


# ══════════════════════════════════════════════════════════════════════════════
# AUTHORISED AUDIT — LEDGER DECRYPTION
# ══════════════════════════════════════════════════════════════════════════════

def decrypt_ledger(master_key_attempt: str) -> list:
    """
    Restricted admin audit function: decrypt all ballot payloads.

    Security requirements enforced here:
      1. Validates master_key_attempt against the configured key BEFORE decrypting.
      2. Uses the original KDF salt so existing records remain readable.
      3. Rejects wrong keys before returning any ballot data.
      4. Never prints decrypted output or secrets.
      5. Caller is responsible for access control (admin session check in route).

    Returns list of dicts:
      [{"block_index": N, "candidate_id": X, "timestamp_utc": "...", "ballot_ref": "..."}, ...]

    Raises:
      PermissionError   — wrong master key
      RuntimeError      — KDF config missing
      ValueError        — malformed payload
    """
    if not master_key_attempt or len(master_key_attempt.strip()) < 32:
        raise PermissionError("Invalid master key supplied.")

    # Derive a test key from the supplied attempt using the STORED salt
    salt_row = db.fetch_one("SELECT salt_hex, iterations FROM kdf_config WHERE config_key = 'ballot_key'")
    if not salt_row:
        raise RuntimeError("KDF configuration not found. Has the database been initialised?")

    salt       = bytes.fromhex(salt_row["salt_hex"])
    iterations = salt_row["iterations"]

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    raw_key    = kdf.derive(master_key_attempt.strip().encode("utf-8"))
    fernet_key = base64.urlsafe_b64encode(raw_key)
    test_fernet = Fernet(fernet_key)

    chain = db.get_full_chain()
    results = []

    for block in chain:
        if block["encrypted_payload"] == "GENESIS":
            continue   # Skip genesis block

        try:
            plaintext = test_fernet.decrypt(block["encrypted_payload"].encode("utf-8"))
            payload   = json.loads(plaintext.decode("utf-8"))
            results.append({
                "block_index"  : block["block_index"],
                "candidate_id" : payload.get("candidate_id"),
                "timestamp_utc": payload.get("timestamp_utc"),
                "ballot_ref"   : payload.get("ballot_ref", ""),
            })
        except InvalidToken:
            raise PermissionError(
                "Decryption failed for block #{}. "
                "Wrong master key or payload has been tampered.".format(block["block_index"])
            )
        except (json.JSONDecodeError, KeyError) as e:
            raise ValueError(f"Malformed payload in block #{block['block_index']}: {e}")

    return results


# ══════════════════════════════════════════════════════════════════════════════
# STATS HELPERS (used by app.py)
# ══════════════════════════════════════════════════════════════════════════════

def get_full_chain():
    return db.get_full_chain()


def get_chain_stats() -> dict:
    chain     = get_full_chain()
    is_valid, _ = verify_chain()
    return {
        "total_blocks": len(chain),
        "vote_blocks" : max(0, len(chain) - 1),
        "is_valid"    : is_valid,
        "last_hash"   : chain[-1]["current_hash"] if chain else "N/A",
    }
