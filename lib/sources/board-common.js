'use strict';
/**
 * board-common.js — shared machinery for key-less, browser-free ATS "board" sources
 * (Greenhouse, Lever, Ashby). Each of those publishes an OFFICIAL public JSON API listing a
 * company's open roles; the only per-platform differences are the URL, how to pull the job
 * array out of the response, and how to map one job to our shared role shape.
 *
 * This module owns everything common: the seed-board resolver, title/location/recency
 * filtering, dedupe, HTML stripping, and the fetch-all-boards harvest loop. A source file is
 * then ~30 lines: a URL builder, an `extractJobs`, and a `normalizeJob`.
 */
const fs = require('fs');
const path = require('path');
const { withinDays, validPostingUrl, DEFAULT_SINCE_DAYS } = require('./claude');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data');

/** Lowercased significant tokens (len >= 2) of a string. */
function terms(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length >= 2);
}

/** Title matches when EVERY query term appears somewhere in the role title. */
function titleMatches(title, query) {
  const q = terms(query);
  if (!q.length) return true;
  const set = new Set(terms(title));
  const lc = String(title).toLowerCase();
  return q.every((w) => set.has(w) || lc.includes(w));
}

// Words that make a remote role location-agnostic (relevant to any country's seeker).
const AGNOSTIC = ['global', 'worldwide', 'anywhere', 'international', 'distributed'];
// Region markers that are NOT the US (so a US search should skip a role scoped to them).
const NON_US_REGIONS = ['emea', 'apac', 'latam', 'anz', 'mena'];
// Country hints keyed by ISO code. Multi-word hints are matched as substrings; single
// tokens are matched whole-word (so "us" never matches inside "Houston").
const COUNTRY_HINTS = {
  us: ['united states', 'usa', 'u.s', 'us', 'america', 'americas', 'north america', 'stateside', 'nationwide'],
  uk: ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'britain', 'london'],
  ca: ['canada'], ie: ['ireland'], de: ['germany'], fr: ['france'], es: ['spain'],
  nl: ['netherlands'], pl: ['poland'], se: ['sweden'], au: ['australia'], nz: ['new zealand'],
  sg: ['singapore'], in: ['india'], br: ['brazil'], mx: ['mexico'], jp: ['japan'],
  cn: ['china'], ph: ['philippines'], ng: ['nigeria'], za: ['south africa'], ae: ['dubai', 'uae'],
};

/** Does a location string contain a hint? Multi-word → substring; single word → whole token. */
function hasHint(loc, locTokens, hint) {
  return hint.includes(' ') ? loc.includes(hint) : locTokens.has(hint);
}

/**
 * Location matches when the role's location shares a significant term with the query, or the
 * role is remote in a country-compatible way. No query location → match all.
 *
 * The remote rule is the important part: a remote posting matches only when it is
 *   • location-agnostic (pure "Remote", or "Remote (Global/Worldwide/Anywhere)"), or
 *   • scoped to the query's own country / a compatible US region, or
 *   • scoped to somewhere we can't identify as foreign (e.g. a US city like "SF (Remote)").
 * A remote posting that names a clearly FOREIGN country/region (e.g. "United Kingdom, Remote",
 * "India (Remote)", "Remote - EMEA" for a US search) is dropped — that was the bug.
 *
 * `country` is the query's ISO country (default "us").
 */
function locationMatches(location, query, country = 'us') {
  const q = terms(query).filter((w) => w.length >= 3);
  if (!q.length) return true;
  const loc = String(location || '').toLowerCase();

  // Direct location overlap (e.g. "New York City" ~ "New York, NY") — country-independent.
  if (q.some((w) => loc.includes(w))) return true;
  return remoteInCountry(location, country);
}

/**
 * Is this a remote role a seeker in `country` (ISO, default "us") can take? True when it's
 * remote and location-agnostic, scoped to that country, or not identifiably foreign.
 */
function remoteInCountry(location, country = 'us') {
  const loc = String(location || '').toLowerCase();
  if (!/\bremote\b/.test(loc)) return false;
  const locTokens = new Set(terms(loc));

  const qc = String(country || 'us').toLowerCase();
  const queryHints = COUNTRY_HINTS[qc] || [qc];
  if (queryHints.some((h) => hasHint(loc, locTokens, h))) return true;      // remote in the query's country
  if (AGNOSTIC.some((w) => locTokens.has(w))) return true;                  // remote (global/anywhere)

  // Clearly foreign remote → drop it.
  for (const [code, hints] of Object.entries(COUNTRY_HINTS)) {
    if (code === qc) continue;
    if (hints.some((h) => hasHint(loc, locTokens, h))) return false;
  }
  if (qc === 'us' && NON_US_REGIONS.some((r) => locTokens.has(r))) return false;
  if (qc !== 'us') return true;
  if (FOREIGN_PLACES.some((p) => hasHint(loc, locTokens, p))) return false; // e.g. "CO-Colombia-Remote"

  // US: the hint list can't name every foreign city ("Bangalore (Remote)", "Seoul, South Korea
  // (Remote)"), so require a positive US signal: bare "Remote", or a US state/city.
  const rest = [...locTokens].filter((t) => !REMOTE_FILLER.has(t));
  if (!rest.length) return true;
  if (usPlace(location, loc, locTokens)) return true;
  return false;
}

// Foreign countries/cities not in COUNTRY_HINTS, checked before US state codes so
// "CO-Colombia-Remote" isn't read as Colorado.
const FOREIGN_PLACES = ['colombia', 'argentina', 'chile', 'peru', 'costa rica', 'uruguay', 'ecuador',
  'guatemala', 'south korea', 'korea', 'switzerland', 'austria', 'belgium', 'denmark', 'norway',
  'finland', 'portugal', 'italy', 'czech', 'czechia', 'romania', 'hungary', 'greece', 'turkey',
  'israel', 'egypt', 'kenya', 'saudi', 'qatar', 'pakistan', 'bangladesh', 'vietnam', 'thailand',
  'malaysia', 'indonesia', 'taiwan', 'hong kong', 'ukraine', 'serbia', 'bulgaria', 'croatia',
  'estonia', 'lithuania', 'latvia', 'bangalore', 'bengaluru', 'hyderabad', 'pune', 'chennai',
  'toronto', 'vancouver', 'montreal', 'tel aviv', 'berlin', 'paris', 'amsterdam', 'dublin', 'sydney',
  'melbourne', 'tokyo', 'seoul', 'sao paulo', 'buenos aires', 'mexico city', 'bogota', 'zurich',
  'warsaw', 'lisbon', 'madrid', 'barcelona', 'stockholm', 'copenhagen', 'oslo', 'helsinki', 'munich',
  'prague', 'emea', 'apac', 'europe', 'asia'];

// Words that say nothing about where a remote role is ("Remote - East Coast, flexible").
const REMOTE_FILLER = new Set(['remote', 'hybrid', 'only', 'based', 'in', 'the', 'first', 'friendly',
  'flexible', 'from', 'within', 'any', 'location', 'locations', 'region', 'east', 'west', 'central',
  'coast', 'timezone', 'timezones', 'time', 'zone', 'zones', 'est', 'pst', 'cst', 'mst', 'et', 'pt',
  'ct', 'mt', 'team', 'office', 'of', 'or', 'and', 'opportunity', 'work', 'home', 'wfh']);
const US_STATE_CODES = new Set(('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN '
  + 'MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC').split(' '));
const US_STATES = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas',
  'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming'];
const US_CITIES = ['sf', 'sfo', 'nyc', 'san francisco', 'bay area', 'los angeles', 'seattle', 'austin',
  'boston', 'chicago', 'denver', 'atlanta', 'dallas', 'houston', 'miami', 'phoenix', 'portland',
  'san diego', 'san jose', 'philadelphia', 'pittsburgh', 'raleigh', 'salt lake city', 'nashville',
  'minneapolis', 'detroit', 'columbus', 'charlotte', 'brooklyn', 'manhattan', 'cambridge', 'palo alto',
  'mountain view', 'menlo park', 'sunnyvale', 'santa clara', 'oakland', 'berkeley', 'boulder'];

/** Does the location name a US state (name or 2-letter code) or a major US city? */
function usPlace(raw, loc, locTokens) {
  if (String(raw).split(/[^A-Za-z]+/).some((t) => US_STATE_CODES.has(t))) return true;
  return [...US_STATES, ...US_CITIES].some((p) => hasHint(loc, locTokens, p));
}

/** Strip HTML tags/entities so a JD is plain text. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How long to wait before retrying a 429: Retry-After when it's short, else exponential backoff.
 * null when Retry-After exceeds 30 s — not worth blocking a scan for.
 */
function retryWaitMs(res, attempt) {
  const after = Number(res.headers.get('retry-after'));
  if (Number.isFinite(after) && after > 30) return null;
  return Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** attempt;
}

/**
 * Default real HTTP getter (Node 18+ global fetch). Returns parsed JSON, or throws. A 429
 * (rate limited — Workable does this) is retried a few times, honouring Retry-After.
 */
async function defaultHttpGetJson(url, label = 'Board') {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status !== 429 || attempt >= 3) break;
    const wait = retryWaitMs(res, attempt);
    if (wait == null) break; // told to come back much later (Workable can say ~24 h): give up
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) {
    const err = new Error(`${label} HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Coerce a list of "token" strings or {token,name} objects to [{token, name}]. */
function normalizeBoards(list) {
  return (list || [])
    .map((c) => (typeof c === 'string' ? { token: c, name: c } : c))
    .filter((c) => c && c.token)
    .map((c) => ({ token: String(c.token).trim(), name: String(c.name || c.token).trim() }));
}

/**
 * Resolve seed boards. Priority: opts.companies → env[cfg.envVar] ("tok1,tok2") →
 * data/<cfg.dataFileName> → cfg.bundledFile. Returns [{token, name}].
 */
function resolveBoards(opts = {}, cfg = {}) {
  if (Array.isArray(opts.companies) && opts.companies.length) return normalizeBoards(opts.companies);
  const env = opts.env || process.env;
  if (cfg.envVar && env[cfg.envVar]) {
    return normalizeBoards(env[cfg.envVar].split(',').map((t) => t.trim()).filter(Boolean));
  }
  const override = path.join(opts.dataDir || DEFAULT_DATA_DIR, cfg.dataFileName || '');
  for (const file of [override, cfg.bundledFile].filter(Boolean)) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const boards = Array.isArray(j) ? j : j.boards;
      if (Array.isArray(boards) && boards.length) return normalizeBoards(boards);
    } catch { /* try the next source */ }
  }
  return [];
}

/**
 * Fetch every board, filter (title + location + recency), dedupe, cap at target.
 * cfg: { boards, params, target, sinceDays, httpGetJson, label, urlFor(token),
 *        extractJobs(data)->[], normalizeJob(job, boardName, params)->role|null }
 * Optional hooks (used by the watchlist scan and paginated sources):
 *   fetchJobs(board, httpGetJson) -> Promise<job[]>   replaces urlFor + extractJobs
 *   filter(role) -> boolean                            replaces the title/location query match
 *   enrich(role, job, board, httpGetJson) -> Promise   runs only on matched roles (e.g. fetch a JD)
 * Resolves { roles, pages, total, recent, stale, sinceDays, boards, errors, scanned, onBoard },
 * where `scanned` lists the board tokens fetched successfully and `onBoard` maps each of those
 * tokens to the ids of EVERY posting on it (filtered or not), for closed-job detection.
 */
async function harvest(cfg) {
  const { boards, params = {}, target = 100, sinceDays = DEFAULT_SINCE_DAYS,
    httpGetJson = defaultHttpGetJson, label = 'Board', urlFor, extractJobs, normalizeJob,
    fetchJobs, filter, enrich } = cfg;
  const now = Date.now();
  const seen = new Set();
  const matched = [];
  const recent = [];
  let fetched = 0;
  const errors = [];
  const scanned = [];
  const onBoard = {};
  const keep = filter || ((role) => titleMatches(role.title, params.title)
    && locationMatches(role.location, params.location, params.country));

  for (const board of boards) {
    if (recent.length >= target) break;
    let jobs;
    try {
      jobs = fetchJobs
        ? await fetchJobs(board, httpGetJson)
        : (extractJobs(await httpGetJson(urlFor(board.token), label)) || []);
    } catch (e) { errors.push({ token: board.token, error: e.message }); continue; }
    fetched += 1;
    scanned.push(board.token);
    onBoard[board.token] = [];
    for (const job of jobs) {
      const role = normalizeJob(job, board.name, params);
      if (!role) continue;
      onBoard[board.token].push(role.id);
      if (!keep(role)) continue;
      if (seen.has(role.id)) continue;
      seen.add(role.id);
      if (enrich) {
        try { await enrich(role, job, board, httpGetJson); } catch { /* keep the role without extras */ }
      }
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
    scanned,
    onBoard,
  };
}

/** Resolve the recency window from params/opts (default 7). */
function resolveSinceDays(params = {}, opts = {}) {
  if (params.sinceDays != null) return Number(params.sinceDays);
  if (opts.sinceDays != null) return Number(opts.sinceDays);
  return DEFAULT_SINCE_DAYS;
}

module.exports = {
  terms, titleMatches, locationMatches, remoteInCountry, stripHtml, retryWaitMs, defaultHttpGetJson,
  normalizeBoards, resolveBoards, harvest, resolveSinceDays, validPostingUrl,
  DEFAULT_DATA_DIR, DEFAULT_SINCE_DAYS,
};
