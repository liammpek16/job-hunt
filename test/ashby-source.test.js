'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ashby = require('../lib/sources/ashby');

function iso(daysAgo) { return new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(); }

/** An Ashby-shaped job. */
function job(o) {
  return {
    title: o.title, jobUrl: o.url, location: o.location || '', isRemote: o.isRemote,
    publishedAt: o.publishedAt, descriptionPlain: o.desc || 'Do the job.', compensation: o.compensation,
  };
}
function fakeHttp(byOrg) {
  return async (url) => {
    const m = url.match(/job-board\/([^?]+)\?/);
    const org = m && decodeURIComponent(m[1]);
    if (!(org in byOrg)) { const e = new Error('Ashby HTTP 404'); e.status = 404; throw e; }
    return { jobs: byOrg[org] };
  };
}

test('credsPresent is true; boardUrl targets the official job-board API', () => {
  assert.strictEqual(ashby.credsPresent(), true);
  assert.strictEqual(ashby.boardUrl('ramp'), 'https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true');
});

test('resolveBoards uses the bundled seed by default and env override', () => {
  const bundled = ashby.resolveBoards({ env: {} });
  assert.ok(bundled.length >= 3 && bundled.some((b) => b.token === 'ramp'));
  assert.deepStrictEqual(ashby.resolveBoards({ env: { ASHBY_COMPANIES: 'a, b' } }).map((b) => b.token), ['a', 'b']);
});

test('normalize maps title/location/jobUrl/publishedAt, folds isRemote, pulls salary', () => {
  const comp = { compensationTiers: [{ components: [{ summary: 'Base Salary', minValue: 150000, maxValue: 190000 }] }] };
  const r = ashby.normalize(job({ title: 'Sales Engineer', url: 'https://jobs.ashbyhq.com/ramp/1', location: 'New York, NY', isRemote: true, publishedAt: iso(1), compensation: comp }), 'Ramp', { title: 'Sales Engineer' });
  assert.strictEqual(r.source, 'ashby');
  assert.strictEqual(r.company, 'Ramp');
  assert.strictEqual(r.location, 'New York, NY (Remote)');
  assert.strictEqual(r.salaryMin, 150000);
  assert.strictEqual(r.salaryMax, 190000);
  assert.match(r.id, /^ashby:https/);
});

test('normalize drops jobs with no title or no valid URL', () => {
  assert.strictEqual(ashby.normalize(job({ title: '', url: 'https://x/1', publishedAt: iso(1) }), 'Ramp'), null);
  assert.strictEqual(ashby.normalize(job({ title: 'X', url: '', publishedAt: iso(1) }), 'Ramp'), null);
});

test('fetchRoles filters title/location/recency across boards, dedupes, reports the split', async () => {
  const httpGetJson = fakeHttp({
    ramp: [
      job({ title: 'Sales Engineer', url: 'https://jobs.ashbyhq.com/ramp/1', location: 'New York, NY', publishedAt: iso(2) }),   // keep
      job({ title: 'Sales Engineer', url: 'https://jobs.ashbyhq.com/ramp/2', location: 'New York, NY', publishedAt: iso(45) }),  // stale
      job({ title: 'Designer', url: 'https://jobs.ashbyhq.com/ramp/3', location: 'New York, NY', publishedAt: iso(1) }),         // title miss
    ],
    notion: [
      job({ title: 'Sales Engineer', url: 'https://jobs.ashbyhq.com/notion/9', location: 'SF', isRemote: true, publishedAt: iso(3) }), // keep (remote)
      job({ title: 'Sales Engineer', url: 'https://jobs.ashbyhq.com/ramp/1', location: 'NYC', publishedAt: iso(1) }),            // dup id → skip
    ],
  });
  const res = await ashby.fetchRoles({ title: 'Sales Engineer', location: 'New York City', sinceDays: 7 },
    100, { companies: ['ramp', 'notion'], httpGetJson });
  assert.strictEqual(res.total, 3);
  assert.strictEqual(res.recent, 2);
  assert.strictEqual(res.stale, 1);
  assert.deepStrictEqual(res.roles.map((r) => r.url).sort(), [
    'https://jobs.ashbyhq.com/notion/9', 'https://jobs.ashbyhq.com/ramp/1',
  ]);
});

test('fetchRoles records a 404 board and keeps going', async () => {
  const httpGetJson = fakeHttp({ good: [job({ title: 'Sales Engineer', url: 'https://jobs.ashbyhq.com/good/1', location: 'NYC', publishedAt: iso(1) })] });
  const res = await ashby.fetchRoles({ title: 'Sales Engineer', location: 'NYC' }, 100, { companies: ['good', 'bad'], httpGetJson });
  assert.strictEqual(res.roles.length, 1);
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].token, 'bad');
});
