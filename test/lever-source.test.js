'use strict';
const test = require('node:test');
const assert = require('node:assert');
const lever = require('../lib/sources/lever');

const nowMs = Date.now();
function agoMs(days) { return nowMs - days * 24 * 3600 * 1000; }

/** A Lever-shaped posting. */
function posting(o) {
  return {
    text: o.title, hostedUrl: o.url, categories: { location: o.location || '' },
    createdAt: o.createdAt, descriptionPlain: o.desc || 'Do the job.', workplaceType: o.workplaceType,
  };
}
function fakeHttp(byToken) {
  return async (url) => {
    const m = url.match(/postings\/([^?]+)\?/);
    const token = m && decodeURIComponent(m[1]);
    if (!(token in byToken)) { const e = new Error('Lever HTTP 404'); e.status = 404; throw e; }
    return byToken[token];
  };
}

test('credsPresent is true; boardUrl targets the official postings API', () => {
  assert.strictEqual(lever.credsPresent(), true);
  assert.strictEqual(lever.boardUrl('sambatv'), 'https://api.lever.co/v0/postings/sambatv?mode=json');
});

test('resolveBoards uses the bundled seed by default and env override', () => {
  const bundled = lever.resolveBoards({ env: {} });
  assert.ok(bundled.length >= 3 && bundled.some((b) => b.token === 'sambatv'));
  assert.deepStrictEqual(lever.resolveBoards({ env: { LEVER_COMPANIES: 'a,b' } }).map((b) => b.token), ['a', 'b']);
});

test('normalize maps text/hostedUrl/categories.location/createdAt(ms) and folds remote', () => {
  const r = lever.normalize(posting({ title: 'Sales Engineer', url: 'https://jobs.lever.co/acme/1', location: 'Austin, TX', createdAt: agoMs(2), workplaceType: 'remote' }), 'Acme', { title: 'Sales Engineer' });
  assert.strictEqual(r.source, 'lever');
  assert.strictEqual(r.title, 'Sales Engineer');
  assert.strictEqual(r.company, 'Acme');
  assert.strictEqual(r.location, 'Austin, TX (Remote)');
  assert.strictEqual(r.url, 'https://jobs.lever.co/acme/1');
  assert.match(r.created, /^\d{4}-\d{2}-\d{2}T/, 'epoch ms → ISO');
  assert.match(r.id, /^lever:https/);
});

test('normalize drops postings with no title or no valid URL', () => {
  assert.strictEqual(lever.normalize(posting({ title: '', url: 'https://x/1', createdAt: nowMs }), 'Acme'), null);
  assert.strictEqual(lever.normalize(posting({ title: 'X', url: '', createdAt: nowMs }), 'Acme'), null);
});

test('fetchRoles filters title/location/recency across boards, dedupes, reports the split', async () => {
  const httpGetJson = fakeHttp({
    acme: [
      posting({ title: 'Sales Engineer', url: 'https://jobs.lever.co/acme/1', location: 'New York, NY', createdAt: agoMs(2) }),   // keep
      posting({ title: 'Sales Engineer', url: 'https://jobs.lever.co/acme/2', location: 'New York, NY', createdAt: agoMs(60) }),  // stale
      posting({ title: 'Recruiter', url: 'https://jobs.lever.co/acme/3', location: 'New York, NY', createdAt: agoMs(1) }),        // title miss
    ],
    globex: [
      posting({ title: 'Senior Sales Engineer', url: 'https://jobs.lever.co/globex/9', location: 'Remote', createdAt: agoMs(1), workplaceType: 'remote' }), // keep (remote)
      posting({ title: 'Sales Engineer', url: 'https://jobs.lever.co/acme/1', location: 'NYC', createdAt: agoMs(1) }),            // dup id → skip
    ],
  });
  const res = await lever.fetchRoles({ title: 'Sales Engineer', location: 'New York City', sinceDays: 7 },
    100, { companies: ['acme', 'globex'], httpGetJson });
  assert.strictEqual(res.total, 3);
  assert.strictEqual(res.recent, 2);
  assert.strictEqual(res.stale, 1);
  assert.deepStrictEqual(res.roles.map((r) => r.url).sort(), [
    'https://jobs.lever.co/acme/1', 'https://jobs.lever.co/globex/9',
  ]);
});

test('fetchRoles records a 404 board and keeps going', async () => {
  const httpGetJson = fakeHttp({ good: [posting({ title: 'Sales Engineer', url: 'https://jobs.lever.co/good/1', location: 'NYC', createdAt: agoMs(1) })] });
  const res = await lever.fetchRoles({ title: 'Sales Engineer', location: 'NYC' }, 100, { companies: ['good', 'bad'], httpGetJson });
  assert.strictEqual(res.roles.length, 1);
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].token, 'bad');
});
