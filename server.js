const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 STARTING SERVER...');

// ВШИТЫЕ КЛЮЧИ
const supabaseUrl = 'https://pjyuagmvrhnepomqfxcc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXVhZ212cmhwZXBvbXFmeHhjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzE1MjQxMywiZXhwIjoyMDc4NzI4NDEzfQ.cRJ9xx3wganoJQldTL3hbY8OSTIV_XR6f9EIZT4fsac';

console.log('📦 Creating Supabase client...');
const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase client created');

app.use(cors());
app.use(express.json());

// Генерация адреса
function generateWalletAddress(network) {
    const chars = '0123456789ABCDEF';
    let address = network === 'bep20' ? '0x' : 'T';
    const length = network === 'bep20' ? 40 : 33;
    
    for (let i = 0; i < length; i++) {
        address += chars[Math.floor(Math.random() * 16)];
    }
    return address;
}

// Health check
app.get('/', (req, res) => {
    console.log('✅ Health check received');
    res.json({ 
        status: 'OK', 
        service: 'UI Deposit Server',
        timestamp: new Date().toISOString()
    });
});

// Генерация адреса
app.get('/api/deposit/generate', async (req, res) => {
    try {
        const { user_id, network } = req.query;
        console.log(`📥 Generate request: ${user_id}, ${network}`);
        
        if (!user_id || !network) {
            return res.json({ success: false, error: 'Missing parameters' });
        }

        const address = generateWalletAddress(network);
        const qrCode = await QRCode.toDataURL(address);
        
        res.json({
            success: true,
            address: address,
            qr_code: qrCode,
            network: network
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.json({ success: false, error: error.message });
    }
});

// История
app.get('/api/deposit/history', async (req, res) => {
    try {
        const { user_id, network } = req.query;
        console.log(`📥 History request: ${user_id}, ${network}`);
        
        if (!user_id) {
            return res.json({ success: false, error: 'Missing user_id' });
        }

        // Просто возвращаем пустой массив для теста
        res.json({
            success: true,
            deposits: []
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Сохранение адреса
app.post('/api/deposit/save-address', async (req, res) => {
    try {
        const { user_id, address, network } = req.body;
        console.log(`📥 Save address: ${user_id}, ${network}`);
        
        res.json({ success: true, message: 'Address saved' });
        
    } catch (error) {
        console.error('Error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📍 URL: http://0.0.0.0:${PORT}`);
    console.log(`🌐 External: https://ui-deposit-production.up.railway.app`);
});

console.log('📡 Server setup complete');
