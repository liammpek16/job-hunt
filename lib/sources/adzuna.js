'use strict';
/**
 * Adzuna job source.
 *
 * Adzuna is a legal, free-tier job aggregator (developer.adzuna.com): a free
 * app_id + app_key, real listings across many boards, and title/location/salary
 * filters with pagination — so it can reliably surface >=100 roles, which is the
 * roadmap's hard requirement and the reason we picked an official API over scraping.
 *
 * Credentials come from the environment, never from code or a job board:
 *   ADZUNA_APP_ID, ADZUNA_APP_KEY
 *
 * The HTTP layer is injectable (`httpGetJson`) so pagination/normalization are
 * unit-testable with fixtures and no network / no key.
 */

const RESULTS_PER_PAGE = 50; // Adzuna's max per page.
const API_BASE = 'https://api.adzuna.com/v1/api/jobs';

/** Default real HTTP getter (Node 18+ global fetch). */
async function defaultHttpGetJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Adzuna HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function requireCreds(env = process.env) {
  const app_id = env.ADZUNA_APP_ID;
  const app_key = env.ADZUNA_APP_KEY;
  if (!app_id || !app_key) {
    const err = new Error(
      'Missing ADZUNA_APP_ID / ADZUNA_APP_KEY. Get a free key at developer.adzuna.com, then set them in the environment.'
    );
    err.code = 'NO_CREDS';
    throw err;
  }
  return { app_id, app_key };
}

/** Build a single search-page URL. `params` = {title, location, salaryMin, salaryMax, country}. */
function buildUrl(params, page, creds) {
  const country = (params.country || 'us').toLowerCase();
  const qs = new URLSearchParams({
    app_id: creds.app_id,
    app_key: creds.app_key,
    results_per_page: String(RESULTS_PER_PAGE),
    'content-type': 'application/json',
  });
  if (params.title) qs.set('what', params.title);
  if (params.location) qs.set('where', params.location);
  if (params.salaryMin != null) qs.set('salary_min', String(params.salaryMin));
  if (params.salaryMax != null) qs.set('salary_max', String(params.salaryMax));
  return `${API_BASE}/${country}/search/${page}?${qs.toString()}`;
}

/** Normalize an Adzuna result into the project's shared role shape. */
function normalize(r, params) {
  return {
    id: `adzuna:${r.id}`,
    title: r.title || '',
    company: (r.company && r.company.display_name) || '',
    location: (r.location && r.location.display_name) || '',
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    url: r.redirect_url || '',
    description: r.description || '',
    source: 'adzuna',
    query: { title: params.title || '', location: params.location || '' },
    created: r.created || null,
  };
}

/**
 * Fetch up to `target` normalized roles, paginating as needed.
 * Options: { httpGetJson, env } for testing. Resolves { roles, pages, total }.
 */
async function fetchRoles(params = {}, target = 100, opts = {}) {
  const httpGetJson = opts.httpGetJson || defaultHttpGetJson;
  const creds = requireCreds(opts.env);
  const roles = [];
  let page = 1;
  let total = null;
  const maxPages = Math.ceil(target / RESULTS_PER_PAGE) + 5; // safety cap
  while (roles.length < target && page <= maxPages) {
    const url = buildUrl(params, page, creds);
    const data = await httpGetJson(url);
    if (total == null && typeof data.count === 'number') total = data.count;
    const batch = Array.isArray(data.results) ? data.results : [];
    if (batch.length === 0) break; // no more results
    for (const r of batch) roles.push(normalize(r, params));
    page += 1;
  }
  return { roles: roles.slice(0, target), pages: page - 1, total };
}

module.exports = { fetchRoles, buildUrl, normalize, requireCreds, RESULTS_PER_PAGE };
