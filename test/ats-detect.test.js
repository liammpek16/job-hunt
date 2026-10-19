'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { slugCandidates, sameCompany, detectCompany } = require('../lib/ats-detect');

/** Fake HTTP: a map of URL → { status, json }; anything else 404s. Records calls. */
function fakeHttp(routes) {
  const calls = [];
  const http = async (url) => { calls.push(url); return routes[url] || { status: 404, json: null }; };
  http.calls = calls;
  return http;
}
const GH = (s) => `https://boards-api.greenhouse.io/v1/boards/${s}`;
const ASHBY = (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`;
const LEVER = (s) => `https://api.lever.co/v0/postings/${s}?mode=json`;
const SR = (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`;
const WK = (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`;

test('slugCandidates: full-name slugs first, then suffix-stripped ones', () => {
  const c = slugCandidates('dbt Labs');
  assert.deepEqual(c.full, ['dbtlabs', 'dbt-labs']);
  assert.ok(c.short.includes('dbt'));
  assert.deepEqual(slugCandidates('Weights & Biases').full, ['weightsandbiases', 'weights-and-biases']);
});

test('sameCompany: loose ignores suffixes; strict needs every word', () => {
  assert.ok(sameCompany('Cockroach Labs', 'Cockroach Labs Inc.'));
  assert.ok(sameCompany('Grafana Labs', 'Grafana'));
  assert.ok(!sameCompany('Hex', 'Hexagon AB'));
  assert.ok(sameCompany('S.H.I.E.L.D.', 'Shield AI'));            // loose would accept…
  assert.ok(!sameCompany('S.H.I.E.L.D.', 'Shield AI', { strict: true })); // …strict doesn't
});

test('detects a Greenhouse board whose name matches and has open jobs', async () => {
  const http = fakeHttp({
    [GH('rescale')]: { status: 200, json: { name: 'Rescale' } },
    [GH('rescale') + '/jobs']: { status: 200, json: { jobs: [{}, {}] } },
  });
  assert.deepEqual(await detectCompany({ name: 'Rescale' }, { http }), { ats: 'greenhouse', slug: 'rescale', jobs: 2 });
});

test('rejects a board whose reported name is a different company', async () => {
  const http = fakeHttp({
    [GH('shield')]: { status: 200, json: { name: 'S.H.I.E.L.D.' } },
    [GH('shield') + '/jobs']: { status: 200, json: { jobs: [{}] } },
    [LEVER('shieldai')]: { status: 200, json: [{}, {}, {}] },
  });
  assert.deepEqual(await detectCompany({ name: 'Shield AI' }, { http }), { ats: 'lever', slug: 'shieldai', jobs: 3 });
});

test('empty boards never count (stale Greenhouse board, dormant Workable account)', async () => {
  const http = fakeHttp({
    [GH('vimeo')]: { status: 200, json: { name: 'Vimeo' } },
    [GH('vimeo') + '/jobs']: { status: 200, json: { jobs: [] } },
    [WK('vimeo')]: { status: 200, json: { name: 'Vimeo', jobs: [] } },
  });
  assert.deepEqual(await detectCompany({ name: 'Vimeo' }, { http }), { ats: 'none' });
});

test('Lever/Ashby (no company name) only try full-name slugs', async () => {
  const http = fakeHttp({ [ASHBY('dbt')]: { status: 200, json: { jobs: [{}] } } });
  assert.deepEqual(await detectCompany({ name: 'dbt Labs' }, { http }), { ats: 'none' });
  assert.ok(!http.calls.includes(ASHBY('dbt')));
});

test('SmartRecruiters uses the identifier it reports; unknown ids (200, empty) are misses', async () => {
  const http = fakeHttp({
    [SR('servicenow')]: { status: 200, json: { totalFound: 0, content: [] } },
    [SR('service-now')]: { status: 200, json: { totalFound: 0, content: [] } },
    [SR('ServiceNow')]: { status: 200, json: { totalFound: 409, content: [{ company: { identifier: 'ServiceNow', name: 'ServiceNow' } }] } },
  });
  const r = await detectCompany({ name: 'ServiceNow', slugs: ['ServiceNow'] }, { http });
  assert.deepEqual(r, { ats: 'smartrecruiters', slug: 'ServiceNow', jobs: 409 });
});

test('a rate-limited probe throws so the company is left unchecked, not marked none', async () => {
  const http = fakeHttp({ [WK('nominal')]: { status: 429, json: null } });
  await assert.rejects(detectCompany({ name: 'Nominal' }, { http }), /rate-limited/);
});
