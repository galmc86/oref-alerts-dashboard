const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = require('./js/config.js');
const serverUtils = require('./lib/server-utils.js');

const app = express();
const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const MOCK = process.argv.includes('--mock');
const SERVER_POLL_MS = 5000;
const ALERT_END_SLACK_DELAY_MS = parseInt(process.env.ALERT_END_DELAY_MINUTES || '15', 10) * 60 * 1000;

// Track pending alert_end per region — persist scheduled send time so the
// 15-minute delay survives Azure restarts / SIGTERM recycling.
// { regionName: { event: {...}, sendAfter: <epoch ms> } }
var pendingAlertEnds = {};
var pendingAlertEndTimers = {}; // in-memory timers (convenience, not relied upon)

// Webhook secrets from environment variables
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || '';

// Optional: route OREF requests through an Israeli proxy (for Azure West Europe)
const OREF_PROXY_URL = process.env.OREF_PROXY_URL || '';

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

// --- Middleware ---

app.use(cors());
app.use(express.json());

// --- Mock helpers ---

var getIsraelDateStr = serverUtils.getIsraelDateStr;

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
  if (OREF_PROXY_URL) {
    // Route through Israel Central proxy (Azure West Europe cannot reach OREF directly)
    fetch(OREF_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, headers: OREF_HEADERS }),
    }).then(function (proxyRes) {
      return proxyRes.text().then(function (body) {
        res.set('Content-Type', 'application/json; charset=utf-8');
        res.set('Cache-Control', 'no-cache, no-store');
        res.status(proxyRes.status).send(body);
      });
    }).catch(function (err) {
      res.status(502).json({ error: err.message });
    });
    return;
  }
  // Direct OREF access (local dev in Israel)
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

// GET /alerts — short alias
app.get('/alerts', function (req, res) {
  if (MOCK) return serveMockAlerts(req, res);
  proxyOref('https://www.oref.org.il/WarningMessages/alert/alerts.json', res);
});

// GET /history — short alias
app.get('/history', function (req, res) {
  if (MOCK) return serveMockHistory(req, res);
  proxyOref('https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json', res);
});

// POST /proxy — OREF-only HTTP proxy (used by GitHub Actions check-alerts.js)
// Restricted to oref.org.il to prevent SSRF
app.post('/proxy', async function (req, res) {
  try {
    var proxyReq = req.body;
    var targetUrl = proxyReq.url;

    // SSRF protection: only allow OREF URLs
    if (!targetUrl || !targetUrl.startsWith('https://www.oref.org.il/')) {
      return res.status(403).json({ error: 'Only oref.org.il URLs are allowed' });
    }

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

// POST /webhook — webhook relay (forwards to Google Sheets)
// Slack is handled exclusively by server-side polling
app.post('/webhook', async function (req, res) {
  var event = req.body;
  var results = {};

  if (GOOGLE_SHEET_WEBHOOK_URL) {
    results.sheets = await sendGoogleSheet(event);
  }

  if (Object.keys(results).length === 0) {
    return res.status(503).json({ error: 'No webhook URLs configured' });
  }
  res.json(results);
});

// --- Health check endpoint ---

var lastPollTimestamp = 0;

app.get('/health', function (req, res) {
  var pollAge = Date.now() - lastPollTimestamp;
  var isPollingConfigured = !!(SLACK_WEBHOOK_URL || GOOGLE_SHEET_WEBHOOK_URL);

  // Unhealthy if polling is configured but hasn't run in 30 seconds
  if (isPollingConfigured && lastPollTimestamp > 0 && pollAge > 30000) {
    return res.status(503).json({
      status: 'unhealthy',
      reason: 'polling_stalled',
      pollAge: pollAge,
      uptime: process.uptime(),
    });
  }

  res.json({
    status: 'ok',
    pollAge: lastPollTimestamp > 0 ? pollAge : null,
    polling: isPollingConfigured,
    uptime: process.uptime(),
    regionsTracked: CONFIG.REGIONS.length,
    activeAlerts: Object.keys(serverRegionStates).filter(function (k) {
      return serverRegionStates[k];
    }).length,
  });
});

// --- Server event log endpoint ---

app.get('/api/events', function (req, res) {
  var since = req.query.since;
  if (since) {
    var sinceTime = new Date(since).getTime();
    var filtered = serverEvents.filter(function (e) {
      return new Date(e.timestamp).getTime() > sinceTime;
    });
    return res.json(filtered);
  }
  res.json(serverEvents);
});

// --- Slack / Google Sheets helpers ---

// Dedup guard — prevent duplicate Slack messages when Azure runs multiple
// instances during deploys/restarts. Uses a shared file lock.
// DEDUP_FILE is set after DATA_DIR is defined (see below)
var DEDUP_FILE;
var DEDUP_WINDOW_MS = 60 * 1000; // 60 seconds — cross-instance dedup only

function isDuplicateSlack(event) {
  var key = event.type + '|' + event.regionName;
  var now = Date.now();
  var dedup = {};
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      dedup = JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf8'));
    }
  } catch (e) { dedup = {}; }

  // Clean old entries
  Object.keys(dedup).forEach(function (k) {
    if (now - dedup[k] > DEDUP_WINDOW_MS) delete dedup[k];
  });

  if (dedup[key] && now - dedup[key] < DEDUP_WINDOW_MS) {
    return true; // duplicate
  }

  dedup[key] = now;
  try {
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(dedup), 'utf8');
  } catch (e) { /* best effort */ }
  return false;
}

async function sendSlack(event) {
  try {
    // Skip if another instance already sent this message recently
    if (isDuplicateSlack(event)) {
      console.log('[SLACK] Dedup skip:', event.type, event.displayNameEn);
      return true; // pretend success so caller doesn't retry
    }

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
// Serve only client-facing directories (not server.js, package.json, etc.)

app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.get('/israel-map.svg', function (req, res) { res.sendFile(path.join(ROOT, 'israel-map.svg')); });
app.get('/israel-outline.svg', function (req, res) { res.sendFile(path.join(ROOT, 'israel-outline.svg')); });
app.get('/', function (req, res) { res.sendFile(path.join(ROOT, 'index.html')); });

// --- Server-side alert polling & webhook ---

var serverRegionStates = {};
var isFirstServerPoll = true;
var isPolling = false; // guard against concurrent polls
var serverEvents = []; // in-memory event log for client dashboard

// Persistent data directory — use /home on Azure (survives deploys),
// fall back to __dirname for local dev
var DATA_DIR = fs.existsSync('/home') && !MOCK ? '/home/data' : __dirname;
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

var EVENTS_FILE = path.join(DATA_DIR, '.server-events.json');
var REGION_STATES_FILE = path.join(DATA_DIR, '.server-region-states.json');
DEDUP_FILE = path.join(DATA_DIR, '.slack-dedup.json');
PENDING_ENDS_FILE = path.join(DATA_DIR, '.pending-alert-ends.json');

var getIsraelTimeStr = serverUtils.getIsraelTimeStr;
var isRegionMatchedServer = serverUtils.isRegionMatchedServer;

// Load persisted events from disk on startup
function loadServerEvents() {
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      var data = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        serverEvents.push.apply(serverEvents, data);
        console.log('[EVENTS] Loaded', serverEvents.length, 'events from disk');
      }
    }
  } catch (e) {
    console.error('[EVENTS] Failed to load from disk:', e.message);
  }
}

// Persist events to disk (called after each change)
function saveServerEvents() {
  try {
    fs.writeFileSync(EVENTS_FILE, JSON.stringify(serverEvents), 'utf8');
  } catch (e) {
    console.error('[EVENTS] Failed to save to disk:', e.message);
  }
}

// Load persisted region states from disk on startup
function loadRegionStates() {
  try {
    if (fs.existsSync(REGION_STATES_FILE)) {
      var data = JSON.parse(fs.readFileSync(REGION_STATES_FILE, 'utf8'));
      Object.keys(data).forEach(function (k) { serverRegionStates[k] = data[k]; });
      var activeCount = Object.values(serverRegionStates).filter(Boolean).length;
      console.log('[STATES] Loaded region states from disk (' + activeCount + ' active)');
    }
  } catch (e) {
    console.error('[STATES] Failed to load from disk:', e.message);
  }
}

// Persist region states to disk
function saveRegionStates() {
  try {
    fs.writeFileSync(REGION_STATES_FILE, JSON.stringify(serverRegionStates), 'utf8');
  } catch (e) {
    console.error('[STATES] Failed to save to disk:', e.message);
  }
}

// Flicker guard — require 3 consecutive "not matched" polls before
// transitioning a region from active→ended. Prevents OREF data
// flicker from causing false alert_end → alert_start cycles.
var FLICKER_THRESHOLD = 3;
var regionNotMatchedCount = {}; // { regionName: consecutiveNotMatchedPolls }

function recordEvent(event) {
  serverUtils.recordEvent(event, serverEvents, CONFIG.EVENT_LOG_MAX);
  saveServerEvents();
}

function fetchJson(targetUrl) {
  if (OREF_PROXY_URL && !MOCK) {
    // Route through Israel Central proxy (Azure West Europe cannot reach OREF directly)
    return fetch(OREF_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, headers: OREF_HEADERS }),
    }).then(function (res) {
      return res.text();
    }).then(function (body) {
      body = (body || '').replace(/^\uFEFF/, '');
      if (!body || body.trim() === '' || body.trim() === '[]') return null;
      return JSON.parse(body);
    });
  }

  // Direct OREF access (local dev in Israel)
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
// alert_end Slack notifications are delayed 15 minutes; cancelled if alert restarts
function fireWebhook(event) {
  var region = event.regionName;

  if (SLACK_WEBHOOK_URL) {
    if (event.type === 'alert_start') {
      // Cancel any pending "ended" notification for this region
      if (pendingAlertEndTimers[region]) {
        clearTimeout(pendingAlertEndTimers[region]);
        delete pendingAlertEndTimers[region];
      }
      if (pendingAlertEnds[region]) {
        console.log('[SLACK] Cancelled pending alert_end for:', event.displayNameEn);
        delete pendingAlertEnds[region];
      }
      sendSlack(event).then(function (ok) {
        if (ok) console.log('[SLACK] Sent:', event.type, event.displayNameEn);
        else console.error('[SLACK] Failed for:', event.displayNameEn);
      });
    } else if (event.type === 'alert_end') {
      var sendAfter = Date.now() + ALERT_END_SLACK_DELAY_MS;
      pendingAlertEnds[region] = { event: event, sendAfter: sendAfter };
      console.log('[SLACK] Scheduling alert_end in 15 min for:', event.displayNameEn,
        '(send after', new Date(sendAfter).toISOString() + ')');
      scheduleAlertEndTimer(region);
    }
  }

  if (GOOGLE_SHEET_WEBHOOK_URL) {
    sendGoogleSheet(event).then(function (ok) {
      if (ok) console.log('[SHEETS] Sent:', event.type, event.displayNameEn);
      else console.error('[SHEETS] Failed for:', event.displayNameEn);
    });
  }
}

// Schedule (or re-schedule after restart) an in-memory timer for a pending alert_end.
// If the delay has already elapsed, send immediately.
function scheduleAlertEndTimer(region) {
  var pending = pendingAlertEnds[region];
  if (!pending) return;
  var remaining = pending.sendAfter - Date.now();
  if (remaining <= 0) {
    // Delay already elapsed (e.g. server restarted after the 15 min passed)
    delete pendingAlertEnds[region];
    delete pendingAlertEndTimers[region];
    sendSlack(pending.event).then(function (ok) {
      if (ok) console.log('[SLACK] Sent (delayed, post-restart):', pending.event.displayNameEn);
      else console.error('[SLACK] Failed (delayed, post-restart):', pending.event.displayNameEn);
    });
  } else {
    pendingAlertEndTimers[region] = setTimeout(function () {
      delete pendingAlertEnds[region];
      delete pendingAlertEndTimers[region];
      sendSlack(pending.event).then(function (ok) {
        if (ok) console.log('[SLACK] Sent (delayed):', pending.event.type, pending.event.displayNameEn);
        else console.error('[SLACK] Failed (delayed) for:', pending.event.displayNameEn);
      });
    }, remaining);
  }
}

function serverPoll() {
  // Guard against concurrent polls (if OREF is slow)
  if (isPolling) return Promise.resolve();
  isPolling = true;

  var alertsUrl = MOCK
    ? 'http://localhost:' + PORT + '/api/alerts'
    : 'https://www.oref.org.il/WarningMessages/alert/alerts.json';
  var historyUrl = MOCK
    ? 'http://localhost:' + PORT + '/api/history'
    : 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json';

  // Always fetch BOTH primary and history in parallel for complete coverage
  return Promise.all([
    fetchJson(alertsUrl).catch(function () { return null; }),
    fetchJson(historyUrl).catch(function () { return null; })
  ]).then(function (results) {
    var primary = results[0];
    var entries = results[1];

    lastPollTimestamp = Date.now();

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

    // Build region-level active/ended times from history (within lookback window)
    // Compare at REGION level, not city level, because OREF uses different
    // sub-area names for active vs ended entries (e.g., "אזור תעשייה חבל מודיעין"
    // gets an active alert but its ended event goes to "מודיעין מכבים רעות")
    var regionActiveTime = {};
    var regionEndedTime = {};
    var regionActiveAlertDate = {}; // original Israel-time string from OREF
    var regionEndedAlertDate = {};
    if (Array.isArray(entries) && entries.length > 0) {
      var cutoff = Date.now() - CONFIG.HISTORY_LOOKBACK_MS;

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

        // Match this city against all regions and track times per region
        CONFIG.REGIONS.forEach(function (region) {
          var matches = region.matchPatterns.some(function (pattern) {
            return city.includes(pattern);
          });
          if (!matches) return;

          if (isEnded) {
            if (!regionEndedTime[region.name] || time > regionEndedTime[region.name]) {
              regionEndedTime[region.name] = time;
              regionEndedAlertDate[region.name] = e.alertDate;
            }
          } else {
            if (!regionActiveTime[region.name] || time > regionActiveTime[region.name]) {
              regionActiveTime[region.name] = time;
              regionActiveAlertDate[region.name] = e.alertDate;
            }
          }
        });
      });
    }

    // On first poll, seed serverEvents from OREF history so the client
    // event log shows recent alerts even after a server restart
    if (isFirstServerPoll && serverEvents.length === 0) {
      var historyEvents = [];
      CONFIG.REGIONS.forEach(function (region) {
        if (regionActiveAlertDate[region.name]) {
          var timeStr = regionActiveAlertDate[region.name].split(' ')[1] || '';
          historyEvents.push({
            type: 'alert_start',
            regionName: region.name,
            displayNameEn: region.displayNameEn,
            timestamp: regionActiveAlertDate[region.name],
            israelTime: timeStr,
            source: 'History',
          });
        }
        if (regionEndedAlertDate[region.name]) {
          var timeStr2 = regionEndedAlertDate[region.name].split(' ')[1] || '';
          historyEvents.push({
            type: 'alert_end',
            regionName: region.name,
            displayNameEn: region.displayNameEn,
            timestamp: regionEndedAlertDate[region.name],
            israelTime: timeStr2,
            source: 'History',
          });
        }
      });
      // Sort newest first and record
      historyEvents.sort(function (a, b) {
        return b.timestamp < a.timestamp ? -1 : b.timestamp > a.timestamp ? 1 : 0;
      });
      historyEvents.forEach(function (e) { recordEvent(e); });
      if (historyEvents.length > 0) {
        console.log('[EVENTS] Seeded', historyEvents.length, 'events from OREF history');
      }
    }

    // Merge: a region is active if matched by primary, or active in history
    // with no later ended time, and not in primary ended list
    CONFIG.REGIONS.forEach(function (region) {
      var fromPrimary = isRegionMatchedServer(region, primaryCities);
      var fromHistory = regionActiveTime[region.name] &&
        (!regionEndedTime[region.name] || regionActiveTime[region.name] > regionEndedTime[region.name]);
      var fromEnded = isRegionMatchedServer(region, endedCities);
      var matched = (fromPrimary || fromHistory) && !fromEnded;
      var prev = serverRegionStates[region.name] || false;

      if (matched) {
        // Region is active — reset flicker counter
        regionNotMatchedCount[region.name] = 0;

        if (!prev) {
          serverRegionStates[region.name] = true;
          saveRegionStates();
          if (!isFirstServerPoll) {
            console.log('[STATE] ' + region.displayNameEn + ': false→true',
              '(primary=' + fromPrimary + ', history=' + fromHistory + ', ended=' + fromEnded + ')');
            var startEvent = {
              type: 'alert_start',
              regionName: region.name,
              displayNameEn: region.displayNameEn,
              timestamp: new Date().toISOString(),
              israelTime: getIsraelTimeStr(),
              source: 'Server',
            };
            console.log('[WEBHOOK] Alert started:', region.displayNameEn);
            recordEvent(startEvent);
            fireWebhook(startEvent);
          } else {
            console.log('[WEBHOOK] Skipping first-poll alert_start for:', region.displayNameEn);
          }
        }
      } else if (prev) {
        // Region was active but not matched this poll — increment flicker counter
        var count = (regionNotMatchedCount[region.name] || 0) + 1;
        regionNotMatchedCount[region.name] = count;

        if (count >= FLICKER_THRESHOLD) {
          // Confirmed ended — 3 consecutive polls without match
          serverRegionStates[region.name] = false;
          saveRegionStates();
          regionNotMatchedCount[region.name] = 0;
          if (!isFirstServerPoll) {
            console.log('[STATE] ' + region.displayNameEn + ': true→false (after ' + count + ' polls)',
              '(primary=' + fromPrimary + ', history=' + fromHistory + ', ended=' + fromEnded + ')');
            var endEvent = {
              type: 'alert_end',
              regionName: region.name,
              displayNameEn: region.displayNameEn,
              timestamp: new Date().toISOString(),
              israelTime: getIsraelTimeStr(),
              source: 'Server',
            };
            console.log('[WEBHOOK] Alert ended:', region.displayNameEn);
            recordEvent(endEvent);
            fireWebhook(endEvent);
          }
        } else {
          console.log('[FLICKER] ' + region.displayNameEn + ': not matched poll ' + count + '/' + FLICKER_THRESHOLD + ', holding state');
        }
      }
    });
  }).then(function () {
    isFirstServerPoll = false;
  }).catch(function (err) {
    console.error('Server poll error:', err.message);
  }).finally(function () {
    isPolling = false;
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
  if (OREF_PROXY_URL) console.log('  OREF proxy: ' + OREF_PROXY_URL);
  serverPoll();
  setInterval(serverPoll, SERVER_POLL_MS);
}

// --- Graceful shutdown ---
// On SIGTERM (Azure restart/deploy), persist pending alert_end times to disk
// so they survive restarts and the 15-minute delay is honoured.

// PENDING_ENDS_FILE is set after DATA_DIR is defined (see below)
var PENDING_ENDS_FILE;

function savePendingEnds() {
  try {
    var data = JSON.stringify(pendingAlertEnds);
    fs.writeFileSync(PENDING_ENDS_FILE, data, 'utf8');
    console.log('[SHUTDOWN] Saved', Object.keys(pendingAlertEnds).length, 'pending alert_end(s) to disk');
  } catch (e) {
    console.error('[SHUTDOWN] Failed to save pending ends:', e.message);
  }
}

function loadPendingEnds() {
  try {
    if (fs.existsSync(PENDING_ENDS_FILE)) {
      var data = JSON.parse(fs.readFileSync(PENDING_ENDS_FILE, 'utf8'));
      var count = 0;
      Object.keys(data).forEach(function (region) {
        pendingAlertEnds[region] = data[region];
        scheduleAlertEndTimer(region);
        count++;
      });
      // Clean up the file after loading
      fs.unlinkSync(PENDING_ENDS_FILE);
      if (count > 0) {
        console.log('[STARTUP] Restored', count, 'pending alert_end(s) from disk');
      }
    }
  } catch (e) {
    console.error('[STARTUP] Failed to load pending ends:', e.message);
  }
}

function gracefulShutdown(signal) {
  console.log(signal + ' received — saving pending notifications...');
  // Cancel in-memory timers
  var regions = Object.keys(pendingAlertEndTimers);
  regions.forEach(function (region) {
    clearTimeout(pendingAlertEndTimers[region]);
    delete pendingAlertEndTimers[region];
  });
  // Persist pending ends to disk so they survive restart
  savePendingEnds();
  // Exit quickly — no more Slack calls on shutdown
  setTimeout(function () {
    process.exit(0);
  }, 500);
}

process.on('SIGTERM', function () { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', function () { gracefulShutdown('SIGINT'); });

// --- Start server ---

if (require.main === module) {
  var server = app.listen(PORT, function () {
    console.log('Oref Dashboard running at http://localhost:' + PORT);
    if (MOCK) {
      console.log('\x1b[33m%s\x1b[0m', '\u26A0 MOCK MODE \u2014 serving fake alert data from mocks/');
    }
    console.log('Endpoints: /api/alerts, /api/history, /api/events, /proxy, /webhook, /health');
    loadServerEvents();
    loadRegionStates();
    loadPendingEnds();
    startServerPolling();
  });
}

module.exports = { app: app, serverRegionStates: serverRegionStates, serverEvents: serverEvents };
