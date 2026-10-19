'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../lib/db');
const { migrate } = require('../scripts/migrate-to-sqlite');

const NOW = new Date('2026-10-20T12:00:00Z');

function withJob(fields = {}) {
  const db = store.open(':memory:');
  store.insertJob(db, { id: 'j1', title: 'Sales Engineer', company: 'Acme', description: 'Run demos.', status: 'new', ...fields });
  return db;
}

test('Applied records date, JD snapshot, resume and a 7-day follow-up, and logs the event', () => {
  const db = withJob({ status: 'interested' });
  const j = store.setStatus(db, 'j1', 'applied', { resume: 'Resumes/acme.docx', now: NOW });
  assert.equal(j.status, 'applied');
  assert.equal(j.appliedAt, NOW.toISOString());
  assert.equal(j.jdSnapshot, 'Run demos.');
  assert.equal(j.resume, 'Resumes/acme.docx');
  assert.equal(j.followUpAt, new Date(NOW.getTime() + 7 * 864e5).toISOString());
  const [e] = store.events(db, { jobId: 'j1', kind: 'status' });
  assert.equal(e.from_status, 'interested');
  assert.equal(e.to_status, 'applied');
});

test('undo restores the exact previous state, one change at a time', () => {
  const db = withJob();
  store.setStatus(db, 'j1', 'interested', { now: NOW });
  store.setStatus(db, 'j1', 'applied', { resume: 'r.docx', now: NOW });
  let j = store.undo(db, 'j1');
  assert.equal(j.status, 'interested');
  assert.equal(j.appliedAt, null);
  assert.equal(j.resume, null);
  assert.equal(j.followUpAt, null);
  j = store.undo(db, 'j1');
  assert.equal(j.status, 'new');
  assert.throws(() => store.undo(db, 'j1'), /Nothing to undo/);
});

test('setStatus rejects unknown statuses and jobs', () => {
  const db = withJob();
  assert.throws(() => store.setStatus(db, 'j1', 'hired'), /Unknown status/);
  assert.throws(() => store.setStatus(db, 'nope', 'interested'), /No job/);
});

test('viewOf: triage, pipeline, closed (applied jobs stay in the pipeline when the posting closes)', () => {
  assert.equal(store.viewOf({ status: 'new' }), 'new');
  assert.equal(store.viewOf({ status: 'backlog' }), 'backlog');
  assert.equal(store.viewOf({ status: 'interested' }), 'pipeline');
  assert.equal(store.viewOf({ status: 'interested', closedAt: 'x' }), 'closed');
  assert.equal(store.viewOf({ status: 'applied', closedAt: 'x' }), 'pipeline');
  assert.equal(store.viewOf({ status: 'dismissed' }), 'closed');
  assert.equal(store.viewOf({ status: 'rejected' }), 'closed');
});

test('companies + meta round-trip', () => {
  const db = store.open(':memory:');
  store.upsertCompany(db, { name: 'Acme', tier: 'A', ats: 'greenhouse', slug: 'acme', jobs: 3, slugs: ['acme-inc'] });
  store.upsertCompany(db, { name: 'Acme', tier: 'B', ats: 'greenhouse', slug: 'acme', jobs: 4 });
  store.setMeta(db, 'blocklist', ['Jobgether']);
  const wl = store.loadWatchlist(db);
  assert.equal(wl.companies.length, 1);
  assert.equal(wl.companies[0].tier, 'B');
  assert.equal(wl.companies[0].jobs, 4);
  assert.deepEqual(wl.blocklist, ['Jobgether']);
});

test('migration imports the seed watchlist, scanned jobs and the Excel applications once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jh-mig-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'config', 'companies.seed.json'), JSON.stringify({
    blocklist: ['Jobgether'], companies: [{ name: 'Acme', tier: 'A', ats: 'greenhouse', slug: 'acme' }],
  }));
  fs.writeFileSync(path.join(root, 'data', 'jobs.json'), JSON.stringify({
    roles: {
      'greenhouse:x': { id: 'greenhouse:x', title: 'Sales Engineer', company: 'Acme', triage: 'backlog', tier: 'A', ats: 'greenhouse', firstSeen: 'a', lastSeen: 'b' },
      'claude:y': { id: 'claude:y', title: 'Old', company: 'Old Co' }, // pre-revamp: not migrated
    },
    apps: {}, meta: { companiesScanned: { 'greenhouse:acme': 'a' }, scans: [{ at: 'a' }] },
  }));
  fs.writeFileSync(path.join(root, 'data', 'manual-applications.json'), JSON.stringify({
    applications: [{ company: 'Radar', title: 'Sales Engineer', status: 'applied', resume: 'Radar.docx' }],
  }));
  const db = store.open(':memory:');
  const out = migrate(db, { root, now: NOW });
  assert.deepEqual(out, { companies: 2, jobs: 1, applications: 1, skipped: 0 });
  assert.equal(store.getJob(db, 'greenhouse:x').status, 'backlog');
  assert.equal(store.getJob(db, 'claude:y'), null);
  assert.equal(store.getJob(db, 'manual:radar:salesengineer').status, 'applied');
  assert.ok(store.loadWatchlist(db).companies.some((c) => c.name === 'Radar' && !c.ats));
  assert.deepEqual(store.getMeta(db, 'scans'), [{ at: 'a' }]);
  const again = migrate(db, { root, now: NOW });
  assert.deepEqual(again, { companies: 0, jobs: 0, applications: 0, skipped: 2 });
});
