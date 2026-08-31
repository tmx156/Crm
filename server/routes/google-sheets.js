const express = require('express');
const router = express.Router();
const { getGoogleSheetsSync } = require('../utils/googleSheetsSync');

router.get('/status', (req, res) => {
  const sync = getGoogleSheetsSync();
  if (!sync) {
    return res.json({ enabled: false, message: 'Google Sheets sync not configured' });
  }
  res.json({ enabled: true, ...sync.getStatus() });
});

router.post('/sync', async (req, res) => {
  const sync = getGoogleSheetsSync();
  if (!sync || !sync.isInitialized) {
    return res.status(400).json({ error: 'Google Sheets sync not initialized' });
  }

  try {
    await sync.fullSync();
    res.json({ success: true, message: 'Full sync completed', lastSync: sync.lastFullSync });
  } catch (err) {
    console.error('[GoogleSheets] Manual sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync-month', async (req, res) => {
  const sync = getGoogleSheetsSync();
  if (!sync || !sync.isInitialized) {
    return res.status(400).json({ error: 'Google Sheets sync not initialized' });
  }

  const { year, month } = req.body;
  if (year === undefined || month === undefined) {
    return res.status(400).json({ error: 'year and month are required' });
  }

  try {
    await sync.syncMonth(parseInt(year), parseInt(month));
    res.json({ success: true, message: `Synced ${year}-${month + 1}` });
  } catch (err) {
    console.error('[GoogleSheets] Month sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
