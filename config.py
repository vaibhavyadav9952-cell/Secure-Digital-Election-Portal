# config.py - Configuration for the Secure Digital Election Portal

import os

# Secret key for Flask sessions
SECRET_KEY = "election_portal_secret_key_2024"

# SQLite database path (built into Python — no server needed)
DATABASE_PATH = "election_portal.db"

# Face image storage
UPLOAD_FOLDER = os.path.join("static", "uploads", "faces")
TEMP_FOLDER   = os.path.join("static", "uploads", "temp")

# ---------------------------------------------------------------
# FACE_MATCH_THRESHOLD:
#   face_recognition computes Euclidean distance between 128-D vectors.
#   0.0 = identical  |  1.0 = completely different
#   distance <= FACE_MATCH_THRESHOLD  →  same person
#   Used BOTH for login verification AND duplicate-registration detection.
#   Tune here in one place only.
#   Lower (e.g. 0.45) = stricter / fewer false positives
#   Higher (e.g. 0.55) = more lenient
# ---------------------------------------------------------------
FACE_MATCH_THRESHOLD = 0.65

# Stricter threshold used ONLY for duplicate-detection during registration.
# Must be lower (stricter) than FACE_MATCH_THRESHOLD so we don't false-positive
# on the large Kaggle dataset while still allowing lenient login matching.
DUPLICATE_FACE_THRESHOLD = 0.45

# Session settings
SESSION_TYPE      = "filesystem"
SESSION_PERMANENT = False

# Admin credentials (also seeded into DB by setup_db.py)
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"

# Fraud / Risk thresholds
RISK_SAFE       = 30
RISK_SUSPICIOUS = 60

# Election status
ELECTION_OPEN = True
