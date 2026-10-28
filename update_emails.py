# update_emails.py - Update names AND emails from CSV into the database
# Handles both recovered_users.csv (photo_id) and bulk_imported.csv (user_id)
# Run: python update_emails.py

import sys, os, csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

import database as db
import bcrypt


def is_placeholder_email(email):
    """Return True if email is still a auto-generated placeholder."""
    return "@example.com" in email or "@imported.com" in email


def update_from_csv(csv_file):
    print(f"\n{'='*60}")
    print(f"Reading: {csv_file}")
    print(f"{'='*60}\n")

    with open(csv_file, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        print("CSV is empty!")
        return

    print(f"Found {len(rows)} rows\n")
    name_updated = email_updated = skipped = 0

    for row in rows:
        # Support both 'user_id' and 'photo_id' column names
        user_id = (row.get("user_id") or row.get("photo_id") or "").strip()
        name    = row.get("name", "").strip()
        email   = row.get("email", "").strip()

        if not user_id:
            print(f"  SKIP  Missing user_id/photo_id: {row}")
            skipped += 1
            continue

        # Find user in DB
        user = db.get_user_by_id(user_id)
        if not user:
            print(f"  SKIP  user_id={user_id} not found in DB")
            skipped += 1
            continue

        old_name  = user["name"]
        old_email = user["email"]

        # --- Update NAME if it changed from what's in the DB ---
        name_changed  = bool(name and name != old_name)
        # --- Update EMAIL only if it's a real non-placeholder email ---
        email_changed = bool(email and email != old_email and not is_placeholder_email(email))

        if not name_changed and not email_changed:
            print(f"  SKIP  user_id={user_id} ({old_name}) — nothing to update")
            skipped += 1
            continue

        # Check new email not taken by another user
        if email_changed:
            existing = db.get_user_by_email(email)
            if existing and str(existing["id"]) != str(user_id):
                print(f"  SKIP  user_id={user_id} — email '{email}' already used by user_id={existing['id']}")
                skipped += 1
                continue

        # Build what to update
        new_name  = name  if name_changed  else old_name
        new_email = email if email_changed else old_email

        db.execute_query(
            "UPDATE users SET name=?, email=? WHERE id=?",
            (new_name, new_email, user_id)
        )

        # Only update password if email actually changed (password = new email)
        if email_changed:
            pw_hash = bcrypt.hashpw(new_email.encode(), bcrypt.gensalt()).decode()
            db.execute_query("UPDATE users SET password_hash=? WHERE id=?", (pw_hash, user_id))
            print("  OK    user_id=%s | Name: %s -> %s | Email: %s -> %s | Password = email" % (user_id, old_name, new_name, old_email, new_email))
            email_updated += 1
        else:
            print("  OK    user_id=%s | Name: %s -> %s | (email unchanged)" % (user_id, old_name, new_name))
            name_updated += 1

    print(f"\n{'='*60}")
    print(f"  Names updated  : {name_updated}")
    print(f"  Emails updated : {email_updated}  (password set = email)")
    print(f"  Skipped        : {skipped}")
    print(f"{'='*60}")

    if email_updated > 0:
        print(f"\nFor email-updated users → login with:")
        print(f"  Email    = new email")
        print(f"  Password = same as email\n")


def main():
    found_any = False
    for csv_file in ["data/recovered_users.csv", "data/bulk_imported.csv"]:
        if os.path.exists(csv_file):
            found_any = True
            update_from_csv(csv_file)
        else:
            print(f"Not found (skipping): {csv_file}")
    if not found_any:
        print("No CSV files found in data/ folder!")


if __name__ == "__main__":
    main()
