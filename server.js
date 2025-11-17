const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase клиент
const supabaseUrl = 'https://pjyuagmvrhnepomqfxcc.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());

// Генерация случайного адреса кошелька
function generateWalletAddress(network) {
    const chars = '0123456789ABCDEF';
    let address = 'T';
    
    if (network === 'bep20') {
        address = '0x';
        for (let i = 0; i < 40; i++) {
            address += chars[Math.floor(Math.random() * 16)];
        }
    } else {
        for (let i = 0; i < 33; i++) {
            address += chars[Math.floor(Math.random() * 16)];
        }
    }
    
    return address;
}

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'UI Deposit Server',
        timestamp: new Date().toISOString()
    });
});

// Эндпоинт для генерации адреса депозита
app.get('/api/deposit/generate', async (req, res) => {
    try {
        const { user_id, network } = req.query;
        
        if (!user_id || !network) {
            return res.status(400).json({ success: false, error: 'Missing parameters' });
        }

        console.log(`🔄 Generating ${network} address for user ${user_id}`);
        
        // Генерируем адрес кошелька
        const address = generateWalletAddress(network);
        
        // Генерируем QR код
        const qrCode = await QRCode.toDataURL(address);
        
        res.json({
            success: true,
            address: address,
            qr_code: qrCode,
            network: network
        });
        
    } catch (error) {
        console.error('Generate address error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Эндпоинт для сохранения адреса пользователя
app.post('/api/deposit/save-address', async (req, res) => {
    try {
        const { user_id, address, network } = req.body;
        
        if (!user_id || !address || !network) {
            return res.status(400).json({ success: false, error: 'Missing parameters' });
        }

        console.log(`💾 Saving ${network} address for user ${user_id}`);

        // Сохраняем адрес в базу данных
        const { data, error } = await supabase
            .from('user_addresses')
            .upsert({
                user_id: user_id,
                address: address,
                network: network,
                created_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,network'
            });

        if (error) throw error;
        
        res.json({ success: true, message: 'Address saved successfully' });
        
    } catch (error) {
        console.error('Save address error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Эндпоинт для получения истории депозитов
app.get('/api/deposit/history', async (req, res) => {
    try {
        const { user_id, network } = req.query;
        
        if (!user_id) {
            return res.status(400).json({ success: false, error: 'Missing user_id' });
        }

        let query = supabase
            .from('deposits')
            .select('*')
            .eq('user_id', user_id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (network) {
            query = query.eq('network', network);
        }

        const { data, error } = await query;

        if (error) throw error;
        
        res.json({
            success: true,
            deposits: data || []
        });
        
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Эндпоинт для проверки статуса депозита
app.get('/api/deposit/check/:tx_hash', async (req, res) => {
    try {
        const { tx_hash } = req.params;

        const { data, error } = await supabase
            .from('deposits')
            .select('*')
            .eq('tx_hash', tx_hash)
            .single();

        if (error) throw error;
        
        res.json({
            success: true,
            deposit: data
        });
        
    } catch (error) {
        console.error('Check deposit error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 UI Deposit Server running on port ${PORT}`);
    console.log(`📝 Endpoints:`);
    console.log(`   • GET  /api/deposit/generate?user_id=XXX&network=trc20`);
    console.log(`   • POST /api/deposit/save-address`);
    console.log(`   • GET  /api/deposit/history?user_id=XXX`);
});
