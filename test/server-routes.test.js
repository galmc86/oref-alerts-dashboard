'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Force mock mode before requiring server
process.argv.push('--mock');

const { app } = require('../server.js');

var server;
var baseUrl;

before(function (_, done) {
  server = app.listen(0, function () {
    var port = server.address().port;
    baseUrl = 'http://localhost:' + port;
    done();
  });
});

after(function (_, done) {
  server.close(done);
});

describe('GET /api/alerts (mock)', function () {
  it('returns 200 with JSON content type', async function () {
    var res = await fetch(baseUrl + '/api/alerts');
    assert.equal(res.status, 200);
    var ct = res.headers.get('content-type');
    assert.ok(ct.includes('application/json'), 'expected JSON content-type, got: ' + ct);
  });

  it('returns parseable JSON body', async function () {
    var res = await fetch(baseUrl + '/api/alerts');
    var text = await res.text();
    assert.doesNotThrow(function () { JSON.parse(text); });
  });
});

describe('GET /api/history (mock)', function () {
  it('returns 200 with a JSON array', async function () {
    var res = await fetch(baseUrl + '/api/history');
    assert.equal(res.status, 200);
    var data = await res.json();
    assert.ok(Array.isArray(data), 'expected array');
  });

  it('entries have dynamic alertDate values', async function () {
    var res = await fetch(baseUrl + '/api/history');
    var data = await res.json();
    assert.ok(data.length > 0, 'expected entries');
    assert.ok(data[0].alertDate, 'expected alertDate field');
    assert.match(data[0].alertDate, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('GET /api/events', function () {
  it('returns 200 with a JSON array', async function () {
    var res = await fetch(baseUrl + '/api/events');
    assert.equal(res.status, 200);
    var data = await res.json();
    assert.ok(Array.isArray(data), 'expected array');
  });

  it('supports ?since= filter parameter', async function () {
    var future = new Date(Date.now() + 86400000).toISOString();
    var res = await fetch(baseUrl + '/api/events?since=' + encodeURIComponent(future));
    var data = await res.json();
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0, 'expected no events in the future');
  });
});

describe('GET /health', function () {
  it('returns 200 with status object', async function () {
    var res = await fetch(baseUrl + '/health');
    assert.equal(res.status, 200);
    var data = await res.json();
    assert.equal(data.status, 'ok');
    assert.ok('uptime' in data);
    assert.ok('regionsTracked' in data);
  });
});

describe('POST /proxy — SSRF protection', function () {
  it('rejects non-OREF URLs with 403', async function () {
    var res = await fetch(baseUrl + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://evil.com/steal' }),
    });
    assert.equal(res.status, 403);
    var data = await res.json();
    assert.ok(data.error.includes('oref.org.il'));
  });

  it('rejects missing URL with 403', async function () {
    var res = await fetch(baseUrl + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403);
  });

  it('rejects http:// OREF URLs with 403', async function () {
    var res = await fetch(baseUrl + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://www.oref.org.il/foo' }),
    });
    assert.equal(res.status, 403);
  });
});

describe('POST /webhook — no config', function () {
  it('returns 503 when no webhook URLs configured', async function () {
    var res = await fetch(baseUrl + '/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'alert_start', regionName: 'test' }),
    });
    assert.equal(res.status, 503);
  });
});
