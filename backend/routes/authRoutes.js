const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { JWT_SECRET, requireAuth } = require('../middleware/authMiddleware');

/**
 * Calculate age from YYYY-MM-DD
 */
function calculateAge(dobString) {
  const dob = new Date(dobString);
  const diff = Date.now() - dob.getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

/**
 * GET /api/auth/aadhaar-directory
 * Returns mock Aadhaar records for demonstration & testing
 */
router.get('/aadhaar-directory', async (req, res) => {
  try {
    const records = await db.asyncAll('SELECT aadhaar_no, full_name, mobile, dob, gender, address, is_registered FROM aadhaar_records');
    res.json({ success: true, count: records.length, records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/auth/aadhaar-lookup
 * Step 1 of Registration: Verify Citizen in UIDAI Simulated Database & Age Check
 */
router.post('/aadhaar-lookup', async (req, res) => {
  try {
    const { aadhaar_no } = req.body;
    if (!aadhaar_no || !/^\d{12}$/.test(aadhaar_no.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 12-digit Aadhaar Number.'
      });
    }

    const cleanAadhaar = aadhaar_no.trim();
    const citizen = await db.asyncGet('SELECT * FROM aadhaar_records WHERE aadhaar_no = ?', [cleanAadhaar]);

    if (!citizen) {
      return res.status(404).json({
        success: false,
        message: 'Aadhaar Number not found in UIDAI National Database. Please verify and try again.'
      });
    }

    // Check if already registered
    const existingVoter = await db.asyncGet('SELECT id, voter_id FROM voters WHERE aadhaar_no = ?', [cleanAadhaar]);
    if (existingVoter) {
      return res.status(409).json({
        success: false,
        message: `This Aadhaar is already registered with Voter ID: ${existingVoter.voter_id}. Please login directly.`
      });
    }

    // Check 18+ Eligibility
    const age = calculateAge(citizen.dob);
    if (age < 18) {
      return res.status(403).json({
        success: false,
        message: `Eligibility Check Failed: Citizen age is ${age} years. Minimum voting age is 18 years.`
      });
    }

    // Mask phone number for security
    const maskedMobile = citizen.mobile.replace(/(\+?\d{2})\s?(\d{2})(\d{4})(\d{4})/, '$1 $2****$4');

    res.json({
      success: true,
      message: 'Aadhaar identity verified with UIDAI records.',
      citizen: {
        aadhaar_no: citizen.aadhaar_no,
        full_name: citizen.full_name,
        dob: citizen.dob,
        age,
        gender: citizen.gender,
        address: citizen.address,
        maskedMobile,
        rawMobile: citizen.mobile,
        photo_url: citizen.photo_url
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/auth/send-otp
 * Step 2 of Registration: Generate 6-digit OTP and send via simulated SMS gateway
 */
router.post('/send-otp', async (req, res) => {
  try {
    const { aadhaar_no } = req.body;
    if (!aadhaar_no) {
      return res.status(400).json({ success: false, message: 'Aadhaar number is required.' });
    }

    const citizen = await db.asyncGet('SELECT * FROM aadhaar_records WHERE aadhaar_no = ?', [aadhaar_no]);
    if (!citizen) {
      return res.status(404).json({ success: false, message: 'Citizen record not found.' });
    }

    // Generate 6-digit random OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    // Upsert into otp_sessions
    await db.asyncRun(`
      INSERT OR REPLACE INTO otp_sessions (aadhaar_no, mobile, otp_code, expires_at, verified)
      VALUES (?, ?, ?, ?, 0)
    `, [aadhaar_no, citizen.mobile, otpCode, expiresAt]);

    console.log(`[OTP Gateway - Simulation] 📲 SMS to ${citizen.mobile}: "Your Secure Election Portal OTP is ${otpCode}. Valid for 5 mins."`);

    res.json({
      success: true,
      message: `OTP successfully generated and dispatched to ${citizen.mobile}.`,
      otpPreview: otpCode, // Provided for easy UI evaluation and demonstration
      expiresInSeconds: 300
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/auth/verify-otp
 * Step 3: Validate OTP submitted by user
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { aadhaar_no, otp_code } = req.body;
    if (!aadhaar_no || !otp_code) {
      return res.status(400).json({ success: false, message: 'Aadhaar number and OTP are required.' });
    }

    const session = await db.asyncGet('SELECT * FROM otp_sessions WHERE aadhaar_no = ?', [aadhaar_no]);
    if (!session) {
      return res.status(400).json({ success: false, message: 'No active OTP session found. Please request a new OTP.' });
    }

    if (Date.now() > session.expires_at) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (session.otp_code !== otp_code.trim()) {
      return res.status(400).json({ success: false, message: 'Invalid OTP code. Please enter the correct 6-digit code.' });
    }

    // Mark as verified
    await db.asyncRun('UPDATE otp_sessions SET verified = 1 WHERE aadhaar_no = ?', [aadhaar_no]);

    res.json({
      success: true,
      message: 'Mobile OTP verified successfully. Proceed to password creation.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/auth/register
 * Step 4: Finalize Voter Registration with Encrypted Password & Voter ID Generation
 */
router.post('/register', async (req, res) => {
  try {
    const { aadhaar_no, email, password } = req.body;
    if (!aadhaar_no || !email || !password) {
      return res.status(400).json({ success: false, message: 'All fields (Aadhaar, Email, Password) are required.' });
    }

    // Ensure OTP was verified
    const session = await db.asyncGet('SELECT * FROM otp_sessions WHERE aadhaar_no = ? AND verified = 1', [aadhaar_no]);
    if (!session) {
      return res.status(400).json({
        success: false,
        message: 'OTP verification is required before finalizing registration.'
      });
    }

    const citizen = await db.asyncGet('SELECT * FROM aadhaar_records WHERE aadhaar_no = ?', [aadhaar_no]);
    if (!citizen) {
      return res.status(404).json({ success: false, message: 'Aadhaar record not found.' });
    }

    // Generate unique national Voter ID
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const voterId = `VOTER-IND-${randomSuffix}`;

    // Hash password with bcrypt
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Save Voter Record
    const insertResult = await db.asyncRun(`
      INSERT INTO voters (aadhaar_no, full_name, email, mobile, password_hash, voter_id, role, has_voted)
      VALUES (?, ?, ?, ?, ?, ?, 'voter', 0)
    `, [aadhaar_no, citizen.full_name, email.toLowerCase().trim(), citizen.mobile, passwordHash, voterId]);

    // Update UIDAI status
    await db.asyncRun('UPDATE aadhaar_records SET is_registered = 1 WHERE aadhaar_no = ?', [aadhaar_no]);
    // Clean up OTP session
    await db.asyncRun('DELETE FROM otp_sessions WHERE aadhaar_no = ?', [aadhaar_no]);

    // Issue JWT token
    const token = jwt.sign(
      {
        id: insertResult.id,
        aadhaar_no: citizen.aadhaar_no,
        full_name: citizen.full_name,
        voter_id: voterId,
        role: 'voter'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Audit log
    await db.asyncRun(`
      INSERT INTO audit_logs (event_type, actor, ip_address, details_json, severity)
      VALUES (?, ?, ?, ?, ?)
    `, [
      'VOTER_REGISTERED',
      citizen.full_name,
      req.ip || '127.0.0.1',
      JSON.stringify({ voterId, aadhaar_no }),
      'INFO'
    ]);

    res.status(201).json({
      success: true,
      message: 'Voter Registration Successful! Your Voter ID has been generated.',
      token,
      voter: {
        id: insertResult.id,
        voter_id: voterId,
        full_name: citizen.full_name,
        aadhaar_no: citizen.aadhaar_no,
        email: email.toLowerCase().trim(),
        mobile: citizen.mobile,
        has_voted: 0,
        role: 'voter'
      }
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        success: false,
        message: 'A voter with this Aadhaar or Email is already registered.'
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/auth/login
 * User & Admin Authentication
 */
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Please provide identifier (Aadhaar / Voter ID / Email / Username) and password.' });
    }

    const cleanId = identifier.trim();

    // Query by Aadhaar, Voter ID, Email, or Admin username
    let user = await db.asyncGet(`
      SELECT * FROM voters 
      WHERE aadhaar_no = ? OR voter_id = ? OR email = ? OR (role = 'admin' AND aadhaar_no = '000000000000' AND email = ?)
    `, [cleanId, cleanId, cleanId.toLowerCase(), cleanId]);

    if (!user && cleanId === 'admin') {
      user = await db.asyncGet("SELECT * FROM voters WHERE role = 'admin' LIMIT 1");
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        aadhaar_no: user.aadhaar_no,
        full_name: user.full_name,
        voter_id: user.voter_id,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Audit log
    await db.asyncRun(`
      INSERT INTO audit_logs (event_type, actor, ip_address, details_json, severity)
      VALUES (?, ?, ?, ?, ?)
    `, [
      'USER_LOGIN',
      user.full_name,
      req.ip || '127.0.0.1',
      JSON.stringify({ voter_id: user.voter_id, role: user.role }),
      'INFO'
    ]);

    res.json({
      success: true,
      message: `Welcome, ${user.full_name}!`,
      token,
      user: {
        id: user.id,
        voter_id: user.voter_id,
        full_name: user.full_name,
        aadhaar_no: user.aadhaar_no,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        has_voted: user.has_voted,
        voted_at: user.voted_at,
        receipt_hash: user.receipt_hash
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/auth/me
 * Get current logged in user details
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.asyncGet('SELECT id, aadhaar_no, full_name, email, mobile, voter_id, role, has_voted, voted_at, receipt_hash FROM voters WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
