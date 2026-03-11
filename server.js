const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const url = require('url');
const CONFIG = require('./js/config.js');

const PORT = 8080;
const ROOT = __dirname;
const MOCK = process.argv.includes('--mock');
const WEBHOOK_URL = process.env.WEBHOOK_URL || CONFIG.WEBHOOK_URL;
const SERVER_POLL_MS = 5000; // Server polls every 5s (faster than client's 15s to catch brief alerts)

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

// --- Mock helpers ---

function getIsraelDateStr(offsetMinutes) {
  var d = new Date(Date.now() - offsetMinutes * 60000);
  var iso = d.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }); // "YYYY-MM-DD HH:MM:SS"
  return iso.replace('T', ' ');
}

function serveMockAlerts(res) {
  var mockFile = process.argv.includes('--history-only') ? 'alerts-empty.json' : 'alerts.json';
  var data = fs.readFileSync(path.join(ROOT, 'mocks', mockFile), 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-store',
  });
  res.end(data);
}

function serveMockHistory(res) {
  var raw = fs.readFileSync(path.join(ROOT, 'mocks', 'history.json'), 'utf8');
  var entries = JSON.parse(raw);
  // Inject recent timestamps so entries fall within the 30-minute lookback window
  entries.forEach(function (entry, i) {
    entry.alertDate = getIsraelDateStr(2 + i); // 2, 3, 4 minutes ago
  });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-store',
  });
  res.end(JSON.stringify(entries));
}

// --- Oref proxy ---

function proxyOref(targetUrl, res) {
  https.get(targetUrl, { headers: OREF_HEADERS }, function (proxyRes) {
    var chunks = [];
    proxyRes.on('data', function (chunk) { chunks.push(chunk); });
    proxyRes.on('end', function () {
      var body = Buffer.concat(chunks);
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store',
      });
      res.end(body);
    });
  }).on('error', function (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}

var server = http.createServer(function (req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    });
    res.end();
    return;
  }

  // API endpoints (mock or proxy)
  if (req.url === '/api/alerts') {
    if (MOCK) { serveMockAlerts(res); } else { proxyOref('https://www.oref.org.il/WarningMessages/alert/alerts.json', res); }
    return;
  }
  if (req.url === '/api/history') {
    if (MOCK) { serveMockHistory(res); } else { proxyOref('https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json', res); }
    return;
  }

  // Static file serving
  var filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(ROOT, filePath);

  var ext = path.extname(filePath);
  var contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

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

function fireWebhook(event) {
  if (!WEBHOOK_URL) return;
  var postData = JSON.stringify(event);
  try {
    var urlObj = new url.URL(WEBHOOK_URL);
    var transport = WEBHOOK_URL.startsWith('https') ? https : http;
    var options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (WEBHOOK_URL.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    var req = transport.request(options, function (res) { res.resume(); });
    req.on('error', function (err) {
      console.error('Webhook error:', err.message);
    });
    req.write(postData);
    req.end();
  } catch (err) {
    console.error('Webhook error:', err.message);
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
            israelTime: getIsraelTimeStr()
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
            israelTime: getIsraelTimeStr()
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
  if (!WEBHOOK_URL) return;
  console.log('Webhook polling active — sending to:', WEBHOOK_URL);
  serverPoll();
  console.log('Polling every', SERVER_POLL_MS / 1000, 'seconds');
  setInterval(serverPoll, SERVER_POLL_MS);
}

server.listen(PORT, function () {
  console.log('Oref Dashboard running at http://localhost:' + PORT);
  if (MOCK) {
    console.log('\x1b[33m%s\x1b[0m', '⚠ MOCK MODE — serving fake alert data from mocks/');
  } else {
    console.log('Proxy: /api/alerts and /api/history');
  }
  startServerPolling();
});
