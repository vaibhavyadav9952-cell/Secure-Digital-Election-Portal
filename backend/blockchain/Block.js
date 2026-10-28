const crypto = require('crypto');

class Block {
  /**
   * @param {number} index - Block height/index
   * @param {number} timestamp - Unix epoch timestamp (ms)
   * @param {Array|Object} data - Vote transactions or genesis data
   * @param {string} previousHash - SHA-256 hash of previous block
   */
  constructor(index, timestamp, data, previousHash = '') {
    this.index = index;
    this.timestamp = timestamp;
    this.data = data;
    this.previousHash = previousHash;
    this.merkleRoot = this.calculateMerkleRoot(data);
    this.nonce = 0;
    this.hash = this.calculateHash();
  }

  /**
   * Calculates the SHA-256 hash of the block contents
   * @returns {string} SHA-256 hex digest
   */
  calculateHash() {
    const payload = `${this.index}${this.previousHash}${this.timestamp}${this.merkleRoot}${this.nonce}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Computes a Merkle Root hash from the block's transactions
   * @param {Array|Object} data - Array of vote transactions or data object
   * @returns {string} Merkle Root SHA-256 hash
   */
  calculateMerkleRoot(data) {
    if (!data) return crypto.createHash('sha256').update('EMPTY').digest('hex');
    
    let hashes = [];
    if (Array.isArray(data)) {
      if (data.length === 0) {
        return crypto.createHash('sha256').update('EMPTY_ARRAY').digest('hex');
      }
      hashes = data.map((tx) =>
        crypto.createHash('sha256').update(typeof tx === 'string' ? tx : JSON.stringify(tx)).digest('hex')
      );
    } else {
      hashes = [crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')];
    }

    // Build Merkle tree upwards until single root hash remains
    while (hashes.length > 1) {
      const nextLevel = [];
      for (let i = 0; i < hashes.length; i += 2) {
        const left = hashes[i];
        const right = i + 1 < hashes.length ? hashes[i + 1] : hashes[i]; // Duplicate last if odd count
        const combined = crypto.createHash('sha256').update(left + right).digest('hex');
        nextLevel.push(combined);
      }
      hashes = nextLevel;
    }

    return hashes[0];
  }

  /**
   * Proof of Work mining algorithm
   * Finds a nonce such that the block hash begins with specified difficulty zeros
   * @param {number} difficulty - Number of leading zeros required
   */
  mineBlock(difficulty = 2) {
    this.nonce = 0;
    this.hash = this.calculateHash();
    const target = Array(difficulty + 1).join('0');
    while (this.hash.substring(0, difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
    return this.hash;
  }
}

module.exports = Block;
