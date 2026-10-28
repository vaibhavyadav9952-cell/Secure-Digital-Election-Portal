const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const blockchain = require('../blockchain/Blockchain');
const VoteTransaction = require('../blockchain/VoteTransaction');
const anomalyService = require('../ai_engine/anomalyService');

/**
 * GET /api/election
 * Fetch active election metadata & candidate list
 */
router.get('/', async (req, res) => {
  try {
    const election = await db.asyncGet('SELECT * FROM elections ORDER BY id DESC LIMIT 1');
    const candidates = await db.asyncAll('SELECT id, name, party, symbol, photo, manifesto, constituency, vote_count FROM candidates ORDER BY id ASC');
    const totalVoters = await db.asyncGet('SELECT COUNT(*) as count FROM voters WHERE role = "voter"');
    const totalVoted = await db.asyncGet('SELECT COUNT(*) as count FROM voters WHERE role = "voter" AND has_voted = 1');

    res.json({
      success: true,
      election,
      candidates,
      stats: {
        totalVoters: totalVoters.count,
        totalVoted: totalVoted.count,
        turnoutPercentage: totalVoters.count > 0 ? ((totalVoted.count / totalVoters.count) * 100).toFixed(1) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/election/status
 * Admin update election status ('ACTIVE', 'PAUSED', 'CLOSED')
 */
router.put('/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'PAUSED', 'CLOSED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid election status.' });
    }

    const election = await db.asyncGet('SELECT id FROM elections ORDER BY id DESC LIMIT 1');
    if (!election) {
      return res.status(404).json({ success: false, message: 'No election found.' });
    }

    await db.asyncRun('UPDATE elections SET status = ? WHERE id = ?', [status, election.id]);

    await db.asyncRun(`
      INSERT INTO audit_logs (event_type, actor, ip_address, details_json, severity)
      VALUES (?, ?, ?, ?, ?)
    `, [
      'ELECTION_STATUS_CHANGE',
      req.user.full_name || 'Admin',
      req.ip || '127.0.0.1',
      JSON.stringify({ status }),
      'WARN'
    ]);

    res.json({
      success: true,
      message: `Election status successfully updated to ${status}.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/election/candidates
 * Admin add a candidate
 */
router.post('/candidates', requireAdmin, async (req, res) => {
  try {
    const { name, party, symbol, photo, manifesto, constituency } = req.body;
    if (!name || !party || !symbol) {
      return res.status(400).json({ success: false, message: 'Candidate name, party, and symbol are required.' });
    }

    const result = await db.asyncRun(`
      INSERT INTO candidates (name, party, symbol, photo, manifesto, constituency)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      name,
      party,
      symbol,
      photo || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
      manifesto || 'Dedicated to serving citizens and upholding national progress.',
      constituency || 'National General'
    ]);

    await db.asyncRun(`
      INSERT INTO audit_logs (event_type, actor, ip_address, details_json, severity)
      VALUES (?, ?, ?, ?, ?)
    `, [
      'CANDIDATE_ADDED',
      req.user.full_name || 'Admin',
      req.ip || '127.0.0.1',
      JSON.stringify({ candidateId: result.id, name, party }),
      'INFO'
    ]);

    res.status(201).json({
      success: true,
      message: 'Candidate added successfully.',
      candidateId: result.id
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/election/candidates/:id
 * Admin edit candidate
 */
router.put('/candidates/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, party, symbol, photo, manifesto, constituency } = req.body;

    await db.asyncRun(`
      UPDATE candidates 
      SET name = ?, party = ?, symbol = ?, photo = ?, manifesto = ?, constituency = ?
      WHERE id = ?
    `, [name, party, symbol, photo, manifesto, constituency, id]);

    res.json({ success: true, message: 'Candidate updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/election/candidates/:id
 * Admin delete candidate
 */
router.delete('/candidates/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.asyncRun('DELETE FROM candidates WHERE id = ?', [id]);
    res.json({ success: true, message: 'Candidate removed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/election/vote
 * Core Voting Endpoint: Cast Vote -> Blockchain Mined -> Anti-Double Voting Check
 */
router.post('/vote', requireAuth, async (req, res) => {
  try {
    const voterId = req.user.id;
    const { candidateId } = req.body;

    if (!candidateId) {
      return res.status(400).json({ success: false, message: 'Please select a candidate to vote.' });
    }

    // 1. Check Election Active State
    const election = await db.asyncGet('SELECT * FROM elections ORDER BY id DESC LIMIT 1');
    if (!election || election.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: `Voting is currently ${election ? election.status.toLowerCase() : 'closed'}. Votes can only be cast when election is ACTIVE.`
      });
    }

    // 2. Anti-Double Voting Verification (Enforce Single Ballot Per Voter)
    const voter = await db.asyncGet('SELECT * FROM voters WHERE id = ?', [voterId]);
    if (!voter) {
      return res.status(404).json({ success: false, message: 'Voter profile not found.' });
    }

    if (voter.has_voted === 1) {
      // AI & Security Anomaly Tracking
      await anomalyService.recordDuplicateAttempt(voter.voter_id, voter.full_name, req.ip || '127.0.0.1');

      return res.status(403).json({
        success: false,
        message: 'Duplicate Vote Rejected! You have already cast your ballot in this election.',
        votedAt: voter.voted_at,
        receiptHash: voter.receipt_hash
      });
    }

    // 3. Verify Candidate
    const candidate = await db.asyncGet('SELECT * FROM candidates WHERE id = ?', [candidateId]);
    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Candidate not found.' });
    }

    // 4. Create Cryptographic Anonymous Vote Transaction
    const voteTx = new VoteTransaction({
      electionId: election.id,
      candidateId: candidate.id,
      candidateName: candidate.name,
      voterAadhaarNo: voter.aadhaar_no
    });

    // 5. Mine Block into Custom SHA-256 Blockchain
    const minedBlock = await blockchain.addVote(voteTx);

    // 6. Update Candidate Vote Count
    await db.asyncRun('UPDATE candidates SET vote_count = vote_count + 1 WHERE id = ?', [candidate.id]);

    // 7. Update Voter record atomically
    const nowIso = new Date().toISOString();
    await db.asyncRun(`
      UPDATE voters 
      SET has_voted = 1, voted_at = ?, receipt_hash = ?
      WHERE id = ?
    `, [nowIso, voteTx.voterReceiptHash, voterId]);

    // 8. AI Real-Time Voting Velocity & Anomaly Monitoring
    await anomalyService.recordVoteEvent(voter.voter_id, req.ip || '127.0.0.1');

    // 9. Audit Logging (Secret ballot preserved - no candidate identity linked to voter)
    await db.asyncRun(`
      INSERT INTO audit_logs (event_type, actor, ip_address, details_json, severity)
      VALUES (?, ?, ?, ?, ?)
    `, [
      'VOTE_CAST_SUCCESS',
      voter.full_name,
      req.ip || '127.0.0.1',
      JSON.stringify({
        voterId: voter.voter_id,
        blockIndex: minedBlock.index,
        receiptHash: voteTx.voterReceiptHash
      }),
      'INFO'
    ]);

    res.json({
      success: true,
      message: 'Vote cast and successfully mined into immutable SHA-256 Blockchain!',
      receipt: {
        receiptToken: voteTx.voterReceiptHash,
        blockIndex: minedBlock.index,
        blockHash: minedBlock.hash,
        timestamp: voteTx.timestamp,
        candidateChosen: candidate.name,
        signature: voteTx.signature
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/election/results
 * Live Election Results & Winner Analysis
 */
router.get('/results', async (req, res) => {
  try {
    const election = await db.asyncGet('SELECT * FROM elections ORDER BY id DESC LIMIT 1');
    const candidates = await db.asyncAll('SELECT id, name, party, symbol, photo, vote_count FROM candidates ORDER BY vote_count DESC');
    const totalVotes = candidates.reduce((sum, c) => sum + c.vote_count, 0);

    const candidatesWithPct = candidates.map((c) => ({
      ...c,
      votePercentage: totalVotes > 0 ? ((c.vote_count / totalVotes) * 100).toFixed(2) : '0.00'
    }));

    const leadingCandidate = candidatesWithPct.length > 0 && totalVotes > 0 ? candidatesWithPct[0] : null;

    res.json({
      success: true,
      election,
      totalVotes,
      leadingCandidate,
      isFinalized: election.status === 'CLOSED',
      results: candidatesWithPct
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/election/voters
 * Admin view of registered voters and voting status
 */
router.get('/voters', requireAdmin, async (req, res) => {
  try {
    const voters = await db.asyncAll(`
      SELECT id, voter_id, full_name, email, mobile, role, has_voted, voted_at, receipt_hash, created_at 
      FROM voters 
      WHERE role = 'voter'
      ORDER BY id ASC
    `);
    res.json({ success: true, count: voters.length, voters });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
