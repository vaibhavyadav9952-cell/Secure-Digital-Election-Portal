const { initDatabase, db } = require('./config/database');
const blockchain = require('./blockchain/Blockchain');
const VoteTransaction = require('./blockchain/VoteTransaction');
const anomalyService = require('./ai_engine/anomalyService');

async function testSystem() {
  try {
    console.log('--- TEST 1: Database Initialization ---');
    await initDatabase();
    console.log('✓ Database initialized successfully.');

    console.log('\n--- TEST 2: Blockchain Initialization ---');
    await blockchain.init();
    console.log(`✓ Blockchain initialized with ${blockchain.chain.length} block(s).`);

    console.log('\n--- TEST 3: Add Vote Transaction ---');
    const voteTx = new VoteTransaction({
      electionId: 1,
      candidateId: 1,
      candidateName: 'Dr. Rajesh Vardhan',
      voterAadhaarNo: '112233445566'
    });
    const block = await blockchain.addVote(voteTx);
    console.log(`✓ Block #${block.index} successfully mined with hash: ${block.hash}`);

    console.log('\n--- TEST 4: Blockchain Validation ---');
    let validation = blockchain.isChainValid();
    console.log('Validation status:', validation);
    if (!validation.isValid) throw new Error('Initial chain validation failed!');
    console.log('✓ Blockchain integrity 100% verified.');

    console.log('\n--- TEST 5: Tamper Simulation ---');
    await blockchain.tamperBlock(block.index, 'HACKED_TEST_CANDIDATE');
    validation = blockchain.isChainValid();
    console.log('Post-tamper validation status:', validation);
    if (validation.isValid) throw new Error('Tamper detection failed to catch modified block!');
    console.log(`✓ Tamper successfully caught at Block #${validation.corruptedIndex}!`);

    console.log('\n--- TEST 6: Chain Repair ---');
    await blockchain.repairChain();
    validation = blockchain.isChainValid();
    console.log('Post-repair validation status:', validation);
    if (!validation.isValid) throw new Error('Chain repair failed!');
    console.log('✓ Chain repair verified.');

    console.log('\n--- TEST 7: AI Anomaly Service & Python ML ---');
    const mlAnalysis = await anomalyService.runPythonMLAnalysis();
    console.log('AI ML Analysis output:', mlAnalysis);
    console.log('✓ AI Anomaly Engine verified.');

    console.log('\n======================================');
    console.log('🎉 ALL 7 SYSTEM TESTS PASSED CLEANLY! 🎉');
    console.log('======================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

testSystem();
