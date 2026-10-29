'use strict';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../lib/db');
const wd = require('../lib/sources/workday');
const { discover, titleGroups } = require('../lib/discover');
const { parseUrl } = require('../lib/intake');

const recent = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const profile = {
  titles: ['sales engineer', 'solutions engineer', 'forward deployed', 'applications engineer'], excludeTitleWords: ['senior'],
  locations: [{ query: 'New York', states: ['NY'] }], allowRemote: true, country: 'us', maxYearsRequired: 4, maxAgeDays: 7,
};

test('workday: token parsing and "Posted N Days Ago" dates', () => {
  const t = wd.parseToken('salesforce.wd12/External_Career_Site');
  assert.equal(t.api, 'https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site');
  assert.throws(() => wd.parseToken('salesforce'), /Bad Workday token/);
  const now = Date.parse('2026-10-29T12:00:00Z');
  assert.equal(wd.postedOnToDate('Posted Today', now), '2026-10-29');
  assert.equal(wd.postedOnToDate('Posted Yesterday', now), '2026-10-28');
  assert.equal(wd.postedOnToDate('Posted 3 Days Ago', now), '2026-10-26');
  assert.equal(wd.postedOnToDate('Posted 30+ Days Ago', now), null);
});

test('workday: searches each term, keeps passing titles, fetches only their details', async () => {
  const calls = [];
  const httpJson = async (method, url, body) => {
    calls.push(`${method} ${url}${body ? ' ' + body.searchText : ''}`);
    if (method === 'POST') {
      return { jobPostings: [
        { title: 'Solutions Engineer', externalPath: '/job/NY/Solutions-Engineer_R1', locationsText: '2 Locations', postedOn: 'Posted Today' },
        { title: 'Account Executive', externalPath: '/job/NY/AE_R2', locationsText: 'New York' },
      ] };
    }
    assert.match(url, /Solutions-Engineer_R1$/); // the AE posting is never fetched
    return { jobPostingInfo: { title: 'Solutions Engineer', location: 'New York, NY', additionalLocations: ['Chicago, IL'],
      startDate: recent, jobDescription: '&lt;p&gt;Run demos&lt;/p&gt;', externalUrl: 'https://acme.wd1.myworkdayjobs.com/Ext/job/NY/Solutions-Engineer_R1' } };
  };
  const res = await wd.fetchRoles({ searchTerms: ['solutions engineer', 'sales engineer'], titleOk: (t) => /engineer/i.test(t), sinceDays: 30 },
    100, { companies: [{ token: 'acme.wd1/Ext', name: 'Acme' }], httpJson, filter: () => true });
  assert.equal(calls.filter((c) => c.startsWith('POST')).length, 2); // one page per term (short page)
  assert.equal(calls.filter((c) => c.startsWith('GET')).length, 1);
  assert.equal(res.roles.length, 1);
  const r = res.roles[0];
  assert.deepEqual([r.title, r.company, r.location, r.description, r.source, r.created],
    ['Solutions Engineer', 'Acme', 'New York, NY; Chicago, IL', 'Run demos', 'workday', recent]);
  assert.equal(r.id, 'workday:https://acme.wd1.myworkdayjobs.com/ext/job/ny/solutions-engineer_r1');
});

test('intake reads Workday links (board token + requisition id)', () => {
  const p = parseUrl('https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site/job/New-York/Account-SE_JR362037');
  assert.deepEqual([p.ats, p.slug, p.jobKey, p.companyGuess], ['workday', 'salesforce.wd12/External_Career_Site', 'JR362037', 'Salesforce']);
});

test('titleGroups splits the profile into a few searches covering every title', () => {
  const g = titleGroups(profile);
  assert.ok(g.length >= 2 && g.length <= 5);
  assert.deepEqual(g.flat().sort(), [...profile.titles].sort());
});

test('discover adds only companies whose own board has a matching job now', async () => {
  const db = store.open(':memory:');
  store.setMeta(db, 'blocklist', ['Jobgether']);
  store.upsertCompany(db, { name: 'Datadog', tier: 'B', ats: 'greenhouse', slug: 'datadog' });
  const boards = { bitgo: 2, quietco: 0 };
  const res = await discover(db, profile, {
    now: new Date('2026-10-29T12:00:00Z'),
    search: async () => [
      { company: 'BitGo', title: 'Solutions Engineer', url: 'https://job-boards.greenhouse.io/bitgo/jobs/8575180002' },
      { company: 'BitGo', title: 'Sales Engineer', url: 'https://job-boards.greenhouse.io/bitgo/jobs/1' }, // same board
      { company: 'Datadog', title: 'Sales Engineer', url: 'https://job-boards.greenhouse.io/datadog/jobs/9' }, // already watched
      { company: 'QuietCo', title: 'Sales Engineer', url: 'https://jobs.lever.co/quietco/abc' }, // nothing matches now
      { company: 'Jobgether', title: 'Sales Engineer', url: 'https://jobs.lever.co/jobgether/x' },
      { company: 'Someco', title: 'Sales Engineer', url: 'https://someco.com/careers/123' }, // not an ATS
    ],
    loadSource: () => ({ fetchRoles: async (params, target, opts) => ({ roles: Array(boards[opts.companies[0].token] || 0).fill({}), errors: [] }) }),
    http: async () => ({ status: 200, json: { name: 'BitGo' } }),
  });
  assert.deepEqual(res.added.map((a) => [a.name, a.ats, a.slug, a.matches]), [['BitGo', 'greenhouse', 'bitgo', 2]]);
  assert.deepEqual(res.skipped.map((s) => s.company).sort(), ['Jobgether', 'QuietCo', 'Someco']);
  const c = store.loadWatchlist(db).companies.find((x) => x.name === 'BitGo');
  assert.deepEqual([c.tier, c.origin], ['C', 'discovery']);
  assert.equal(store.getMeta(db, 'lastDiscovery').added, 1);
});

test('POST /api/discover runs in the background and reports the result', async () => {
  const { createServer } = require('../skills/dashboard/dashboard');
  const db = store.open(':memory:');
  const server = createServer({ db, profile, getTask: async () => ({}),
    discover: async () => ({ added: [{ name: 'BitGo', matches: 2 }], candidates: 9, boards: 3, skipped: [], scan: { added: { new: 2 } } }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const start = await fetch(base + '/api/discover', { method: 'POST' });
    assert.equal(start.status, 202);
    let d;
    for (let i = 0; i < 20; i++) { d = await (await fetch(base + '/api/discover')).json(); if (d.task.state !== 'running') break; await new Promise((r) => setTimeout(r, 10)); }
    assert.equal(d.task.state, 'done');
    assert.deepEqual([d.task.result.added.length, d.task.result.newJobs], [1, 2]);
  } finally { await new Promise((r) => server.close(r)); }
});
