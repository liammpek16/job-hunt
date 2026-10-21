'use strict';
const test = require('node:test');
const assert = require('node:assert');
const gh = require('../lib/sources/greenhouse');

function iso(daysAgo) { return new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(); }

/** A greenhouse-shaped job. */
function job(o) {
  return {
    title: o.title, absolute_url: o.url, location: { name: o.location || '' },
    content: o.content || '<p>Great role</p>', updated_at: o.updated_at,
  };
}

/** A fake httpGetJson mapping board tokens → {jobs:[...]} (or throwing 404). */
function fakeHttp(byToken) {
  return async (url) => {
    const m = url.match(/boards\/([^/]+)\/jobs/);
    const token = m && decodeURIComponent(m[1]);
    if (!(token in byToken)) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
    const v = byToken[token];
    if (v instanceof Error) throw v;
    return { jobs: v };
  };
}

test('credsPresent is true — Greenhouse boards need no key', () => {
  assert.strictEqual(gh.credsPresent(), true);
});

test('boardUrl targets the official public board API', () => {
  assert.strictEqual(gh.boardUrl('datadog'), 'https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true');
});

test('resolveBoards reads opts.companies, env, then the bundled seed file', () => {
  assert.deepStrictEqual(gh.resolveBoards({ companies: ['acme'] }), [{ token: 'acme', name: 'acme' }]);
  assert.deepStrictEqual(gh.resolveBoards({ companies: [{ token: 'a', name: 'A' }] }), [{ token: 'a', name: 'A' }]);
  const viaEnv = gh.resolveBoards({ env: { GREENHOUSE_COMPANIES: 'x, y ,z' } });
  assert.deepStrictEqual(viaEnv.map((b) => b.token), ['x', 'y', 'z']);
  const bundled = gh.resolveBoards({ env: {} });
  assert.ok(bundled.length >= 5 && bundled.some((b) => b.token === 'datadog'), 'bundled seed present');
});

test('titleMatches requires every query term; locationMatches is token/remote-based', () => {
  assert.ok(gh.titleMatches('Mid-Market Sales Engineer', 'sales engineer'));
  assert.ok(!gh.titleMatches('Software Engineer', 'sales engineer'));
  assert.ok(gh.titleMatches('Anything', ''));
  assert.ok(gh.locationMatches('New York, NY', 'New York City'));
  assert.ok(gh.locationMatches('Remote - US', 'New York City'));
  assert.ok(!gh.locationMatches('Austin, TX', 'New York City'));
  assert.ok(gh.locationMatches('anywhere', ''));
});

test('normalize maps a greenhouse job to the shared shape and strips HTML', () => {
  const r = gh.normalize(job({ title: 'Sales Engineer', url: 'https://boards.greenhouse.io/acme/jobs/1', location: 'New York, NY', content: '<p>Sell <b>things</b>&nbsp;fast</p>', updated_at: iso(1) }), 'Acme', { title: 'Sales Engineer' });
  assert.strictEqual(r.source, 'greenhouse');
  assert.strictEqual(r.company, 'Acme');
  assert.strictEqual(r.location, 'New York, NY');
  assert.strictEqual(r.url, 'https://boards.greenhouse.io/acme/jobs/1');
  assert.strictEqual(r.description, 'Sell things fast');
  assert.match(r.id, /^greenhouse:https/);
});

test('normalize drops a job with no valid posting URL', () => {
  assert.strictEqual(gh.normalize(job({ title: 'X', url: '' }), 'Acme'), null);
  assert.strictEqual(gh.normalize(job({ title: '', url: 'https://x.example/1' }), 'Acme'), null);
});

test('fetchRoles filters by title/location/recency across boards, dedupes, reports the split', async () => {
  const httpGetJson = fakeHttp({
    datadog: [
      job({ title: 'Sales Engineer', url: 'https://boards.greenhouse.io/datadog/jobs/1', location: 'New York, NY', updated_at: iso(2) }),   // keep (recent)
      job({ title: 'Senior Sales Engineer', url: 'https://boards.greenhouse.io/datadog/jobs/2', location: 'New York, NY', updated_at: iso(40) }), // matched but stale
      job({ title: 'Product Manager', url: 'https://boards.greenhouse.io/datadog/jobs/3', location: 'New York, NY', updated_at: iso(1) }),   // title miss
      job({ title: 'Sales Engineer', url: 'https://boards.greenhouse.io/datadog/jobs/4', location: 'Austin, TX', updated_at: iso(1) }),      // location miss
    ],
    twilio: [
      job({ title: 'Sales Engineer', url: 'https://boards.greenhouse.io/twilio/jobs/9', location: 'Remote - US', updated_at: iso(3) }),      // keep (recent, remote)
      job({ title: 'Sales Engineer', url: 'https://boards.greenhouse.io/datadog/jobs/1', location: 'NYC', updated_at: iso(1) }),             // dup id → skip
    ],
  });
  const res = await gh.fetchRoles({ title: 'Sales Engineer', location: 'New York City', sinceDays: 7 },
    100, { companies: ['datadog', 'twilio'], httpGetJson });
  assert.strictEqual(res.boards, 2);
  assert.strictEqual(res.pages, 2, 'both boards fetched');
  assert.strictEqual(res.total, 3, 'distinct title+location matches before recency');
  assert.strictEqual(res.recent, 2);
  assert.strictEqual(res.stale, 1);
  assert.deepStrictEqual(res.roles.map((r) => r.url).sort(), [
    'https://boards.greenhouse.io/datadog/jobs/1',
    'https://boards.greenhouse.io/twilio/jobs/9',
  ]);
});

test('fetchRoles records a failed board and keeps going', async () => {
  const httpGetJson = fakeHttp({
    good: [job({ title: 'Sales Engineer', url: 'https://boards.greenhouse.io/good/jobs/1', location: 'NYC', updated_at: iso(1) })],
    // "bad" token is absent → 404
  });
  const res = await gh.fetchRoles({ title: 'Sales Engineer', location: 'NYC' }, 100,
    { companies: ['good', 'bad'], httpGetJson });
  assert.strictEqual(res.pages, 1, 'only the good board fetched');
  assert.strictEqual(res.roles.length, 1);
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].token, 'bad');
});

test('fetchRoles falls back to the bundled seed boards when none are passed', async () => {
  // No opts.companies / env → the bundled greenhouse-companies.json is the floor; every
  // board 404s under this fake, but the call still runs and reports them as errors.
  const httpGetJson = async () => { const e = new Error('HTTP 404'); e.status = 404; throw e; };
  const res = await gh.fetchRoles({ title: 'Sales Engineer', location: 'NYC' }, 100, { env: {}, httpGetJson });
  assert.ok(res.boards >= 5, 'used the bundled seed list');
  assert.strictEqual(res.roles.length, 0);
  assert.strictEqual(res.errors.length, res.boards, 'each seed board recorded as a fetch error');
});

test('entity-encoded JD HTML (as Greenhouse sends it) becomes clean text', () => {
  const { stripHtml } = require('../lib/sources/board-common');
  const enc = '&lt;div class=&quot;content&quot;&gt;&lt;p&gt;&lt;span style=&quot;font-size: 10pt&quot;&gt;Run demos &amp;amp; POCs&lt;/span&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;2+ years&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;';
  assert.strictEqual(stripHtml(enc), 'Run demos & POCs\n2+ years');
});
