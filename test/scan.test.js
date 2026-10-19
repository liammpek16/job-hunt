'use strict';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../lib/store');
const watchlist = require('../lib/watchlist');
const { runScan } = require('../lib/scan');

const DAY = 864e5;
const NOW = new Date('2026-10-20T12:00:00Z');
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();

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

function gh(jobs) {
  return { jobs: jobs.map(([id, title, loc, posted, content = '']) => ({
    absolute_url: `https://boards.greenhouse.io/x/jobs/${id}`, title, location: { name: loc },
    first_published: posted, updated_at: NOW.toISOString(), content,
  })) };
}

test('first scan files everything as backlog; later scans mark fresh roles new', async () => {
  let boards = {
    acme: gh([[1, 'Sales Engineer', 'Boston, MA', ago(30)], [2, 'Senior Sales Engineer', 'Boston, MA', ago(1)]]),
    beta: gh([[3, 'Solutions Engineer', 'Remote - US', ago(1), '<p>6+ years of experience</p>']]),
    jobgether: gh([[9, 'Sales Engineer', 'Boston, MA', ago(1)]]),
  };
  const http = async (url) => boards[url.split('/boards/')[1].split('/')[0]];
  const s = store.emptyStore();

  const first = await runScan({ profile, wl, store: s, now: NOW, httpGetJson: http });
  assert.equal(first.boards, 2);                 // blocklisted + uncovered companies skipped
  assert.deepEqual(first.added, { new: 0, backlog: 1 });
  assert.equal(first.rejected['asks for N+ years'], 1);
  const r1 = s.roles['greenhouse:https://boards.greenhouse.io/x/jobs/1'];
  assert.equal(r1.triage, 'backlog');
  assert.equal(r1.tier, 'A');
  assert.equal(r1.posted, ago(30));              // first_published, not updated_at

  boards = {
    acme: gh([
      [1, 'Sales Engineer', 'Boston, MA', ago(30)],
      [4, 'Sales Engineer II', 'Cambridge, MA', ago(1)],
      [5, 'Solutions Engineer', 'Boston', ago(40)],   // reopened old posting → backlog
    ]),
    beta: gh([]),
  };
  const later = new Date(NOW.getTime() + DAY);
  const second = await runScan({ profile, wl, store: s, now: later, httpGetJson: http });
  assert.deepEqual(second.added, { new: 1, backlog: 1 });
  assert.equal(second.seenAgain, 1);
  assert.equal(s.roles['greenhouse:https://boards.greenhouse.io/x/jobs/4'].triage, 'new');
  assert.equal(r1.lastSeen, later.toISOString());
  assert.equal(r1.firstSeen, NOW.toISOString());
  assert.equal(s.meta.scans.length, 2);
});

test('a board that errors is reported and not marked as scanned', async () => {
  const http = async (url) => {
    if (url.includes('/beta/')) { const e = new Error('Greenhouse HTTP 500'); throw e; }
    return gh([]);
  };
  const s = store.emptyStore();
  const sum = await runScan({ profile, wl, store: s, now: NOW, httpGetJson: http });
  assert.equal(sum.scanned, 1);
  assert.equal(sum.errors.length, 1);
  assert.ok(s.meta.companiesScanned['greenhouse:acme']);
  assert.ok(!s.meta.companiesScanned['greenhouse:beta']);
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
