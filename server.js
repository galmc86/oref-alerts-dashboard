const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = require('./js/config.js');

const app = express();
const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const MOCK = process.argv.includes('--mock');
const SERVER_POLL_MS = 5000;

// Webhook secrets from environment variables
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || '';

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

// --- Middleware ---

app.use(cors());
app.use(express.json());

// --- Mock helpers ---

function getIsraelDateStr(offsetMinutes) {
  var d = new Date(Date.now() - offsetMinutes * 60000);
  var iso = d.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' });
  return iso.replace('T', ' ');
}

function serveMockAlerts(req, res) {
  var mockFile = process.argv.includes('--history-only') ? 'alerts-empty.json' : 'alerts.json';
  var data = fs.readFileSync(path.join(ROOT, 'mocks', mockFile), 'utf8');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Cache-Control', 'no-cache, no-store');
  res.send(data);
}

function serveMockHistory(req, res) {
  var raw = fs.readFileSync(path.join(ROOT, 'mocks', 'history.json'), 'utf8');
  var entries = JSON.parse(raw);
  entries.forEach(function (entry, i) {
    entry.alertDate = getIsraelDateStr(2 + i);
  });
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Cache-Control', 'no-cache, no-store');
  res.json(entries);
}

// --- OREF proxy helper ---

function proxyOref(targetUrl, res) {
  https.get(targetUrl, { headers: OREF_HEADERS }, function (proxyRes) {
    var chunks = [];
    proxyRes.on('data', function (chunk) { chunks.push(chunk); });
    proxyRes.on('end', function () {
      var body = Buffer.concat(chunks);
      res.set('Content-Type', 'application/json; charset=utf-8');
      res.set('Cache-Control', 'no-cache, no-store');
      res.status(proxyRes.statusCode).send(body);
    });
  }).on('error', function (err) {
    res.status(502).json({ error: err.message });
  });
}

// --- API Routes ---

// GET /api/alerts — OREF alerts proxy (used by dashboard client)
app.get('/api/alerts', function (req, res) {
  if (MOCK) return serveMockAlerts(req, res);
  proxyOref('https://www.oref.org.il/WarningMessages/alert/alerts.json', res);
});

// GET /api/history — OREF history proxy (used by dashboard client)
app.get('/api/history', function (req, res) {
  if (MOCK) return serveMockHistory(req, res);
  proxyOref('https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json', res);
});

// GET /alerts — short alias (used by proxy/server.js clients)
app.get('/alerts', function (req, res) {
  if (MOCK) return serveMockAlerts(req, res);
  proxyOref('https://www.oref.org.il/WarningMessages/alert/alerts.json', res);
});

// GET /history — short alias
app.get('/history', function (req, res) {
  if (MOCK) return serveMockHistory(req, res);
  proxyOref('https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json', res);
});

// POST /proxy — generic HTTP proxy (replaces C# ProxyController)
// Used by GitHub Actions check-alerts.js to reach OREF from non-Israeli IPs
app.post('/proxy', async function (req, res) {
  try {
    var proxyReq = req.body;
    var targetUrl = proxyReq.url;
    var method = (proxyReq.method || 'GET').toUpperCase();
    var headers = proxyReq.headers || {};
    var body = proxyReq.body || '';

    var response = await fetch(targetUrl, {
      method: method,
      headers: headers,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
    });

    var responseBody = await response.text();
    var contentType = response.headers.get('content-type') || 'text/plain';
    res.set('Content-Type', contentType);
    res.status(response.status).send(responseBody);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /webhook — unified webhook relay (replaces C# WebhookController)
// Accepts alert events and forwards to Slack + Google Sheets
app.post('/webhook', async function (req, res) {
  var event = req.body;
  var results = {};

  if (SLACK_WEBHOOK_URL) {
    results.slack = await sendSlack(event);
  }
  if (GOOGLE_SHEET_WEBHOOK_URL) {
    results.sheets = await sendGoogleSheet(event);
  }

  if (Object.keys(results).length === 0) {
    return res.status(503).json({ error: 'No webhook URLs configured' });
  }
  res.json(results);
});

// POST /slack-webhook — direct Slack relay (kept for backward compatibility)
app.post('/slack-webhook', async function (req, res) {
  if (!SLACK_WEBHOOK_URL) {
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  var ok = await sendSlack(req.body);
  res.json({ ok: ok });
});

// --- Slack / Google Sheets helpers ---

async function sendSlack(event) {
  try {
    var icon = event.type === 'alert_start' ? ':rotating_light:' : ':white_check_mark:';
    var label = event.type === 'alert_start' ? 'Alert Started' : 'Alert Ended';
    var source = event.source || 'Server';
    var text = icon + ' *' + label + '* \u2014 ' + (event.displayNameEn || '') +
      ' (' + (event.regionName || '') + ')' +
      '\nTime: ' + (event.israelTime || '') + ' (Israel)' +
      '\nSource: ' + source;
    var payload = 'payload=' + encodeURIComponent(JSON.stringify({ text: text }));
    var response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload,
    });
    var result = await response.text();
    return result === 'ok';
  } catch (err) {
    console.error('Slack error:', err.message);
    return false;
  }
}

async function sendGoogleSheet(event) {
  try {
    var response = await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: event.type,
        regionName: event.regionName,
        displayNameEn: event.displayNameEn,
        timestamp: event.timestamp,
        israelTime: event.israelTime,
        source: event.source || 'Server',
      }),
    });
    return response.ok;
  } catch (err) {
    console.error('Google Sheet error:', err.message);
    return false;
  }
}

// --- Static file serving ---

app.use(express.static(ROOT, {
  extensions: ['html'],
  index: 'index.html',
}));

// --- Server-side alert polling & webhook ---

var serverRegionStates = {};
var isFirstServerPoll = true;

function getIsraelTimeStr() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Jerusalem' });
}

function isRegionMatchedServer(region, cities) {
  return cities.some(function (city) {
    return region.matchPatterns.some(function (pattern) {
      return city.includes(pattern);
    });
  });
}

function fetchJson(targetUrl) {
  return new Promise(function (resolve, reject) {
    var transport = targetUrl.startsWith('https') ? https : http;
    transport.get(targetUrl, { headers: OREF_HEADERS }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
        if (!body || body.trim() === '' || body.trim() === '[]') {
          resolve(null);
          return;
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Fire webhook: sends directly to Slack + Google Sheets (no intermediate hop)
function fireWebhook(event) {
  if (SLACK_WEBHOOK_URL) {
    sendSlack(event).then(function (ok) {
      if (ok) console.log('[SLACK] Sent:', event.type, event.displayNameEn);
      else console.error('[SLACK] Failed for:', event.displayNameEn);
    });
  }
  if (GOOGLE_SHEET_WEBHOOK_URL) {
    sendGoogleSheet(event).then(function (ok) {
      if (ok) console.log('[SHEETS] Sent:', event.type, event.displayNameEn);
      else console.error('[SHEETS] Failed for:', event.displayNameEn);
    });
  }
}

function serverPoll() {
  var alertsUrl = MOCK
    ? 'http://localhost:' + PORT + '/api/alerts'
    : 'https://www.oref.org.il/WarningMessages/alert/alerts.json';
  var historyUrl = MOCK
    ? 'http://localhost:' + PORT + '/api/history'
    : 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json';

  // Always fetch BOTH primary and history in parallel for complete coverage
  Promise.all([
    fetchJson(alertsUrl).catch(function () { return null; }),
    fetchJson(historyUrl).catch(function () { return null; })
  ]).then(function (results) {
    var primary = results[0];
    var entries = results[1];

    // Build the set of active cities from primary endpoint
    var primaryCities = [];
    var endedCities = [];
    if (primary && primary.data && primary.data.length > 0) {
      var isAlertOver = primary.title && primary.title.includes('\u05D4\u05E1\u05EA\u05D9\u05D9\u05DD');
      if (isAlertOver) {
        endedCities = primary.data;
      } else {
        primaryCities = primary.data;
      }
    }

    // Build the set of active cities from history (within lookback window)
    var historyCities = [];
    if (Array.isArray(entries) && entries.length > 0) {
      var cutoff = Date.now() - CONFIG.HISTORY_LOOKBACK_MS;
      var cityEndedTime = {};
      var cityActiveTime = {};

      entries.forEach(function (e) {
        var parts = e.alertDate.split(' ');
        var dateParts = parts[0].split('-');
        var timeParts = parts[1].split(':');
        var time = new Date(
          parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]),
          parseInt(timeParts[0]), parseInt(timeParts[1]), parseInt(timeParts[2])
        ).getTime();
        if (time < cutoff) return;

        var city = e.data;
        var isEnded = e.title && e.title.includes('\u05D4\u05E1\u05EA\u05D9\u05D9\u05DD');
        if (isEnded) {
          if (!cityEndedTime[city] || time > cityEndedTime[city]) cityEndedTime[city] = time;
        } else {
          if (!cityActiveTime[city] || time > cityActiveTime[city]) cityActiveTime[city] = time;
        }
      });

      Object.keys(cityActiveTime).forEach(function (city) {
        if (!cityEndedTime[city] || cityActiveTime[city] > cityEndedTime[city]) {
          historyCities.push(city);
        }
      });
    }

    // Merge: a region is active if matched by primary OR history, and not in ended list
    CONFIG.REGIONS.forEach(function (region) {
      var fromPrimary = isRegionMatchedServer(region, primaryCities);
      var fromHistory = isRegionMatchedServer(region, historyCities);
      var fromEnded = isRegionMatchedServer(region, endedCities);
      var matched = (fromPrimary || fromHistory) && !fromEnded;
      var prev = serverRegionStates[region.name] || false;

      if (matched && !prev) {
        serverRegionStates[region.name] = true;
        if (!isFirstServerPoll) {
          console.log('[WEBHOOK] Alert started:', region.displayNameEn);
          fireWebhook({
            type: 'alert_start',
            regionName: region.name,
            displayNameEn: region.displayNameEn,
            timestamp: new Date().toISOString(),
            israelTime: getIsraelTimeStr(),
            source: 'Server',
          });
        }
      } else if (!matched && prev) {
        serverRegionStates[region.name] = false;
        if (!isFirstServerPoll) {
          console.log('[WEBHOOK] Alert ended:', region.displayNameEn);
          fireWebhook({
            type: 'alert_end',
            regionName: region.name,
            displayNameEn: region.displayNameEn,
            timestamp: new Date().toISOString(),
            israelTime: getIsraelTimeStr(),
            source: 'Server',
          });
        }
      }
    });
  }).then(function () {
    isFirstServerPoll = false;
  }).catch(function (err) {
    console.error('Server poll error:', err.message);
  });
}

function startServerPolling() {
  if (!SLACK_WEBHOOK_URL && !GOOGLE_SHEET_WEBHOOK_URL) {
    console.log('No webhook URLs configured — polling disabled');
    return;
  }
  console.log('Webhook polling active — every', SERVER_POLL_MS / 1000, 'seconds');
  if (SLACK_WEBHOOK_URL) console.log('  Slack: configured');
  if (GOOGLE_SHEET_WEBHOOK_URL) console.log('  Google Sheets: configured');
  serverPoll();
  setInterval(serverPoll, SERVER_POLL_MS);
}

// --- Start server ---

app.listen(PORT, function () {
  console.log('Oref Dashboard running at http://localhost:' + PORT);
  if (MOCK) {
    console.log('\x1b[33m%s\x1b[0m', '\u26A0 MOCK MODE \u2014 serving fake alert data from mocks/');
  }
  console.log('Endpoints: /api/alerts, /api/history, /proxy, /webhook, /slack-webhook');
  startServerPolling();
});
