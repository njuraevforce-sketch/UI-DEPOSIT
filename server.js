const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

// Конфигурация Supabase
const supabaseUrl = 'https://pjyuagmvrhnepomqfxcc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXVhZ212cmhwZXBvbXFmeHhjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzE1MjQxMywiZXhwIjoyMDc4NzI4NDEzfQ.cRJ9xx3wganoJQldTL3hbY8OSTIV_XR6f9EIZT4fsac';
const supabase = createClient(supabaseUrl, supabaseKey);

// Конфигурация API ключей
const TRONGRID_API_KEY = '8fa63ef4-f010-4ad2-a556-a7124563bafd';
const BSCSCAN_API_KEY = 'HIQGABWWJ77G9B42SZ92HV2QYA7JVGC125';

// USDT контракты
const USDT_CONTRACTS = {
  trc20: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  bep20: '0x55d398326f99059ff775485246999027b3197955'
};

app.use(express.json());

// Функция проверки депозитов
async function checkDeposits() {
  console.log('🔍 Checking for deposits...');
  
  try {
    // Получаем все активные адреса
    const { data: addresses, error } = await supabase
      .from('user_deposit_addresses')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('❌ Supabase error:', error);
      return;
    }

    if (!addresses || addresses.length === 0) {
      console.log('📭 No addresses to monitor');
      return;
    }

    console.log(`📝 Monitoring ${addresses.length} addresses`);

    // Проверяем каждый адрес
    for (const addressRecord of addresses) {
      try {
        if (addressRecord.network === 'trc20') {
          await checkTRC20Deposits(addressRecord);
        } else if (addressRecord.network === 'bep20') {
          await checkBEP20Deposits(addressRecord);
        }
      } catch (error) {
        console.error(`❌ Error checking ${addressRecord.address}:`, error.message);
      }
    }
  } catch (error) {
    console.error('❌ Error in checkDeposits:', error.message);
  }
}

// Проверка TRC20 депозитов
async function checkTRC20Deposits(addressRecord) {
  const { user_id, address } = addressRecord;
  
  try {
    const response = await axios.get(
      `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`,
      {
        headers: {
          'TRON-PRO-API-KEY': TRONGRID_API_KEY,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 20,
          order_by: 'block_timestamp,desc'
        },
        timeout: 10000
      }
    );

    const transactions = response.data.data || [];
    
    for (const tx of transactions) {
      // Проверяем что это USDT и получаем на наш адрес
      if (tx.to === address && 
          tx.token_info?.address === USDT_CONTRACTS.trc20 &&
          tx.type === 'Transfer') {
        
        const amount = parseFloat(tx.value) / 1000000; // USDT 6 decimals
        
        if (amount >= 17) {
          await processDeposit(user_id, address, amount, tx.transaction_id, 'trc20');
        }
      }
    }
  } catch (error) {
    console.error('❌ TRC20 check error:', error.message);
  }
}

// Проверка BEP20 депозитов
async function checkBEP20Deposits(addressRecord) {
  const { user_id, address } = addressRecord;
  
  try {
    const response = await axios.get(
      `https://api.bscscan.com/api?module=account&action=tokentx&address=${address}&page=1&offset=20&sort=desc&apikey=${BSCSCAN_API_KEY}`,
      { timeout: 10000 }
    );

    if (response.data.status !== '1') return;
    
    const transactions = response.data.result || [];
    
    for (const tx of transactions) {
      if (tx.contractAddress.toLowerCase() === USDT_CONTRACTS.bep20.toLowerCase() && 
          tx.to.toLowerCase() === address.toLowerCase()) {
        
        const amount = parseFloat(tx.value) / 1000000000000000000; // USDT 18 decimals
        
        if (amount >= 17) {
          await processDeposit(user_id, address, amount, tx.hash, 'bep20');
        }
      }
    }
  } catch (error) {
    console.error('❌ BEP20 check error:', error.message);
  }
}

// Обработка депозита
async function processDeposit(user_id, address, amount, tx_hash, network) {
  try {
    console.log(`💰 Found deposit: ${amount} USDT to ${address}`);

    // Проверяем дубликаты
    const { data: existing } = await supabase
      .from('deposits')
      .select('id')
      .eq('tx_hash', tx_hash)
      .single();

    if (existing) {
      console.log('⚠️ Already processed');
      return;
    }

    // Сохраняем депозит
    const { error: depositError } = await supabase
      .from('deposits')
      .insert({
        user_id: user_id,
        address: address,
        amount: amount,
        tx_hash: tx_hash,
        network: network,
        status: 'confirmed'
      });

    if (depositError) throw depositError;

    // Обновляем баланс
    const { data: user } = await supabase
      .from('users')
      .select('balance')
      .eq('id', user_id)
      .single();

    const newBalance = (parseFloat(user?.balance) || 0) + amount;
    
    const { error: balanceError } = await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', user_id);

    if (balanceError) throw balanceError;

    console.log(`✅ Deposit processed: ${amount} USDT for user ${user_id}, new balance: ${newBalance}`);

  } catch (error) {
    console.error('❌ Process deposit error:', error.message);
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'deposit-monitor',
    timestamp: new Date().toISOString()
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Deposit monitor started on port ${PORT}`);
  
  // Первая проверка через 5 секунд
  setTimeout(checkDeposits, 5000);
  
  // Периодическая проверка каждые 30 секунд
  setInterval(checkDeposits, 30000);
});
