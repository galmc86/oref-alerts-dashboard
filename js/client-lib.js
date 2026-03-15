'use strict';

var ClientLib = (function () {

  function isRegionMatched(region, cities) {
    return cities.some(function (city) {
      return region.matchPatterns.some(function (pattern) {
        return city.includes(pattern);
      });
    });
  }

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

  function findRegionAlertTime(region, activeCityDates, fallbackTime) {
    var cities = Object.keys(activeCityDates);
    for (var i = 0; i < cities.length; i++) {
      var city = cities[i];
      var matches = region.matchPatterns.some(function (pattern) {
        return city.includes(pattern);
      });
      if (matches) {
        var parts = activeCityDates[city].alertDate.split(' ');
        return parts[1] || '';
      }
    }
    return fallbackTime || '';
  }

  function mergeServerEvents(newEvents, existingLog, maxLen) {
    var existingKeys = {};
    existingLog.forEach(function (e) {
      existingKeys[e.timestamp + '|' + e.regionName + '|' + e.type] = true;
    });

    var added = 0;
    var latestTimestamp = '';
    newEvents.forEach(function (e) {
      var key = e.timestamp + '|' + e.regionName + '|' + e.type;
      if (!existingKeys[key]) {
        existingLog.push(e);
        existingKeys[key] = true;
        added++;
      }
      if (!latestTimestamp || e.timestamp > latestTimestamp) {
        latestTimestamp = e.timestamp;
      }
    });

    if (added > 0) {
      existingLog.sort(function (a, b) {
        return b.timestamp < a.timestamp ? -1 : b.timestamp > a.timestamp ? 1 : 0;
      });
      if (existingLog.length > maxLen) {
        existingLog.length = maxLen;
      }
    }

    return { added: added, latestTimestamp: latestTimestamp };
  }

  function createEvent(type, region, israelTimeFn) {
    var now = new Date();
    return {
      type: type,
      regionName: region.name,
      displayNameEn: region.displayNameEn,
      timestamp: now.toISOString(),
      israelTime: israelTimeFn ? israelTimeFn() : ''
    };
  }

  var exports = {
    isRegionMatched: isRegionMatched,
    parseAlertDate: parseAlertDate,
    findRegionAlertTime: findRegionAlertTime,
    mergeServerEvents: mergeServerEvents,
    createEvent: createEvent,
  };

  if (typeof module !== 'undefined') module.exports = exports;
  if (typeof window !== 'undefined') window.ClientLib = exports;

  return exports;
})();
