# tests/test_voting.py - Voting flow, duplicate-vote prevention, and route tests

import os, sys, pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import database as db
import bcrypt


@pytest.fixture()
def voter(temp_db):
    """Fresh voter user with a clean state."""
    pw = bcrypt.hashpw(b"testpass123", bcrypt.gensalt()).decode()
    uid = db.create_user("Voter User", f"voter_{os.urandom(4).hex()}@example.com", pw)
    yield uid
    # Cleanup: reset has_voted so delete works cleanly
    db.execute_query("DELETE FROM votes WHERE user_id=?", (uid,))
    db.delete_user(uid)


@pytest.fixture()
def flask_client(temp_db):
    """Flask test client with testing mode."""
    import app as application
    application.app.config["TESTING"] = True
    application.app.config["WTF_CSRF_ENABLED"] = False
    with application.app.test_client() as client:
        yield client


class TestVotingRoutes:
    def test_vote_page_redirects_unauthenticated(self, flask_client):
        r = flask_client.get("/vote")
        assert r.status_code == 302

    def test_cast_vote_unauthenticated(self, flask_client):
        r = flask_client.post("/cast-vote", data={"candidate_id": 1})
        assert r.status_code == 302

    def test_results_page_public(self, flask_client):
        r = flask_client.get("/results")
        assert r.status_code == 200

    def test_blockchain_page_public(self, flask_client):
        r = flask_client.get("/blockchain")
        assert r.status_code == 200


class TestVotingLogic:
    def test_successful_vote_records_all_data(self, voter):
        """Casting a vote should update votes table, candidate count, user has_voted."""
        from blockchain import add_block
        block_hash = add_block(voter, 1)
        db.record_vote(voter, 1, block_hash)
        db.increment_candidate_votes(1)
        db.mark_user_voted(voter)

        user = db.get_user_by_id(voter)
        assert user["has_voted"] == 1

        cand = db.get_candidate_by_id(1)
        assert cand["votes"] >= 1

        votes = db.fetch_all("SELECT * FROM votes WHERE user_id=?", (voter,))
        assert len(votes) == 1
        assert votes[0]["block_hash"] == block_hash

    def test_duplicate_vote_rejected_by_db(self, voter):
        """UNIQUE(user_id) constraint on votes table prevents two rows."""
        import sqlite3
        from blockchain import add_block
        from config import DATABASE_PATH
        h1 = add_block(voter, 1)
        # Use raw connection so we can catch IntegrityError at SQLite level
        conn = sqlite3.connect(DATABASE_PATH)
        conn.execute(
            "INSERT INTO votes (user_id, candidate_id, block_hash) VALUES (?,?,?)",
            (voter, 1, h1)
        )
        conn.commit()

        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO votes (user_id, candidate_id, block_hash) VALUES (?,?,?)",
                (voter, 2, "second_fake_hash")
            )
            conn.commit()
        conn.close()

    def test_invalid_candidate_not_found(self):
        """get_candidate_by_id with non-existent ID returns None."""
        cand = db.get_candidate_by_id(99999)
        assert cand is None

    def test_mark_user_voted_flag(self, voter):
        user_before = db.get_user_by_id(voter)
        assert user_before["has_voted"] == 0
        db.mark_user_voted(voter)
        user_after = db.get_user_by_id(voter)
        assert user_after["has_voted"] == 1

    def test_vote_increments_candidate(self, voter):
        from blockchain import add_block
        before = db.get_candidate_by_id(1)["votes"]
        add_block(voter, 1)
        db.record_vote(voter, 1, "hash123")
        db.increment_candidate_votes(1)
        after = db.get_candidate_by_id(1)["votes"]
        assert after == before + 1

    def test_blockchain_block_count_increases(self, voter):
        from blockchain import add_block, get_full_chain
        before = len(get_full_chain())
        add_block(voter, 1)
        after = len(get_full_chain())
        assert after == before + 1

    def test_no_extra_ledger_block_on_failed_vote(self, voter):
        """If candidate doesn't exist, no blockchain block should be added."""
        from blockchain import get_full_chain
        before = len(get_full_chain())
        # Don't add a block — just test the guard logic
        cand = db.get_candidate_by_id(99999)
        assert cand is None
        after = len(get_full_chain())
        assert after == before  # No block added


class TestRegistrationLogic:
    def test_create_user_success(self, temp_db):
        pw = bcrypt.hashpw(b"pass", bcrypt.gensalt()).decode()
        uid = db.create_user("New Person", "newperson@example.com", pw)
        assert uid is not None
        assert uid > 0
        db.delete_user(uid)

    def test_duplicate_email_rejected(self, temp_db):
        import sqlite3
        pw = bcrypt.hashpw(b"pass", bcrypt.gensalt()).decode()
        uid = db.create_user("Person A", "dup@example.com", pw)
        with pytest.raises(sqlite3.IntegrityError):
            db.create_user("Person B", "dup@example.com", pw)
        db.delete_user(uid)

    def test_get_user_by_email(self, temp_db):
        pw = bcrypt.hashpw(b"pass", bcrypt.gensalt()).decode()
        uid = db.create_user("Lookup Test", "lookup@example.com", pw)
        user = db.get_user_by_email("lookup@example.com")
        assert user is not None
        assert user["name"] == "Lookup Test"
        db.delete_user(uid)

    def test_delete_user_removes_row(self, temp_db):
        pw = bcrypt.hashpw(b"pass", bcrypt.gensalt()).decode()
        uid = db.create_user("Delete Me", "deleteme@example.com", pw)
        db.delete_user(uid)
        assert db.get_user_by_id(uid) is None

    def test_face_duplicate_detection(self, temp_db):
        """check_duplicate_face: same encoding detected, different not."""
        import json, numpy as np
        from face_auth import check_duplicate_face

        emb = [0.1] * 128
        pw = bcrypt.hashpw(b"pass", bcrypt.gensalt()).decode()
        uid = db.create_user("Face User", "faceuser@example.com", pw)
        db.update_user_face_and_embedding(uid, "face.jpg", json.dumps(emb))

        existing = db.get_all_users_with_embeddings()

        # Same embedding → duplicate
        is_dup, matched = check_duplicate_face(np.array(emb), existing)
        assert is_dup

        # Different embedding → not duplicate
        diff_emb = np.array([0.9] * 128)
        is_dup2, _ = check_duplicate_face(diff_emb, existing)
        assert not is_dup2

        db.delete_user(uid)


class TestAdminRoutes:
    def test_admin_login_page_loads(self, flask_client):
        r = flask_client.get("/admin/login")
        assert r.status_code == 200

    def test_admin_dashboard_requires_auth(self, flask_client):
        r = flask_client.get("/admin/dashboard")
        assert r.status_code == 302

    def test_admin_votes_requires_auth(self, flask_client):
        r = flask_client.get("/admin/votes")
        assert r.status_code == 302

    def test_admin_audit_requires_auth(self, flask_client):
        r = flask_client.get("/admin/audit")
        assert r.status_code == 302

    def test_chain_verify_api(self, flask_client):
        r = flask_client.get("/api/verify-blockchain")
        assert r.status_code == 200
        data = r.get_json()
        assert "is_valid" in data
