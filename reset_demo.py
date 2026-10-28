# reset_demo.py - Development-only demo data reset
# ============================================================
# SAFETY:  This script requires explicit confirmation before
#          deleting any data. It NEVER runs automatically.
#
# Usage:
#   python reset_demo.py          -- shows menu
#   python reset_demo.py --votes  -- clear votes + blockchain only
#   python reset_demo.py --all    -- full reset (requires confirmation)
#
# What is NEVER reset by this script:
#   - .env file (encryption keys)
#   - Source code
#   - Requirements / venv
#   - Face photos already uploaded to static/uploads/faces/
# ============================================================

import sys, sqlite3, shutil, os
from dotenv import load_dotenv
load_dotenv()
from config import DATABASE_PATH

DIVIDER = "=" * 55

def confirm(prompt):
    ans = input(f"\n{prompt}\nType YES to confirm: ").strip()
    return ans == "YES"

def clear_votes_and_chain():
    """Clear votes, blockchain (except genesis), reset has_voted and candidate counts."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.execute("DELETE FROM votes")
    conn.execute("DELETE FROM security_timeline WHERE event_type IN ('Vote Cast','Block Added')")
    conn.execute("DELETE FROM blockchain WHERE block_index > 0")
    conn.execute("UPDATE users SET has_voted = 0")
    conn.execute("UPDATE candidates SET votes = 0")
    conn.commit()
    conn.close()
    print("[RESET] Votes, blockchain vote blocks, and has_voted flags cleared.")
    print("[RESET] Candidates reset to 0 votes.")
    print("[RESET] Genesis block preserved.")

def clear_users():
    """Remove all registered voters (keeps candidates, admins, and genesis)."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.execute("DELETE FROM votes")
    conn.execute("DELETE FROM security_timeline")
    conn.execute("DELETE FROM fraud_logs")
    conn.execute("DELETE FROM blockchain WHERE block_index > 0")
    conn.execute("DELETE FROM users")
    conn.execute("UPDATE candidates SET votes = 0")
    conn.commit()
    conn.close()
    print("[RESET] All users, votes, fraud logs, and timeline events cleared.")

def full_reset():
    """Complete reset: re-runs setup_db.py (drops and recreates ALL tables)."""
    import subprocess
    result = subprocess.run(
        [sys.executable, "setup_db.py"],
        capture_output=False
    )
    if result.returncode == 0:
        print("[RESET] Full reset complete. Database recreated from scratch.")
    else:
        print("[RESET] Error during setup_db.py.")

def show_current_state():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    votes = conn.execute("SELECT COUNT(*) AS c FROM votes").fetchone()["c"]
    blocks = conn.execute("SELECT COUNT(*) AS c FROM blockchain").fetchone()["c"]
    conn.close()
    print(f"\nCurrent state:  Users={users}  Votes={votes}  Blockchain blocks={blocks}")

def main():
    print(f"\n{DIVIDER}")
    print("  Election Portal -- Demo Reset (Dev Only)")
    print(DIVIDER)
    show_current_state()

    args = sys.argv[1:]

    if "--votes" in args:
        if confirm("Clear votes + blockchain vote blocks (keep users)?"):
            clear_votes_and_chain()
        else:
            print("Cancelled.")

    elif "--users" in args:
        if confirm("Delete ALL users, votes, and fraud logs? (keeps candidates + admin)"):
            clear_users()
        else:
            print("Cancelled.")

    elif "--all" in args:
        print("\nWARNING: This will DROP and RECREATE ALL tables.")
        print("All users, votes, blockchain, and face registrations will be DELETED.")
        print("The encryption key (.env) will NOT be changed.")
        if confirm("Proceed with FULL RESET?"):
            full_reset()
        else:
            print("Cancelled.")

    else:
        print("""
Options:
  python reset_demo.py --votes   Clear votes and blockchain vote blocks only.
                                 Users remain. Safe for demo re-run.

  python reset_demo.py --users   Delete all users, votes, fraud logs.
                                 Candidates and admin are kept.

  python reset_demo.py --all     Full schema reset (setup_db.py).
                                 Requires explicit confirmation.
                                 WARNING: All data including users is deleted.

Note: The .env encryption key is NEVER modified by this script.
      If you delete .env and recreate it, old blockchain records
      cannot be decrypted with the new key.
""")

if __name__ == "__main__":
    main()
