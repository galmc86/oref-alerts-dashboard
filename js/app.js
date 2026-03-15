(function () {
  'use strict';

  var pollingTimer = null;
  var consecutiveErrors = 0;
  var MAX_BACKOFF_MS = 30000;

  // Track the alert time (from alertDate) for each region
  var regionAlertTimes = {};
  // Current state per region: true = alert, false = safe
  var regionStates = {};
  var isFirstLoad = true;
  // Track regions ended by primary "ended" events so history fallback won't re-alert them
  var recentlyEndedRegions = {};

  // Event log and notifications state
  var eventLog = [];
  var notificationsEnabled = false;

  // Load persisted event log
  try {
    var stored = localStorage.getItem('eventLog');
    if (stored) eventLog = JSON.parse(stored);
  } catch (e) { eventLog = []; }

  // --- Initialization ---

  function init() {
    renderSafePills();
    initEventLog();
    initNotifications();
    fetchServerEvents(); // load server-detected events into log
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
      fetchServerEvents(); // sync server-detected events into log
      if (isFirstLoad) {
        hideLoading();
        isFirstLoad = false;
        // Emit events for any regions already in alert on first load
        CONFIG.REGIONS.forEach(function (region) {
          if (regionStates[region.name]) {
            emitEvent(createEvent('alert_start', region));
          }
        });
      }
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

    // Per city, track the most recent ended timestamp and most recent active entry.
    // An "ended" event (category 13) cancels ALL earlier active alerts for the same
    // city regardless of category, since the original alert (cat 1) and ended event
    // (cat 13) use different category numbers.
    var cityEndedTime = {};
    var cityActiveEntries = {};

    recent.forEach(function (e) {
      var city = e.data;
      var time = parseAlertDate(e.alertDate);
      var isEnded = e.title && e.title.includes('\u05D4\u05E1\u05EA\u05D9\u05D9\u05DD');

      if (isEnded) {
        if (!cityEndedTime[city] || time > cityEndedTime[city]) {
          cityEndedTime[city] = time;
        }
      } else {
        if (!cityActiveEntries[city] || time > cityActiveEntries[city].time) {
          cityActiveEntries[city] = { time: time, alertDate: e.alertDate };
        }
      }
    });

    // A city is active only if its most recent non-ended entry is newer than
    // its most recent ended entry (or it has no ended entry at all)
    var activeCityDates = {};
    Object.keys(cityActiveEntries).forEach(function (city) {
      var activeEntry = cityActiveEntries[city];
      var endedTime = cityEndedTime[city];
      if (!endedTime || activeEntry.time > endedTime) {
        activeCityDates[city] = activeEntry;
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
      if (!isFirstLoad) {
        emitEvent(createEvent('alert_start', region));
      }
    }
    regionStates[region.name] = true;
  }

  function setRegionSafe(region) {
    if (regionStates[region.name]) {
      delete regionAlertTimes[region.name];
      if (!isFirstLoad) {
        emitEvent(createEvent('alert_end', region));
      }
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

  function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('card-view').removeAttribute('hidden');
  }

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

  // --- Event System ---

  function createEvent(type, region) {
    var now = new Date();
    return {
      type: type,
      regionName: region.name,
      displayNameEn: region.displayNameEn,
      timestamp: now.toISOString(),
      israelTime: getIsraelTime()
    };
  }

  function emitEvent(event) {
    logEvent(event);
    if (event.type === 'alert_start') {
      sendNotification(event);
    }
  }

  // --- Event Log ---

  function initEventLog() {
    var toggle = document.getElementById('event-log-toggle');
    var list = document.getElementById('event-log-list');
    toggle.addEventListener('click', function () {
      var isCollapsed = list.hasAttribute('hidden');
      if (isCollapsed) {
        list.removeAttribute('hidden');
        toggle.textContent = 'Event Log \u25B2';
      } else {
        list.setAttribute('hidden', '');
        toggle.textContent = 'Event Log \u25BC';
      }
    });
    renderEventLog();
  }

  function logEvent(event) {
    eventLog.unshift(event);
    if (eventLog.length > CONFIG.EVENT_LOG_MAX) {
      eventLog = eventLog.slice(0, CONFIG.EVENT_LOG_MAX);
    }
    persistEventLog();
    renderEventLog();
  }

  function persistEventLog() {
    try {
      localStorage.setItem('eventLog', JSON.stringify(eventLog));
    } catch (e) { /* localStorage full or unavailable */ }
  }

  function renderEventLog() {
    var list = document.getElementById('event-log-list');
    if (!list) return;
    list.innerHTML = '';
    eventLog.forEach(function (event) {
      var item = document.createElement('div');
      item.className = 'event-log-item';
      var indicator = event.type === 'alert_start' ? 'event-indicator-alert' : 'event-indicator-safe';
      var label = event.type === 'alert_start' ? 'ALERT' : 'SAFE';
      item.innerHTML =
        '<span class="event-indicator ' + indicator + '"></span>' +
        '<span class="event-label">' + label + '</span>' +
        '<span class="event-region">' + event.displayNameEn + '</span>' +
        '<span class="event-time">' + event.israelTime + '</span>';
      list.appendChild(item);
    });
  }

  // --- Server Events Sync ---

  var lastServerEventTime = '';

  function fetchServerEvents() {
    var url = '/api/events';
    if (lastServerEventTime) {
      url += '?since=' + encodeURIComponent(lastServerEventTime);
    }
    fetch(url).then(function (res) {
      return res.json();
    }).then(function (events) {
      if (!Array.isArray(events) || events.length === 0) return;
      mergeServerEvents(events);
    }).catch(function () { /* silently ignore */ });
  }

  function mergeServerEvents(events) {
    // Build a set of existing event keys for dedup
    var existingKeys = {};
    eventLog.forEach(function (e) {
      existingKeys[e.timestamp + '|' + e.regionName + '|' + e.type] = true;
    });

    var added = 0;
    events.forEach(function (e) {
      var key = e.timestamp + '|' + e.regionName + '|' + e.type;
      if (!existingKeys[key]) {
        eventLog.push(e);
        existingKeys[key] = true;
        added++;
      }
      // Track latest timestamp for ?since= on next fetch
      if (!lastServerEventTime || e.timestamp > lastServerEventTime) {
        lastServerEventTime = e.timestamp;
      }
    });

    if (added > 0) {
      // Sort by timestamp descending (newest first)
      eventLog.sort(function (a, b) {
        return b.timestamp < a.timestamp ? -1 : b.timestamp > a.timestamp ? 1 : 0;
      });
      // Cap at max
      if (eventLog.length > CONFIG.EVENT_LOG_MAX) {
        eventLog = eventLog.slice(0, CONFIG.EVENT_LOG_MAX);
      }
      persistEventLog();
      renderEventLog();
    }
  }

  // --- Browser Notifications ---

  function initNotifications() {
    var btn = document.getElementById('notify-btn');
    if (!('Notification' in window)) {
      btn.style.display = 'none';
      return;
    }

    if (Notification.permission === 'granted' && localStorage.getItem('notifyEnabled') === 'true') {
      notificationsEnabled = true;
    }
    updateNotifyButton();

    btn.addEventListener('click', function () {
      if (Notification.permission === 'denied') return;

      if (Notification.permission === 'granted') {
        notificationsEnabled = !notificationsEnabled;
        localStorage.setItem('notifyEnabled', notificationsEnabled ? 'true' : 'false');
        updateNotifyButton();
      } else {
        Notification.requestPermission().then(function (result) {
          if (result === 'granted') {
            notificationsEnabled = true;
            localStorage.setItem('notifyEnabled', 'true');
          }
          updateNotifyButton();
        });
      }
    });
  }

  function updateNotifyButton() {
    var btn = document.getElementById('notify-btn');
    btn.className = 'notify-btn';
    if (Notification.permission === 'denied') {
      btn.classList.add('denied');
      btn.title = 'Notifications blocked by browser';
    } else if (notificationsEnabled) {
      btn.classList.add('enabled');
      btn.title = 'Notifications enabled (click to disable)';
    } else {
      btn.title = 'Enable notifications';
    }
  }

  function sendNotification(event) {
    if (!notificationsEnabled || Notification.permission !== 'granted') return;
    if (!document.hidden) return;

    new Notification('Alert: ' + event.displayNameEn, {
      body: event.displayNameEn + ' - Alert started at ' + event.israelTime,
      tag: 'oref-alert-' + event.regionName,
      requireInteraction: true
    });
  }

  // --- Start ---

  document.addEventListener('DOMContentLoaded', init);
})();
