const express = require('express');
const cors = require('cors');
const app = express();

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/json',
};

app.use(cors());

app.get('/alerts', async (req, res) => {
  try {
    const response = await fetch(
      'https://www.oref.org.il/WarningMessages/alert/alerts.json',
      { headers: OREF_HEADERS }
    );
    const text = await response.text();
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(text || '{}');
  } catch (err) {
    console.error('alerts fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch alerts' });
  }
});

app.get('/history', async (req, res) => {
  try {
    const response = await fetch(
      'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json',
      { headers: OREF_HEADERS }
    );
    const text = await response.text();
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(text || '[]');
  } catch (err) {
    console.error('history fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch history' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Oref proxy running on port ' + PORT);
});
