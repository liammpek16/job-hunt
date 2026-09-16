'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { locationMatches, titleMatches } = require('../lib/sources/board-common');

test('direct location overlap matches regardless of remote', () => {
  assert.ok(locationMatches('New York, NY', 'New York City'));
  assert.ok(locationMatches('Boston, MA; New York, NY; Remote', 'New York City'));
  assert.ok(!locationMatches('Austin, TX', 'New York City'));
  assert.ok(locationMatches('anywhere', ''), 'no query location → match all');
});

test('remote roles in the query country (US) match', () => {
  assert.ok(locationMatches('Remote - US', 'New York City'));
  assert.ok(locationMatches('Remote (United States)', 'New York City'));
  assert.ok(locationMatches('US, Remote', 'New York City'));
  assert.ok(locationMatches('Illinois, USA, Remote; Michigan, USA, Remote', 'New York City'));
  assert.ok(locationMatches('Remote - Americas', 'New York City'));
});

test('agnostic remote (global/anywhere) and unqualified remote match', () => {
  assert.ok(locationMatches('Remote', 'New York City'));
  assert.ok(locationMatches('Remote (Global)', 'New York City'));
  assert.ok(locationMatches('Worldwide - Remote', 'New York City'));
  assert.ok(locationMatches('SF (Remote)', 'New York City'), 'a US city we cannot flag foreign → keep');
});

test('remote roles in a clearly FOREIGN country are dropped for a US search (the bug)', () => {
  assert.ok(!locationMatches('United Kingdom, Remote', 'New York City'));
  assert.ok(!locationMatches('India (Remote)', 'New York City'));
  assert.ok(!locationMatches('Canada, Remote', 'New York City'));
  assert.ok(!locationMatches('Remote - EMEA', 'New York City'));
  assert.ok(!locationMatches('Remote, APAC', 'New York City'));
});

test('short country codes are matched whole-word, not as substrings', () => {
  // An unrelated US city (non-remote) must not match a New York search.
  assert.ok(!locationMatches('Houston, TX', 'New York City'));
  // "Waukesha" contains the letters "uk" (United Kingdom's code) as a substring; token
  // matching must NOT flag a US "Waukesha, WI (Remote)" role as a foreign UK posting.
  assert.ok(locationMatches('Waukesha, WI (Remote)', 'New York City'));
});

test('country param flips which remote roles are compatible', () => {
  // A UK search should keep UK-remote and drop US-remote.
  assert.ok(locationMatches('United Kingdom, Remote', 'London', 'uk'));
  assert.ok(!locationMatches('Remote - US', 'London', 'uk'));
});

test('titleMatches unaffected (regression guard)', () => {
  assert.ok(titleMatches('Senior Sales Engineer', 'sales engineer'));
  assert.ok(!titleMatches('Software Engineer', 'sales engineer'));
});
