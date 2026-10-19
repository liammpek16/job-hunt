'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const store = require('../lib/db');
const { createServer } = require('../skills/dashboard/dashboard');
const { APP_JS } = require('../lib/webapp');

const profile = {
  titles: ['sales engineer', 'solutions engineer'], excludeTitleWords: ['senior'],
  locations: [{ query: 'Boston', states: ['MA'] }], allowRemote: true, country: 'us', maxYearsRequired: 4, maxAgeDays: 7,
};
const DAY = 864e5;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

function seed() {
  const db = store.open(':memory:');
  store.upsertCompany(db, { name: 'Acme', tier: 'A', ats: 'greenhouse', slug: 'acme' });
  store.upsertCompany(db, { name: 'Beta', tier: 'C', ats: 'greenhouse', slug: 'beta' });
  store.upsertCompany(db, { name: 'Nowhere', tier: 'B', ats: 'none' });
  const base = { location: 'Boston, MA', ats: 'greenhouse', source: 'greenhouse', firstSeen: iso(1) };
  store.insertJob(db, { ...base, id: 'c-old', title: 'Sales Engineer', company: 'Beta', tier: 'C', posted: iso(1), status: 'new', url: 'https://boards.greenhouse.io/beta/jobs/1' });
  store.insertJob(db, { ...base, id: 'a-old', title: 'Solutions Engineer', company: 'Acme', tier: 'A', posted: iso(5), status: 'new', url: 'https://boards.greenhouse.io/acme/jobs/2', description: '2+ years of experience' });
  store.insertJob(db, { ...base, id: 'a-new', title: 'Sales Engineer II', company: 'Acme', tier: 'A', posted: iso(0), status: 'new', url: 'https://boards.greenhouse.io/acme/jobs/3' });
  store.insertJob(db, { ...base, id: 'gone', title: 'Sales Engineer', company: 'Acme', tier: 'A', status: 'backlog', closedAt: iso(0) });
  return db;
}

function boot(db = seed()) {
  return new Promise((resolve) => {
    const server = createServer({ db, profile, getTask: async () => ({ registered: true, nextRun: '10/21/2026 7:00:00 AM' }) });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      resolve({
        db, base,
        get: (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json() })),
        post: (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
          .then(async (r) => ({ status: r.status, body: await r.json() })),
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('the client script parses (no syntax errors in the inlined JS)', () => {
  assert.doesNotThrow(() => new vm.Script(APP_JS));
});

test('GET / serves the Jobs + Companies app', async () => {
  const s = await boot();
  try {
    const html = await (await fetch(s.base + '/')).text();
    assert.match(html, /data-tab="jobs"/);
    assert.match(html, /data-tab="companies"/);
    assert.match(html, /data-view="pipeline"/);
    assert.match(html, /Paste a job link/);
  } finally { await s.close(); }
});

test('New is ranked by tier, then newest, with match chips and links', async () => {
  const s = await boot();
  try {
    const { body } = await s.get('/api/jobs?view=new');
    assert.deepEqual(body.jobs.map((j) => j.id), ['a-new', 'a-old', 'c-old']);
    const j = body.jobs[1];
    assert.deepEqual([j.chips.title, j.chips.location, j.chips.years], ['solutions engineer', 'Boston', 2]);
    assert.match(j.linkedin, /^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=Acme/);
    const closed = await s.get('/api/jobs?view=closed');
    assert.deepEqual(closed.body.jobs.map((x) => x.id), ['gone']);
    assert.equal((await s.get('/api/jobs?view=bogus')).status, 400);
  } finally { await s.close(); }
});

test('triage → interested → applied → interview, with undo', async () => {
  const s = await boot();
  try {
    assert.equal((await s.post('/api/jobs/status', { id: 'a-new', status: 'interested' })).status, 200);
    assert.equal((await s.post('/api/jobs/status', { id: 'a-new', status: 'applied' })).status, 400); // must use Applied
    const ap = await s.post('/api/jobs/applied', { id: 'a-new', resume: 'Resumes/acme.docx' });
    assert.equal(ap.body.job.status, 'applied');
    assert.ok(ap.body.job.appliedAt && ap.body.job.followUpAt);
    await s.post('/api/jobs/status', { id: 'a-new', status: 'interview' });
    const pipe = await s.get('/api/jobs?view=pipeline');
    assert.deepEqual(pipe.body.jobs.map((j) => [j.id, j.status, j.resume]), [['a-new', 'interview', 'Resumes/acme.docx']]);
    let u = await s.post('/api/jobs/undo', { id: 'a-new' });
    assert.equal(u.body.job.status, 'applied');
    u = await s.post('/api/jobs/undo', { id: 'a-new' });
    assert.equal(u.body.job.status, 'interested');
    assert.equal(u.body.job.appliedAt, null);
    const detail = await s.get('/api/job?id=a-new');
    assert.ok(detail.body.events.length >= 4);
  } finally { await s.close(); }
});

test('companies payload, tier edits and health', async () => {
  const s = await boot();
  try {
    let { body } = await s.get('/api/companies');
    const acme = body.companies.find((c) => c.name === 'Acme');
    assert.equal(acme.openMatches, 2);
    assert.equal(acme.covered, true);
    assert.equal(body.companies.find((c) => c.name === 'Nowhere').covered, false);
    assert.equal(body.coverage.covered, 2);
    assert.equal((await s.post('/api/companies/tier', { name: 'Beta', tier: 'A' })).status, 200);
    assert.equal(store.getJob(s.db, 'c-old').tier, 'A');
    assert.equal((await s.post('/api/companies/tier', { name: 'Beta', tier: 'Z' })).status, 400);
    ({ body } = await s.get('/api/health'));
    assert.equal(body.task.registered, true);
    assert.equal(body.counts.views.new, 3);
    assert.equal(body.lastFullScan, null);
  } finally { await s.close(); }
});

test('unknown routes and jobs are JSON errors', async () => {
  const s = await boot();
  try {
    assert.equal((await s.get('/api/nope')).status, 404);
    assert.equal((await s.get('/api/job?id=missing')).status, 404);
    assert.equal((await s.post('/api/jobs/undo', { id: 'c-old' })).status, 400);
    assert.equal((await s.get('/api/tailored?id=missing')).status, 404);
  } finally { await s.close(); }
});
