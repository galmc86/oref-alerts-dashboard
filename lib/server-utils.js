'use strict';

function getIsraelDateStr(offsetMinutes) {
  var d = new Date(Date.now() - offsetMinutes * 60000);
  var iso = d.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' });
  return iso.replace('T', ' ');
}

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

function recordEvent(event, serverEvents, maxLen) {
  serverEvents.unshift(event);
  if (serverEvents.length > maxLen) {
    serverEvents.length = maxLen;
  }
}

module.exports = {
  getIsraelDateStr: getIsraelDateStr,
  getIsraelTimeStr: getIsraelTimeStr,
  isRegionMatchedServer: isRegionMatchedServer,
  recordEvent: recordEvent,
};
