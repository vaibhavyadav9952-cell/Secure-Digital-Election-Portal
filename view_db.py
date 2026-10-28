# view_db.py - Database viewer for the Election Portal
# Run: python view_db.py

import sqlite3

conn = sqlite3.connect("election_portal.db")
conn.row_factory = sqlite3.Row

def show_table(table_name):
    print(f"\n{'='*60}")
    print(f"  TABLE: {table_name}")
    print('='*60)
    try:
        cur = conn.execute(f"SELECT * FROM {table_name}")
        rows = cur.fetchall()
        if not rows:
            print("  (empty - no rows yet)")
            return
        # Print column headers
        cols = [d[0] for d in cur.description]
        print(" | ".join(f"{c:15}" for c in cols))
        print("-" * 60)
        for row in rows:
            vals = []
            for v in row:
                s = str(v) if v is not None else "NULL"
                # Truncate long values (like face_embedding)
                if len(s) > 30:
                    s = s[:27] + "..."
                vals.append(f"{s:15}")
            print(" | ".join(vals))
        print(f"\n  Total rows: {len(rows)}")
    except Exception as e:
        print(f"  Error: {e}")

# Show all tables
tables = ["users", "candidates", "votes", "blockchain", "admins", "fraud_logs", "security_timeline"]
for t in tables:
    show_table(t)

conn.close()
print("\n\nDone.")
