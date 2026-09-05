'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { aggregate, renderHtml, renderTerminal } = require('../lib/dashboard');
const store = require('../lib/store');

function seed() {
  const s = store.emptyStore();
  store.addRoles(s, [
    { id: 'a:1', title: 'SWE', company: 'Acme', location: 'Remote', url: 'https://x/1' },
    { id: 'a:2', title: 'Backend Eng', company: 'Beta', location: 'NYC', url: 'https://x/2' },
    { id: 'a:3', title: 'Platform Eng', company: 'Gamma', location: 'SF' },
    { id: 'a:4', title: 'Infra', company: 'Delta', location: 'Remote' },
  ]);
  store.setStatus(s, 'a:1', 'applied');
  store.setStatus(s, 'a:2', 'applied');
  store.addInterview(s, 'a:2', { kind: 'phone screen' }); // -> interviewing
  store.setStatus(s, 'a:3', 'offer');
  // a:4 stays saved
  return s;
}

test('aggregate counts each status and monotonic funnel', () => {
  const agg = aggregate(seed());
  assert.strictEqual(agg.totals.roles, 4);
  assert.strictEqual(agg.totals.saved, 1);
  assert.strictEqual(agg.totals.applied, 1);       // a:1
  assert.strictEqual(agg.totals.interviewing, 1);  // a:2
  assert.strictEqual(agg.totals.offer, 1);         // a:3
  assert.strictEqual(agg.totals.interviews, 1);
  // Funnel is monotonic: Sourced >= Applied >= Interviewing >= Offer
  const counts = agg.funnel.map((f) => f.count);
  assert.deepStrictEqual(counts, [4, 3, 2, 1]);
});

test('rows sorted furthest-along first', () => {
  const agg = aggregate(seed());
  assert.strictEqual(agg.rows[0].status, 'offer', 'offer first');
  assert.strictEqual(agg.rows[agg.rows.length - 1].status, 'saved', 'saved last (no rejected in seed)');
});

test('renderHtml is self-contained and escapes user data', () => {
  const s = store.emptyStore();
  store.addRoles(s, [{ id: 'x:1', title: '<script>alert(1)</script>', company: 'A & B', url: 'https://x' }]);
  const html = renderHtml(s.roles ? aggregate(s) : null);
  assert.match(html, /<!doctype html>/i);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'title is escaped');
  assert.match(html, /&lt;script&gt;/, 'escaped form present');
  assert.match(html, /A &amp; B/, 'ampersand escaped');
});

test('empty store renders without crashing and shows the empty state', () => {
  const agg = aggregate(store.emptyStore());
  assert.strictEqual(agg.totals.roles, 0);
  const html = renderHtml(agg);
  assert.match(html, /No roles yet/);
  assert.match(renderTerminal(agg), /Sourced 0/);
});

test('terminal summary reports the funnel', () => {
  const out = renderTerminal(aggregate(seed()));
  assert.match(out, /Applied 3/);
  assert.match(out, /Interviews logged: 1/);
});
