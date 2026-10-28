# 🗳️ Secure Digital Election Portal

A **full-stack secure online voting system** built with Python (Flask), Face Recognition, Liveness Detection, and Blockchain — designed for tamper-proof, privacy-first elections.

---

## 🔥 Key Features

| Feature | Details |
|---|---|
| **Face Recognition Login** | 128-D facial embedding via `face_recognition` (dlib) |
| **Liveness Detection** | Blink + motion + texture analysis — rejects phone photos |
| **Blockchain Voting Ledger** | SHA-256 chained blocks, AES-256 encrypted ballots |
| **Fraud Detection** | Duplicate vote blocking, risk scoring, audit trail |
| **Admin Dashboard** | Live stats, blockchain audit, voter timeline |
| **Secure Registration** | bcrypt password hashing, duplicate face check |

---

## 🏗️ Architecture

```
secure-digital-election-portal/
│
├── app.py                  # Main Flask app — all routes
├── config.py               # Thresholds, paths, settings
├── database.py             # SQLite ORM (all DB queries)
├── face_auth.py            # Face encoding, liveness, duplicate check
├── blockchain.py           # AES-256 encrypted ballot chain
├── fraud_detection.py      # Risk scoring & duplicate vote detection
│
├── templates/              # Jinja2 HTML templates
│   ├── index.html
│   ├── register.html
│   ├── login.html
│   ├── capture_face.html   # Webcam face capture (register + login)
│   ├── vote.html
│   ├── dashboard.html
│   └── admin/
│       ├── admin_dashboard.html
│       ├── admin_votes.html
│       └── admin_audit.html
│
├── static/
│   ├── css/
│   ├── js/
│   │   ├── login.js        # Liveness frames capture for login
│   │   └── register.js     # Liveness frames capture for registration
│   └── uploads/faces/      # ← gitignored (biometric data)
│
├── .env.example            # Template for secrets
├── requirements.txt
└── setup_db.py             # First-run DB initialiser
```

---

## ⚙️ How Face Recognition Works

### Registration
1. User fills name / email / password → stored in SQLite
2. Webcam captures **30 frames** over 3 seconds
3. **Liveness check** runs (blink / motion / texture — any one must pass)
4. `face_recognition` extracts a **128-D embedding** from the best frame
5. Embedding is compared against all existing users (`DUPLICATE_FACE_THRESHOLD = 0.45`) — blocks duplicates
6. Embedding stored as JSON in DB alongside hashed password

### Login
1. User enters email + password (bcrypt verified)
2. Webcam captures 30 frames → liveness check
3. Live frame embedding compared against stored embedding
4. **Match threshold:** Euclidean distance ≤ `0.65` → same person ✅
5. On success → session created, redirect to vote page

### Liveness (Anti-Spoofing)
Passes if **any one** of:
- **Blink:** eye-region brightness drops ≥ 6 units across frames
- **Motion:** avg pixel diff ≥ 500 px between consecutive frames
- **Texture:** Laplacian variance ≥ 25 on final frame (blurry = fake photo)

---

## 🔗 Blockchain Voting

- Every vote = one **encrypted block**: `{ prev_hash, timestamp, encrypted_ballot, hmac_voter_id }`
- Ballot encrypted with **AES-256** (Fernet) using PBKDF2-derived key from `.env`
- Voter identity hashed with **HMAC-SHA256** — untraceable but auditable
- Chain integrity verified with **SHA-256** linking each block to the previous

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10 or 3.11
- CMake + C++ build tools (required for `dlib` / `face_recognition`)
- Webcam

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/secure-digital-election-portal.git
cd secure-digital-election-portal
```

### 2. Create virtual environment
```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

> ⚠️ `face-recognition` requires `dlib`. On Windows, install CMake first:
> ```bash
> pip install cmake
> pip install dlib
> pip install face-recognition
> ```

### 4. Set up environment secrets
```bash
cp .env.example .env
# Edit .env and fill in your secret keys
```

### 5. Initialise the database
```bash
python setup_db.py
```

### 6. Run the app
```bash
python app.py
```
Open **http://127.0.0.1:5000**

---

## 🔐 Environment Variables (`.env`)

```env
FLASK_SECRET_KEY=your_random_secret_key_here
BALLOT_MASTER_KEY=your_32_char_aes_key_here
VOTER_HMAC_SALT=your_hmac_salt_here
```

Copy from `.env.example` and fill in your own values. **Never commit `.env`.**

---

## 👤 Admin Panel

- URL: `/admin`
- Default credentials: `admin` / `admin123`
- Features: voter list, blockchain audit, fraud timeline, live chain verification

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, Flask 3.x |
| Database | SQLite (via `sqlite3`) |
| Face AI | `face_recognition` (dlib), OpenCV |
| Blockchain | Custom SHA-256 chain, AES-256 Fernet |
| Security | bcrypt, HMAC-SHA256, PBKDF2 |
| Frontend | HTML5, CSS3, JavaScript (Webcam API) |

---

## 🛡️ Security Highlights

- ✅ Passwords hashed with **bcrypt** (never stored plain)
- ✅ Face biometrics stored as **128-D vectors** (not raw images for login)
- ✅ Liveness detection **blocks phone photo spoofing**
- ✅ Votes **AES-256 encrypted** — even admin can't read without master key
- ✅ Voter identity protected by **HMAC** — vote is auditable but anonymous
- ✅ Blockchain **immutable** — any tampered block breaks chain verification
- ✅ Secrets in `.env` — **never hardcoded**

---

## 🧪 Running Tests

```bash
pytest tests/
```

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 👥 Team

Built as a college project demonstrating secure digital voting with AI-powered biometric authentication and blockchain-backed vote integrity.
