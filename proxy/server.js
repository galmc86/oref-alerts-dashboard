const express = require('express');
const cors = require('cors');
const app = express();

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/json',
};

app.use(cors());
app.use(express.json());

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

// Slack webhook relay — URL stored in Azure env var, never exposed to client
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

app.post('/slack-webhook', async (req, res) => {
  if (!SLACK_WEBHOOK_URL) {
    console.error('[SLACK] No SLACK_WEBHOOK_URL configured — returning 503');
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  try {
    var event = req.body;
    var icon = event.type === 'alert_start' ? ':rotating_light:' : ':white_check_mark:';
    var label = event.type === 'alert_start' ? 'Alert Started' : 'Alert Ended';
    var text = icon + ' *' + label + '* \u2014 ' + (event.displayNameEn || '') +
      ' (' + (event.regionName || '') + ')' +
      '\nTime: ' + (event.israelTime || '') + ' (Israel)' +
      '\nSource: Dashboard';
    var payload = 'payload=' + encodeURIComponent(JSON.stringify({ text: text }));
    console.log('[SLACK] Sending to webhook for:', event.type, (event.displayNameEn || ''));
    var response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });
    var result = await response.text();
    if (result !== 'ok') {
      console.error('[SLACK] Unexpected response (HTTP ' + response.status + '):', result);
    }
    res.json({ ok: result === 'ok' });
  } catch (err) {
    console.error('[SLACK] Send error:', err.message);
    res.status(502).json({ error: 'Failed to send webhook' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Oref proxy running on port ' + PORT);
  if (SLACK_WEBHOOK_URL) {
    try {
      var webhookHost = new URL(SLACK_WEBHOOK_URL).host;
      console.log('  Slack webhook: configured (host: ' + webhookHost + ')');
    } catch (e) {
      console.error('  Slack webhook: INVALID URL — check SLACK_WEBHOOK_URL env var');
    }
  } else {
    console.warn('  Slack webhook: NOT configured — set SLACK_WEBHOOK_URL env var');
  }
});
