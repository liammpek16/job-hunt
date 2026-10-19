#!/usr/bin/env node
'use strict';
/**
 * archive-legacy-roles.js — one-time cleanup for the M0 revamp.
 *
 * Moves every role the watchlist scan didn't produce (no `triage`: old Claude web-search,
 * Greenhouse/Lever/Ashby search and Jobgether rows) out of data/jobs.json into
 * data/jobs-archive.json. Roles with an application record are kept. Run with --dry-run to
 * see the counts first. Back up data/jobs.json before running.
 */
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

const ARCHIVE = path.join(__dirname, '..', 'data', 'jobs-archive.json');

function archiveLegacy(s, archive = { archivedAt: null, roles: {} }) {
  const moved = [];
  for (const [id, role] of Object.entries(s.roles)) {
    if (role.triage || (s.apps || {})[id]) continue;
    archive.roles[id] = role;
    delete s.roles[id];
    moved.push(role);
  }
  return moved;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const s = store.load();
  let archive = { archivedAt: null, roles: {} };
  try { archive = JSON.parse(fs.readFileSync(ARCHIVE, 'utf8')); } catch { /* new archive */ }
  const moved = archiveLegacy(s, archive);
  const bySource = {};
  for (const r of moved) bySource[r.source || '?'] = (bySource[r.source || '?'] || 0) + 1;
  console.log(`${dryRun ? 'Would archive' : 'Archived'} ${moved.length} legacy role(s): `
    + Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') + `; ${Object.keys(s.roles).length} remain.`);
  if (dryRun) return;
  archive.archivedAt = new Date().toISOString();
  fs.writeFileSync(ARCHIVE, JSON.stringify(archive, null, 2));
  store.save(s);
}

if (require.main === module) main();
module.exports = { archiveLegacy };
