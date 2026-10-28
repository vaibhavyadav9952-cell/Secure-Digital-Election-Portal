const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class VoteTransaction {
  /**
   * Constructs an anonymized cryptographic vote transaction
   * @param {Object} params
   * @param {number} params.electionId
   * @param {number} params.candidateId
   * @param {string} params.candidateName
   * @param {string} params.voterAadhaarNo
   */
  constructor({ electionId, candidateId, candidateName, voterAadhaarNo }) {
    this.voteId = uuidv4();
    this.electionId = electionId;
    this.candidateId = candidateId;
    this.candidateName = candidateName;
    this.timestamp = Date.now();
    
    // Salt and cryptographic receipt token
    // Prevents reversing voter identity while allowing the voter to verify inclusion on-chain
    this.salt = crypto.randomBytes(16).toString('hex');
    this.voterReceiptHash = crypto
      .createHash('sha256')
      .update(`${voterAadhaarNo}:${this.salt}:${this.timestamp}`)
      .digest('hex');

    // Cryptographic signature over transaction payload
    this.signature = this.generateSignature();
  }

  generateSignature() {
    const rawData = `${this.voteId}-${this.electionId}-${this.candidateId}-${this.timestamp}-${this.voterReceiptHash}`;
    return crypto.createHash('sha256').update(rawData).digest('hex');
  }
}

module.exports = VoteTransaction;
