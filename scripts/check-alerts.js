/**
 * Standalone alert checker for GitHub Actions.
 * Fetches OREF data, compares with previous state, fires webhook on changes.
 *
 * State is persisted via a JSON file (path from STATE_FILE env var).
 * Webhook URL from WEBHOOK_URL env var.
 */

const https = require('https');
const fs = require('fs');
const CONFIG = require('../js/config.js');

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const STATE_FILE = process.env.STATE_FILE || '/tmp/alert-state.json';

const AZURE_PROXY = 'https://delco-regions-alert-dashboard.10bis.co.il/proxy';

function fetchJson(targetUrl) {
  return new Promise(function (resolve, reject) {
    var postData = JSON.stringify({ url: targetUrl });
    var urlObj = new URL(AZURE_PROXY);
    var options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    var req = https.request(options, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        if (!body || body.trim() === '' || body.trim() === '[]') {
          resolve(null);
          return;
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function isRegionMatched(region, cities) {
  return cities.some(function (city) {
    return region.matchPatterns.some(function (pattern) {
      return city.includes(pattern);
    });
  });
}

function getIsraelTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Jerusalem' });
}

function fireWebhook(event) {
  if (!WEBHOOK_URL) return Promise.resolve();
  event.source = 'GitHub Actions';
  var postData = JSON.stringify(event);
  return new Promise(function (resolve) {
    try {
      var urlObj = new URL(WEBHOOK_URL);
      var options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      var req = https.request(options, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          console.log('Webhook response:', Buffer.concat(chunks).toString());
          resolve();
        });
      });
      req.on('error', function (err) {
        console.error('Webhook error:', err.message);
        resolve();
      });
      req.write(postData);
      req.end();
    } catch (err) {
      console.error('Webhook error:', err.message);
      resolve();
    }
  });
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function run() {
  if (!WEBHOOK_URL) {
    console.log('No WEBHOOK_URL set, skipping.');
    return;
  }

  var prevState = loadState();
  var isFirstRun = Object.keys(prevState).length === 0;
  var newState = {};
  var events = [];

  try {
    // Fetch BOTH primary and history in parallel for complete coverage
    var results = await Promise.all([
      fetchJson('https://www.oref.org.il/WarningMessages/alert/alerts.json').catch(function () { return null; }),
      fetchJson('https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json').catch(function () { return null; })
    ]);
    var primary = results[0];
    var entries = results[1];

    // Carry forward previous state
    Object.keys(prevState).forEach(function (k) { newState[k] = prevState[k]; });

    // Build active/ended cities from primary endpoint
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
    // sub-area names for active vs ended entries
    var regionActiveTime = {};
    var regionEndedTime = {};
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

        CONFIG.REGIONS.forEach(function (region) {
          var matches = region.matchPatterns.some(function (pattern) {
            return city.includes(pattern);
          });
          if (!matches) return;

          if (isEnded) {
            if (!regionEndedTime[region.name] || time > regionEndedTime[region.name]) {
              regionEndedTime[region.name] = time;
            }
          } else {
            if (!regionActiveTime[region.name] || time > regionActiveTime[region.name]) {
              regionActiveTime[region.name] = time;
            }
          }
        });
      });
    }

    // Merge: a region is active if matched by primary, or active in history
    // with no later ended time, and not in primary ended list
    CONFIG.REGIONS.forEach(function (region) {
      var fromPrimary = isRegionMatched(region, primaryCities);
      var fromHistory = regionActiveTime[region.name] &&
        (!regionEndedTime[region.name] || regionActiveTime[region.name] > regionEndedTime[region.name]);
      var fromEnded = isRegionMatched(region, endedCities);
      newState[region.name] = (fromPrimary || fromHistory) && !fromEnded;
    });

    // Detect transitions (skip on first run)
    if (!isFirstRun) {
      CONFIG.REGIONS.forEach(function (region) {
        var prev = prevState[region.name] || false;
        var curr = newState[region.name] || false;
        if (curr && !prev) {
          events.push({
            type: 'alert_start',
            regionName: region.name,
            displayNameEn: region.displayNameEn,
            timestamp: new Date().toISOString(),
            israelTime: getIsraelTime()
          });
        } else if (!curr && prev) {
          events.push({
            type: 'alert_end',
            regionName: region.name,
            displayNameEn: region.displayNameEn,
            timestamp: new Date().toISOString(),
            israelTime: getIsraelTime()
          });
        }
      });
    }

    // Fire webhooks
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      console.log('[' + ev.type + '] ' + ev.displayNameEn + ' at ' + ev.israelTime);
      await fireWebhook(ev);
    }

    if (events.length === 0) {
      console.log('No state changes detected.' + (isFirstRun ? ' (first run — baseline set)' : ''));
    }

    saveState(newState);
  } catch (err) {
    console.error('Check failed:', err.message);
    process.exit(1);
  }
}

run();
