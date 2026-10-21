'use strict';
/**
 * db.js — the one store (data/jobhunt.db, SQLite via node:sqlite).
 *
 * Tables:
 *   jobs       one row per posting: what it is, where it came from, and where you are with it
 *   companies  the watchlist: name, tier, ATS board
 *   events     append-only log of every status change (button, scan, email, migration), so
 *              any change can be explained and undone
 *   meta       small JSON values: blocklist, scan summaries, which boards were scanned when
 *
 * Job status: new → interested → applied → screening → interview → offer, or backlog /
 * dismissed / rejected / withdrawn / ghosted. closed_at is set by the scan when the posting
 * leaves its board (independent of status).
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB = process.env.JOB_HUNT_DB || path.join(__dirname, '..', 'data', 'jobhunt.db');
const STATUSES = ['new', 'backlog', 'interested', 'dismissed', 'applied', 'screening', 'interview',
  'offer', 'rejected', 'withdrawn', 'ghosted'];
const PIPELINE = ['interested', 'applied', 'screening', 'interview', 'offer'];
const APPLIED_OR_LATER = ['applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn', 'ghosted'];
const TERMINAL = ['dismissed', 'rejected', 'withdrawn', 'ghosted'];
const FOLLOW_UP_DAYS = 7;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, company TEXT, location TEXT, url TEXT,
  description TEXT, source TEXT, ats TEXT, board TEXT, tier TEXT,
  salary_min REAL, salary_max REAL, posted TEXT, first_seen TEXT, last_seen TEXT, closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'new', applied_at TEXT, resume TEXT, jd_snapshot TEXT,
  follow_up_at TEXT, notes TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_board ON jobs(board);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS companies (
  name TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'C', ats TEXT, slug TEXT, jobs INTEGER,
  checked_at TEXT, added_at TEXT, origin TEXT, slugs TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, at TEXT NOT NULL, kind TEXT NOT NULL,
  from_status TEXT, to_status TEXT, cause TEXT, data TEXT
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', path TEXT, pdf_path TEXT, note TEXT, summary TEXT,
  edits TEXT, rejected TEXT, warnings TEXT, ats_before REAL, ats_after REAL, keywords TEXT
);
CREATE INDEX IF NOT EXISTS resumes_job ON resumes(job_id);
`;

// camelCase job field ↔ column
const JOB_COLS = {
  id: 'id', title: 'title', company: 'company', location: 'location', url: 'url',
  description: 'description', source: 'source', ats: 'ats', board: 'board', tier: 'tier',
  salaryMin: 'salary_min', salaryMax: 'salary_max', posted: 'posted', firstSeen: 'first_seen',
  lastSeen: 'last_seen', closedAt: 'closed_at', status: 'status', appliedAt: 'applied_at',
  resume: 'resume', jdSnapshot: 'jd_snapshot', followUpAt: 'follow_up_at', notes: 'notes',
  updatedAt: 'updated_at',
};
const COL_TO_FIELD = Object.fromEntries(Object.entries(JOB_COLS).map(([f, c]) => [c, f]));

function open(file = DEFAULT_DB) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction (nested calls just run). */
function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function rowToJob(row) {
  if (!row) return null;
  const j = {};
  for (const [c, v] of Object.entries(row)) j[COL_TO_FIELD[c] || c] = v;
  return j;
}

function getJob(db, id) {
  return rowToJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
}

function insertJob(db, job) {
  const fields = Object.keys(JOB_COLS).filter((f) => job[f] !== undefined);
  const cols = fields.map((f) => JOB_COLS[f]);
  db.prepare(`INSERT INTO jobs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...fields.map((f) => job[f]));
}

function updateJob(db, id, patch) {
  const fields = Object.keys(patch).filter((f) => JOB_COLS[f] && f !== 'id');
  if (!fields.length) return;
  db.prepare(`UPDATE jobs SET ${fields.map((f) => `${JOB_COLS[f]} = ?`).join(', ')} WHERE id = ?`)
    .run(...fields.map((f) => (patch[f] === undefined ? null : patch[f])), id);
}

function allJobs(db) {
  return db.prepare('SELECT * FROM jobs').all().map(rowToJob);
}

/** Stored jobs from one board. Older rows without `board` match on ATS + company name. */
function jobsForBoard(db, board, ats, company) {
  return db.prepare('SELECT * FROM jobs WHERE board = ? OR (board IS NULL AND ats = ? AND company = ?)')
    .all(board, ats, company || '').map(rowToJob);
}

/** Which tab a job belongs on. */
function viewOf(job) {
  if (TERMINAL.includes(job.status)) return 'closed';
  if (job.closedAt && !APPLIED_OR_LATER.includes(job.status)) return 'closed';
  if (PIPELINE.includes(job.status)) return 'pipeline';
  return job.status === 'backlog' ? 'backlog' : 'new';
}

function counts(db) {
  const out = { new: 0, backlog: 0, pipeline: 0, closed: 0 };
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const j of allJobs(db)) { out[viewOf(j)] += 1; byStatus[j.status] = (byStatus[j.status] || 0) + 1; }
  return { views: out, byStatus };
}

function addEvent(db, e) {
  db.prepare('INSERT INTO events (job_id, at, kind, from_status, to_status, cause, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(e.jobId ?? null, e.at || new Date().toISOString(), e.kind, e.from ?? null, e.to ?? null,
      e.cause ?? null, e.data != null ? JSON.stringify(e.data) : null);
}

function events(db, { jobId = null, kind = null, limit = 50 } = {}) {
  const where = [];
  const args = [];
  if (jobId) { where.push('job_id = ?'); args.push(jobId); }
  if (kind) { where.push('kind = ?'); args.push(kind); }
  return db.prepare(`SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
    .all(...args, limit)
    .map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
}

const UNDO_FIELDS = ['status', 'appliedAt', 'resume', 'jdSnapshot', 'followUpAt'];

/**
 * Change a job's status and log it. Moving to "applied" also records the date, a snapshot of
 * the JD (postings disappear), the resume used, and a follow-up date. The event keeps the
 * previous values so undo() can restore them exactly.
 */
function setStatus(db, id, to, { cause = 'button', resume, now = new Date(), data = {} } = {}) {
  if (!STATUSES.includes(to)) { const e = new Error(`Unknown status "${to}". One of: ${STATUSES.join(', ')}`); e.status = 400; throw e; }
  return tx(db, () => {
    const job = getJob(db, id);
    if (!job) { const e = new Error(`No job "${id}".`); e.status = 404; throw e; }
    const at = now.toISOString();
    const prev = Object.fromEntries(UNDO_FIELDS.map((f) => [f, job[f] ?? null]));
    const patch = { status: to, updatedAt: at };
    if (to === 'applied' && !job.appliedAt) {
      patch.appliedAt = at;
      patch.jdSnapshot = job.description || null;
      patch.followUpAt = new Date(now.getTime() + FOLLOW_UP_DAYS * 864e5).toISOString();
    }
    if (resume !== undefined) patch.resume = resume || null;
    updateJob(db, id, patch);
    addEvent(db, { jobId: id, at, kind: 'status', from: job.status, to, cause, data: { ...data, prev } });
    return getJob(db, id);
  });
}

/** Revert the job's most recent status change that hasn't been undone already. */
function undo(db, id, { now = new Date() } = {}) {
  return tx(db, () => {
    const undone = new Set(events(db, { jobId: id, kind: 'undo', limit: 1000 }).map((e) => e.data && e.data.undoes));
    const last = events(db, { jobId: id, kind: 'status', limit: 1000 }).find((e) => !undone.has(e.id));
    if (!last) { const e = new Error('Nothing to undo for this job.'); e.status = 400; throw e; }
    const prev = (last.data && last.data.prev) || { status: last.from_status };
    updateJob(db, id, { ...prev, updatedAt: now.toISOString() });
    addEvent(db, { jobId: id, at: now.toISOString(), kind: 'undo', from: last.to_status, to: prev.status, cause: 'button', data: { undoes: last.id } });
    return getJob(db, id);
  });
}

function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

// --- companies (the watchlist) ---------------------------------------------------------------

function rowToCompany(r) {
  const c = { name: r.name, tier: r.tier };
  if (r.ats) c.ats = r.ats;
  if (r.slug) c.slug = r.slug;
  if (r.jobs != null) c.jobs = r.jobs;
  if (r.checked_at) c.checkedAt = r.checked_at;
  if (r.added_at) c.addedAt = r.added_at;
  if (r.origin) c.origin = r.origin;
  if (r.slugs) c.slugs = JSON.parse(r.slugs);
  return c;
}

function listCompanies(db) {
  return db.prepare('SELECT * FROM companies ORDER BY name COLLATE NOCASE').all().map(rowToCompany);
}

function upsertCompany(db, c) {
  db.prepare(`INSERT INTO companies (name, tier, ats, slug, jobs, checked_at, added_at, origin, slugs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET tier = excluded.tier, ats = excluded.ats, slug = excluded.slug,
      jobs = excluded.jobs, checked_at = excluded.checked_at, origin = COALESCE(companies.origin, excluded.origin),
      slugs = excluded.slugs`)
    .run(c.name, c.tier || 'C', c.ats ?? null, c.slug ?? null, c.jobs ?? null, c.checkedAt ?? null,
      c.addedAt || new Date().toISOString(), c.origin ?? null, c.slugs ? JSON.stringify(c.slugs) : null);
}

// --- tailored resumes -----------------------------------------------------------------------

const RESUME_JSON = ['edits', 'rejected', 'warnings', 'keywords'];

function rowToResume(r) {
  if (!r) return null;
  const out = { id: r.id, jobId: r.job_id, createdAt: r.created_at, status: r.status, path: r.path,
    pdfPath: r.pdf_path, note: r.note, summary: r.summary, atsBefore: r.ats_before, atsAfter: r.ats_after };
  for (const k of RESUME_JSON) out[k] = r[k] ? JSON.parse(r[k]) : [];
  return out;
}

function addResume(db, r) {
  const info = db.prepare(`INSERT INTO resumes (job_id, created_at, status, path, pdf_path, note, summary,
      edits, rejected, warnings, ats_before, ats_after, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.jobId, r.createdAt || new Date().toISOString(), r.status || 'draft', r.path ?? null, r.pdfPath ?? null,
      r.note ?? null, r.summary ?? null, ...RESUME_JSON.slice(0, 3).map((k) => JSON.stringify(r[k] || [])),
      r.atsBefore ?? null, r.atsAfter ?? null, JSON.stringify(r.keywords || []));
  return getResume(db, Number(info.lastInsertRowid));
}

function getResume(db, id) {
  return rowToResume(db.prepare('SELECT * FROM resumes WHERE id = ?').get(id));
}

function resumesForJob(db, jobId) {
  return db.prepare('SELECT * FROM resumes WHERE job_id = ? ORDER BY id DESC').all(jobId).map(rowToResume);
}

/** Latest resume per job: { jobId: { id, status } } (for row badges). */
function latestResumes(db) {
  const rows = db.prepare('SELECT r.job_id, r.id, r.status FROM resumes r JOIN (SELECT job_id, MAX(id) AS id FROM resumes GROUP BY job_id) m ON m.id = r.id').all();
  return Object.fromEntries(rows.map((r) => [r.job_id, { id: r.id, status: r.status }]));
}

function setResumeStatus(db, id, status) {
  db.prepare('UPDATE resumes SET status = ? WHERE id = ?').run(status, id);
  return getResume(db, id);
}

/** The watchlist in the shape lib/watchlist.js works on: { blocklist, companies }. */
function loadWatchlist(db) {
  return { blocklist: getMeta(db, 'blocklist', []), companies: listCompanies(db) };
}

module.exports = {
  DEFAULT_DB, STATUSES, PIPELINE, APPLIED_OR_LATER, TERMINAL, FOLLOW_UP_DAYS,
  open, tx, getJob, insertJob, updateJob, allJobs, jobsForBoard, viewOf, counts,
  addEvent, events, setStatus, undo, getMeta, setMeta,
  listCompanies, upsertCompany, loadWatchlist,
  addResume, getResume, resumesForJob, latestResumes, setResumeStatus,
};
