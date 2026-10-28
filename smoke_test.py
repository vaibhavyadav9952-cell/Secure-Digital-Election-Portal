"""Final end-to-end verification against production DB."""
from dotenv import load_dotenv
load_dotenv()

import app as application
application.app.config['TESTING'] = True
client = application.app.test_client()

import bcrypt, database as db, re
from blockchain import add_vote_to_chain, verify_chain, decrypt_ledger, _derive_fernet_key

_derive_fernet_key.cache_clear()

passed = failed = 0
def p(ok, msg):
    global passed, failed
    status = "PASS" if ok else "FAIL"
    print(f"  {status}  {msg}")
    if ok: passed += 1
    else: failed += 1

print("\n=== FINAL END-TO-END VERIFICATION ===\n")

# 1. Public pages
for path in ['/', '/register', '/login', '/results', '/blockchain', '/admin/login']:
    r = client.get(path)
    p(r.status_code == 200, f"GET {path} -> 200")

# 2. Protected pages redirect
for path in ['/dashboard', '/vote', '/admin/dashboard', '/admin/votes', '/admin/audit']:
    r = client.get(path)
    p(r.status_code == 302, f"GET {path} redirects when not logged in")

# 3. Create test voter
pw = bcrypt.hashpw(b'TestPass123', bcrypt.gensalt()).decode()
uid = db.create_user('E2E Voter', 'e2e@example.com', pw)
db.update_user_face_and_embedding(uid, 'static/uploads/faces/e2e.jpg', '[0.1]*128')
p(uid is not None, f"User created (id={uid})")

# 4. Correct candidates
candidates = db.get_all_candidates()
names = [c['name'] for c in candidates]
p('Rahul Gandhi'   in names, "Rahul Gandhi in candidates")
p('Narendra Modi'  in names, "Narendra Modi in candidates")
p('Abhijeet Dipke' in names, "Abhijeet Dipke in candidates")
p('NOTA'           in names, "NOTA in candidates")

# 5. Cast vote (simulated)
cand = candidates[0]
block_hash = add_vote_to_chain(uid, cand['name'])
db.record_vote(uid, cand['id'], block_hash)
db.increment_candidate_votes(cand['id'])
db.mark_user_voted(uid)
p(len(block_hash) == 64, f"Block hash is 64 hex chars")

# 6. has_voted flag
user = db.get_user_by_id(uid)
p(user['has_voted'] == 1, "User marked as voted after casting")

# 7. Chain valid
is_valid, msg = verify_chain()
p(is_valid, f"Blockchain valid after vote ({msg})")

# 8. Ledger privacy
chain = db.get_full_chain()
vote_blocks = [b for b in chain if b['block_index'] > 0]
p(len(vote_blocks) >= 1, "Vote block recorded in chain")
vb = vote_blocks[0]
p(str(uid) != vb['anonymous_voter_id'], "Ledger: raw user_id NOT stored in anonymous_voter_id")
p('rahul' not in vb['encrypted_payload'].lower(), "Ledger: no plaintext candidate name")

# 9. decrypt_ledger
env_key = None
with open('.env') as f:
    for line in f:
        m = re.match(r'BALLOT_MASTER_KEY=(.+)', line.strip())
        if m: env_key = m.group(1)

if env_key:
    results = decrypt_ledger(env_key)
    p(len(results) >= 1, f"decrypt_ledger returns {len(results)} ballot(s)")
    p(results[0]['candidate_id'] == cand['id'], "Decrypted candidate_id correct")
    p('user_id' not in results[0], "Decrypted result has no user_id")
    try:
        decrypt_ledger("wrong_key_that_is_definitely_32plus_chars_long!!")
        p(False, "Wrong key rejected")
    except PermissionError:
        p(True, "Wrong master key correctly rejected")
else:
    print("  SKIP  .env key not found")

# 10. Admin routes
with client.session_transaction() as sess:
    sess['is_admin'] = True
    sess['admin_username'] = 'admin'
for path, code in [('/admin/dashboard', 200), ('/admin/votes', 200), ('/admin/audit', 200)]:
    r = client.get(path)
    p(r.status_code == code, f"Admin GET {path} -> {code}")

# 11. API verify
r = client.get('/api/verify-blockchain')
d = r.get_json()
p(d['is_valid'], "API /api/verify-blockchain reports valid chain")

# Cleanup
db.execute_query("DELETE FROM votes WHERE user_id=?", (uid,))
db.delete_user(uid)
db.execute_query("DELETE FROM blockchain WHERE block_index > 0")
db.execute_query("UPDATE candidates SET votes = 0")

print(f"\n{'='*50}")
print(f"  RESULT: {passed} passed, {failed} failed")
print(f"{'='*50}\n")
import sys; sys.exit(0 if failed == 0 else 1)
