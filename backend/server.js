const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./config/database');
const blockchain = require('./blockchain/Blockchain');

const authRoutes = require('./routes/authRoutes');
const electionRoutes = require('./routes/electionRoutes');
const blockchainRoutes = require('./routes/blockchainRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/election', electionRoutes);
app.use('/api/blockchain', blockchainRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Secure Digital Election Portal API',
    version: '1.0.0'
  });
});

// Fallback to index.html for SPA client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Initialize database, blockchain, and start server
async function startServer() {
  try {
    console.log('====================================================');
    console.log('🗳️  SECURE DIGITAL ELECTION PORTAL INITIALIZATION  🗳️');
    console.log('====================================================');
    
    // Step 1: Initialize Database & seed data
    await initDatabase();
    
    // Step 2: Initialize Blockchain (Genesis block / persistent ledger)
    await blockchain.init();

    // Step 3: Listen on PORT
    app.listen(PORT, () => {
      console.log(`\n🚀 Server running successfully on http://localhost:${PORT}`);
      console.log(`🌐 Frontend Portal: http://localhost:${PORT}`);
      console.log(`📊 API Endpoints ready at http://localhost:${PORT}/api/`);
      console.log('====================================================\n');
    });
  } catch (err) {
    console.error('Fatal Server Initialization Error:', err);
    process.exit(1);
  }
}

startServer();
