const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TronWeb = require('tronweb');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

// Конфигурация
const supabaseUrl = 'https://pjyuagmvrhnepomqfxcc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXVhZ212cmhwZXBvbXFmeHhjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzE1MjQxMywiZXhpj';
const supabase = createClient(supabaseUrl, supabaseKey);

// Инициализация TronWeb с правильными параметрами
const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  headers: { 
    'TRON-PRO-API-KEY': '8fa63ef4-f010-4ad2-a556-a7124563bafd',
    'Content-Type': 'application/json'
  }
});

// USDT TRC20 контракт
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// Middleware
app.use(express.json());

// Функция для проверки транзакций
async function checkDeposits() {
  console.log('🔍 Checking for new deposits...');
  
  try {
    // Получаем все активные адреса для отслеживания
    const { data: addresses, error } = await supabase
      .from('user_deposit_addresses')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('❌ Supabase error:', error);
      return;
    }

    console.log(`📝 Found ${addresses?.length || 0} addresses to monitor`);

    for (const addressRecord of addresses || []) {
      await checkAddressTransactions(addressRecord);
    }
  } catch (error) {
    console.error('❌ Error checking deposits:', error.message);
  }
}

// Проверяем транзакции для конкретного адреса
async function checkAddressTransactions(addressRecord) {
  try {
    const { user_id, address, network, last_checked_block } = addressRecord;
    
    if (network === 'trc20') {
      await checkTRC20Transactions(user_id, address, last_checked_block || 0);
    } else if (network === 'bep20') {
      await checkBEP20Transactions(user_id, address, last_checked_block || 0);
    }
  } catch (error) {
    console.error(`❌ Error checking transactions for address ${addressRecord.address}:`, error.message);
  }
}

// Проверяем TRC20 транзакции через TronGrid API
async function checkTRC20Transactions(user_id, address, lastBlock = 0) {
  try {
    console.log(`🔍 Checking TRC20 transactions for ${address}`);
    
    // Используем прямой HTTP запрос к TronGrid API
    const response = await axios.get(`https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`, {
      headers: {
        'TRON-PRO-API-KEY': '8fa63ef4-f010-4ad2-a556-a7124563bafd',
        'Content-Type': 'application/json'
      },
      params: {
        limit: 50,
        order_by: 'block_timestamp,desc'
      },
      timeout: 10000
    });

    const transactions = response.data.data || [];
    
    console.log(`📊 Found ${transactions.length} transactions for ${address}`);

    for (const tx of transactions) {
      // Пропускаем старые транзакции
      if (tx.block_timestamp <= lastBlock) continue;
      
      // Проверяем, что это USDT транзакция на наш адрес
      if (tx.to === address && 
          tx.token_info?.address === USDT_TRC20_CONTRACT &&
          tx.type === 'Transfer') {
        
        const amount = parseFloat(tx.value) / 1000000; // USDT имеет 6 decimals
        
        console.log(`💰 Found USDT transaction: ${amount} USDT to ${address}`);

        // Проверяем минимальный депозит
        if (amount >= 17) {
          await processDeposit(user_id, address, amount, tx.transaction_id, 'trc20');
        }
      }
    }
    
    // Обновляем последний проверенный блок
    if (transactions.length > 0) {
      const latestBlock = Math.max(...transactions.map(tx => tx.block_timestamp || 0));
      await supabase
        .from('user_deposit_addresses')
        .update({ last_checked_block: latestBlock })
        .eq('address', address);
    }
  } catch (error) {
    console.error('❌ TRC20 transaction check error:', error.message);
  }
}

// Проверяем BEP20 транзакции (через BscScan API)
async function checkBEP20Transactions(user_id, address, lastBlock = 0) {
  try {
    console.log(`🔍 Checking BEP20 transactions for ${address}`);
    
    const apiKey = 'HIQGABWWJ77G9B42SZ92HV2QYA7JVGC125';
    const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${address}&page=1&offset=50&sort=desc&apikey=${apiKey}`;
    
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data.status !== '1') {
      console.log('📭 No BEP20 transactions found');
      return;
    }
    
    const transactions = response.data.result || [];
    
    console.log(`📊 Found ${transactions.length} BEP20 transactions`);

    for (const tx of transactions) {
      if (parseInt(tx.blockNumber) <= lastBlock) continue;
      
      // USDT BEP20 контракт
      if (tx.contractAddress.toLowerCase() === '0x55d398326f99059ff775485246999027b3197955' && 
          tx.to.toLowerCase() === address.toLowerCase() &&
          parseInt(tx.confirmations) > 0) {
        
        const amount = parseFloat(tx.value) / 1000000000000000000; // Конвертируем из wei
        
        console.log(`💰 Found BEP20 USDT transaction: ${amount} USDT`);

        if (amount >= 17) {
          await processDeposit(user_id, address, amount, tx.hash, 'bep20');
        }
      }
    }
    
    // Обновляем последний проверенный блок
    if (transactions.length > 0) {
      const latestBlock = Math.max(...transactions.map(tx => parseInt(tx.blockNumber)));
      await supabase
        .from('user_deposit_addresses')
        .update({ last_checked_block: latestBlock })
        .eq('address', address);
    }
  } catch (error) {
    console.error('❌ BEP20 transaction check error:', error.message);
  }
}

// Обрабатываем найденный депозит
async function processDeposit(user_id, address, amount, tx_hash, network) {
  try {
    console.log(`💰 Processing deposit: ${amount} USDT to ${address}, TX: ${tx_hash}`);
    
    // Проверяем, не обрабатывали ли мы уже эту транзакцию
    const { data: existing } = await supabase
      .from('deposits')
      .select('id')
      .eq('tx_hash', tx_hash)
      .single();
    
    if (existing) {
      console.log('⚠️ Transaction already processed');
      return;
    }
    
    // Добавляем запись о депозите
    const { data: deposit, error } = await supabase
      .from('deposits')
      .insert([
        {
          user_id: user_id,
          address: address,
          amount: amount,
          tx_hash: tx_hash,
          network: network,
          status: 'confirmed'
        }
      ])
      .select()
      .single();
    
    if (error) {
      console.error('❌ Error inserting deposit:', error);
      return;
    }
    
    // Обновляем баланс пользователя
    await updateUserBalance(user_id, amount);
    
    console.log(`✅ Deposit processed successfully: ${amount} USDT for user ${user_id}`);
    
  } catch (error) {
    console.error('❌ Error processing deposit:', error.message);
  }
}

// Обновляем баланс пользователя
async function updateUserBalance(user_id, amount) {
  try {
    // Получаем текущий баланс
    const { data: user, error } = await supabase
      .from('users')
      .select('balance')
      .eq('id', user_id)
      .single();
    
    if (error) {
      console.error('❌ Error fetching user balance:', error);
      return;
    }
    
    const newBalance = (parseFloat(user?.balance) || 0) + amount;
    
    // Обновляем баланс
    const { error: updateError } = await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', user_id);
    
    if (updateError) {
      console.error('❌ Error updating user balance:', updateError);
      return;
    }
    
    console.log(`🔄 Balance updated: ${newBalance} USDT for user ${user_id}`);
    
  } catch (error) {
    console.error('❌ Error updating user balance:', error.message);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'deposit-monitor',
    timestamp: new Date().toISOString()
  });
});

// Запускаем сервер
app.listen(PORT, () => {
  console.log(`🚀 Deposit monitor running on port ${PORT}`);
  console.log(`🔍 Starting deposit monitoring...`);
  
  // Первая проверка при запуске
  setTimeout(checkDeposits, 5000);
  
  // Запускаем проверку каждые 30 секунд
  setInterval(checkDeposits, 30000);
});
