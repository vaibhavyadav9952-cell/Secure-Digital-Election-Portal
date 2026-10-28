const Block = require('./Block');
const { db } = require('../config/database');

class Blockchain {
  constructor() {
    this.chain = [];
    this.difficulty = 2; // Fast mining for interactive responsiveness while maintaining PoW
    this.pendingVotes = [];
  }

  /**
   * Initializes the blockchain from SQLite or creates Genesis Block
   */
  async init() {
    try {
      const rows = await db.asyncAll('SELECT * FROM blockchain_blocks ORDER BY block_index ASC');
      if (rows && rows.length > 0) {
        this.chain = rows.map((row) => {
          const blk = new Block(
            row.block_index,
            row.timestamp,
            JSON.parse(row.data_json),
            row.previous_hash
          );
          blk.merkleRoot = row.merkle_root;
          blk.nonce = row.nonce;
          blk.hash = row.hash;
          return blk;
        });
        console.log(`[Blockchain] Loaded ${this.chain.length} blocks from database.`);
      } else {
        console.log('[Blockchain] Initializing Genesis Block...');
        const genesis = this.createGenesisBlock();
        genesis.mineBlock(this.difficulty);
        this.chain = [genesis];
        await this.persistBlock(genesis);
        console.log('[Blockchain] Genesis Block successfully initialized and persisted.');
      }
    } catch (err) {
      console.error('[Blockchain] Initialization error:', err);
    }
  }

  createGenesisBlock() {
    const genesisData = {
      message: 'National Digital Election Genesis Block - Cryptographic Verification Root',
      authority: 'Election Commission of India (Simulated)',
      system: 'Secure Digital Election Portal',
      timestamp: Date.now()
    };
    return new Block(0, Date.now(), genesisData, '0'.repeat(64));
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /**
   * Adds a new vote into a new mined block and persists to DB
   * @param {Object} voteTransaction
   * @returns {Promise<Block>}
   */
  async addVote(voteTransaction) {
    const latestBlock = this.getLatestBlock();
    const newBlockIndex = latestBlock.index + 1;
    const newBlock = new Block(
      newBlockIndex,
      Date.now(),
      [voteTransaction],
      latestBlock.hash
    );

    // Mine Proof-of-Work
    const startTime = Date.now();
    newBlock.mineBlock(this.difficulty);
    const miningDuration = Date.now() - startTime;
    console.log(`[Blockchain] Mined Block #${newBlock.index} in ${miningDuration}ms (Nonce: ${newBlock.nonce}, Hash: ${newBlock.hash})`);

    this.chain.push(newBlock);
    await this.persistBlock(newBlock);

    return newBlock;
  }

  /**
   * Saves a block to SQLite database
   */
  async persistBlock(block) {
    const sql = `
      INSERT OR REPLACE INTO blockchain_blocks 
      (block_index, timestamp, data_json, previous_hash, merkle_root, nonce, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await db.asyncRun(sql, [
      block.index,
      block.timestamp,
      JSON.stringify(block.data),
      block.previousHash,
      block.merkleRoot,
      block.nonce,
      block.hash
    ]);
  }

  /**
   * Validates the cryptographic integrity of the entire blockchain
   * @returns {Object} { isValid: boolean, corruptedIndex: number|null, reason: string|null }
   */
  isChainValid() {
    // 1. Verify Genesis Block
    const genesis = this.chain[0];
    if (genesis.index !== 0 || genesis.previousHash !== '0'.repeat(64)) {
      return {
        isValid: false,
        corruptedIndex: 0,
        reason: 'Genesis block is invalid or corrupted.'
      };
    }

    // 2. Validate hash links and Merkle roots across all blocks
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      // Check Merkle Root integrity
      const recalculatedMerkle = currentBlock.calculateMerkleRoot(currentBlock.data);
      if (currentBlock.merkleRoot !== recalculatedMerkle) {
        return {
          isValid: false,
          corruptedIndex: currentBlock.index,
          reason: `Block #${currentBlock.index} data has been tampered! Merkle Root mismatch (Expected: ${recalculatedMerkle}, Found: ${currentBlock.merkleRoot}).`
        };
      }

      // Check Block Hash integrity
      const recalculatedHash = currentBlock.calculateHash();
      if (currentBlock.hash !== recalculatedHash) {
        return {
          isValid: false,
          corruptedIndex: currentBlock.index,
          reason: `Block #${currentBlock.index} hash is invalid! Content altered (Expected: ${recalculatedHash}, Found: ${currentBlock.hash}).`
        };
      }

      // Check Previous Hash link
      if (currentBlock.previousHash !== previousBlock.hash) {
        return {
          isValid: false,
          corruptedIndex: currentBlock.index,
          reason: `Chain broken at Block #${currentBlock.index}! Previous Hash link does not match Block #${previousBlock.index} hash.`
        };
      }
    }

    return {
      isValid: true,
      corruptedIndex: null,
      reason: 'All cryptographic hashes, Merkle roots, and chain links are 100% verified.'
    };
  }

  /**
   * Tamper simulation for viva / presentation demonstration
   * Artificially alters a block's data without re-mining to demonstrate tamper detection
   */
  async tamperBlock(blockIndex, fakeCandidateName = 'TAMPERED_CANDIDATE') {
    if (blockIndex <= 0 || blockIndex >= this.chain.length) {
      throw new Error(`Invalid block index ${blockIndex} for tampering demonstration.`);
    }

    const targetBlock = this.chain[blockIndex];
    if (Array.isArray(targetBlock.data) && targetBlock.data.length > 0) {
      targetBlock.data[0].candidateName = fakeCandidateName;
      targetBlock.data[0].candidateId = 999;
    } else {
      targetBlock.data = { tamperedMessage: 'Malicious unauthorized modification' };
    }

    // Update in DB without recalculating valid hash
    await db.asyncRun(
      'UPDATE blockchain_blocks SET data_json = ? WHERE block_index = ?',
      [JSON.stringify(targetBlock.data), targetBlock.index]
    );

    console.warn(`[Blockchain Security Alert] Block #${blockIndex} has been intentionally tampered for demonstration!`);
    return this.isChainValid();
  }

  /**
   * Restores chain to valid integrity by recalculating and re-mining from the corrupted point
   */
  async repairChain() {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      currentBlock.previousHash = previousBlock.hash;
      currentBlock.merkleRoot = currentBlock.calculateMerkleRoot(currentBlock.data);
      currentBlock.mineBlock(this.difficulty);

      await this.persistBlock(currentBlock);
    }
    console.log('[Blockchain] Chain repaired and cryptographic integrity restored.');
    return this.isChainValid();
  }

  /**
   * Verifies if a voter's receipt token exists in any block on the blockchain
   * @param {string} receiptHash
   */
  verifyReceipt(receiptHash) {
    if (!receiptHash) return null;
    const cleanHash = receiptHash.trim();

    for (const block of this.chain) {
      if (Array.isArray(block.data)) {
        for (const tx of block.data) {
          if (tx.voterReceiptHash === cleanHash) {
            return {
              verified: true,
              blockIndex: block.index,
              blockHash: block.hash,
              timestamp: block.timestamp,
              candidateName: tx.candidateName,
              signature: tx.signature
            };
          }
        }
      }
    }
    return { verified: false };
  }

  getChainSummary() {
    return this.chain.map((block) => ({
      index: block.index,
      timestamp: block.timestamp,
      previousHash: block.previousHash,
      merkleRoot: block.merkleRoot,
      hash: block.hash,
      nonce: block.nonce,
      transactionCount: Array.isArray(block.data) ? block.data.length : 1,
      transactions: block.data
    }));
  }
}

// Singleton blockchain instance
const blockchainInstance = new Blockchain();

module.exports = blockchainInstance;
