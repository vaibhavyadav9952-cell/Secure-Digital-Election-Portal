# Member Contribution & Viva Defense Guide

This guide is designed for the 4-member project team for final-year project presentations, viva examinations, and project report documentation.

---

## 👤 Member 1: Authentication & User Management

### Subsystem: Identity Verification & Access Control
- **Assigned Module**: Registration, Simulated Aadhaar Verification (UIDAI), OTP Gateway, Password Encryption, Session Management.
- **Key Source Code Files**:
  - `backend/routes/authRoutes.js`
  - `backend/config/database.js` (Aadhaar mock database table)
  - `backend/middleware/authMiddleware.js`
  - `frontend/js/auth.js`

### Technical Highlights
1. **Simulated UIDAI Database**: Maintained local records of citizens with 12-digit Aadhaar numbers, phone numbers, and dates of birth.
2. **Age Eligibility Enforcement**: Automatically calculates voter age from DOB and strictly rejects citizens $<18$ years old.
3. **Time-Based 2-Factor OTP**: Generates a cryptographically random 6-digit OTP with a 5-minute expiration timer and rate limiting.
4. **Bcrypt Hashing**: Passwords are encrypted using bcrypt with 10 salt rounds before persistence.
5. **JWT Authentication**: Issues signed JSON Web Tokens (24h lifespan) containing user claims and role (`voter` vs `admin`).

### Anticipated Viva Questions & Answers
- **Q: Why simulate Aadhaar rather than calling real UIDAI APIs?**
  - *A: Real UIDAI APIs require government authorization, biometric KYC hardware, and enterprise licenses. Simulating the UIDAI database with full 12-digit schemas, 18+ age checks, and OTP gateways allows complete end-to-end verification without legal/hardware bottlenecks.*
- **Q: How are passwords protected against rainbow table attacks?**
  - *A: We use `bcryptjs` with adaptive salt rounds ($2^{10}$ iterations), which hashes unique per-user salts preventing rainbow table lookups.*

---

## 👤 Member 2: Voting Portal & Admin Dashboard

### Subsystem: Election Management & Ballot Operations
- **Assigned Module**: Candidate Management, Election Lifecycle, Voter Ballot UI, Double-Voting Prevention, Live Tallying.
- **Key Source Code Files**:
  - `backend/routes/electionRoutes.js`
  - `frontend/js/voting.js`
  - `frontend/js/admin.js`

### Technical Highlights
1. **Atomic Double-Voting Prevention**: Once a vote is submitted, the voter's database record is atomically updated (`has_voted = 1`). Any subsequent attempt is rejected and flagged as a security anomaly.
2. **Secret Ballot Guarantee**: The voter registry records *that* a voter cast a ballot, but the vote itself is encrypted into an anonymous blockchain transaction with a salt token, ensuring nobody (not even administrators) can trace candidate choices to individual citizens.
3. **Admin Election Governance**: Admins can start, pause, and close elections, and manage candidate rosters with symbols, photos, and manifestos.
4. **Real-time Results Engine**: Automatically computes live vote shares and proclaims the winner upon election finalization.

### Anticipated Viva Questions & Answers
- **Q: How do you ensure a voter cannot vote twice?**
  - *A: When a vote request arrives, the server checks the voter's `has_voted` flag. If `0`, the vote is mined onto the blockchain and `has_voted` is set to `1` atomically in the database. If `1`, the request returns HTTP 403 and triggers an AI security anomaly alert.*
- **Q: How is the voter's privacy maintained?**
  - *A: Voter identity and candidate choice are decoupled. The blockchain stores only anonymous transaction hashes, salted receipt tokens, and candidate IDs.*

---

## 👤 Member 3: Blockchain & Security Core

### Subsystem: Decentralized Cryptographic Ledger
- **Assigned Module**: Custom SHA-256 Blockchain, Merkle Root Hashing, Proof-of-Work Mining, Tamper Detection, Audit Logs.
- **Key Source Code Files**:
  - `backend/blockchain/Block.js`
  - `backend/blockchain/Blockchain.js`
  - `backend/blockchain/VoteTransaction.js`
  - `backend/routes/blockchainRoutes.js`
  - `frontend/js/blockchainView.js`

### Technical Highlights
1. **Custom SHA-256 Blockchain Architecture**: Built a complete blockchain from scratch with `index`, `timestamp`, `transactions`, `previousHash`, `merkleRoot`, `nonce`, and `hash`.
2. **Merkle Tree Computation**: Batched vote transactions are hashed into a binary Merkle tree root for cryptographic integrity.
3. **Proof-of-Work Mining**: Implemented mining consensus algorithm requiring leading zeros (`difficulty = 2`).
4. **Live Tamper Detection**: Traverses the chain and verifies recalculations of hashes and previous links. Identifies the exact corrupted block if any byte is altered.
5. **Voter Cryptographic Receipt Proof**: Voters can verify inclusion in the immutable ledger using their private receipt token.

### Anticipated Viva Questions & Answers
- **Q: What happens if an attacker modifies a vote in Block #2?**
  - *A: Changing data in Block #2 changes its Merkle root and SHA-256 hash. Because Block #3 references Block #2's original hash in `previousHash`, the link breaks. The `isChainValid()` algorithm immediately flags Block #2 as tampered.*
- **Q: Why use a Merkle Tree in each block?**
  - *A: Merkle trees allow efficient ($O(\log N)$) cryptographic verification of whether a transaction is included in a block without having to download all block data.*

---

## 👤 Member 4: AI & Analytics / Smart Monitoring

### Subsystem: Machine Learning & Real-Time Monitoring
- **Assigned Module**: AI Anomaly Detection, Voting Velocity Tracking, IP Cluster Detection, Live Chart.js Visualizations, Certified Election Reports.
- **Key Source Code Files**:
  - `backend/ai_engine/fraud_detector.py`
  - `backend/ai_engine/anomalyService.js`
  - `backend/routes/analyticsRoutes.js`
  - `frontend/js/analyticsView.js`

### Technical Highlights
1. **Multi-Factor Anomaly Scoring**: Analyzes 60-second sliding-window voting velocity (bursts $> 10$ votes/min), IP clustering (proxy floods), duplicate vote attempts, and cryptographic tamper alerts.
2. **Python Scikit-Learn ML Script**: Standalone Python module (`fraud_detector.py`) executing statistical outlier analysis and risk classification (LOW / MODERATE / ELEVATED / CRITICAL).
3. **Live Interactive Visualizations**: Chart.js integration displaying real-time vote share (Donut), hourly velocity (Line), and demographic breakdowns (Bar).
4. **Official Certified Audit Report**: Generates a printable official election audit document featuring winner proclamations, vote tallies, digital seals, and blockchain hash certificates.

### Anticipated Viva Questions & Answers
- **Q: How does the AI detect bot attacks or automated voting?**
  - *A: The anomaly engine tracks voting velocity using a 60-second sliding window and IP entropy. A surge in votes from a single IP or sudden abnormal spikes triggers an anomaly score surge and warns administrators.*
- **Q: How is the Python ML model connected to the Node.js backend?**
  - *A: Node.js spawns the Python script as a sub-process via `child_process.spawn()`, passes database context, and parses the returned JSON risk report, with an internal Node.js statistical fallback if Python is unavailable.*
