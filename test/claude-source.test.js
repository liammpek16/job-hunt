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
    { title: 'Sales Engineer', company: 'Acme', location: 'New York, NY', salaryMin: 130000, url: 'https://acme.example/1', description: 'Sell.' },
    { title: 'Senior Sales Engineer', company: 'Globex', location: 'NYC', salary_min: '150000', url: 'https://globex.example/2' },
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
    JSON.stringify({ roles: [{ title: 'X', company: 'C', url: 'https://c.example/x' }] }));
  const { roles } = await claude.fetchRoles(params, 100, { dataDir: dir });
  assert.strictEqual(roles.length, 1);
});

test('dedupes by id and drops title-less junk', async () => {
  const dir = tmpDir();
  const params = { title: 'X', location: 'Y' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claude.resultsPath(params, { dataDir: dir }), JSON.stringify([
    { title: 'Dup', company: 'C', url: 'https://c.example/dup' },
    { title: 'Dup', company: 'C', url: 'https://c.example/dup' }, // same url → same id
    { company: 'NoTitle', url: 'https://c.example/none' },        // no title → dropped
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
