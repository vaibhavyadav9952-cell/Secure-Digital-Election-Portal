# scripts/import_users.py
# ============================================================
# Import demo users from CSV + photos into the Election Portal DB
# ============================================================
#
# Usage (run from project root):
#   python scripts/import_users.py
#
# Before running:
#   1. python setup_db.py          (initialize the database first)
#   2. Put photos in data/photos/  (e.g. rahul.jpg, priya.jpg)
#   3. Edit data/users.csv         (name, email, password, photo)
#
# The script is IDEMPOTENT:
#   Running it twice will NOT create duplicate users.
#   Duplicate emails and duplicate faces are both skipped.
# ============================================================

import sys
import os
import csv
import json
import bcrypt

# Add project root to path so we can import our modules
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

import cv2
import numpy as np
import face_recognition
import database as db
from face_auth import get_face_count, get_face_encoding, save_face_image, embedding_to_json
from config import FACE_MATCH_THRESHOLD

CSV_PATH   = os.path.join(PROJECT_ROOT, "data", "users.csv")
PHOTOS_DIR = os.path.join(PROJECT_ROOT, "data", "photos")


def check_face_duplicate(new_encoding, existing_users):
    """
    Compare new_encoding against all existing users with stored embeddings.
    Returns (is_duplicate: bool, matched_email: str or None).

    Uses FACE_MATCH_THRESHOLD from config.py — same value as live login,
    so duplicate detection is consistent throughout the system.
    """
    for user in existing_users:
        stored_json = user.get("face_embedding")
        if not stored_json:
            continue
        try:
            stored_enc = np.array(json.loads(stored_json))
        except Exception:
            continue
        distance = face_recognition.face_distance([stored_enc], new_encoding)[0]
        if distance <= FACE_MATCH_THRESHOLD:
            return True, user.get("email", "?")
    return False, None


def import_users():
    print("\n" + "=" * 55)
    print("  Election Portal -- Import Demo Users")
    print("=" * 55 + "\n")

    if not os.path.exists(CSV_PATH):
        print(f"[ERROR] CSV not found: {CSV_PATH}")
        print("Create data/users.csv first.")
        sys.exit(1)

    if not os.path.exists(PHOTOS_DIR):
        print(f"[ERROR] Photos folder not found: {PHOTOS_DIR}")
        print("Create data/photos/ and add your photos.")
        sys.exit(1)

    stats = {"inserted": 0, "skip_email": 0, "skip_face": 0, "errors": 0}

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        required = {"name", "email", "password", "photo"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            print(f"[ERROR] CSV missing columns: {missing}")
            sys.exit(1)

        for row_num, row in enumerate(reader, start=2):
            name  = (row.get("name")     or "").strip()
            email = (row.get("email")    or "").strip()
            pwd   = (row.get("password") or "").strip()
            photo = (row.get("photo")    or "").strip()

            print(f"Row {row_num}: {name} <{email}>")

            # Validate fields
            if not all([name, email, pwd, photo]):
                print(f"  [SKIP] Missing fields in row {row_num}.")
                stats["errors"] += 1
                continue

            # STEP 1 — Email uniqueness
            if db.get_user_by_email(email):
                print(f"  [SKIP] Email already registered: {email}")
                stats["skip_email"] += 1
                continue

            # STEP 2 — Load photo
            photo_path = os.path.join(PHOTOS_DIR, photo)
            if not os.path.exists(photo_path):
                print(f"  [SKIP] Photo not found: {photo_path}")
                stats["skip_face"] += 1
                continue

            image = cv2.imread(photo_path)
            if image is None:
                print(f"  [SKIP] Cannot read image: {photo_path}")
                stats["skip_face"] += 1
                continue

            # STEP 3 — Validate exactly one face
            face_count = get_face_count(image)
            if face_count == 0:
                print(f"  [SKIP] No face detected in {photo}")
                stats["skip_face"] += 1
                continue
            if face_count > 1:
                print(f"  [SKIP] {face_count} faces detected in {photo}. Need exactly 1.")
                stats["skip_face"] += 1
                continue

            # STEP 4 — Generate 128-D embedding
            encoding = get_face_encoding(image)
            if encoding is None:
                print(f"  [SKIP] Could not generate face encoding from {photo}")
                stats["skip_face"] += 1
                continue

            # STEP 5 — Check face duplicate against existing DB users
            existing = db.get_all_users_with_embeddings() or []
            is_dup, matched = check_face_duplicate(encoding, existing)
            if is_dup:
                print(f"  [SKIP] Face already registered under: {matched}")
                stats["skip_face"] += 1
                continue

            # STEP 6 — Hash password securely
            password_hash = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()

            # STEP 7 — Insert user into DB
            user_id = db.create_user(name, email, password_hash)
            if not user_id:
                print(f"  [ERROR] DB insert failed.")
                stats["errors"] += 1
                continue

            # STEP 8 — Save face image to static/uploads/faces/{user_id}.jpg
            face_path = save_face_image(image, user_id)
            if not face_path:
                db.delete_user(user_id)   # rollback
                print(f"  [ERROR] Could not save face image. User row rolled back.")
                stats["errors"] += 1
                continue

            # STEP 9 — Save face path + embedding to DB
            emb_json = embedding_to_json(encoding)
            db.update_user_face_and_embedding(user_id, face_path, emb_json)
            db.log_timeline_event(user_id, "Imported",
                                  f"User imported via import script. Photo: {photo}")

            print(f"  [OK]   Inserted. user_id={user_id}")
            stats["inserted"] += 1

    print("\n" + "=" * 55)
    print("  Import Summary")
    print("=" * 55)
    print(f"  Inserted             : {stats['inserted']}")
    print(f"  Skipped (email dup)  : {stats['skip_email']}")
    print(f"  Skipped (face issue) : {stats['skip_face']}")
    print(f"  Errors               : {stats['errors']}")
    print("=" * 55 + "\n")


if __name__ == "__main__":
    import_users()
