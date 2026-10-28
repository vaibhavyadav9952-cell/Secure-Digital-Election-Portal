const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, '../../election_portal.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB] Error opening SQLite database:', err.message);
  } else {
    console.log('[DB] Connected to SQLite database at:', dbPath);
  }
});

// Helper for promise-based queries
db.asyncRun = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

db.asyncGet = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

db.asyncAll = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// Initialize schema and seed data
async function initDatabase() {
  db.serialize(async () => {
    // 1. Aadhaar Simulation Table (UIDAI Mock Database)
    db.run(`
      CREATE TABLE IF NOT EXISTS aadhaar_records (
        aadhaar_no TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        mobile TEXT NOT NULL,
        dob TEXT NOT NULL,
        gender TEXT NOT NULL,
        address TEXT NOT NULL,
        photo_url TEXT,
        is_registered INTEGER DEFAULT 0
      )
    `);

    // 2. Registered Voters Table
    db.run(`
      CREATE TABLE IF NOT EXISTS voters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aadhaar_no TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE,
        mobile TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        voter_id TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'voter',
        has_voted INTEGER DEFAULT 0,
        voted_at TEXT,
        receipt_hash TEXT,
        face_verified INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. OTP Sessions
    db.run(`
      CREATE TABLE IF NOT EXISTS otp_sessions (
        aadhaar_no TEXT PRIMARY KEY,
        mobile TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        verified INTEGER DEFAULT 0
      )
    `);

    // 4. Election Metadata
    db.run(`
      CREATE TABLE IF NOT EXISTS elections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'ACTIVE', -- 'DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'
        start_time TEXT,
        end_time TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Candidates Table
    db.run(`
      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        party TEXT NOT NULL,
        symbol TEXT NOT NULL,
        photo TEXT,
        manifesto TEXT,
        constituency TEXT DEFAULT 'National General',
        vote_count INTEGER DEFAULT 0
      )
    `);

    // 6. Blockchain Persistent Storage
    db.run(`
      CREATE TABLE IF NOT EXISTS blockchain_blocks (
        block_index INTEGER PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        merkle_root TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Security Audit Trail Logs
    db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        ip_address TEXT,
        details_json TEXT,
        severity TEXT DEFAULT 'INFO' -- 'INFO', 'WARN', 'CRITICAL'
      )
    `);

    // 8. AI Anomaly Logs
    db.run(`
      CREATE TABLE IF NOT EXISTS ai_anomaly_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        anomaly_type TEXT NOT NULL,
        score REAL NOT NULL,
        details TEXT NOT NULL,
        ip_address TEXT,
        resolved INTEGER DEFAULT 0
      )
    `);

    await seedMockData();
  });
}

async function seedMockData() {
  try {
    // Seed UIDAI Aadhaar Mock Database
    const aadhaarCount = await db.asyncGet('SELECT COUNT(*) as count FROM aadhaar_records');
    if (aadhaarCount.count === 0) {
      const mockAadhaar = [
        ['112233445566', 'Aarav Sharma', '+91 9876543210', '1995-05-14', 'Male', 'Flat 402, Lotus Towers, New Delhi', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150'],
        ['223344556677', 'Priya Patel', '+91 9876543211', '1998-11-23', 'Female', '12, Shanti Kunj, Ahmedabad, Gujarat', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150'],
        ['334455667788', 'Rohan Verma', '+91 9876543212', '1990-08-19', 'Male', '88 Green Park, Bengaluru, Karnataka', 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150'],
        ['445566778899', 'Ananya Iyer', '+91 9876543213', '2001-02-10', 'Female', '45 Marina Road, Chennai, Tamil Nadu', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150'],
        ['556677889900', 'Vikramaditya Singh', '+91 9876543214', '1988-12-05', 'Male', 'Plot 104, Civil Lines, Jaipur, Rajasthan', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150'],
        ['667788990011', 'Sneha Mukherjee', '+91 9876543215', '1996-07-30', 'Female', '22 Ballygunge, Kolkata, West Bengal', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'],
        ['778899001122', 'Kabir Khan', '+91 9876543216', '1993-04-18', 'Male', 'Bandstand Villa, Bandra West, Mumbai', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150'],
        ['889900112233', 'Pooja Nair', '+91 9876543217', '1997-09-12', 'Female', '77 Hill Palace Road, Kochi, Kerala', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'],
        ['990011223344', 'Aditya Joshi', '+91 9876543218', '2000-01-25', 'Male', '34 Model Town, Pune, Maharashtra', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150'],
        ['123456789012', 'Divya Sundaram', '+91 9876543219', '1992-06-15', 'Female', '108 Jubilee Hills, Hyderabad, Telangana', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150']
      ];

      for (const row of mockAadhaar) {
        await db.asyncRun(
          'INSERT INTO aadhaar_records (aadhaar_no, full_name, mobile, dob, gender, address, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
          row
        );
      }
      console.log('[DB] Mock Aadhaar database seeded with 10 records.');
    }

    // Seed Admin Account & Sample Pre-Registered Voters
    const voterCount = await db.asyncGet('SELECT COUNT(*) as count FROM voters');
    if (voterCount.count === 0) {
      const adminPass = await bcrypt.hash('admin123', 10);
      const voterPass = await bcrypt.hash('voter123', 10);

      // Admin user
      await db.asyncRun(`
        INSERT INTO voters (aadhaar_no, full_name, email, mobile, password_hash, voter_id, role)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, ['000000000000', 'Chief Election Administrator', 'admin@election.gov', '+91 9000000000', adminPass, 'ADMIN-001', 'admin']);

      // Pre-seed 3 demo voters
      await db.asyncRun(`
        INSERT INTO voters (aadhaar_no, full_name, email, mobile, password_hash, voter_id, role, has_voted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, ['112233445566', 'Aarav Sharma', 'aarav@example.com', '+91 9876543210', voterPass, 'VOTER-IND-1001', 'voter', 0]);

      await db.asyncRun(`
        INSERT INTO voters (aadhaar_no, full_name, email, mobile, password_hash, voter_id, role, has_voted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, ['223344556677', 'Priya Patel', 'priya@example.com', '+91 9876543211', voterPass, 'VOTER-IND-1002', 'voter', 0]);

      await db.asyncRun(`
        INSERT INTO voters (aadhaar_no, full_name, email, mobile, password_hash, voter_id, role, has_voted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, ['334455667788', 'Rohan Verma', 'rohan@example.com', '+91 9876543212', voterPass, 'VOTER-IND-1003', 'voter', 0]);

      // Mark mock Aadhaar records as registered
      await db.asyncRun("UPDATE aadhaar_records SET is_registered = 1 WHERE aadhaar_no IN ('112233445566', '223344556677', '334455667788')");
      console.log('[DB] Admin and demo voter accounts seeded.');
    }

    // Seed Election Details
    const electionCount = await db.asyncGet('SELECT COUNT(*) as count FROM elections');
    if (electionCount.count === 0) {
      await db.asyncRun(`
        INSERT INTO elections (title, description, status, start_time, end_time)
        VALUES (?, ?, 'ACTIVE', datetime('now'), datetime('now', '+7 days'))
      `, [
        'National General Election 2026',
        'Secure democratic election powered by Aadhaar verification, cryptographic SHA-256 Blockchain, and AI anomaly detection.'
      ]);
      console.log('[DB] Default Election seeded.');
    }

    // Seed Candidates
    const candidateCount = await db.asyncGet('SELECT COUNT(*) as count FROM candidates');
    if (candidateCount.count === 0) {
      const mockCandidates = [
        [
          'Dr. Rajesh Vardhan',
          'Progressive Democratic Alliance (PDA)',
          '🌱',
          'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
          'Focusing on clean energy transition, digital healthcare infrastructure, and high-tech job creation across all districts.',
          'Constituency 01 - North Metro'
        ],
        [
          'Smt. Meera Sundaram',
          'National Unity Front (NUF)',
          '⚡',
          'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
          'Championing universal high-speed internet, smart public transit networks, and youth entrepreneurship funds.',
          'Constituency 01 - North Metro'
        ],
        [
          'Col. Arjun Singhania (Retd.)',
          'Bharat Vikas Parishad (BVP)',
          '🛡️',
          'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150',
          'Prioritizing cybersecurity sovereignty, rural agricultural modernizations, and transparent governance reform.',
          'Constituency 01 - North Metro'
        ],
        [
          'Adv. Kavita Deshmukh',
          'Citizen Rights & Justice Coalition (CRJC)',
          '⚖️',
          'https://images.unsplash.com/photo-1580894732444-8ecded7900cd?w=150',
          'Advocating for educational equality, environmental preservation, and digital privacy safeguards for every citizen.',
          'Constituency 01 - North Metro'
        ],
        [
          'None of the Above (NOTA)',
          'Independent / Neutral',
          '🚫',
          'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=150',
          'Express lack of confidence in all candidate manifestos.',
          'All Constituencies'
        ]
      ];

      for (const cand of mockCandidates) {
        await db.asyncRun(
          'INSERT INTO candidates (name, party, symbol, photo, manifesto, constituency) VALUES (?, ?, ?, ?, ?, ?)',
          cand
        );
      }
      console.log('[DB] Default candidates seeded.');
    }

    // Seed Initial Audit Logs
    const auditCount = await db.asyncGet('SELECT COUNT(*) as count FROM audit_logs');
    if (auditCount.count === 0) {
      await db.asyncRun(`
        INSERT INTO audit_logs (event_type, actor, ip_address, details_json, severity)
        VALUES (?, ?, ?, ?, ?)
      `, ['SYSTEM_INIT', 'SYSTEM', '127.0.0.1', JSON.stringify({ message: 'Election portal initialized successfully.' }), 'INFO']);
    }
  } catch (err) {
    console.error('[DB] Seeding error:', err);
  }
}

module.exports = {
  db,
  initDatabase
};
