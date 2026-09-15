'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const claude = require('../lib/sources/claude');
const store = require('../lib/store');
const { runSearch } = require('../skills/dashboard/dashboard');

// A throwaway search slug that will not collide with real saved roles.
const PARAMS = { title: 'ZZ Recency Test Engineer', location: 'Nowhere Test City' };
function iso(daysAgo) { return new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(); }

/** Remove any request/results/archived files this test wrote in the real data dir. */
function cleanupFiles() {
  const dir = path.dirname(claude.resultsPath(PARAMS));
  const slug = claude.slugFor(PARAMS);
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`claude-search-${slug}.`)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  }
}

test('runSearch → no_new when only stale postings come back (tells user to expand criteria)', async () => {
  cleanupFiles();
  try {
    // Plant a results file with only an OLD posting → 0 recent → 0 added, store untouched.
    fs.writeFileSync(claude.resultsPath(PARAMS),
      JSON.stringify([{ title: 'Old Role', company: 'Stale Co', url: 'https://stale.example/zz-old', created: iso(45) }]));
    const before = JSON.stringify(store.load());
    const out = await runSearch(PARAMS);
    assert.strictEqual(out.status, 'no_new');
    assert.strictEqual(out.added, 0);
    assert.strictEqual(out.recent, 0);
    assert.strictEqual(out.sinceDays, 7);
    assert.match(out.message, /expand/i);
    assert.match(out.message, /7 days/);
    assert.strictEqual(JSON.stringify(store.load()), before, 'store is unchanged on a no_new search');
    // the results file was consumed (archived aside) so the next run re-searches
    assert.ok(!fs.existsSync(claude.resultsPath(PARAMS)), 'results file consumed');
  } finally { cleanupFiles(); }
});

test('runSearch → ingested for a fresh posting, then consumes the results file', async () => {
  cleanupFiles();
  const url = 'https://fresh.example/zz-recency-' + Date.now();
  const id = 'claude:' + url.toLowerCase();
  try {
    fs.writeFileSync(claude.resultsPath(PARAMS),
      JSON.stringify([{ title: 'Fresh Role', company: 'New Co', url, created: iso(1) }]));
    const out = await runSearch(PARAMS);
    assert.strictEqual(out.status, 'ingested');
    assert.strictEqual(out.added, 1);
    assert.strictEqual(out.recent, 1);
    assert.strictEqual(out.sinceDays, 7);
    assert.ok(!fs.existsSync(claude.resultsPath(PARAMS)), 'results file consumed after ingest');
    assert.ok(store.load().roles[id], 'the fresh role was saved');
  } finally {
    // restore the store to its prior content (remove only our throwaway role)
    const s = store.load();
    if (s.roles[id]) { delete s.roles[id]; store.save(s); }
    cleanupFiles();
  }
});

test('a second run with no results file re-enters the handoff (fresh search, not a re-ingest)', async () => {
  cleanupFiles();
  try {
    const out = await runSearch(PARAMS); // no results file present
    assert.strictEqual(out.status, 'handoff');
    assert.match(out.prompt, /last 7 days/i);
  } finally { cleanupFiles(); }
});
