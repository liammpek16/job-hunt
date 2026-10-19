'use strict';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../lib/db');
const { parseUrl, intake, addCompany, intakeStats } = require('../lib/intake');

const NOW = new Date('2026-10-20T12:00:00Z');
const profile = { titles: ['sales engineer'], excludeTitleWords: [], locations: [], allowRemote: true, country: 'us', maxYearsRequired: null, maxAgeDays: 7 };

test('parseUrl reads ATS links, LinkedIn slugs and careers domains without fetching', () => {
  assert.deepEqual(
    (({ ats, slug, jobKey }) => ({ ats, slug, jobKey }))(parseUrl('https://job-boards.greenhouse.io/braze/jobs/8201757')),
    { ats: 'greenhouse', slug: 'braze', jobKey: '8201757' });
  const lv = parseUrl('https://jobs.lever.co/shieldai/2d9d1774-48f1');
  assert.equal(lv.ats, 'lever'); assert.equal(lv.slug, 'shieldai');
  const sr = parseUrl('https://jobs.smartrecruiters.com/ServiceNow/744000154154044-forward-deployed');
  assert.equal(sr.slug, 'ServiceNow'); assert.equal(sr.jobKey, '744000154154044');
  const wk = parseUrl('https://apply.workable.com/huggingface/j/81B46579FE/');
  assert.equal(wk.ats, 'workable'); assert.equal(wk.slug, 'huggingface'); assert.equal(wk.jobKey, '81B46579FE');
  const li = parseUrl('https://www.linkedin.com/jobs/view/sales-engineer-at-acme-robotics-4012345678/');
  assert.ok(li.linkedin); assert.equal(li.companyGuess, 'Acme Robotics'); assert.equal(li.titleGuess, 'sales engineer');
  const dd = parseUrl('https://careers.datadoghq.com/detail/7762722/?gh_jid=7762722');
  assert.equal(dd.ats, 'greenhouse'); assert.equal(dd.jobKey, '7762722'); assert.equal(dd.companyGuess, 'Datadog');
  assert.ok(parseUrl('not a url').error);
});

function db0() {
  const db = store.open(':memory:');
  store.setMeta(db, 'blocklist', ['Jobgether']);
  store.upsertCompany(db, { name: 'Braze', tier: 'B', ats: 'greenhouse', slug: 'braze' });
  store.insertJob(db, { id: 'greenhouse:https://job-boards.greenhouse.io/braze/jobs/8201757', title: 'Solutions Consultant', company: 'Braze',
    url: 'https://job-boards.greenhouse.io/braze/jobs/8201757', ats: 'greenhouse', status: 'backlog' });
  return db;
}

test('a posting we already had counts toward coverage; nothing new is added', async () => {
  const db = db0();
  let scanned = null;
  const r = await intake(db, { url: 'https://job-boards.greenhouse.io/braze/jobs/8201757' },
    { profile, now: NOW, scan: async (o) => { scanned = o.only; return {}; } });
  assert.equal(r.had, true);
  assert.equal(r.added, false);
  assert.deepEqual(scanned, ['Braze']);
  assert.deepEqual(intakeStats(db), { total: 1, had: 1, pct: 100 });
});

test('an ATS link for an unwatched company adds it straight from the URL and scans it', async () => {
  const db = db0();
  let detectCalled = false;
  const r = await intake(db, { url: 'https://jobs.ashbyhq.com/acme/1234-5678', tier: 'A' }, {
    profile, now: NOW, detect: async () => { detectCalled = true; return { ats: 'none' }; },
    scan: async ({ db: d }) => {
      store.insertJob(d, { id: 'ashby:https://jobs.ashbyhq.com/acme/1234-5678', title: 'Sales Engineer', company: 'Acme',
        url: 'https://jobs.ashbyhq.com/acme/1234-5678', ats: 'ashby', status: 'backlog' });
      return {};
    },
  });
  assert.equal(detectCalled, false);
  assert.equal(r.added, true);
  assert.equal(r.had, false);
  assert.equal(r.jobId, 'ashby:https://jobs.ashbyhq.com/acme/1234-5678');
  const c = store.loadWatchlist(db).companies.find((x) => x.name === 'Acme');
  assert.deepEqual([c.ats, c.slug, c.tier, c.origin], ['ashby', 'acme', 'A', 'intake']);
  assert.deepEqual(intakeStats(db), { total: 1, had: 0, pct: 0 });
});

test('a LinkedIn link is never fetched: company from the slug, board auto-detected', async () => {
  const db = db0();
  const r = await intake(db, { url: 'https://www.linkedin.com/jobs/view/sales-engineer-at-rescale-4012345678/' }, {
    profile, now: NOW,
    detect: async (c) => { assert.equal(c.name, 'Rescale'); return { ats: 'greenhouse', slug: 'rescale', jobs: 17, name: 'ReScale' }; },
    scan: async () => ({}),
  });
  assert.equal(r.company, 'ReScale'); // the board's own spelling wins over the URL guess
  assert.equal(r.covered, true);
  assert.match(r.message, /Added ReScale/);
  const [e] = store.events(db, { kind: 'intake' });
  assert.equal(e.data.linkedin, true);
});

test('blocklisted companies and unreadable links are refused', async () => {
  const db = db0();
  await assert.rejects(intake(db, { url: 'https://jobs.lever.co/jobgether/abc' }, { now: NOW }), /blocklist/);
  await assert.rejects(intake(db, { url: 'nope' }, { now: NOW }), /valid URL/);
});

test('addCompany detects the board and refuses duplicates', async () => {
  const db = db0();
  const r = await addCompany(db, { name: 'Formlabs', tier: 'A' },
    { profile, now: NOW, detect: async () => ({ ats: 'greenhouse', slug: 'formlabs', jobs: 247 }), scan: async () => ({ added: { new: 0, backlog: 2 } }) });
  assert.match(r.message, /247 open jobs, 2 match/);
  await assert.rejects(addCompany(db, { name: 'formlabs' }, { now: NOW }), /already on the watchlist/);
});
