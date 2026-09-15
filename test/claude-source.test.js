'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const claude = require('../lib/sources/claude');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-src-'));
}

/** ISO date `n` days ago (default: today) — for building "recent" fixtures. */
function daysAgoIso(n = 0) {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}

test('credsPresent is always true — no API key needed (runs on the subscription)', () => {
  assert.strictEqual(claude.credsPresent(), true);
  assert.strictEqual(claude.credsPresent({}), true);
});

test('phase 1: no results file → writes a request spec and throws HANDOFF_PENDING', async () => {
  const dir = tmpDir();
  const params = { title: 'Sales Engineer', location: 'New York City' };
  await assert.rejects(
    () => claude.fetchRoles(params, 100, { dataDir: dir }),
    (e) => {
      assert.strictEqual(e.code, 'HANDOFF_PENDING');
      assert.match(e.prompt, /Sales Engineer/);
      assert.match(e.prompt, /New York City/);
      assert.match(e.prompt, /at least 100/);
      return true;
    }
  );
  const reqFile = claude.requestPath(params, { dataDir: dir });
  assert.ok(fs.existsSync(reqFile), 'request spec written');
  const spec = JSON.parse(fs.readFileSync(reqFile, 'utf8'));
  assert.strictEqual(spec.title, 'Sales Engineer');
  assert.strictEqual(spec.target, 100);
});

test('phase 2: ingests a results array, normalizing to the shared shape (source=claude)', async () => {
  const dir = tmpDir();
  const params = { title: 'Sales Engineer', location: 'New York City' };
  const results = claude.resultsPath(params, { dataDir: dir });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(results, JSON.stringify([
    { title: 'Sales Engineer', company: 'Acme', location: 'New York, NY', salaryMin: 130000, url: 'https://acme.example/1', description: 'Sell.', created: daysAgoIso(1) },
    { title: 'Senior Sales Engineer', company: 'Globex', location: 'NYC', salary_min: '150000', url: 'https://globex.example/2', created: daysAgoIso(2) },
  ]));
  const { roles, pages, total } = await claude.fetchRoles(params, 100, { dataDir: dir });
  assert.strictEqual(pages, 1);
  assert.strictEqual(total, 2);
  assert.strictEqual(roles[0].source, 'claude');
  assert.strictEqual(roles[0].salaryMin, 130000);
  assert.strictEqual(roles[1].salaryMin, 150000, 'accepts salary_min alias, coerced to number');
  assert.ok(roles[0].id.length > 0);
});

test('phase 2: also accepts { roles: [...] } wrapper', async () => {
  const dir = tmpDir();
  const params = { title: 'X', location: 'Y' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claude.resultsPath(params, { dataDir: dir }),
    JSON.stringify({ roles: [{ title: 'X', company: 'C', url: 'https://c.example/x', created: daysAgoIso(1) }] }));
  const { roles } = await claude.fetchRoles(params, 100, { dataDir: dir });
  assert.strictEqual(roles.length, 1);
});

test('dedupes by id and drops title-less junk', async () => {
  const dir = tmpDir();
  const params = { title: 'X', location: 'Y' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claude.resultsPath(params, { dataDir: dir }), JSON.stringify([
    { title: 'Dup', company: 'C', url: 'https://c.example/dup', created: daysAgoIso(1) },
    { title: 'Dup', company: 'C', url: 'https://c.example/dup', created: daysAgoIso(1) }, // same url → same id
    { company: 'NoTitle', url: 'https://c.example/none', created: daysAgoIso(1) },        // no title → dropped
  ]));
  const { roles } = await claude.fetchRoles(params, 100, { dataDir: dir });
  assert.strictEqual(roles.length, 1);
});

test('bad JSON in results file → BAD_RESULTS (never silently 0 roles)', async () => {
  const dir = tmpDir();
  const params = { title: 'X', location: 'Y' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claude.resultsPath(params, { dataDir: dir }), 'not json{');
  await assert.rejects(() => claude.fetchRoles(params, 100, { dataDir: dir }),
    (e) => e.code === 'BAD_RESULTS');
});

test('slug is stable and filesystem-safe for the same title/location', () => {
  const a = claude.slugFor({ title: 'Sales Engineer', location: 'New York City' });
  const b = claude.slugFor({ title: 'Sales Engineer', location: 'New York City' });
  assert.strictEqual(a, b);
  assert.match(a, /^[a-z0-9-]+$/);
});

test('resolveSource auto-selects claude when no API key is present', () => {
  const { resolveSource } = require('../skills/searcher/searcher.js');
  assert.strictEqual(resolveSource(null, {}).name, 'claude');
  assert.strictEqual(resolveSource(null, { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }).name, 'adzuna');
  assert.strictEqual(resolveSource(null, { LINKEDIN_JOBS_API_KEY: 'k' }).name, 'linkedin');
  assert.strictEqual(resolveSource('adzuna', {}).name, 'adzuna', 'explicit --source wins');
});

/* --- URL gate: stop surfacing "non-existent jobs" (no valid posting link) --- */

test('validPostingUrl accepts absolute http(s) URLs with a real host', () => {
  assert.ok(claude.validPostingUrl('https://boards.greenhouse.io/x/1'));
  assert.ok(claude.validPostingUrl('http://jobs.lever.co/y/2'));
  assert.strictEqual(claude.validPostingUrl(' https://acme.example/1 '), 'https://acme.example/1', 'trims');
});

test('validPostingUrl rejects missing/relative/non-http/hostless URLs', () => {
  assert.strictEqual(claude.validPostingUrl(''), null);
  assert.strictEqual(claude.validPostingUrl(null), null);
  assert.strictEqual(claude.validPostingUrl('/jobs/123'), null, 'relative path');
  assert.strictEqual(claude.validPostingUrl('acme.com/jobs'), null, 'no scheme');
  assert.strictEqual(claude.validPostingUrl('ftp://acme.example/1'), null, 'non-http scheme');
  assert.strictEqual(claude.validPostingUrl('mailto:a@b.com'), null);
  assert.strictEqual(claude.validPostingUrl('http://localhost/x'), null, 'bare host, not a real posting');
  assert.strictEqual(claude.validPostingUrl('not a url'), null);
});

test('normalize drops a role with no valid posting URL (a non-existent job)', () => {
  assert.strictEqual(claude.normalize({ title: 'Sales Engineer', company: 'Acme' }), null, 'no url');
  assert.strictEqual(claude.normalize({ title: 'Sales Engineer', url: '/relative' }), null, 'invalid url');
  const ok = claude.normalize({ title: 'Sales Engineer', company: 'Acme', url: 'https://acme.example/1' });
  assert.ok(ok && ok.url === 'https://acme.example/1');
});

test('fetchRoles ingests only roles with a valid posting URL', async () => {
  const dir = tmpDir();
  const params = { title: 'X', location: 'Y' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claude.resultsPath(params, { dataDir: dir }), JSON.stringify([
    { title: 'Real Role', company: 'Acme', url: 'https://acme.example/1', created: daysAgoIso(1) }, // kept
    { title: 'No Link', company: 'Ghost Co', created: daysAgoIso(1) },                              // dropped: no url
    { title: 'Bad Link', company: 'Ghost Co', url: 'javascript:alert(1)', created: daysAgoIso(1) },// dropped: not http(s)
    { title: 'Relative', company: 'Ghost Co', url: '/careers/42', created: daysAgoIso(1) },        // dropped: relative
  ]));
  const { roles, total } = await claude.fetchRoles(params, 100, { dataDir: dir });
  assert.strictEqual(roles.length, 1, 'only the one real, linked role survives');
  assert.strictEqual(total, 1);
  assert.strictEqual(roles[0].title, 'Real Role');
});

test('buildPrompt tells Claude every role needs a real posting URL', () => {
  const prompt = claude.buildPrompt({ title: 'X', location: 'Y' }, 100, { request: 'req', results: 'res' });
  assert.match(prompt, /valid posting URL|working[\s\S]*http/i);
});

/* --- recency window: surface last-week postings, else flag "expand criteria" --- */

test('withinDays accepts recent ISO dates, rejects old/invalid/future', () => {
  assert.ok(claude.withinDays(daysAgoIso(1), 7));
  assert.ok(claude.withinDays(daysAgoIso(6), 7));
  assert.ok(!claude.withinDays(daysAgoIso(30), 7), 'a month old is stale');
  assert.ok(!claude.withinDays(null, 7));
  assert.ok(!claude.withinDays('not a date', 7));
  assert.ok(!claude.withinDays(daysAgoIso(-5), 7), 'implausible future date rejected');
});

test('fetchRoles keeps only postings within the recency window and reports the split', async () => {
  const dir = tmpDir();
  const params = { title: 'X', location: 'Y' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claude.resultsPath(params, { dataDir: dir }), JSON.stringify([
    { title: 'Fresh', company: 'A', url: 'https://a.example/1', created: daysAgoIso(2) },  // recent
    { title: 'Old',   company: 'B', url: 'https://b.example/2', created: daysAgoIso(40) }, // stale
    { title: 'Undated', company: 'C', url: 'https://c.example/3' },                        // no date → stale
  ]));
  const res = await claude.fetchRoles(params, 100, { dataDir: dir, sinceDays: 7 });
  assert.strictEqual(res.total, 3, 'all distinct roles counted');
  assert.strictEqual(res.recent, 1);
  assert.strictEqual(res.stale, 2);
  assert.strictEqual(res.sinceDays, 7);
  assert.deepStrictEqual(res.roles.map((r) => r.title), ['Fresh']);
});

test('fetchRoles returns zero recent when everything is old (drives the "expand criteria" path)', async () => {
  const dir = tmpDir();
  const params = { title: 'X', location: 'Y' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claude.resultsPath(params, { dataDir: dir }), JSON.stringify([
    { title: 'Old', company: 'B', url: 'https://b.example/2', created: daysAgoIso(40) },
  ]));
  const res = await claude.fetchRoles(params, 100, { dataDir: dir, sinceDays: 7 });
  assert.strictEqual(res.roles.length, 0);
  assert.strictEqual(res.recent, 0);
  assert.strictEqual(res.total, 1);
});

test('archiveResults renames the results file so the next run re-searches (fresh handoff)', async () => {
  const dir = tmpDir();
  const params = { title: 'X', location: 'Y' };
  fs.mkdirSync(dir, { recursive: true });
  const results = claude.resultsPath(params, { dataDir: dir });
  fs.writeFileSync(results, JSON.stringify([{ title: 'Fresh', url: 'https://a.example/1', created: daysAgoIso(1) }]));
  // consume it
  const dest = claude.archiveResults(params, { dataDir: dir });
  assert.ok(dest && fs.existsSync(dest), 'archived aside');
  assert.ok(!fs.existsSync(results), 'original results file gone');
  // with no results file, the next fetch re-enters the handoff (fresh search)
  await assert.rejects(() => claude.fetchRoles(params, 100, { dataDir: dir }),
    (e) => e.code === 'HANDOFF_PENDING');
  // archiving when there is nothing to consume is a no-op (null)
  assert.strictEqual(claude.archiveResults(params, { dataDir: dir }), null);
});

test('buildPrompt states the recency window and asks for created dates', () => {
  const prompt = claude.buildPrompt({ title: 'X', location: 'Y', sinceDays: 7 }, 100, { request: 'r', results: 's' });
  assert.match(prompt, /last 7 days/i);
  assert.match(prompt, /created/i);
});
