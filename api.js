// Добавляем эндпоинт для сохранения адреса
app.post('/api/deposit/save-address', async (req, res) => {
  try {
    const { user_id, address, network } = req.body;
    
    const { data, error } = await supabase
      .from('user_deposit_addresses')
      .upsert([
        {
          user_id: user_id,
          address: address,
          network: network,
          is_active: true,
          created_at: new Date().toISOString()
        }
      ])
      .select();
    
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error saving address:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Эндпоинт для получения истории депозитов
app.get('/api/deposit/history', async (req, res) => {
  try {
    const { user_id, network } = req.query;
    
    const { data: deposits, error } = await supabase
      .from('deposits')
      .select('*')
      .eq('user_id', user_id)
      .eq('network', network)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ success: true, deposits });
  } catch (error) {
    console.error('Error fetching deposit history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
