'use strict';
const test = require('node:test');
const assert = require('node:assert');
const adzuna = require('../lib/sources/adzuna');
const store = require('../lib/store');

const CREDS = { ADZUNA_APP_ID: 'x', ADZUNA_APP_KEY: 'y' };

// Build a fake Adzuna page of `n` results starting at index `start`.
function fakePage(n, start) {
  return {
    count: 250,
    results: Array.from({ length: n }, (_, i) => ({
      id: String(start + i),
      title: 'Software Engineer',
      company: { display_name: `Co ${(start + i) % 7}` },
      location: { display_name: 'Remote, US' },
      salary_min: 120000,
      salary_max: 160000,
      redirect_url: `https://example.com/${start + i}`,
      description: 'Build things.',
      created: '2026-09-01T00:00:00Z',
    })),
  };
}

test('fetchRoles paginates to reach the target of 100 (2 pages of 50)', async () => {
  let calls = 0;
  const httpGetJson = async (url) => {
    calls++;
    const page = Number(url.match(/\/search\/(\d+)\?/)[1]);
    return fakePage(50, (page - 1) * 50);
  };
  const { roles, pages } = await adzuna.fetchRoles({ title: 'SWE' }, 100, { httpGetJson, env: CREDS });
  assert.strictEqual(roles.length, 100);
  assert.strictEqual(pages, 2);
  assert.strictEqual(calls, 2);
});

test('fetchRoles stops when results run out (no infinite loop)', async () => {
  const httpGetJson = async (url) => {
    const page = Number(url.match(/\/search\/(\d+)\?/)[1]);
    return page === 1 ? fakePage(30, 0) : { count: 30, results: [] };
  };
  const { roles } = await adzuna.fetchRoles({ title: 'SWE' }, 100, { httpGetJson, env: CREDS });
  assert.strictEqual(roles.length, 30, 'returns what exists, not padded to target');
});

test('normalize maps Adzuna shape to the shared role shape', () => {
  const r = adzuna.normalize(fakePage(1, 0).results[0], { title: 'SWE', location: 'Remote' });
  assert.strictEqual(r.id, 'adzuna:0');
  assert.strictEqual(r.company, 'Co 0');
  assert.strictEqual(r.salaryMin, 120000);
  assert.strictEqual(r.source, 'adzuna');
  assert.strictEqual(r.url, 'https://example.com/0');
});

test('missing credentials throws NO_CREDS (not a network call)', async () => {
  await assert.rejects(
    () => adzuna.fetchRoles({ title: 'SWE' }, 10, { env: {}, httpGetJson: async () => ({}) }),
    (e) => e.code === 'NO_CREDS'
  );
});

test('buildUrl includes filters and never leaks creds into the path', () => {
  const url = adzuna.buildUrl({ title: 'Data Scientist', location: 'NYC', salaryMin: 100000, country: 'us' }, 1,
    { app_id: 'ID', app_key: 'KEY' });
  assert.match(url, /\/jobs\/us\/search\/1\?/);
  assert.match(url, /what=Data\+Scientist/);
  assert.match(url, /where=NYC/);
  assert.match(url, /salary_min=100000/);
  assert.match(url, /app_id=ID/); // creds are query params (Adzuna's scheme), not path
});

test('store: addRoles dedups by id; setStatus + interview advance correctly', () => {
  const s = store.emptyStore();
  const roles = [adzuna.normalize(fakePage(1, 0).results[0], {}), adzuna.normalize(fakePage(1, 0).results[0], {})];
  const { added, skipped } = store.addRoles(s, roles);
  assert.strictEqual(added, 1);
  assert.strictEqual(skipped, 1, 'duplicate id skipped');

  store.setStatus(s, 'adzuna:0', 'applied');
  assert.strictEqual(s.apps['adzuna:0'].status, 'applied');
  assert.ok(s.apps['adzuna:0'].appliedAt, 'appliedAt stamped');

  store.addInterview(s, 'adzuna:0', { kind: 'phone screen' });
  assert.strictEqual(s.apps['adzuna:0'].status, 'interviewing');
  assert.strictEqual(s.apps['adzuna:0'].interviews.length, 1);
});

test('store: setStatus rejects unknown status and unknown id', () => {
  const s = store.emptyStore();
  s.roles['adzuna:1'] = { id: 'adzuna:1' };
  assert.throws(() => store.setStatus(s, 'adzuna:1', 'ghosted'), /Unknown status/);
  assert.throws(() => store.setStatus(s, 'nope', 'applied'), /No role/);
});
