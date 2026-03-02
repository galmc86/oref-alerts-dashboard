const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;
const MOCK = process.argv.includes('--mock');

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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

server.listen(PORT, function () {
  console.log('Oref Dashboard running at http://localhost:' + PORT);
  if (MOCK) {
    console.log('\x1b[33m%s\x1b[0m', '⚠ MOCK MODE — serving fake alert data from mocks/');
  } else {
    console.log('Proxy: /api/alerts and /api/history');
  }
});
