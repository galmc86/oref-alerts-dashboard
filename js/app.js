(function () {
  'use strict';

  var pollingTimer = null;
  var consecutiveErrors = 0;
  var MAX_BACKOFF_MS = 30000;

  // Track the alert time (from alertDate) for each region
  var regionAlertTimes = {};
  // Current state per region: true = alert, false = safe
  var regionStates = {};
  // Track regions ended by primary "ended" events so history fallback won't re-alert them
  var recentlyEndedRegions = {};

  // --- Initialization ---

  function init() {
    renderSafePills();
    startPolling();
  }

  // --- Render safe pills (initial state) ---

  function renderSafePills() {
    var safeGrid = document.getElementById('safe-grid');
    safeGrid.innerHTML = '';
    CONFIG.REGIONS.forEach(function (region) {
      regionStates[region.name] = false;
      var pill = createSafePill(region);
      safeGrid.appendChild(pill);
    });
    updateCounts();
  }

  function createSafePill(region) {
    var pill = document.createElement('div');
    pill.className = 'safe-pill';
    pill.id = 'pill-' + region.name;
    pill.innerHTML =
      '<span class="pill-dot"></span>' +
      '<span>' + region.name + '</span>';
    return pill;
  }

  function createAlertCard(region) {
    var card = document.createElement('div');
    card.className = 'alert-card';
    card.id = 'alert-' + region.name;
    var timeStr = regionAlertTimes[region.name] || '';
    card.innerHTML =
      '<div class="alert-timer">Started ' + timeStr + '</div>' +
      '<div class="alert-city-en">' + region.name + '</div>';
    return card;
  }

  // --- Polling ---

  function startPolling() {
    poll();
    pollingTimer = setInterval(poll, CONFIG.POLL_INTERVAL_MS);
  }

  async function poll() {
    try {
      var primary = await fetchPrimary();
      consecutiveErrors = 0;
      setConnectionStatus(true);

      var isAlertOver = primary && primary.title && primary.title.includes('\u05D4\u05E1\u05EA\u05D9\u05D9\u05DD');

      if (primary && primary.data && primary.data.length > 0) {
        if (isAlertOver) {
          processEndedResponse(primary);
        } else {
          processPrimaryResponse(primary);
        }
      } else {
        var history = await fetchHistory();
        processHistoryFallback(history);
      }
      updateLastPollTime();
    } catch (err) {
      console.error('Poll error:', err);
      consecutiveErrors++;
      setConnectionStatus(false);
      updateLastPollTime();

      if (consecutiveErrors > 3) {
        clearInterval(pollingTimer);
        var backoff = Math.min(
          CONFIG.POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors - 3),
          MAX_BACKOFF_MS
        );
        setTimeout(function () {
          consecutiveErrors = 0;
          startPolling();
        }, backoff);
      }
    }
  }

  // --- API Fetch ---

  async function fetchPrimary() {
    var response = await fetch(CONFIG.PROXY_URL, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var text = await response.text();
    if (!text || text.trim() === '' || text.trim() === '[]') return null;
    return JSON.parse(text);
  }

  async function fetchHistory() {
    var response = await fetch(CONFIG.HISTORY_URL, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error('History HTTP ' + response.status);
    var text = await response.text();
    if (!text || text.trim() === '') return [];
    return JSON.parse(text);
  }

  // --- Process Ended Response ---

  function processEndedResponse(response) {
    // "Ended" event: only set matched regions safe, leave others untouched.
    // Record them so history fallback won't re-alert them.
    var endedCities = response.data || [];
    var now = Date.now();
    CONFIG.REGIONS.forEach(function (region) {
      if (isRegionMatched(region, endedCities)) {
        setRegionSafe(region);
        recentlyEndedRegions[region.name] = now;
      }
    });
    rebuildUI();
  }

  // --- Process Primary Response ---

  function processPrimaryResponse(response) {
    var alertedCities = response.data || [];
    var alertTime = getIsraelTime();

    CONFIG.REGIONS.forEach(function (region) {
      var isMatched = isRegionMatched(region, alertedCities);
      if (isMatched) {
        delete recentlyEndedRegions[region.name];
        setRegionAlert(region, alertTime);
      }
    });

    rebuildUI();
  }

  // --- Process History Fallback ---

  function processHistoryFallback(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      setAllSafe();
      rebuildUI();
      return;
    }

    var now = new Date();
    var cutoff = now.getTime() - CONFIG.HISTORY_LOOKBACK_MS;

    var recent = entries.filter(function (e) {
      return parseAlertDate(e.alertDate) > cutoff;
    });

    if (recent.length === 0) {
      setAllSafe();
      rebuildUI();
      return;
    }

    // Group by city + category so different alert types are tracked independently.
    // A city is active if ANY of its alert categories still has a non-ended entry.
    var cityCategory = {};
    recent.forEach(function (e) {
      var city = e.data;
      var time = parseAlertDate(e.alertDate);
      var key = city + '|' + (e.category || '');
      if (!cityCategory[key] || time > cityCategory[key].time) {
        cityCategory[key] = { city: city, time: time, category: e.category, title: e.title, alertDate: e.alertDate };
      }
    });

    // Build map of active cities with their most recent alertDate
    var activeCityDates = {};
    Object.keys(cityCategory).forEach(function (key) {
      var entry = cityCategory[key];
      var isEnded = entry.title && entry.title.includes('\u05D4\u05E1\u05EA\u05D9\u05D9\u05DD');
      if (!isEnded) {
        if (!activeCityDates[entry.city] || entry.time > activeCityDates[entry.city].time) {
          activeCityDates[entry.city] = { time: entry.time, alertDate: entry.alertDate };
        }
      }
    });

    var activeCities = Object.keys(activeCityDates);

    // Clean up ended records older than the lookback window
    var now = Date.now();
    Object.keys(recentlyEndedRegions).forEach(function (name) {
      if (now - recentlyEndedRegions[name] > CONFIG.HISTORY_LOOKBACK_MS) {
        delete recentlyEndedRegions[name];
      }
    });

    CONFIG.REGIONS.forEach(function (region) {
      if (isRegionMatched(region, activeCities) && !recentlyEndedRegions[region.name]) {
        var alertTime = findRegionAlertTime(region, activeCityDates);
        setRegionAlert(region, alertTime);
      } else {
        setRegionSafe(region);
      }
    });

    rebuildUI();
  }

  // --- Matching ---

  function isRegionMatched(region, cities) {
    return cities.some(function (city) {
      return region.matchPatterns.some(function (pattern) {
        return city.includes(pattern);
      });
    });
  }

  function findRegionAlertTime(region, activeCityDates) {
    var cities = Object.keys(activeCityDates);
    for (var i = 0; i < cities.length; i++) {
      var city = cities[i];
      var matches = region.matchPatterns.some(function (pattern) {
        return city.includes(pattern);
      });
      if (matches) {
        // Extract time portion from alertDate "YYYY-MM-DD HH:MM:SS"
        var parts = activeCityDates[city].alertDate.split(' ');
        return parts[1] || '';
      }
    }
    return getIsraelTime();
  }

  // --- State Management ---

  function setRegionAlert(region, alertTime) {
    if (!regionStates[region.name]) {
      regionAlertTimes[region.name] = alertTime || getIsraelTime();
    }
    regionStates[region.name] = true;
  }

  function setRegionSafe(region) {
    if (regionStates[region.name]) {
      delete regionAlertTimes[region.name];
    }
    regionStates[region.name] = false;
  }

  function setAllSafe() {
    CONFIG.REGIONS.forEach(function (region) {
      setRegionSafe(region);
    });
  }

  // --- UI Rebuild ---

  function rebuildUI() {
    var alertGrid = document.getElementById('alert-grid');
    var safeGrid = document.getElementById('safe-grid');
    var alertSection = document.getElementById('alert-section');

    alertGrid.innerHTML = '';
    safeGrid.innerHTML = '';

    CONFIG.REGIONS.forEach(function (region) {
      if (regionStates[region.name]) {
        alertGrid.appendChild(createAlertCard(region));
      } else {
        safeGrid.appendChild(createSafePill(region));
      }
    });

    alertSection.hidden = alertGrid.children.length === 0;
    updateCounts();
  }

  function updateCounts() {
    var alertCount = 0;
    var safeCount = 0;
    CONFIG.REGIONS.forEach(function (region) {
      if (regionStates[region.name]) {
        alertCount++;
      } else {
        safeCount++;
      }
    });
    document.getElementById('alert-count').textContent = alertCount;
    document.getElementById('safe-count').textContent = safeCount;
  }

  // --- Connection & Time ---

  function setConnectionStatus(connected) {
    var dot = document.getElementById('connection-dot');
    dot.className = connected ? 'status-dot connected' : 'status-dot error';
  }

  function getIsraelTime() {
    return new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Jerusalem' });
  }

  function getLocalTime() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  function updateLastPollTime() {
    var el = document.getElementById('last-update');
    el.textContent = getIsraelTime();
  }

  // --- Date Parsing ---

  function parseAlertDate(dateStr) {
    var parts = dateStr.split(' ');
    var dateParts = parts[0].split('-');
    var timeParts = parts[1].split(':');
    return new Date(
      parseInt(dateParts[0]),
      parseInt(dateParts[1]) - 1,
      parseInt(dateParts[2]),
      parseInt(timeParts[0]),
      parseInt(timeParts[1]),
      parseInt(timeParts[2])
    ).getTime();
  }

  // --- Start ---

  document.addEventListener('DOMContentLoaded', init);
})();
