const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TronWeb = require('tronweb');
const { Web3 } = require('web3');
const axios = require('axios');
const cron = require('node-cron');
const { ethers } = require('ethers');

const app = express();
app.use(express.json());

// Supabase конфигурация
const supabaseUrl = 'https://pjyuagmvrhpepomqfxxc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXVhZ212cmhwZXBvbXFmeHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNTI0MTMsImV4cCI6MjA3ODcyODQxM30.yJzBls_cn_x5CUVyQyqZjYhrMf_WlN23W48QUHHPc6Y';
const supabase = createClient(supabaseUrl, supabaseKey);

// Блокчейн конфигурация
const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  headers: { "TRON-PRO-API-KEY": '8fa63ef4-f010-4ad2-a556-a7124563bafd' }
});

// BSC провайдер с использованием ethers.js (более стабильный)
const bscProvider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');

// USDT контракты
const TRC20_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const BEP20_USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

// API ключи
const ETHERSCAN_API_KEY = 'HIQGABWWJ77G9B42SZ92HV2QYA7JVGC125';

// Утилиты для задержки
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Генерация уникальных кошельков для пользователей
async function generateWalletAddress(userId, network) {
  try {
    // Проверяем, есть ли уже адрес для этого пользователя и сети
    const { data: existingAddress, error: fetchError } = await supabase
      .from('deposit_addresses')
      .select('*')
      .eq('user_id', userId)
      .eq('network', network)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (existingAddress) {
      return {
        success: true,
        address: existingAddress.address,
        private_key: existingAddress.private_key
      };
    }

    let address, privateKey;

    if (network === 'trc20') {
      // Генерация TRC20 адреса
      const account = await tronWeb.createAccount();
      address = account.address.base58;
      privateKey = account.privateKey;
    } else if (network === 'bep20') {
      // Генерация BEP20 адреса с использованием ethers.js
      const wallet = ethers.Wallet.createRandom();
      address = wallet.address;
      privateKey = wallet.privateKey;
    }

    // Сохраняем в базу данных
    const { error: insertError } = await supabase
      .from('deposit_addresses')
      .insert([
        {
          user_id: userId,
          network: network,
          address: address,
          private_key: privateKey,
          created_at: new Date().toISOString()
        }
      ]);

    if (insertError) throw insertError;

    return { success: true, address, private_key: privateKey };
  } catch (error) {
    console.error('Error generating wallet:', error);
    return { success: false, error: error.message };
  }
}

// API для генерации адреса депозита
app.get('/api/deposit/generate', async (req, res) => {
  try {
    const { user_id, network } = req.query;

    if (!user_id || !network) {
      return res.status(400).json({ 
        success: false, 
        error: 'User ID and network are required' 
      });
    }

    const result = await generateWalletAddress(user_id, network);

    if (result.success) {
      // Генерация QR кода
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${result.address}`;
      
      res.json({
        success: true,
        address: result.address,
        qr_code: qrCodeUrl,
        network: network
      });
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Generate address error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Оптимизированная проверка депозитов для TRC20 с учетом лимитов
async function checkTronDeposits() {
  try {
    console.log('🔍 Checking TRC20 deposits...');
    
    const { data: addresses, error } = await supabase
      .from('deposit_addresses')
      .select('*')
      .eq('network', 'trc20');

    if (error) {
      console.error('Error fetching TRC20 addresses:', error);
      return;
    }

    if (!addresses || addresses.length === 0) {
      console.log('No TRC20 addresses to check');
      return;
    }

    console.log(`Checking ${addresses.length} TRC20 addresses...`);

    // Обрабатываем адреса пачками с задержкой для соблюдения лимитов
    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      
      try {
        // Получаем транзакции для адреса через TronGrid API
        const response = await axios.get(
          `https://api.trongrid.io/v1/accounts/${address.address}/transactions/trc20`,
          {
            params: {
              limit: 20,
              contract_address: TRC20_USDT_CONTRACT,
              only_to: true,
              order_by: 'block_timestamp,desc'
            },
            headers: {
              'TRON-PRO-API-KEY': '8fa63ef4-f010-4ad2-a556-a7124563bafd'
            }
          }
        );

        const transactions = response.data.data || [];

        for (const tx of transactions) {
          // Проверяем, была ли уже обработана эта транзакция
          const { data: existingTx } = await supabase
            .from('deposit_transactions')
            .select('*')
            .eq('tx_hash', tx.transaction_id)
            .single();

          if (existingTx) continue;

          // Проверяем, что это входящая транзакция на наш адрес и это USDT
          if (tx.to === address.address && 
              tx.token_info?.address === TRC20_USDT_CONTRACT && 
              tx.type === 'Transfer') {
            
            const amount = parseFloat(tx.value) / 1000000; // USDT имеет 6 decimal places
            
            if (amount >= 17) { // Минимальный депозит 17 USDT
              await processDepositTransaction(address.user_id, tx.transaction_id, amount, 'trc20');
              console.log(`✅ TRC20 Deposit: ${amount} USDT to user ${address.user_id}`);
            }
          }
        }

        // Задержка для соблюдения лимита 5 запросов в секунду
        if (i < addresses.length - 1) {
          await delay(250); // 250ms задержка между запросами
        }

      } catch (error) {
        console.error(`Error checking TRC20 address ${address.address}:`, error.message);
        // Задержка при ошибке
        await delay(1000);
      }
    }
  } catch (error) {
    console.error('TRC20 deposit check error:', error.message);
  }
}

// Оптимизированная проверка депозитов для BEP20 с учетом лимитов
async function checkBscDeposits() {
  try {
    console.log('🔍 Checking BEP20 deposits...');
    
    const { data: addresses, error } = await supabase
      .from('deposit_addresses')
      .select('*')
      .eq('network', 'bep20');

    if (error) {
      console.error('Error fetching BEP20 addresses:', error);
      return;
    }

    if (!addresses || addresses.length === 0) {
      console.log('No BEP20 addresses to check');
      return;
    }

    console.log(`Checking ${addresses.length} BEP20 addresses...`);

    // Обрабатываем адреса пачками с задержкой
    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      
      try {
        // Используем Etherscan API V2 для BSC (chainid=56)
        const response = await axios.get(
          'https://api.etherscan.io/v2/api',
          {
            params: {
              chainid: 56, // BSC Mainnet
              module: 'account',
              action: 'tokentx',
              contractaddress: BEP20_USDT_CONTRACT,
              address: address.address,
              page: 1,
              offset: 20,
              sort: 'desc',
              apikey: ETHERSCAN_API_KEY
            },
            timeout: 10000
          }
        );

        // Проверяем статус ответа
        if (response.data.status === '1') {
          const transactions = response.data.result || [];

          for (const tx of transactions) {
            // Проверяем, была ли уже обработана эта транзакция
            const { data: existingTx } = await supabase
              .from('deposit_transactions')
              .select('*')
              .eq('tx_hash', tx.hash)
              .single();

            if (existingTx) continue;

            // Проверяем, что это входящая транзакция
            if (tx.to.toLowerCase() === address.address.toLowerCase()) {
              const amount = parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal));
              
              if (amount >= 17) { // Минимальный депозит 17 USDT
                await processDepositTransaction(address.user_id, tx.hash, amount, 'bep20');
                console.log(`✅ BEP20 Deposit: ${amount} USDT to user ${address.user_id}`);
              }
            }
          }
        } else if (response.data.message && response.data.message.includes('rate limit')) {
          console.log('⚠️ Rate limit reached for BSC, waiting...');
          await delay(5000); // Ждем 5 секунд при достижении лимита
        }

        // Задержка для соблюдения лимита 5 запросов в секунду
        if (i < addresses.length - 1) {
          await delay(250); // 250ms задержка между запросами
        }

      } catch (error) {
        if (error.response?.status === 429) {
          console.log('⚠️ Rate limit hit for BSC, waiting 10 seconds...');
          await delay(10000);
        } else {
          console.error(`Error checking BEP20 address ${address.address}:`, error.message);
          await delay(1000);
        }
      }
    }
  } catch (error) {
    console.error('BEP20 deposit check error:', error.message);
  }
}

// Обработка депозитной транзакции
async function processDepositTransaction(userId, txHash, amount, network) {
  try {
    // Записываем транзакцию
    const { error: txError } = await supabase
      .from('deposit_transactions')
      .insert([
        {
          user_id: userId,
          tx_hash: txHash,
          amount: amount,
          network: network,
          status: 'confirmed',
          created_at: new Date().toISOString()
        }
      ]);

    if (txError) {
      console.error('Error saving transaction:', txError);
      return;
    }

    // Получаем текущий баланс пользователя
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('balance')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('Error fetching user:', userError);
      return;
    }

    const newBalance = (parseFloat(user.balance) || 0) + amount;

    // Обновляем баланс пользователя
    const { error: updateError } = await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating balance:', updateError);
      return;
    }

    // Создаем запись в транзакциях
    const { error: historyError } = await supabase
      .from('transactions')
      .insert([
        {
          user_id: userId,
          type: 'deposit',
          title: `USDT Deposit (${network.toUpperCase()})`,
          amount: amount,
          positive: true,
          created_at: new Date().toISOString()
        }
      ]);

    if (historyError) {
      console.error('Error creating transaction history:', historyError);
    }

    console.log(`💰 Successfully deposited ${amount} USDT to user ${userId} via ${network}`);
    
  } catch (error) {
    console.error('Error processing deposit transaction:', error);
  }
}

// API для получения истории депозитов
app.get('/api/deposit/history', async (req, res) => {
  try {
    const { user_id, network } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    let query = supabase
      .from('deposit_transactions')
      .select('*')
      .eq('user_id', user_id)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(20);

    if (network) {
      query = query.eq('network', network);
    }

    const { data: deposits, error } = await query;

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      deposits: deposits || []
    });

  } catch (error) {
    console.error('Deposit history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch deposit history' });
  }
});

// API для проверки статуса депозита
app.get('/api/deposit/status', async (req, res) => {
  try {
    const { user_id, network } = req.query;

    if (!user_id || !network) {
      return res.status(400).json({
        success: false,
        error: 'User ID and network are required'
      });
    }

    const { data: transactions } = await supabase
      .from('deposit_transactions')
      .select('*')
      .eq('user_id', user_id)
      .eq('network', network)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1);

    if (transactions && transactions.length > 0) {
      res.json({
        success: true,
        deposited: true,
        amount: transactions[0].amount,
        timestamp: transactions[0].created_at,
        tx_hash: transactions[0].tx_hash
      });
    } else {
      res.json({
        success: true,
        deposited: false
      });
    }
  } catch (error) {
    console.error('Deposit status error:', error);
    res.status(500).json({ success: false, error: 'Status check failed' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Uipath Deposit Server',
    version: '3.0'
  });
});

// Оптимизированная проверка депозитов с интервалом 2 минуты
cron.schedule('*/2 * * * *', () => {
  console.log('🔄 Running optimized deposit checks...');
  
  // Запускаем проверки параллельно для обеих сетей
  Promise.all([
    checkTronDeposits(),
    checkBscDeposits()
  ]).then(() => {
    console.log('✅ Completed deposit check cycle');
  }).catch(error => {
    console.error('❌ Deposit check cycle failed:', error);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Uipath Deposit Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`⏰ Deposit checks scheduled every 2 minutes`);
});
