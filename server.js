const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TronWeb = require('tronweb');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Конфигурация
const supabaseUrl = 'https://pjyuagmvrhnepomqfxcc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXVhZ212cmhwZXBvbXFmeHhjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzE1MjQxMywiZXhwIjoyMDc4NzI4NDEzfQ.cRJ9xx3wganoJQldTL3hbY8OSTIV_XR6f9EIZT4fsac';
const supabase = createClient(supabaseUrl, supabaseKey);

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  headers: { 'TRON-PRO-API-KEY': '8fa63ef4-f010-4ad2-a556-a7124563bafd' }
});

// USDT TRC20 контракт
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// Функция для проверки транзакций
async function checkDeposits() {
  console.log('🔍 Checking for new deposits...');
  
  try {
    // Получаем все активные адреса для отслеживания
    const { data: addresses, error } = await supabase
      .from('user_deposit_addresses')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;

    for (const addressRecord of addresses) {
      await checkAddressTransactions(addressRecord);
    }
  } catch (error) {
    console.error('❌ Error checking deposits:', error);
  }
}

// Проверяем транзакции для конкретного адреса
async function checkAddressTransactions(addressRecord) {
  try {
    const { user_id, address, network, last_checked_block } = addressRecord;
    
    if (network === 'trc20') {
      await checkTRC20Transactions(user_id, address, last_checked_block);
    } else if (network === 'bep20') {
      await checkBEP20Transactions(user_id, address, last_checked_block);
    }
  } catch (error) {
    console.error(`❌ Error checking transactions for address ${addressRecord.address}:`, error);
  }
}

// Проверяем TRC20 транзакции
async function checkTRC20Transactions(user_id, address, lastBlock = 0) {
  try {
    console.log(`🔍 Checking TRC20 transactions for ${address}`);
    
    const transactions = await tronWeb.trx.getTransactionInfo(address);
    
    for (const tx of transactions) {
      // Пропускаем уже обработанные транзакции
      if (tx.blockNumber <= lastBlock) continue;
      
      // Проверяем, что это USDT транзакция
      if (tx.contract_address === USDT_TRC20_CONTRACT && tx.result === 'SUCCESS') {
        const amount = tx.amount / 1000000; // Конвертируем из sun to USDT
        
        // Проверяем минимальный депозит
        if (amount >= 17) {
          await processDeposit(user_id, address, amount, tx.txID, 'trc20');
        }
      }
    }
    
    // Обновляем последний проверенный блок
    if (transactions.length > 0) {
      const latestBlock = Math.max(...transactions.map(tx => tx.blockNumber));
      await supabase
        .from('user_deposit_addresses')
        .update({ last_checked_block: latestBlock })
        .eq('address', address);
    }
  } catch (error) {
    console.error('❌ TRC20 transaction check error:', error);
  }
}

// Проверяем BEP20 транзакции (через BscScan API)
async function checkBEP20Transactions(user_id, address, lastBlock = 0) {
  try {
    console.log(`🔍 Checking BEP20 transactions for ${address}`);
    
    const apiKey = 'HIQGABWWJ77G9B42SZ92HV2QYA7JVGC125';
    const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${apiKey}`;
    
    const response = await axios.get(url);
    const transactions = response.data.result;
    
    for (const tx of transactions) {
      if (parseInt(tx.blockNumber) <= lastBlock) continue;
      
      // USDT BEP20 контракт
      if (tx.contractAddress.toLowerCase() === '0x55d398326f99059ff775485246999027b3197955' && 
          tx.to.toLowerCase() === address.toLowerCase()) {
        
        const amount = parseFloat(tx.value) / 1000000000000000000; // Конвертируем из wei
        
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
    console.error('❌ BEP20 transaction check error:', error);
  }
}

// Обрабатываем найденный депозит
async function processDeposit(user_id, address, amount, tx_hash, network) {
  try {
    console.log(`💰 New deposit detected: ${amount} USDT to ${address}`);
    
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
    
    if (error) throw error;
    
    // Обновляем баланс пользователя
    await updateUserBalance(user_id, amount);
    
    console.log(`✅ Deposit processed successfully: ${amount} USDT for user ${user_id}`);
    
  } catch (error) {
    console.error('❌ Error processing deposit:', error);
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
    
    if (error) throw error;
    
    const newBalance = (user.balance || 0) + amount;
    
    // Обновляем баланс
    const { error: updateError } = await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', user_id);
    
    if (updateError) throw updateError;
    
    console.log(`🔄 Balance updated: ${newBalance} USDT for user ${user_id}`);
    
  } catch (error) {
    console.error('❌ Error updating user balance:', error);
  }
}

// Запускаем проверку каждые 30 секунд
setInterval(checkDeposits, 30000);

// Первая проверка при запуске
checkDeposits();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'deposit-monitor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Deposit monitor running on port ${PORT}`);
});
