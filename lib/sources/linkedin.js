'use strict';
/**
 * LinkedIn job source.
 *
 * IMPORTANT — honesty about LinkedIn access:
 *   LinkedIn has NO first-party public job-search API for individuals. Their Jobs /
 *   Talent Solutions APIs are partner-gated (for employers/ATS vendors, approval
 *   required) and do not offer open job search. Scraping LinkedIn directly violates
 *   their ToS and hits anti-bot walls.
 *
 *   So this source targets a THIRD-PARTY LinkedIn-jobs provider (e.g. a RapidAPI
 *   "LinkedIn Jobs Search" endpoint, or Proxycurl) that relicenses LinkedIn data.
 *   You bring that provider's key. If you don't have one, the searcher falls back to
 *   Adzuna automatically.
 *
 * Config (all from the environment, never code):
 *   LINKEDIN_JOBS_API_KEY   — the provider key (required to activate this source)
 *   LINKEDIN_JOBS_API_HOST  — provider host (default: a RapidAPI-style host)
 *   LINKEDIN_JOBS_API_URL   — full override of the request URL base (optional)
 *
 * The HTTP layer is injectable (`httpGetJson`) so normalization/pagination are
 * unit-testable with fixtures, no key and no network.
 */

const DEFAULT_HOST = 'linkedin-jobs-search.p.rapidapi.com';

function credsPresent(env = process.env) {
  return Boolean(env.LINKEDIN_JOBS_API_KEY);
}

function requireCreds(env = process.env) {
  if (!env.LINKEDIN_JOBS_API_KEY) {
    const err = new Error(
      'Missing LINKEDIN_JOBS_API_KEY. LinkedIn has no first-party public job-search API — '
      + 'set the key for a third-party LinkedIn-jobs provider (e.g. a RapidAPI "LinkedIn Jobs '
      + 'Search" endpoint) to use this source, or omit it to search Adzuna instead.'
    );
    err.code = 'NO_CREDS';
    throw err;
  }
  return {
    key: env.LINKEDIN_JOBS_API_KEY,
    host: env.LINKEDIN_JOBS_API_HOST || DEFAULT_HOST,
    urlBase: env.LINKEDIN_JOBS_API_URL || null,
  };
}

async function defaultHttpGetJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`LinkedIn provider HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function buildUrl(params, page, creds) {
  const base = creds.urlBase || `https://${creds.host}/`;
  const qs = new URLSearchParams({ page: String(page) });
  if (params.title) qs.set('keyword', params.title);
  if (params.location) qs.set('location', params.location);
  // Provider field names vary; keyword/location/page are the common denominator.
  return `${base}${base.includes('?') ? '&' : '?'}${qs.toString()}`;
}

/** Tolerant normalization — providers use different field names for the same data. */
function normalize(r, params) {
  const pick = (...keys) => { for (const k of keys) if (r[k] != null && r[k] !== '') return r[k]; return null; };
  const id = pick('job_url', 'jobUrl', 'url', 'link', 'id') || `${pick('job_title', 'title') || 'role'}-${pick('company_name', 'company') || ''}`;
  return {
    id: `linkedin:${id}`,
    title: pick('job_title', 'title', 'jobTitle') || '',
    company: pick('company_name', 'company', 'companyName') || '',
    location: pick('job_location', 'location') || '',
    salaryMin: pick('salary_min', 'salaryMin') ?? null,
    salaryMax: pick('salary_max', 'salaryMax') ?? null,
    url: pick('job_url', 'jobUrl', 'url', 'link') || '',
    description: pick('job_description', 'description', 'snippet') || '',
    source: 'linkedin',
    query: { title: params.title || '', location: params.location || '' },
    created: pick('posted_date', 'postedAt', 'date', 'created') || null,
  };
}

function resultsFrom(data) {
  if (Array.isArray(data)) return data;
  for (const k of ['data', 'results', 'jobs', 'hits']) if (Array.isArray(data[k])) return data[k];
  return [];
}

async function fetchRoles(params = {}, target = 100, opts = {}) {
  const httpGetJson = opts.httpGetJson || defaultHttpGetJson;
  const creds = requireCreds(opts.env);
  const headers = { 'X-RapidAPI-Key': creds.key, 'X-RapidAPI-Host': creds.host };
  const roles = [];
  let page = 1;
  const maxPages = target + 5; // providers page in small increments; cap defensively
  while (roles.length < target && page <= maxPages) {
    const url = buildUrl(params, page, creds);
    const data = await httpGetJson(url, headers);
    const batch = resultsFrom(data);
    if (batch.length === 0) break;
    for (const r of batch) roles.push(normalize(r, params));
    page += 1;
  }
  return { roles: roles.slice(0, target), pages: page - 1, total: roles.length };
}

module.exports = { fetchRoles, buildUrl, normalize, requireCreds, credsPresent, DEFAULT_HOST };
