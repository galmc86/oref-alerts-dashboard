'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getIsraelDateStr, getIsraelTimeStr, isRegionMatchedServer, recordEvent } = require('../lib/server-utils.js');

describe('getIsraelDateStr', function () {
  it('returns a string matching YYYY-MM-DD HH:MM:SS format', function () {
    var result = getIsraelDateStr(0);
    assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('returns an earlier time when offset is positive', function () {
    var now = getIsraelDateStr(0);
    var earlier = getIsraelDateStr(60); // 1 hour ago
    assert.ok(earlier < now, 'expected earlier < now: ' + earlier + ' vs ' + now);
  });
});

describe('getIsraelTimeStr', function () {
  it('returns a string matching HH:MM:SS format', function () {
    var result = getIsraelTimeStr();
    assert.match(result, /^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('isRegionMatchedServer', function () {
  var region = { matchPatterns: ['תל אביב'] };

  it('returns true when a city matches a pattern', function () {
    assert.ok(isRegionMatchedServer(region, ['תל אביב - יפו', 'חיפה']));
  });

  it('returns false when no city matches', function () {
    assert.ok(!isRegionMatchedServer(region, ['חיפה', 'באר שבע']));
  });

  it('returns false for empty cities array', function () {
    assert.ok(!isRegionMatchedServer(region, []));
  });

  it('returns false for empty matchPatterns', function () {
    assert.ok(!isRegionMatchedServer({ matchPatterns: [] }, ['תל אביב']));
  });

  it('matches partial city names via includes', function () {
    assert.ok(isRegionMatchedServer(region, ['אזור תל אביב מרכז']));
  });

  it('handles multiple matchPatterns (yokneam case)', function () {
    var yokneam = { matchPatterns: ['יוקנעם', 'יקנעם'] };
    assert.ok(isRegionMatchedServer(yokneam, ['יוקנעם המושבה']));
    assert.ok(isRegionMatchedServer(yokneam, ['יקנעם עילית']));
    assert.ok(!isRegionMatchedServer(yokneam, ['חיפה']));
  });
});

describe('recordEvent', function () {
  it('adds event to the front of the array', function () {
    var events = [{ type: 'old' }];
    recordEvent({ type: 'new' }, events, 100);
    assert.equal(events[0].type, 'new');
    assert.equal(events.length, 2);
  });

  it('caps array at maxLen', function () {
    var events = [];
    for (var i = 0; i < 5; i++) {
      recordEvent({ id: i }, events, 3);
    }
    assert.equal(events.length, 3);
    assert.equal(events[0].id, 4); // newest first
  });

  it('handles empty array', function () {
    var events = [];
    recordEvent({ type: 'first' }, events, 10);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'first');
  });
});
