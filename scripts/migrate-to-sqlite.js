#!/usr/bin/env node
'use strict';
/**
 * migrate-to-sqlite.js — one-time move from the JSON store to data/jobhunt.db.
 *
 * Imports (skipping anything already in the DB, so re-running is safe):
 *   • config/companies.seed.json  → companies + blocklist (only if the companies table is empty)
 *   • data/jobs.json              → jobs from the watchlist scan, plus scan history
 *   • data/manual-applications.json → applications tracked in the old Excel sheet
 *     (Job_Applications.xlsx), as "applied" jobs; their companies join the watchlist unchecked
 *     so `npm run detect` can find their boards.
 */
const fs = require('fs');
const path = require('path');
const store = require('../lib/db');
const watchlist = require('../lib/watchlist');

const ROOT = path.join(__dirname, '..');
const OLD_STATUS = { applied: 'applied', interviewing: 'interview', offer: 'offer', rejected: 'rejected' };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function migrate(db, { root = ROOT, now = new Date() } = {}) {
  const at = now.toISOString();
  const out = { companies: 0, jobs: 0, applications: 0, skipped: 0 };
  store.tx(db, () => {
    const seed = readJson(path.join(root, 'config', 'companies.seed.json'));
    if (seed && !store.listCompanies(db).length) {
      store.setMeta(db, 'blocklist', seed.blocklist || []);
      for (const c of seed.companies || []) { store.upsertCompany(db, { ...c, origin: 'seed', addedAt: at }); out.companies += 1; }
    }

    const old = readJson(path.join(root, 'data', 'jobs.json'));
    if (old) {
      for (const r of Object.values(old.roles || {})) {
        if (!r.triage) continue; // pre-revamp rows were archived; only scan results move over
        if (store.getJob(db, r.id)) { out.skipped += 1; continue; }
        const app = (old.apps || {})[r.id];
        store.insertJob(db, {
          id: r.id, title: r.title, company: r.company, location: r.location, url: r.url,
          description: r.description, source: r.source, ats: r.ats, board: r.board || null, tier: r.tier,
          salaryMin: r.salaryMin ?? null, salaryMax: r.salaryMax ?? null, posted: r.posted || null,
          firstSeen: r.firstSeen, lastSeen: r.lastSeen, closedAt: r.closedAt || null,
          status: (app && OLD_STATUS[app.status]) || r.triage, appliedAt: (app && app.appliedAt) || null,
          updatedAt: at,
        });
        store.addEvent(db, { jobId: r.id, at, kind: 'migrated', cause: 'migration', data: { from: 'jobs.json' } });
        out.jobs += 1;
      }
      const meta = old.meta || {};
      if (meta.companiesScanned && !store.getMeta(db, 'companiesScanned')) store.setMeta(db, 'companiesScanned', meta.companiesScanned);
      if (meta.scans && !store.getMeta(db, 'scans')) store.setMeta(db, 'scans', meta.scans);
    }

    const manual = readJson(path.join(root, 'data', 'manual-applications.json'));
    const known = new Set(store.listCompanies(db).map((c) => watchlist.norm(c.name)));
    for (const a of (manual && manual.applications) || []) {
      const id = `manual:${watchlist.norm(a.company)}:${watchlist.norm(a.title)}`;
      if (store.getJob(db, id)) { out.skipped += 1; continue; }
      store.insertJob(db, {
        id, title: a.title, company: a.company, location: a.location || '', url: a.url || null,
        source: 'manual', status: a.status || 'applied', resume: a.resume || null,
        updatedAt: at, // no posted / first-seen date: the sheet didn't record one
      });
      store.addEvent(db, { jobId: id, at, kind: 'migrated', cause: 'migration', data: { from: 'Job_Applications.xlsx' } });
      if (!known.has(watchlist.norm(a.company))) {
        store.upsertCompany(db, { name: a.company, tier: 'B', origin: 'applied', addedAt: at });
        known.add(watchlist.norm(a.company));
        out.companies += 1;
      }
      out.applications += 1;
    }
  });
  return out;
}

if (require.main === module) {
  const db = store.open();
  const out = migrate(db);
  console.log(`Migrated into ${store.DEFAULT_DB}: ${out.companies} companies, ${out.jobs} scanned jobs, `
    + `${out.applications} applications from the Excel sheet (${out.skipped} already there).`);
}
module.exports = { migrate };
