'use strict';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../lib/db');
const li = require('../lib/sources/linkedin');
const { runLinkedInScan, buildQueries, dupKey } = require('../lib/linkedin-scan');

const NOW = new Date('2026-11-26T12:00:00Z');
const DAY = 864e5;
const day = (d) => new Date(NOW.getTime() - d * DAY).toISOString().slice(0, 10);

function card(id, title, company, location, posted, salary = '') {
  return `<li><div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:${id}">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/x-${id}?refId=abc&amp;trackingId=x"></a>
    <div class="base-search-card__info"><h3 class="base-search-card__title">
      ${title}
    </h3><h4 class="base-search-card__subtitle"><a href="#">
      ${company}
    </a></h4><div class="base-search-card__metadata"><span class="job-search-card__location">
      ${location}
    </span>${salary ? `<span class="job-search-card__salary-info">${salary}</span>` : ''}
    <time class="job-search-card__listdate" datetime="${posted}">1 day ago</time></div></div></div></li>`;
}

function detail({ jd = '<p>Great job.</p>', seniority = 'Entry level', type = 'Full-time', industry = 'Software Development', closed = false } = {}) {
  return `<div>${closed ? '<figure>No longer accepting applications</figure>' : ''}
  <div class="description__text description__text--rich"><section class="show-more-less-html" data-max-lines="5">
    <div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5 relative">${jd}</div>
    <button class="show-more-less-html__button">Show more</button></section></div>
  <ul class="description__job-criteria-list">
    <li><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">${seniority}</span></li>
    <li><h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">${type}</span></li>
    <li><h3 class="description__job-criteria-subheader">Industries</h3><span class="description__job-criteria-text">${industry}</span></li>
  </ul></div>`;
}

test('parseSearch reads cards into roles with a clean posting URL', () => {
  const roles = li.parseSearch('<!DOCTYPE html>' + card(111, 'Solutions Engineer', 'Acme &amp; Co', 'New York, NY', '2026-11-25', '$120,000.00 - $150,000.00'));
  assert.equal(roles.length, 1);
  const r = roles[0];
  assert.equal(r.id, 'linkedin:111');
  assert.equal(r.title, 'Solutions Engineer');
  assert.equal(r.company, 'Acme & Co');
  assert.equal(r.location, 'New York, NY');
  assert.equal(r.url, 'https://www.linkedin.com/jobs/view/111/');
  assert.equal(r.salaryMin, 120000);
  assert.equal(r.salaryMax, 150000);
  assert.equal(r.created.slice(0, 10), '2026-11-25');
});

test('parseDetail reads JD, criteria and closed state; parseSalary handles hourly', () => {
  const d = li.parseDetail(detail({ jd: '<p>Need 2+ years of experience.</p>', type: 'Contract', closed: true }));
  assert.match(d.description, /2\+ years of experience/);
  assert.equal(d.seniority, 'Entry level');
  assert.equal(d.employmentType, 'Contract');
  assert.equal(d.closed, true);
  assert.deepEqual(li.parseSalary('$50/hr - $60/hr'), { min: 104000, max: 124800 });
});

test('searchUrl sets remote and recency filters', () => {
  const u = new URL(li.searchUrl({ keywords: 'sales engineer', location: 'United States', remote: true, sinceDays: 7, start: 20 }));
  assert.equal(u.searchParams.get('f_WT'), '2');
  assert.equal(u.searchParams.get('f_TPR'), 'r604800');
  assert.equal(u.searchParams.get('start'), '20');
});

const profile = {
  titles: ['sales engineer', 'solutions engineer'], excludeTitleWords: ['senior'],
  locations: [{ query: 'New York', states: ['NY'] }], allowRemote: true, country: 'us',
  maxYearsRequired: 4, maxAgeDays: 7,
  linkedin: { locations: ['New York City Metropolitan Area'], pagesPerQuery: 2, delayMs: 0 },
};

test('buildQueries: one per title per location plus US-remote', () => {
  const q = buildQueries(profile);
  assert.equal(q.length, 4);
  assert.deepEqual(q[1], { keywords: 'sales engineer', location: 'United States', remote: true });
});

test('runLinkedInScan filters, dedupes against board jobs, and files new jobs', async () => {
  const db = store.open(':memory:');
  store.setMeta(db, 'blocklist', ['Jobgether']);
  store.upsertCompany(db, { name: 'Acme', tier: 'A', ats: 'greenhouse', slug: 'acme' });
  // Already found on Acme's own board: the LinkedIn copy is skipped.
  store.insertJob(db, { id: 'greenhouse:x', title: 'Solutions Engineer', company: 'Acme', location: 'New York, NY', source: 'greenhouse', ats: 'greenhouse', status: 'new' });

  const search = card(1, 'Sales Engineer', 'Acme Inc.', 'New York, NY', day(1))
    + card(2, 'Solutions Engineer', 'Acme', 'New York, NY', day(1))          // dup of board job
    + card(3, 'Senior Sales Engineer', 'Beta', 'New York, NY', day(1))       // excluded title
    + card(4, 'Sales Engineer', 'Gamma', 'Austin, TX', day(1))               // wrong location
    + card(5, 'Sales Engineer', 'Delta', 'United States', day(20))           // remote, old → backlog
    + card(6, 'Sales Engineer', 'Recruiters R Us', 'New York, NY', day(1))   // staffing agency
    + card(7, 'Sales Engineer', 'Epsilon', 'New York, NY', day(1))           // contract
    + card(8, 'Sales Engineer', 'Zeta', 'New York, NY', day(1))              // 7+ years
    + card(9, 'Sales Engineer', 'Jobgether', 'New York, NY', day(1));        // blocklisted
  const details = {
    1: detail(), 5: detail(), 6: detail({ industry: 'Staffing and Recruiting' }),
    7: detail({ type: 'Contract' }), 8: detail({ jd: '<p>7+ years of experience in sales</p>' }), 9: detail(),
  };
  const fetched = [];
  const http = async (url) => {
    fetched.push(url);
    if (url.includes('/jobPosting/')) return details[url.split('/').pop()];
    const u = new URL(url);
    // Remote searches return card 5 only; NYC page 1 returns everything; later pages are empty.
    if (u.searchParams.get('start') !== '0') return '';
    return u.searchParams.get('f_WT') ? card(5, 'Sales Engineer', 'Delta', 'United States', day(20)) : search;
  };

  const sum = await runLinkedInScan({ profile, db, now: NOW, httpGetText: http, sleep: async () => {} });
  assert.equal(sum.searches, 4);
  assert.equal(sum.duplicates, 1);
  assert.deepEqual(sum.added, { new: 1, backlog: 1 });
  assert.equal(sum.rejected['staffing agency'], 1);
  assert.equal(sum.rejected['employment type contract'], 1);
  assert.equal(sum.rejected['asks for N+ years'], 1);
  assert.equal(sum.rejected['blocklisted company'], 1);
  assert.ok(!fetched.some((u) => /jobPosting\/(2|3|4)$/.test(u)), 'no JD fetched for dupes or filtered roles');

  const j1 = store.getJob(db, 'linkedin:1');
  assert.equal(j1.status, 'new');
  assert.equal(j1.tier, 'A');                    // "Acme Inc." matched the watchlist's Acme
  assert.equal(j1.ats, 'linkedin');
  assert.equal(j1.url, 'https://www.linkedin.com/jobs/view/1/');
  assert.equal(store.getJob(db, 'linkedin:5').status, 'backlog');
  assert.equal(store.getJob(db, 'linkedin:5').location, 'United States (Remote)'); // tagged once, not per search

  // A later run: job 1 now says it's closed (its JD is stored, so the page isn't refetched →
  // stays open); job 5 vanishes and goes stale after staleDays.
  const later = new Date(NOW.getTime() + 30 * DAY);
  const sum2 = await runLinkedInScan({ profile, db, now: later, sleep: async () => {},
    httpGetText: async (url) => (url.includes('/jobPosting/') ? detail() : (new URL(url).searchParams.get('start') === '0' && !url.includes('f_WT') ? card(1, 'Sales Engineer', 'Acme Inc.', 'New York, NY', day(1)) : '')) });
  assert.equal(sum2.seenAgain, 1);
  assert.equal(store.getJob(db, 'linkedin:1').closedAt, null);
  assert.ok(store.getJob(db, 'linkedin:5').closedAt, 'stale LinkedIn job closed');
});

test('a 429 ends the run early without throwing', async () => {
  const db = store.open(':memory:');
  store.setMeta(db, 'blocklist', []);
  const sum = await runLinkedInScan({ profile, db, now: NOW, sleep: async () => {},
    httpGetText: async () => { const e = new Error('LinkedIn HTTP 429'); e.status = 429; throw e; } });
  assert.equal(sum.rateLimited, true);
  assert.equal(sum.requests, 2); // one try + one backoff retry, then stop
});

test('dupKey ignores company suffixes and title punctuation', () => {
  assert.equal(dupKey('Acme, Inc.', 'Solutions Engineer (NYC)'), dupKey('Acme', 'solutions engineer nyc'));
});
