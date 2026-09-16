'use strict';
/**
 * Greenhouse job-board source — a real, key-less, ToS-clean job "scraper".
 *
 * Unlike Adzuna (needs a key) and the third-party "linkedin" provider (needs a key), and
 * unlike scraping LinkedIn/Indeed (anti-bot + ToS violations that would require a headless
 * browser), Greenhouse publishes an OFFICIAL public Job Board API meant for exactly this:
 *
 *   https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true
 *
 * No key, no browser, no HTML parsing — plain JSON. Given a seed list of company board
 * tokens (lib/sources/greenhouse-companies.json, or GREENHOUSE_COMPANIES / a
 * data/greenhouse-companies.json override), this pulls every open posting from each board,
 * filters by title keywords + location + the recency window, dedupes, and normalizes to the
 * project's shared role shape. It reuses the same recency + URL-validity gates as the Claude
 * source, so it composes with the rest of the pipeline (relevance ranking, tailoring, ATS).
 *
 * The HTTP layer is injectable (`opts.httpGetJson`) so it is fully unit-testable with
 * fixtures — no network, no key.
 */
const fs = require('fs');
const path = require('path');
const { withinDays, validPostingUrl, DEFAULT_SINCE_DAYS } = require('./claude');

const BOARD_API = 'https://boards-api.greenhouse.io/v1/boards';
const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data');

/** This source needs no credentials — Greenhouse boards are public. */
function credsPresent() { return true; }

/** The board-jobs endpoint for a company token (content=true includes the JD HTML). */
function boardUrl(token) {
  return `${BOARD_API}/${encodeURIComponent(String(token).trim())}/jobs?content=true`;
}

/** Default real HTTP getter (Node 18+ global fetch). Returns parsed JSON, or throws. */
async function defaultHttpGetJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`Greenhouse HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Resolve the seed boards. Priority: opts.companies (array of {token,name} or "token"
 * strings) → GREENHOUSE_COMPANIES env ("tok1,tok2") → data/greenhouse-companies.json →
 * the bundled seed file. Always returns [{token, name}].
 */
function resolveBoards(opts = {}) {
  const norm = (list) => (list || [])
    .map((c) => (typeof c === 'string' ? { token: c, name: c } : c))
    .filter((c) => c && c.token)
    .map((c) => ({ token: String(c.token).trim(), name: String(c.name || c.token).trim() }));

  if (Array.isArray(opts.companies) && opts.companies.length) return norm(opts.companies);

  const env = opts.env || process.env;
  if (env.GREENHOUSE_COMPANIES) {
    return norm(env.GREENHOUSE_COMPANIES.split(',').map((t) => t.trim()).filter(Boolean));
  }
  const override = path.join(opts.dataDir || DEFAULT_DATA_DIR, 'greenhouse-companies.json');
  for (const file of [override, path.join(__dirname, 'greenhouse-companies.json')]) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const boards = Array.isArray(j) ? j : j.boards;
      if (Array.isArray(boards) && boards.length) return norm(boards);
    } catch { /* try the next source */ }
  }
  return [];
}

/** Lowercased significant tokens (len >= 2) of a string. */
function terms(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length >= 2);
}

/** Title matches when EVERY query term appears somewhere in the role title. */
function titleMatches(title, query) {
  const q = terms(query);
  if (!q.length) return true;
  const t = new Set(terms(title));
  return q.every((w) => t.has(w) || String(title).toLowerCase().includes(w));
}

/**
 * Location matches when the role's location shares any significant term with the query, or
 * the role is remote. No query location → match all. ("New York City" ~ "New York, NY".)
 */
function locationMatches(location, query) {
  const q = terms(query).filter((w) => w.length >= 3);
  if (!q.length) return true;
  const loc = String(location || '').toLowerCase();
  if (/\bremote\b/.test(loc)) return true;
  return q.some((w) => loc.includes(w));
}

/** Strip HTML tags/entities from a Greenhouse JD so the description is plain text. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a Greenhouse job into the project's shared role shape (null if unusable). */
function normalize(job, company, params = {}) {
  if (!job || typeof job !== 'object') return null;
  const title = String(job.title || '').trim();
  if (!title) return null;
  const url = validPostingUrl(job.absolute_url);
  if (!url) return null; // must link to a real posting
  return {
    id: `greenhouse:${url.toLowerCase()}`,
    title,
    company: company || (job.company_name ? String(job.company_name) : ''),
    location: (job.location && job.location.name) ? String(job.location.name).trim() : '',
    salaryMin: null, // Greenhouse boards rarely expose salary in the list payload
    salaryMax: null,
    url,
    description: stripHtml(job.content),
    source: 'greenhouse',
    query: { title: params.title || '', location: params.location || '' },
    created: job.updated_at || job.first_published || null,
  };
}

/**
 * Pull roles from every seed board, filter (title + location + recency), dedupe, cap at
 * `target`. Resolves { roles, pages, total, recent, stale, sinceDays, boards, errors }.
 *   roles  — RECENT, matching, de-duplicated roles (the ones to ingest)
 *   total  — distinct matching roles before the recency filter
 *   boards — how many boards were successfully fetched
 */
async function fetchRoles(params = {}, target = 100, opts = {}) {
  const httpGetJson = opts.httpGetJson || defaultHttpGetJson;
  const sinceDays = params.sinceDays != null ? Number(params.sinceDays)
    : (opts.sinceDays != null ? Number(opts.sinceDays) : DEFAULT_SINCE_DAYS);
  const boards = resolveBoards(opts);
  if (!boards.length) {
    const err = new Error(
      'No Greenhouse boards configured. Add company tokens to lib/sources/greenhouse-companies.json, '
      + 'set GREENHOUSE_COMPANIES="tok1,tok2", or pass opts.companies.'
    );
    err.code = 'NO_BOARDS';
    throw err;
  }

  const now = Date.now();
  const seen = new Set();
  const matched = [];   // distinct + title/location match (pre-recency)
  const recent = [];    // matched AND within the recency window
  let fetched = 0;
  const errors = [];

  for (const board of boards) {
    if (recent.length >= target) break;
    let data;
    try { data = await httpGetJson(boardUrl(board.token)); }
    catch (e) { errors.push({ token: board.token, error: e.message }); continue; }
    fetched += 1;
    const jobs = Array.isArray(data && data.jobs) ? data.jobs : [];
    for (const job of jobs) {
      const role = normalize(job, board.name, params);
      if (!role) continue;
      if (!titleMatches(role.title, params.title)) continue;
      if (!locationMatches(role.location, params.location)) continue;
      if (seen.has(role.id)) continue;
      seen.add(role.id);
      matched.push(role);
      if (withinDays(role.created, sinceDays, now)) recent.push(role);
    }
  }

  return {
    roles: recent.slice(0, target),
    pages: fetched,
    total: matched.length,
    recent: recent.length,
    stale: matched.length - recent.length,
    sinceDays,
    boards: boards.length,
    errors,
  };
}

module.exports = {
  fetchRoles, normalize, credsPresent, boardUrl, resolveBoards,
  titleMatches, locationMatches, stripHtml, BOARD_API,
};
