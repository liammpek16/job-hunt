'use strict';
/**
 * store.js — the shared job/application store (data/jobs.json).
 *
 * One data shape threads goals 2 (searcher writes roles) → 6 (dashboard aggregates
 * applications). The customizer (3) and ATS scanner (4) can also read a role's
 * description from here.
 *
 * Shape:
 *   {
 *     roles: { "<id>": { id, title, company, location, salaryMin, salaryMax, url, description, source, created } },
 *     apps:  { "<id>": { status, appliedAt, updatedAt, notes, interviews: [ {date, kind, notes} ] } }
 *   }
 *
 * status ∈ STATUSES. A role starts life at "saved"; the user advances it.
 */
const fs = require('fs');
const path = require('path');

const STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected'];
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'jobs.json');

function emptyStore() {
  return { roles: {}, apps: {} };
}

function load(file = DEFAULT_FILE) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const s = JSON.parse(raw);
    return { roles: s.roles || {}, apps: s.apps || {} };
  } catch (e) {
    if (e.code === 'ENOENT') return emptyStore();
    throw e;
  }
}

function save(store, file = DEFAULT_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}

/** Add roles (dedup by id). Returns {added, skipped}. Does not touch existing apps. */
function addRoles(store, roles) {
  let added = 0;
  let skipped = 0;
  for (const r of roles) {
    if (!r || !r.id) { skipped++; continue; }
    if (store.roles[r.id]) { skipped++; continue; }
    store.roles[r.id] = r;
    added++;
  }
  return { added, skipped };
}

/** Set/advance an application's status. Creates the app record if new. */
function setStatus(store, id, status, when = new Date().toISOString()) {
  if (!STATUSES.includes(status)) {
    throw new Error(`Unknown status "${status}". One of: ${STATUSES.join(', ')}`);
  }
  if (!store.roles[id]) throw new Error(`No role with id "${id}" in the store.`);
  const app = store.apps[id] || { status: 'saved', interviews: [], notes: '' };
  app.status = status;
  app.updatedAt = when;
  if (status === 'applied' && !app.appliedAt) app.appliedAt = when;
  store.apps[id] = app;
  return app;
}

/** Log an interview for a role (also nudges status to "interviewing" if earlier). */
function addInterview(store, id, { date = new Date().toISOString(), kind = 'interview', notes = '' } = {}) {
  if (!store.roles[id]) throw new Error(`No role with id "${id}" in the store.`);
  const app = store.apps[id] || { status: 'applied', interviews: [], notes: '' };
  app.interviews = app.interviews || [];
  app.interviews.push({ date, kind, notes });
  if (['saved', 'applied'].includes(app.status)) app.status = 'interviewing';
  app.updatedAt = date;
  store.apps[id] = app;
  return app;
}

module.exports = { STATUSES, DEFAULT_FILE, emptyStore, load, save, addRoles, setStatus, addInterview };
