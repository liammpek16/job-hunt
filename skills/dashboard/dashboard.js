#!/usr/bin/env node
'use strict';
/**
 * dashboard.js — the Job Hunt webapp (M1): Jobs and Companies tabs over data/jobhunt.db.
 *
 *   Jobs       New / Backlog triage (keyboard), Pipeline (interested → offer), Closed; match
 *              chips; Applied button (date, JD snapshot, resume, follow-up) with undo.
 *   Companies  the watchlist (tier, ATS, open matches, 30-day openings), add a company,
 *              paste-a-link intake with coverage %.
 *   Health bar last scan, the daily task, coverage.
 *
 * Local only (127.0.0.1). The Admin-Brain HUD button launches it via run-dashboard.ps1.
 *
 * Usage:
 *   node skills/dashboard/dashboard.js [--port 4188]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const store = require('../../lib/db');
const profileLib = require('../../lib/profile');
const watchlist = require('../../lib/watchlist');
const { runScan } = require('../../lib/scan');
const { intake, addCompany, intakeStats } = require('../../lib/intake');
const tailored = require('../../lib/tailored');
const { tailorResume, formatTailorReport } = require('../../lib/tailor');
const { writeResumePdf } = require('../../lib/pdf');
const { scoreBullet } = require('../../lib/xyz');
const { renderApp } = require('../../lib/webapp');

const DEFAULT_PORT = 4188;
const REPO_ROOT = path.join(__dirname, '..', '..');
const RESUMES_DIR = path.join(REPO_ROOT, 'Resumes');
const DEFAULT_RESUME = process.env.JOB_HUNT_RESUME || path.join(REPO_ROOT, 'samples', 'sample-resume.md');
const TASK_NAME = 'JobHunt Daily Scan';
const STATUS_ORDER = Object.fromEntries(store.STATUSES.map((s, i) => [s, i]));

function parseArgs(argv) {
  const a = { port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--port') a.port = Number(argv[++i]);
  return a;
}

/* ------------------------------- payloads ----------------------------------- */

function lastActivity(db) {
  const rows = db.prepare('SELECT job_id, MAX(at) AS at FROM events WHERE job_id IS NOT NULL GROUP BY job_id').all();
  return Object.fromEntries(rows.map((r) => [r.job_id, r.at]));
}

function linkedinSearch(job, chips) {
  const q = `${job.company || ''} ${chips.title || 'sales engineer'}`.trim();
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

function shapeJob(job, profile, last, refined) {
  const chips = profileLib.explain(job, profile);
  return {
    id: job.id, title: job.title, company: job.company, location: job.location, url: job.url,
    tier: job.tier, ats: job.ats || job.source, status: job.status, view: store.viewOf(job),
    posted: job.posted, firstSeen: job.firstSeen, closed: Boolean(job.closedAt), closedAt: job.closedAt,
    appliedAt: job.appliedAt, resume: job.resume, followUpAt: job.followUpAt,
    lastUpdate: last[job.id] || job.updatedAt || job.firstSeen,
    salaryMin: job.salaryMin, salaryMax: job.salaryMax,
    chips, linkedin: linkedinSearch(job, chips),
    tailored: tailored.isRefined(job.id, refined), pdf: tailored.hasPdf(job.id),
  };
}

const TIER = watchlist.TIER_RANK;
const time = (s) => (s ? Date.parse(s) || 0 : 0);
const SORTERS = {
  // triage: best tier first, then newest posting
  new: (a, b) => (TIER[a.tier] ?? 3) - (TIER[b.tier] ?? 3) || time(b.posted || b.firstSeen) - time(a.posted || a.firstSeen),
  pipeline: (a, b) => STATUS_ORDER[b.status] - STATUS_ORDER[a.status] || time(b.lastUpdate) - time(a.lastUpdate),
  closed: (a, b) => time(b.lastUpdate) - time(a.lastUpdate),
};
SORTERS.backlog = SORTERS.new;

function jobsPayload(db, profile, view = 'new') {
  if (!SORTERS[view]) { const e = new Error(`Unknown view "${view}".`); e.status = 400; throw e; }
  const last = lastActivity(db);
  const refined = tailored.refinedIds();
  return store.allJobs(db).filter((j) => store.viewOf(j) === view)
    .map((j) => shapeJob(j, profile, last, refined)).sort(SORTERS[view]);
}

function jobDetail(db, profile, id) {
  const job = store.getJob(db, id);
  if (!job) { const e = new Error(`No job "${id}".`); e.status = 404; throw e; }
  return { ...shapeJob(job, profile, lastActivity(db), tailored.refinedIds()),
    description: job.description, jdSnapshot: job.jdSnapshot, events: store.events(db, { jobId: id, limit: 50 }) };
}

function companiesPayload(db) {
  const wl = store.loadWatchlist(db);
  const lastScanned = store.getMeta(db, 'boardsLastScanned', {});
  const jobs = store.allJobs(db);
  const monthAgo = Date.now() - 30 * 864e5;
  const companies = wl.companies.map((c) => {
    const mine = jobs.filter((j) => watchlist.norm(j.company) === watchlist.norm(c.name));
    const open = mine.filter((j) => !j.closedAt && !store.TERMINAL.includes(j.status));
    return {
      ...c,
      covered: watchlist.ATS_NAMES.includes(c.ats) && Boolean(c.slug),
      blocked: watchlist.isBlocked(c.name, wl),
      openMatches: open.length,
      opened30: mine.filter((j) => time(j.firstSeen) >= monthAgo && j.source !== 'manual').length,
      lastScanned: c.slug ? lastScanned[`${c.ats}:${c.slug}`] || null : null,
    };
  });
  return { companies, coverage: watchlist.coverage(wl), intake: intakeStats(db), blocklist: wl.blocklist };
}

function listResumes() {
  const out = [];
  for (const [dir, label] of [[RESUMES_DIR, 'Resumes'], [REPO_ROOT, '']]) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!/\.(docx|pdf)$/i.test(f) || (!label && !/resume/i.test(f))) continue;
      out.push(label ? `${label}/${f}` : f);
    }
  }
  return out.sort();
}

/* --------------------------------- health ----------------------------------- */

let taskCache = { at: 0, value: null };

/** The daily scan's Windows scheduled task: { registered, nextRun, lastRun, lastResult }. */
function scheduledTask() {
  if (process.platform !== 'win32') return Promise.resolve({ registered: false, note: 'not Windows' });
  if (Date.now() - taskCache.at < 60e3 && taskCache.value) return Promise.resolve(taskCache.value);
  return new Promise((resolve) => {
    execFile('schtasks', ['/Query', '/TN', TASK_NAME, '/V', '/FO', 'LIST'], { windowsHide: true, timeout: 10e3 }, (err, stdout) => {
      let value = { registered: false };
      if (!err) {
        const field = (k) => { const m = stdout.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi')); return m ? m[1].trim() : null; };
        value = { registered: true, nextRun: field('Next Run Time'), lastRun: field('Last Run Time'), lastResult: field('Last Result') };
      }
      taskCache = { at: Date.now(), value };
      resolve(value);
    });
  });
}

async function healthPayload(db, getTask = scheduledTask) {
  const scans = store.getMeta(db, 'scans', []);
  const last = scans[scans.length - 1] || null;
  const fullScans = scans.filter((s) => !s.only);
  const lastFull = fullScans[fullScans.length - 1] || null;
  return {
    lastScan: last, lastFullScan: lastFull,
    scanAgeHours: lastFull ? Math.round((Date.now() - time(lastFull.at)) / 36e5) : null,
    task: await getTask(),
    coverage: watchlist.coverage(store.loadWatchlist(db)),
    intake: intakeStats(db),
    counts: store.counts(db),
  };
}

/* ------------------------------ résumé refine ------------------------------- */

/** Same per-bullet transform the customizer uses: replace weak bullets with their XYZ rewrite. */
function improveBullet(text) {
  const b = scoreBullet(text);
  return b.score === 3 ? text : (b.rewrite || text);
}

/**
 * Tailor the resume to one job's JD: a Markdown report and a tailored-resume PDF the row can
 * preview. (M2 replaces this with in-place .docx tailoring.) The original resume is untouched.
 */
async function refineRole(db, id) {
  const role = store.getJob(db, id);
  if (!role) { const e = new Error(`No job "${id}".`); e.status = 404; throw e; }
  let resumeText;
  try { resumeText = fs.readFileSync(DEFAULT_RESUME, 'utf8'); }
  catch { const e = new Error(`Resume not found at ${DEFAULT_RESUME} (set JOB_HUNT_RESUME).`); e.status = 500; throw e; }
  const jdLabel = `${role.title}${role.company ? ' @ ' + role.company : ''}`;
  const report = tailorResume(resumeText, `${role.title}\n${role.description || ''}`);
  const summary = {
    coverage: report.coverage.pct, present: report.coverage.present.length, total: report.coverage.total,
    fullXYZ: report.xyz.fullXYZ, totalBullets: report.xyz.totalBullets, weak: report.weakBullets.length,
  };
  tailored.save(id, formatTailorReport(report, jdLabel), summary);
  const missing = report.coverage.missing.map((k) => k.term).slice(0, 15).join(', ');
  const note = `Tailored for ${jdLabel}. Weave these missing JD keywords in where truthful: `
    + `${missing || '(none — good coverage)'}. Weak bullets carry XYZ rewrite scaffolds — `
    + 'fill the [bracketed] placeholders. Original resume unchanged; review before sending.';
  let pdf = false;
  try { await writeResumePdf(resumeText, improveBullet, tailored.pdfPath(id), note); pdf = true; }
  catch (e) { console.error(`PDF generation failed for ${id}: ${e.message}`); }
  return { id, ...summary, pdf };
}

/* --------------------------------- server ----------------------------------- */

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); } });
    req.on('error', reject);
  });
}

const PIPELINE_MOVES = ['interested', 'dismissed', 'new', 'backlog', 'screening', 'interview', 'offer', 'rejected', 'withdrawn', 'ghosted'];

/**
 * opts (tests): { db, profile, getTask, scanDeps } — defaults open data/jobhunt.db and
 * config/search-profile.json.
 */
function createServer(opts = {}) {
  const db = opts.db || store.open();
  const profile = () => opts.profile || profileLib.load();
  const scanDeps = opts.scanDeps || {};
  let scanning = null;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const p = url.pathname;
      const GET = req.method === 'GET';
      const POST = req.method === 'POST';

      if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
      if (GET && p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderApp()); return; }
      if (GET && p === '/api/jobs') { sendJson(res, 200, { view: url.searchParams.get('view') || 'new', jobs: jobsPayload(db, profile(), url.searchParams.get('view') || 'new') }); return; }
      if (GET && p === '/api/job') { sendJson(res, 200, jobDetail(db, profile(), url.searchParams.get('id') || '')); return; }
      if (GET && p === '/api/counts') { sendJson(res, 200, store.counts(db)); return; }
      if (GET && p === '/api/resumes') { sendJson(res, 200, { resumes: listResumes() }); return; }
      if (GET && p === '/api/companies') { sendJson(res, 200, companiesPayload(db)); return; }
      if (GET && p === '/api/health') { sendJson(res, 200, await healthPayload(db, opts.getTask)); return; }

      if (POST && p === '/api/jobs/status') {
        const b = await readBody(req);
        if (!PIPELINE_MOVES.includes(b.status)) { sendJson(res, 400, { error: `Use the Applied button for "applied"; status must be one of ${PIPELINE_MOVES.join(', ')}.` }); return; }
        sendJson(res, 200, { job: store.setStatus(db, String(b.id || ''), b.status) }); return;
      }
      if (POST && p === '/api/jobs/applied') {
        const b = await readBody(req);
        sendJson(res, 200, { job: store.setStatus(db, String(b.id || ''), 'applied', { resume: b.resume || null }) }); return;
      }
      if (POST && p === '/api/jobs/undo') {
        const b = await readBody(req);
        sendJson(res, 200, { job: store.undo(db, String(b.id || '')) }); return;
      }
      if (POST && p === '/api/companies') {
        const b = await readBody(req);
        sendJson(res, 200, await addCompany(db, { name: b.name, tier: b.tier }, { profile: profile(), ...scanDeps })); return;
      }
      if (POST && p === '/api/companies/tier') {
        const b = await readBody(req);
        const c = store.listCompanies(db).find((x) => x.name === b.name);
        if (!c) { sendJson(res, 404, { error: `No company "${b.name}".` }); return; }
        if (!['A', 'B', 'C'].includes(b.tier)) { sendJson(res, 400, { error: 'Tier must be A, B or C.' }); return; }
        store.upsertCompany(db, { ...c, tier: b.tier });
        db.prepare('UPDATE jobs SET tier = ? WHERE company = ?').run(b.tier, c.name);
        sendJson(res, 200, { ok: true }); return;
      }
      if (POST && p === '/api/intake') {
        const b = await readBody(req);
        sendJson(res, 200, await intake(db, { url: b.url, company: b.company, tier: b.tier }, { profile: profile(), ...scanDeps })); return;
      }
      if (POST && p === '/api/scan') {
        if (!scanning) scanning = runScan({ profile: profile(), db, ...scanDeps }).finally(() => { scanning = null; });
        sendJson(res, 200, await scanning); return;
      }
      if (POST && p === '/api/tailor') {
        const b = await readBody(req);
        sendJson(res, 200, await refineRole(db, String(b.id || ''))); return;
      }
      if (GET && p === '/api/tailored') {
        const rec = tailored.load(url.searchParams.get('id') || '');
        if (!rec) { sendJson(res, 404, { error: 'No tailored résumé for that job yet.' }); return; }
        sendJson(res, 200, { markdown: rec.markdown, meta: rec.meta }); return;
      }
      if (GET && p === '/api/tailored/pdf') {
        const id = url.searchParams.get('id') || '';
        if (!id || !tailored.hasPdf(id)) { sendJson(res, 404, { error: 'No tailored résumé PDF for that job yet.' }); return; }
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="tailored-resume.pdf"' });
        fs.createReadStream(tailored.pdfPath(id)).pipe(res);
        return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.message });
    }
  });
}

function serve(port = DEFAULT_PORT) {
  const server = createServer();
  server.listen(port, '127.0.0.1', () => console.log(`Job Hunt dashboard at http://127.0.0.1:${port}  (Ctrl-C to stop)`));
  return server;
}

if (require.main === module) serve(parseArgs(process.argv.slice(2)).port);

module.exports = {
  parseArgs, createServer, serve, DEFAULT_PORT, jobsPayload, jobDetail, companiesPayload,
  healthPayload, listResumes, refineRole, PIPELINE_MOVES,
};
