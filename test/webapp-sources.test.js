'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dash = require('../skills/dashboard/dashboard');
const store = require('../lib/store');

function iso(d) { return new Date(Date.now() - d * 24 * 3600 * 1000).toISOString(); }

test('searchSources lists the six no-key sources with kinds', () => {
  const names = dash.searchSources().map((s) => s.name);
  assert.deepStrictEqual(names.sort(), ['ashby', 'claude', 'greenhouse', 'lever', 'smartrecruiters', 'workable']);
  const byName = Object.fromEntries(dash.searchSources().map((s) => [s.name, s]));
  assert.strictEqual(byName.claude.kind, 'handoff');
  assert.strictEqual(byName.greenhouse.kind, 'live');
  assert.ok(byName.lever.label && byName.ashby.label);
});

test('runSearch rejects an unknown source', async () => {
  await assert.rejects(() => dash.runSearch({ source: 'bogus', title: 'X' }),
    (e) => e.status === 400 && /unknown search source/i.test(e.message));
});

test('runSearch requires a title', async () => {
  await assert.rejects(() => dash.runSearch({ source: 'greenhouse' }),
    (e) => e.status === 400);
});

/** Swap a board source's module for a fake so the live-fetch path is testable offline. */
function withFakeSource(name, fake, fn) {
  const orig = dash.SEARCH_SOURCES[name].module;
  dash.SEARCH_SOURCES[name].module = fake;
  return Promise.resolve().then(fn).finally(() => { dash.SEARCH_SOURCES[name].module = orig; });
}

test('runSearch (live board source) ingests fresh roles and reports source', async () => {
  const url = 'https://boards.greenhouse.io/faketest/jobs/' + Date.now();
  const id = 'greenhouse:' + url.toLowerCase();
  const fake = {
    fetchRoles: async () => ({
      roles: [{ id, title: 'Sales Engineer', company: 'FakeCo', location: 'NYC', url, source: 'greenhouse', created: iso(1) }],
      pages: 1, total: 1, recent: 1, stale: 0, sinceDays: 7, boards: 1, errors: [],
    }),
  };
  try {
    const out = await withFakeSource('greenhouse', fake, () => dash.runSearch({ source: 'greenhouse', title: 'Sales Engineer' }));
    assert.strictEqual(out.status, 'ingested');
    assert.strictEqual(out.source, 'greenhouse');
    assert.strictEqual(out.added, 1);
    assert.ok(store.load().roles[id], 'role saved to the store');
  } finally {
    const s = store.load(); if (s.roles[id]) { delete s.roles[id]; store.save(s); }
  }
});

test('runSearch (live board source) → no_new with a widen-window message when nothing recent', async () => {
  const fake = {
    fetchRoles: async () => ({ roles: [], pages: 3, total: 5, recent: 0, stale: 5, sinceDays: 7, boards: 3, errors: [] }),
  };
  const out = await withFakeSource('lever', fake, () => dash.runSearch({ source: 'lever', title: 'Sales Engineer' }));
  assert.strictEqual(out.status, 'no_new');
  assert.strictEqual(out.source, 'lever');
  assert.match(out.message, /posted within|board list|widen/i);
});

test('runSearch surfaces board-fetch errors without failing', async () => {
  const url = 'https://jobs.ashbyhq.com/faketest/' + Date.now();
  const id = 'ashby:' + url.toLowerCase();
  const fake = {
    fetchRoles: async () => ({
      roles: [{ id, title: 'Sales Engineer', company: 'X', location: 'NYC', url, source: 'ashby', created: iso(1) }],
      pages: 1, total: 1, recent: 1, stale: 0, sinceDays: 7, boards: 2, errors: [{ token: 'dead', error: 'Ashby HTTP 404' }],
    }),
  };
  try {
    const out = await withFakeSource('ashby', fake, () => dash.runSearch({ source: 'ashby', title: 'Sales Engineer' }));
    assert.strictEqual(out.status, 'ingested');
    assert.strictEqual(out.sourceErrors, 1);
  } finally {
    const s = store.load(); if (s.roles[id]) { delete s.roles[id]; store.save(s); }
  }
});

test('rolesPayload hides closed roles unless applied to', () => {
  const s = { roles: {
    open: { id: 'open', title: 'Sales Engineer', company: 'A', triage: 'new' },
    shut: { id: 'shut', title: 'Sales Engineer', company: 'B', triage: 'backlog', closedAt: '2026-10-20T00:00:00Z' },
    applied: { id: 'applied', title: 'Sales Engineer', company: 'C', triage: 'backlog', closedAt: '2026-10-20T00:00:00Z' },
  }, apps: { applied: { status: 'applied' } }, meta: {} };
  const ids = dash.rolesPayload(s).map((r) => r.id).sort();
  assert.deepStrictEqual(ids, ['applied', 'open']);
});
