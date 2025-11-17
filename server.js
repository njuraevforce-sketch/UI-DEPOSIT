const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Supabase конфигурация
const supabaseUrl = 'https://pjyuagmvrhpepomqfxxc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXVhZ212cmhwZXBvbXFmeHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNTI0MTMsImV4cCI6MjA3ODcyODQxM30.yJzBls_cn_x5CUVyQyqZjYhrMf_WlN23W48QUHHPc6Y';
const supabase = createClient(supabaseUrl, supabaseKey);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Uipath Deposit Server is running',
    timestamp: new Date().toISOString()
  });
});

// Простой endpoint для генерации адреса
app.get('/api/deposit/generate', async (req, res) => {
  try {
    const { user_id, network } = req.query;

    if (!user_id || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'User ID and network are required' 
      });
    }

    // Генерируем тестовый адрес (в реальности здесь будет логика генерации)
    const testAddress = network === 'trc20' 
      ? 'TEst1234567890123456789012345678901234'
      : '0xTest123456789012345678901234567890123456';

    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${testAddress}`;

    res.json({
      success: true,
      address: testAddress,
      qr_code: qrCodeUrl,
      network: network,
      message: 'Test address generated successfully'
    });

  } catch (error) {
    console.error('Generate address error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// История депозитов
app.get('/api/deposit/history', async (req, res) => {
  try {
    const { user_id, network } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Возвращаем тестовые данные
    res.json({
      success: true,
      deposits: [],
      message: 'No deposits yet'
    });

  } catch (error) {
    console.error('Deposit history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch deposit history' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Uipath Deposit Server running on port ${PORT}`);
  console.log(`🔗 Health check: https://ui-deposit-production.up.railway.app/health`);
});
