'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isRegionMatched, parseAlertDate, findRegionAlertTime, mergeServerEvents, createEvent } = require('../js/client-lib.js');

describe('isRegionMatched', function () {
  var region = { matchPatterns: ['תל אביב'] };

  it('returns true when a city matches', function () {
    assert.ok(isRegionMatched(region, ['תל אביב - יפו']));
  });

  it('returns false when no city matches', function () {
    assert.ok(!isRegionMatched(region, ['חיפה']));
  });

  it('returns false for empty cities', function () {
    assert.ok(!isRegionMatched(region, []));
  });

  it('matches partial city names', function () {
    assert.ok(isRegionMatched(region, ['אזור תל אביב מרכז']));
  });
});

describe('parseAlertDate', function () {
  it('parses YYYY-MM-DD HH:MM:SS format correctly', function () {
    var result = parseAlertDate('2025-01-15 14:30:00');
    var expected = new Date(2025, 0, 15, 14, 30, 0).getTime();
    assert.equal(result, expected);
  });

  it('handles midnight correctly', function () {
    var result = parseAlertDate('2025-06-01 00:00:00');
    var expected = new Date(2025, 5, 1, 0, 0, 0).getTime();
    assert.equal(result, expected);
  });

  it('handles end of day', function () {
    var result = parseAlertDate('2025-12-31 23:59:59');
    var expected = new Date(2025, 11, 31, 23, 59, 59).getTime();
    assert.equal(result, expected);
  });
});

describe('findRegionAlertTime', function () {
  var region = { matchPatterns: ['תל אביב'] };

  it('returns time portion when city matches', function () {
    var activeCityDates = {
      'תל אביב - יפו': { time: 100, alertDate: '2025-01-15 14:30:00' }
    };
    assert.equal(findRegionAlertTime(region, activeCityDates, '00:00:00'), '14:30:00');
  });

  it('returns fallback time when no city matches', function () {
    var activeCityDates = {
      'חיפה': { time: 100, alertDate: '2025-01-15 14:30:00' }
    };
    assert.equal(findRegionAlertTime(region, activeCityDates, '12:00:00'), '12:00:00');
  });

  it('returns empty string when no match and no fallback', function () {
    assert.equal(findRegionAlertTime(region, {}, undefined), '');
  });
});

describe('mergeServerEvents', function () {
  it('adds new events to existing log', function () {
    var log = [{ timestamp: '2025-01-01T00:00:00Z', regionName: 'a', type: 'alert_start' }];
    var newEvents = [{ timestamp: '2025-01-02T00:00:00Z', regionName: 'b', type: 'alert_start' }];
    var result = mergeServerEvents(newEvents, log, 100);
    assert.equal(result.added, 1);
    assert.equal(log.length, 2);
  });

  it('deduplicates events by timestamp+region+type key', function () {
    var log = [{ timestamp: '2025-01-01T00:00:00Z', regionName: 'a', type: 'alert_start' }];
    var newEvents = [{ timestamp: '2025-01-01T00:00:00Z', regionName: 'a', type: 'alert_start' }];
    var result = mergeServerEvents(newEvents, log, 100);
    assert.equal(result.added, 0);
    assert.equal(log.length, 1);
  });

  it('sorts log newest-first after merge', function () {
    var log = [{ timestamp: '2025-01-01T00:00:00Z', regionName: 'a', type: 'alert_start' }];
    var newEvents = [{ timestamp: '2025-01-03T00:00:00Z', regionName: 'b', type: 'alert_start' }];
    mergeServerEvents(newEvents, log, 100);
    assert.equal(log[0].timestamp, '2025-01-03T00:00:00Z');
  });

  it('caps log at maxLen', function () {
    var log = [];
    for (var i = 0; i < 5; i++) {
      log.push({ timestamp: '2025-01-0' + (i + 1) + 'T00:00:00Z', regionName: 'r' + i, type: 'alert_start' });
    }
    var newEvents = [{ timestamp: '2025-01-10T00:00:00Z', regionName: 'new', type: 'alert_start' }];
    mergeServerEvents(newEvents, log, 3);
    assert.equal(log.length, 3);
  });

  it('tracks latest timestamp', function () {
    var log = [];
    var newEvents = [
      { timestamp: '2025-01-01T00:00:00Z', regionName: 'a', type: 'alert_start' },
      { timestamp: '2025-01-05T00:00:00Z', regionName: 'b', type: 'alert_start' },
    ];
    var result = mergeServerEvents(newEvents, log, 100);
    assert.equal(result.latestTimestamp, '2025-01-05T00:00:00Z');
  });

  it('handles empty new events', function () {
    var log = [{ timestamp: '2025-01-01T00:00:00Z', regionName: 'a', type: 'alert_start' }];
    var result = mergeServerEvents([], log, 100);
    assert.equal(result.added, 0);
    assert.equal(log.length, 1);
  });
});

describe('createEvent', function () {
  it('creates event with correct structure', function () {
    var region = { name: 'telaviv', displayNameEn: 'Tel Aviv' };
    var event = createEvent('alert_start', region, function () { return '14:30:00'; });
    assert.equal(event.type, 'alert_start');
    assert.equal(event.regionName, 'telaviv');
    assert.equal(event.displayNameEn, 'Tel Aviv');
    assert.equal(event.israelTime, '14:30:00');
    assert.ok(event.timestamp, 'expected timestamp');
  });

  it('handles missing time function', function () {
    var region = { name: 'haifa', displayNameEn: 'Haifa' };
    var event = createEvent('alert_end', region);
    assert.equal(event.israelTime, '');
  });
});
