const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Supabase конфигурация
const supabaseUrl = 'https://pjyuagmvrhpepomqfxxc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXVhZ212cmhwZXBvbXFmeHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNTI0MTMsImV4cCI6MjA3ODcyODQxM30.yJzBls_cn_x5CUVyQyqZjYhrMf_WlN23W48QUHHPc6Y';
const supabase = createClient(supabaseUrl, supabaseKey);

// Health check
app.get('/health', (req, res) => {
  console.log('Health check received');
  res.json({ 
    status: 'OK', 
    message: 'Uipath Deposit Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0'
  });
});

// API endpoints
app.get('/api/deposit/generate', async (req, res) => {
  try {
    const { user_id, network } = req.query;
    console.log('Generate address request:', { user_id, network });

    if (!user_id || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'User ID and network are required' 
      });
    }

    const testAddress = network === 'trc20' 
      ? 'TEst1234567890123456789012345678901234'
      : '0xTest123456789012345678901234567890123456';

    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${testAddress}`;

    res.json({
      success: true,
      address: testAddress,
      qr_code: qrCodeUrl,
      network: network
    });

  } catch (error) {
    console.error('Generate address error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/deposit/history', async (req, res) => {
  try {
    const { user_id, network } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    res.json({
      success: true,
      deposits: []
    });

  } catch (error) {
    console.error('Deposit history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch deposit history' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Uipath Deposit Server',
    endpoints: {
      health: '/health',
      generate: '/api/deposit/generate?user_id=XXX&network=trc20|bep20',
      history: '/api/deposit/history?user_id=XXX'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Uipath Deposit Server running on port ${PORT}`);
  console.log(`🔗 Health: http://0.0.0.0:${PORT}/health`);
});
