const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

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

  // Proxy endpoints
  if (req.url === '/api/alerts') {
    proxyOref('https://www.oref.org.il/WarningMessages/alert/alerts.json', res);
    return;
  }
  if (req.url === '/api/history') {
    proxyOref('https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json', res);
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
  console.log('Proxy: /api/alerts and /api/history');
});
