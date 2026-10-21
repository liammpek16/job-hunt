'use strict';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../lib/db');
const watchlist = require('../lib/watchlist');
const { runScan } = require('../lib/scan');

const DAY = 864e5;
const NOW = new Date('2026-10-20T12:00:00Z');
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const later = (d) => new Date(NOW.getTime() + d * DAY);

const profile = {
  titles: ['sales engineer', 'solutions engineer'], excludeTitleWords: ['senior'],
  locations: [{ query: 'Boston', states: ['MA'] }], allowRemote: true, country: 'us',
  maxYearsRequired: 4, maxAgeDays: 7,
};
const wl = {
  blocklist: ['Jobgether'],
  companies: [
    { name: 'Acme', tier: 'A', ats: 'greenhouse', slug: 'acme' },
    { name: 'Beta', tier: 'B', ats: 'greenhouse', slug: 'beta' },
    { name: 'Jobgether', tier: 'C', ats: 'greenhouse', slug: 'jobgether' },
    { name: 'Gone', tier: 'C', ats: 'none' },
  ],
};

function newDb() {
  const db = store.open(':memory:');
  store.setMeta(db, 'blocklist', wl.blocklist);
  for (const c of wl.companies) store.upsertCompany(db, c);
  return db;
}

function gh(jobs) {
  return { jobs: jobs.map(([id, title, loc, posted, content = '']) => ({
    absolute_url: `https://boards.greenhouse.io/x/jobs/${id}`, title, location: { name: loc },
    first_published: posted, updated_at: NOW.toISOString(), content,
  })) };
}
const jid = (n) => `greenhouse:https://boards.greenhouse.io/x/jobs/${n}`;

test('first scan files everything as backlog; later scans mark fresh roles new', async () => {
  let boards = {
    acme: gh([[1, 'Sales Engineer', 'Boston, MA', ago(30)], [2, 'Senior Sales Engineer', 'Boston, MA', ago(1)]]),
    beta: gh([[3, 'Solutions Engineer', 'Remote - US', ago(1), '<p>6+ years of experience</p>']]),
    jobgether: gh([[9, 'Sales Engineer', 'Boston, MA', ago(1)]]),
  };
  const http = async (url) => boards[url.split('/boards/')[1].split('/')[0]];
  const db = newDb();

  const first = await runScan({ profile, db, now: NOW, httpGetJson: http });
  assert.equal(first.boards, 2);                 // blocklisted + uncovered companies skipped
  assert.deepEqual(first.added, { new: 0, backlog: 1 });
  assert.equal(first.rejected['asks for N+ years'], 1);
  const r1 = store.getJob(db, jid(1));
  assert.equal(r1.status, 'backlog');
  assert.equal(r1.tier, 'A');
  assert.equal(r1.board, 'greenhouse:acme');
  assert.equal(r1.posted, ago(30));              // first_published, not updated_at

  boards = {
    acme: gh([
      [1, 'Sales Engineer', 'Boston, MA', ago(30)],
      [4, 'Sales Engineer II', 'Cambridge, MA', ago(1)],
      [5, 'Solutions Engineer', 'Boston', ago(40)],   // reopened old posting → backlog
    ]),
    beta: gh([]),
  };
  const second = await runScan({ profile, db, now: later(1), httpGetJson: http });
  assert.deepEqual(second.added, { new: 1, backlog: 1 });
  assert.equal(second.seenAgain, 1);
  assert.equal(store.getJob(db, jid(4)).status, 'new');
  assert.equal(store.getJob(db, jid(1)).lastSeen, later(1).toISOString());
  assert.equal(store.getJob(db, jid(1)).firstSeen, NOW.toISOString());
  assert.equal(store.getMeta(db, 'scans').length, 2);
  assert.equal(store.getMeta(db, 'boardsLastScanned')['greenhouse:acme'], later(1).toISOString());
});

test('a board that errors is reported and not marked as scanned', async () => {
  const http = async (url) => {
    if (url.includes('/beta/')) throw new Error('Greenhouse HTTP 500');
    return gh([]);
  };
  const db = newDb();
  const sum = await runScan({ profile, db, now: NOW, httpGetJson: http });
  assert.equal(sum.scanned, 1);
  assert.equal(sum.errors.length, 1);
  const scanned = store.getMeta(db, 'companiesScanned');
  assert.ok(scanned['greenhouse:acme']);
  assert.ok(!scanned['greenhouse:beta']);
});

test('`only` limits the scan to the named companies', async () => {
  const seen = [];
  const http = async (url) => { seen.push(url); return gh([]); };
  const sum = await runScan({ profile, db: newDb(), now: NOW, httpGetJson: http, only: ['beta'] });
  assert.equal(sum.boards, 1);
  assert.ok(seen.every((u) => u.includes('/beta/')));
});

test('watchlist helpers: blocklist, grouping, coverage', () => {
  assert.ok(watchlist.isBlocked('JobGether', wl));
  assert.ok(!watchlist.isBlocked('Acme', wl));
  const by = watchlist.boardsByAts(wl);
  assert.deepEqual(by.greenhouse.map((b) => b.token), ['acme', 'beta']);
  assert.deepEqual(watchlist.coverage(wl), {
    companies: 3, covered: 2, notCovered: 1, unchecked: 0,
    byAts: { greenhouse: 2, ashby: 0, lever: 0, workable: 0, smartrecruiters: 0 },
  });
});

test('jobs a board stops listing are closed, and reopened if they come back', async () => {
  const one = gh([[1, 'Sales Engineer', 'Boston, MA', ago(1)], [2, 'Solutions Engineer', 'Boston, MA', ago(1)]]);
  let acme = one;
  const http = async (url) => (url.includes('/acme/') ? acme : gh([[7, 'Account Executive', 'Boston, MA', ago(1)]]));
  const db = newDb();
  await runScan({ profile, db, now: NOW, httpGetJson: http });

  acme = gh([[1, 'Sales Engineer', 'Boston, MA', ago(1)], [8, 'Recruiter', 'Boston, MA', ago(1)]]);
  const sum2 = await runScan({ profile, db, now: later(1), httpGetJson: http });
  assert.equal(sum2.closed, 1);
  assert.equal(store.getJob(db, jid(2)).closedAt, later(1).toISOString());
  assert.equal(store.viewOf(store.getJob(db, jid(2))), 'closed');
  assert.ok(!store.getJob(db, jid(1)).closedAt);
  assert.equal(store.events(db, { jobId: jid(2), kind: 'closed' }).length, 1);

  // Still on the board but no longer matching the profile → NOT closed.
  const sum3 = await runScan({ profile: { ...profile, titles: ['solutions engineer'] }, db, now: later(1), httpGetJson: http });
  assert.equal(sum3.closed, 0);

  acme = one;
  const sum4 = await runScan({ profile, db, now: later(1), httpGetJson: http });
  assert.equal(sum4.reopened, 1);
  assert.ok(!store.getJob(db, jid(2)).closedAt);
});

test('a board that suddenly returns nothing closes nothing (treated as a glitch)', async () => {
  let acme = gh([[1, 'Sales Engineer', 'Boston, MA', ago(1)]]);
  const http = async (url) => (url.includes('/acme/') ? acme : gh([]));
  const db = newDb();
  await runScan({ profile, db, now: NOW, httpGetJson: http });
  acme = gh([]);
  const sum = await runScan({ profile, db, now: NOW, httpGetJson: http });
  assert.equal(sum.closed, 0);
  assert.ok(sum.errors.some((e) => e.token === 'acme' && /no postings/.test(e.error)));
});
