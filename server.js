const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

// Конфигурация
const SUPABASE_URL = 'https://pjyuagmvrhnepomqfxcc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXVhZ212cmhwZXBvbXFmeHhjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzE1MjQxMywiZXhwIjoyMDc4NzI4NDEzfQ.cRJ9xx3wganoJQldTL3hbY8OSTIV_XR6f9EIZT4fsac';

const TRONGRID_API_KEY = '8fa63ef4-f010-4ad2-a556-a7124563bafd';
const BSCSCAN_API_KEY = 'HIQGABWWJ77G9B42SZ92HV2QYA7JVGC125';

const USDT_CONTRACTS = {
  trc20: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  bep20: '0x55d398326f99059ff775485246999027b3197955'
};

// Headers для Supabase
const supabaseHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

app.use(express.json());

// Улучшенная функция для работы с Supabase
async function supabaseRequest(endpoint, options = {}) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    console.log(`🔗 Making request to: ${url}`);
    
    const response = await axios({
      method: options.method || 'GET',
      url: url,
      headers: supabaseHeaders,
      data: options.data,
      params: options.params,
      timeout: 15000
    });
    
    return { data: response.data, error: null };
  } catch (error) {
    console.error(`❌ Supabase request failed:`, error.message);
    return { data: null, error: error.message };
  }
}

// Проверка соединения с Supabase
async function checkSupabaseConnection() {
  console.log('🔗 Testing Supabase connection...');
  
  const { data, error } = await supabaseRequest('user_deposit_addresses', {
    params: { limit: 1 }
  });
  
  if (error) {
    console.error('❌ Cannot connect to Supabase:', error);
    return false;
  }
  
  console.log('✅ Supabase connection successful');
  return true;
}

// Получение адресов для мониторинга
async function getAddressesToMonitor() {
  const { data, error } = await supabaseRequest('user_deposit_addresses', {
    params: {
      select: '*',
      is_active: 'eq.true'
    }
  });
  
  if (error) {
    console.error('❌ Failed to get addresses:', error);
    return [];
  }
  
  return data || [];
}

// Сохранение депозита
async function saveDeposit(depositData) {
  const { data, error } = await supabaseRequest('deposits', {
    method: 'POST',
    data: depositData
  });
  
  if (error) {
    console.error('❌ Failed to save deposit:', error);
    return false;
  }
  
  return true;
}

// Обновление баланса пользователя
async function updateUserBalance(userId, amount) {
  // Сначала получаем текущий баланс
  const { data: userData } = await supabaseRequest('users', {
    params: {
      id: `eq.${userId}`,
      select: 'balance'
    }
  });
  
  if (!userData || userData.length === 0) {
    console.error('❌ User not found:', userId);
    return false;
  }
  
  const currentBalance = parseFloat(userData[0].balance) || 0;
  const newBalance = currentBalance + amount;
  
  const { error } = await supabaseRequest('users', {
    method: 'PATCH',
    data: { balance: newBalance },
    params: {
      id: `eq.${userId}`
    }
  });
  
  if (error) {
    console.error('❌ Failed to update balance:', error);
    return false;
  }
  
  console.log(`✅ Balance updated: ${newBalance} USDT for user ${userId}`);
  return true;
}

// Основная функция проверки депозитов
async function checkDeposits() {
  console.log('🔍 Starting deposit check...');
  
  // Проверяем соединение с Supabase
  const isConnected = await checkSupabaseConnection();
  if (!isConnected) {
    console.log('🔄 Retrying in 30 seconds...');
    return;
  }
  
  // Получаем адреса для мониторинга
  const addresses = await getAddressesToMonitor();
  
  if (addresses.length === 0) {
    console.log('📭 No active addresses to monitor');
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
  
  console.log('✅ Deposit check completed');
}

// Проверка TRC20 депозитов
async function checkTRC20Deposits(addressRecord) {
  const { user_id, address } = addressRecord;
  
  try {
    console.log(`🔍 Checking TRC20 for ${address}`);
    
    const response = await axios.get(
      `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`,
      {
        headers: {
          'TRON-PRO-API-KEY': TRONGRID_API_KEY,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 10,
          order_by: 'block_timestamp,desc'
        },
        timeout: 10000
      }
    );

    const transactions = response.data.data || [];
    console.log(`📊 Found ${transactions.length} TRC20 transactions for ${address}`);
    
    for (const tx of transactions) {
      if (tx.to === address && 
          tx.token_info?.address === USDT_CONTRACTS.trc20 &&
          tx.type === 'Transfer') {
        
        const amount = parseFloat(tx.value) / 1000000;
        
        console.log(`💰 TRC20 deposit: ${amount} USDT to ${address}`);
        
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
    console.log(`🔍 Checking BEP20 for ${address}`);
    
    const response = await axios.get(
      `https://api.bscscan.com/api?module=account&action=tokentx&address=${address}&page=1&offset=10&sort=desc&apikey=${BSCSCAN_API_KEY}`,
      { timeout: 10000 }
    );

    if (response.data.status !== '1') {
      console.log('📭 No BEP20 transactions found');
      return;
    }
    
    const transactions = response.data.result || [];
    console.log(`📊 Found ${transactions.length} BEP20 transactions for ${address}`);
    
    for (const tx of transactions) {
      if (tx.contractAddress.toLowerCase() === USDT_CONTRACTS.bep20.toLowerCase() && 
          tx.to.toLowerCase() === address.toLowerCase()) {
        
        const amount = parseFloat(tx.value) / 1000000000000000000;
        
        console.log(`💰 BEP20 deposit: ${amount} USDT to ${address}`);
        
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
    console.log(`💰 Processing deposit: ${amount} USDT, TX: ${tx_hash}`);
    
    // Проверяем дубликаты
    const { data: existing } = await supabaseRequest('deposits', {
      params: {
        tx_hash: `eq.${tx_hash}`,
        select: 'id'
      }
    });
    
    if (existing && existing.length > 0) {
      console.log('⚠️ Transaction already processed');
      return;
    }
    
    // Сохраняем депозит
    const depositData = {
      user_id: user_id,
      address: address,
      amount: amount,
      tx_hash: tx_hash,
      network: network,
      status: 'confirmed'
    };
    
    const saved = await saveDeposit(depositData);
    if (!saved) return;
    
    // Обновляем баланс
    const updated = await updateUserBalance(user_id, amount);
    if (!updated) return;
    
    console.log(`✅ Deposit processed successfully: ${amount} USDT for user ${user_id}`);
    
  } catch (error) {
    console.error('❌ Process deposit error:', error.message);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'deposit-monitor',
    timestamp: new Date().toISOString(),
    message: 'Service is running'
  });
});

// Test Supabase connection endpoint
app.get('/test-supabase', async (req, res) => {
  try {
    const isConnected = await checkSupabaseConnection();
    res.json({ 
      supabase_connected: isConnected,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      supabase_connected: false,
      error: error.message 
    });
  }
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Deposit monitor started on port ${PORT}`);
  console.log(`🏥 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`🔗 Test Supabase: http://0.0.0.0:${PORT}/test-supabase`);
  
  // Первая проверка через 10 секунд
  setTimeout(() => {
    console.log('⏰ Starting initial deposit check...');
    checkDeposits();
  }, 10000);
  
  // Периодическая проверка каждые 30 секунд
  setInterval(checkDeposits, 30000);
});
