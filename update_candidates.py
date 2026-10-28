import sqlite3

conn = sqlite3.connect("election_portal.db")

# Step 1: Clear old candidates
conn.execute("DELETE FROM candidates")

# Step 2: Insert new candidates
new_candidates = [
    ("Rahul Gandhi",    "Indian National Congress"),
    ("Narendra Modi",   "Bharatiya Janata Party"),
    ("Abhijeet Dipke",  "Independent"),
    ("NOTA",            "None Of The Above"),
]

for name, party in new_candidates:
    conn.execute(
        "INSERT INTO candidates (name, party, votes) VALUES (?, ?, 0)",
        (name, party)
    )

conn.commit()

# Verify
cur = conn.execute("SELECT id, name, party, votes FROM candidates")
print("\nUpdated Candidates:")
print(f"{'ID':<5} {'Name':<20} {'Party':<30} {'Votes'}")
print("-" * 60)
for row in cur.fetchall():
    print(f"{row[0]:<5} {row[1]:<20} {row[2]:<30} {row[3]}")

conn.close()
print("\nCandidates updated successfully!")
