const express = require('express');
const router = express.Router();
const blockchain = require('../blockchain/Blockchain');
const { db } = require('../config/database');
const anomalyService = require('../ai_engine/anomalyService');
const { requireAdmin } = require('../middleware/authMiddleware');

/**
 * GET /api/blockchain/chain
 * Get full blockchain ledger
 */
router.get('/chain', (req, res) => {
  try {
    const summary = blockchain.getChainSummary();
    const validation = blockchain.isChainValid();

    res.json({
      success: true,
      length: summary.length,
      difficulty: blockchain.difficulty,
      isChainValid: validation.isValid,
      validationDetail: validation,
      chain: summary
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/blockchain/validate
 * Run real-time cryptographic audit check on entire blockchain
 */
router.get('/validate', (req, res) => {
  try {
    const validation = blockchain.isChainValid();
    res.json({
      success: true,
      ...validation,
      checkedAt: new Date().toISOString(),
      totalBlocks: blockchain.chain.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/blockchain/tamper
 * Live demonstration tool to simulate malicious vote modification on a block
 */
router.post('/tamper', async (req, res) => {
  try {
    const { blockIndex, fakeCandidateName } = req.body;
    const targetIdx = parseInt(blockIndex, 10);

    if (isNaN(targetIdx) || targetIdx < 1 || targetIdx >= blockchain.chain.length) {
      return res.status(400).json({
        success: false,
        message: `Please specify a valid block index between 1 and ${blockchain.chain.length - 1}.`
      });
    }

    const validationResult = await blockchain.tamperBlock(targetIdx, fakeCandidateName || 'HACKED_CANDIDATE');

    // Notify AI Anomaly Service
    await anomalyService.recordTamperEvent(targetIdx, `Manual demonstration tamper injected on Block #${targetIdx}`, req.ip || '127.0.0.1');

    res.json({
      success: true,
      message: `Block #${targetIdx} has been deliberately altered for presentation testing!`,
      validationResult
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/blockchain/repair
 * Re-calculate cryptographic hashes and repair chain
 */
router.post('/repair', async (req, res) => {
  try {
    const validationResult = await blockchain.repairChain();

    await db.asyncRun(`
      INSERT INTO audit_logs (event_type, actor, ip_address, details_json, severity)
      VALUES (?, ?, ?, ?, ?)
    `, [
      'BLOCKCHAIN_REPAIRED',
      'ADMIN_AUDITOR',
      req.ip || '127.0.0.1',
      JSON.stringify({ message: 'Blockchain re-mined and cryptographic consensus restored.' }),
      'WARN'
    ]);

    res.json({
      success: true,
      message: 'Blockchain successfully re-mined and cryptographic consensus restored.',
      validationResult
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/blockchain/verify-receipt
 * Voter Receipt Token Verifier - Proves vote is stored on-chain without breaking secret ballot
 */
router.post('/verify-receipt', (req, res) => {
  try {
    const { receiptToken } = req.body;
    if (!receiptToken) {
      return res.status(400).json({ success: false, message: 'Receipt token is required.' });
    }

    const match = blockchain.verifyReceipt(receiptToken);
    if (!match || !match.verified) {
      return res.status(404).json({
        success: false,
        message: 'Receipt token not found on the blockchain ledger. Either the token is invalid or the vote was never committed.'
      });
    }

    res.json({
      success: true,
      message: 'Cryptographic receipt verified! Your vote is immutably sealed on the blockchain.',
      receiptDetails: match
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/blockchain/audit-logs
 * System security and audit logs
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await db.asyncAll('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100');
    res.json({ success: true, count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
