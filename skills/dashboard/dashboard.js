#!/usr/bin/env node
'use strict';
/**
 * dashboard.js — goal 6: track jobs applied to / interviews and render a dashboard, plus the
 * live webapp that fronts the whole search→tailor loop for the Admin Brain HUD.
 *
 * Reads the shared store (data/jobs.json). By default it renders a self-contained static HTML
 * dashboard (funnel + stat tiles + per-role table) and prints a terminal summary. With --serve
 * it runs the INTERACTIVE webapp (lib/webapp.js) + a small JSON API that powers:
 *   • a search button that runs the searcher on the Claude Code subscription (file handoff),
 *   • a relevance-ranked, column-sortable list of every surfaced role,
 *   • a per-role "refine résumé" button (in-process tailoring, $0), and
 *   • a preview of each refined role's tailoring report.
 *
 * Usage:
 *   node skills/dashboard/dashboard.js                       # render dashboard.html + summary
 *   node skills/dashboard/dashboard.js --out board.html      # custom output path
 *   node skills/dashboard/dashboard.js --json                # print aggregate JSON
 *   node skills/dashboard/dashboard.js --apply <id>          # mark a role applied
 *   node skills/dashboard/dashboard.js --status <id> <status># set status (saved..rejected)
 *   node skills/dashboard/dashboard.js --interview <id> [--kind "phone screen"] [--notes "..."]
 *   node skills/dashboard/dashboard.js --serve [--port 4188]   # live webapp for the HUD button
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const store = require('../../lib/store');
const { aggregate, renderHtml, renderTerminal } = require('../../lib/dashboard');
const { rankRoles } = require('../../lib/relevance');
const tailored = require('../../lib/tailored');
const { tailorResume, formatTailorReport } = require('../../lib/tailor');
const { renderApp } = require('../../lib/webapp');
const claudeSource = require('../../lib/sources/claude');

const DEFAULT_PORT = 4188;
const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_RESUME = process.env.JOB_HUNT_RESUME || path.join(REPO_ROOT, 'samples', 'sample-resume.md');
const SEARCH_TARGET = 100;

function parseArgs(argv) {
  const a = { out: null, json: false, apply: null, status: null, statusVal: null,
    interview: null, kind: 'interview', notes: '', serve: false, port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i];
    else if (k === '--json') a.json = true;
    else if (k === '--apply') a.apply = argv[++i];
    else if (k === '--status') { a.status = argv[++i]; a.statusVal = argv[++i]; }
    else if (k === '--interview') a.interview = argv[++i];
    else if (k === '--kind') a.kind = argv[++i];
    else if (k === '--notes') a.notes = argv[++i];
    else if (k === '--serve') a.serve = true;
    else if (k === '--port') a.port = Number(argv[++i]);
  }
  return a;
}

/** Render the static pipeline board from the CURRENT store on disk (fresh each call). */
function renderLiveHtml() {
  return renderHtml(aggregate(store.load()));
}

/* ------------------------------- API helpers -------------------------------- */

/** Every surfaced role, ranked by relevance, annotated with status + tailored state. */
function rolesPayload(s = store.load()) {
  const refined = tailored.refinedIds();
  const roleList = Object.values(s.roles || {});
  const ranked = rankRoles(roleList);
  return ranked.map((r) => {
    const app = (s.apps || {})[r.id] || {};
    const isTailored = tailored.isRefined(r.id, refined);
    let coverage = null;
    if (isTailored) {
      const rec = tailored.load(r.id);
      coverage = rec && rec.meta ? (rec.meta.coverage ?? null) : null;
    }
    return {
      id: r.id, title: r.title, company: r.company, location: r.location,
      salaryMin: r.salaryMin ?? null, salaryMax: r.salaryMax ?? null,
      url: r.url || '', relevance: r.relevance,
      status: app.status || 'saved', tailored: isTailored, coverage,
    };
  });
}

/** Run the searcher's Claude Code source; ingest results if present, else return the handoff. */
function runSearch(body = {}) {
  const params = {
    title: String(body.title || '').trim(),
    location: String(body.location || '').trim(),
    salaryMin: body.salaryMin != null && body.salaryMin !== '' ? Number(body.salaryMin) : null,
    salaryMax: body.salaryMax != null && body.salaryMax !== '' ? Number(body.salaryMax) : null,
    country: body.country || 'us',
  };
  if (!params.title) { const e = new Error('A job title is required.'); e.status = 400; throw e; }

  // fetchRoles resolves once Claude's results file exists; otherwise it throws HANDOFF_PENDING.
  return claudeSource.fetchRoles(params, SEARCH_TARGET).then((result) => {
    const s = store.load();
    const { added, skipped } = store.addRoles(s, result.roles);
    store.save(s);
    return { status: 'ingested', added, skipped, total: result.total ?? result.roles.length };
  }).catch((err) => {
    if (err.code === 'HANDOFF_PENDING') {
      return { status: 'handoff', prompt: err.prompt, requestFile: err.requestFile, resultsFile: err.resultsFile };
    }
    throw err;
  });
}

/** Tailor the resume to one role's JD, persist the report, return a summary. */
function refineRole(id) {
  const s = store.load();
  const role = (s.roles || {})[id];
  if (!role) { const e = new Error(`No role "${id}" in the store.`); e.status = 404; throw e; }
  let resumeText;
  try { resumeText = fs.readFileSync(DEFAULT_RESUME, 'utf8'); }
  catch { const e = new Error(`Resume not found at ${DEFAULT_RESUME} (set JOB_HUNT_RESUME).`); e.status = 500; throw e; }
  const jdText = `${role.title}\n${role.description || ''}`;
  const jdLabel = `${role.title}${role.company ? ' @ ' + role.company : ''}`;
  const report = tailorResume(resumeText, jdText);
  const markdown = formatTailorReport(report, jdLabel);
  const summary = {
    coverage: report.coverage.pct,
    present: report.coverage.present.length,
    total: report.coverage.total,
    fullXYZ: report.xyz.fullXYZ,
    totalBullets: report.xyz.totalBullets,
    weak: report.weakBullets.length,
  };
  tailored.save(id, markdown, summary);
  return { id, ...summary };
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
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}

/**
 * The webapp server: interactive page at /, static board at /board, and a JSON API. Re-reads
 * the store on every request. Bound to 127.0.0.1 by the caller (local only) — no shell exec;
 * search only writes a request spec + returns a prompt, tailoring runs in-process.
 */
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const p = url.pathname;

      if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
      if (req.method === 'GET' && p === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderApp()); return;
      }
      if (req.method === 'GET' && p === '/board') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderLiveHtml()); return;
      }
      if (req.method === 'GET' && p === '/api/overview') {
        const agg = aggregate(store.load());
        sendJson(res, 200, { totals: agg.totals, funnel: agg.funnel, refined: tailored.refinedIds().size });
        return;
      }
      if (req.method === 'GET' && p === '/api/roles') {
        sendJson(res, 200, { roles: rolesPayload() }); return;
      }
      if (req.method === 'GET' && p === '/api/tailored') {
        const id = url.searchParams.get('id') || '';
        const rec = tailored.load(id);
        if (!rec) { sendJson(res, 404, { error: 'No tailored résumé for that role yet.' }); return; }
        sendJson(res, 200, { id, markdown: rec.markdown, meta: rec.meta }); return;
      }
      if (req.method === 'POST' && p === '/api/search') {
        const body = await readBody(req);
        const out = await runSearch(body);
        sendJson(res, 200, out); return;
      }
      if (req.method === 'POST' && p === '/api/tailor') {
        const body = await readBody(req);
        const out = refineRole(String(body.id || ''));
        sendJson(res, 200, out); return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.message });
    }
  });
}

function serve(port = DEFAULT_PORT) {
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Job Hunt webapp live at http://127.0.0.1:${port}  (Ctrl-C to stop)`);
  });
  return server;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const s = store.load();
  let mutated = false;

  if (args.apply) { store.setStatus(s, args.apply, 'applied'); mutated = true; }
  if (args.status) { store.setStatus(s, args.status, args.statusVal); mutated = true; }
  if (args.interview) { store.addInterview(s, args.interview, { kind: args.kind, notes: args.notes }); mutated = true; }
  if (mutated) { store.save(s); console.error('Store updated.'); }

  if (args.serve) { serve(args.port); return; } // long-running; the HUD button launches this

  const agg = aggregate(s);
  if (args.json) { process.stdout.write(JSON.stringify(agg, null, 2) + '\n'); return; }

  const outPath = path.resolve(args.out || 'dashboard.html');
  fs.writeFileSync(outPath, renderHtml(agg));
  console.log(renderTerminal(agg));
  console.log(`\nHTML dashboard → ${path.relative(process.cwd(), outPath)}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = {
  parseArgs, createServer, renderLiveHtml, serve, DEFAULT_PORT,
  rolesPayload, runSearch, refineRole,
};
