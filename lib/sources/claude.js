'use strict';
/**
 * Claude Code job source — run the searcher on the Claude Code SUBSCRIPTION, with
 * NO API key and NO metered credits (goal: "make the searcher runnable using my
 * claude code subscription rather than api credits").
 *
 * Every other source (adzuna, linkedin) needs a paid/keyed jobs API. This one has no
 * credentials at all. It mirrors the Admin Brain "$0 harness hands the reasoning to
 * Claude Code" pattern: a deterministic two-phase FILE HANDOFF.
 *
 *   Phase 1 (no results yet): fetchRoles writes a request spec
 *     data/claude-search-<slug>.request.json
 *   and throws a HANDOFF_PENDING error carrying the exact prompt for Claude Code to
 *   run. The CLI prints that prompt and exits with the handoff code (4).
 *
 *   Phase 2 (Claude has answered): Claude Code performs the web search on the
 *   subscription and writes the roles it found to
 *     data/claude-search-<slug>.results.json
 *   (a JSON array, or { roles: [...] }, in the shared role shape). Re-running the
 *   searcher with --source claude reads, validates, normalizes and dedupes that file
 *   into the shared store — same records the customizer / ATS / dashboard already read.
 *
 * No network, no key: unit-testable by pointing `opts.dataDir` at a temp directory.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data');

/** This source never needs credentials — it runs on the Claude Code subscription. */
function credsPresent() {
  return true;
}

/** Stable slug for a search's handoff files (title + location). */
function slugFor(params = {}) {
  const base = `${params.title || 'roles'}-${params.location || 'anywhere'}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'search';
}

function dataDir(opts = {}) {
  return opts.dataDir || DEFAULT_DATA_DIR;
}
function requestPath(params, opts = {}) {
  return path.join(dataDir(opts), `claude-search-${slugFor(params)}.request.json`);
}
function resultsPath(params, opts = {}) {
  return path.join(dataDir(opts), `claude-search-${slugFor(params)}.results.json`);
}

/** The copy-pasteable instruction handed to Claude Code to run the search on the subscription. */
function buildPrompt(params, target, files) {
  const sal = params.salaryMin != null ? ` with salary at least $${params.salaryMin}` : '';
  return [
    `Search the web for real, currently-open job postings matching:`,
    `  • Title:    ${params.title || '(any)'}`,
    `  • Location: ${params.location || '(any)'}${sal}`,
    `  • Target:   at least ${target} distinct roles (the roadmap's >=100 bar).`,
    ``,
    `Use LinkedIn, Indeed, company career pages and aggregators. For EACH role collect:`,
    `  title, company, location, salaryMin, salaryMax (numbers or null), url, description, created (ISO or null).`,
    ``,
    `IMPORTANT: only include REAL, currently-open postings. Every role MUST have a working`,
    `absolute http(s) "url" to the actual listing — roles with no valid posting URL are dropped`,
    `on ingest (do not invent placeholder links or roles).`,
    ``,
    `Write the results as a JSON array to:`,
    `  ${files.results}`,
    `Each element: { "title", "company", "location", "salaryMin", "salaryMax", "url", "description", "created" }.`,
    `Then re-run:  node skills/searcher/searcher.js --title "${params.title || ''}"` +
      (params.location ? ` --location "${params.location}"` : '') +
      `  (it will ingest that file into the store — no API key needed).`,
  ].join('\n');
}

/**
 * A role must link to a real, openable posting. Accept only a syntactically valid absolute
 * http(s) URL — this is the gate that stops "non-existent jobs" (hallucinated or unverifiable
 * entries) from being surfaced: a listing you can't open is, to the user, not a real job.
 * ($0/no-network — we validate the URL's SHAPE, not that the server is up.)
 */
function validPostingUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || !u.hostname.includes('.')) return null; // needs a real host, not "localhost"/bare
  return u.href;
}

/** Map a loose role object (as Claude writes it) into the project's shared role shape. */
function normalize(r, params = {}) {
  if (!r || typeof r !== 'object') return null;
  const title = String(r.title || '').trim();
  if (!title) return null; // a role must at least have a title
  const url = validPostingUrl(r.url);
  if (!url) return null; // no valid, openable posting link → treat as a non-existent job, drop it
  const company = String(r.company || '').trim();
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  // Stable id: the (now-guaranteed) posting URL keeps dedupe meaningful across sources.
  const key = url.toLowerCase();
  return {
    id: r.id ? String(r.id) : `claude:${key}`,
    title,
    company,
    location: String(r.location || '').trim(),
    salaryMin: num(r.salaryMin != null ? r.salaryMin : r.salary_min),
    salaryMax: num(r.salaryMax != null ? r.salaryMax : r.salary_max),
    url,
    description: String(r.description || ''),
    source: 'claude',
    query: { title: params.title || '', location: params.location || '' },
    created: r.created || null,
  };
}

/**
 * Two-phase handoff. Resolves { roles, pages, total } once Claude's results file exists;
 * otherwise writes the request spec and throws a HANDOFF_PENDING error carrying the prompt.
 */
async function fetchRoles(params = {}, target = 100, opts = {}) {
  const results = resultsPath(params, opts);
  const request = requestPath(params, opts);

  if (!fs.existsSync(results)) {
    fs.mkdirSync(dataDir(opts), { recursive: true });
    const spec = {
      title: params.title || '',
      location: params.location || '',
      salaryMin: params.salaryMin ?? null,
      salaryMax: params.salaryMax ?? null,
      country: params.country || 'us',
      target,
      resultsFile: results,
      created: new Date().toISOString(),
    };
    fs.writeFileSync(request, JSON.stringify(spec, null, 2));
    const prompt = buildPrompt(params, target, { request, results });
    const err = new Error(
      `Claude Code handoff pending — no results file yet.\n\n${prompt}\n\n` +
      `(Request spec written to ${request}.)`
    );
    err.code = 'HANDOFF_PENDING';
    err.requestFile = request;
    err.resultsFile = results;
    err.prompt = prompt;
    throw err;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(results, 'utf8'));
  } catch (e) {
    const err = new Error(`Results file ${results} is not valid JSON: ${e.message}`);
    err.code = 'BAD_RESULTS';
    throw err;
  }
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.roles) ? raw.roles : [];
  const seen = new Set();
  const roles = [];
  for (const r of arr) {
    const n = normalize(r, params);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    roles.push(n);
  }
  return { roles: roles.slice(0, target), pages: 1, total: roles.length };
}

module.exports = { fetchRoles, normalize, validPostingUrl, credsPresent, slugFor, requestPath, resultsPath, buildPrompt };
