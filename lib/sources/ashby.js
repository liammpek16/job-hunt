'use strict';
/**
 * Ashby job-board source — key-less, browser-free, ToS-clean (like the greenhouse source).
 *
 * Ashby publishes an OFFICIAL public job-board API:
 *   https://api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true
 * JSON `{ jobs: [...] }` of a company's open roles — no key, no browser, no HTML parsing.
 * Given a seed list of org slugs (lib/sources/ashby-companies.json, or ASHBY_COMPANIES / a
 * data/ashby-companies.json override), it pulls every open posting, filters by title +
 * location + recency, dedupes, and normalizes to the shared role shape.
 *
 * The generic machinery is in ./board-common; this file defines only Ashby's URL, job-array
 * shape, and per-job normalization. HTTP is injectable via opts.httpGetJson.
 */
const path = require('path');
const common = require('./board-common');

const BOARD_API = 'https://api.ashbyhq.com/posting-api/job-board';
const BOARD_CFG = {
  envVar: 'ASHBY_COMPANIES',
  dataFileName: 'ashby-companies.json',
  bundledFile: path.join(__dirname, 'ashby-companies.json'),
};

function credsPresent() { return true; }

/** The job-board endpoint for an org slug (includeCompensation surfaces salary when public). */
function boardUrl(token) {
  return `${BOARD_API}/${encodeURIComponent(String(token).trim())}?includeCompensation=true`;
}

function resolveBoards(opts = {}) {
  return common.resolveBoards(opts, BOARD_CFG);
}

/** Pull a numeric min/max out of Ashby's compensation payload when present (else null). */
function salaryFrom(comp) {
  const out = { salaryMin: null, salaryMax: null };
  const ranges = comp && Array.isArray(comp.compensationTiers) ? comp.compensationTiers : [];
  for (const tier of ranges) {
    for (const c of (Array.isArray(tier.components) ? tier.components : [])) {
      if (c && /salary|base/i.test(String(c.summary || c.compensationType || '')) ) {
        if (c.minValue != null && (out.salaryMin == null || c.minValue < out.salaryMin)) out.salaryMin = Number(c.minValue);
        if (c.maxValue != null && (out.salaryMax == null || c.maxValue > out.salaryMax)) out.salaryMax = Number(c.maxValue);
      }
    }
  }
  return out;
}

/** Normalize an Ashby job into the shared role shape (null if unusable). */
function normalize(job, company, params = {}) {
  if (!job || typeof job !== 'object') return null;
  const title = String(job.title || '').trim();
  if (!title) return null;
  const url = common.validPostingUrl(job.jobUrl || job.applyUrl);
  if (!url) return null;
  let location = String(job.location || '').trim();
  if (job.isRemote && !/remote/i.test(location)) location = location ? `${location} (Remote)` : 'Remote';
  const sal = salaryFrom(job.compensation);
  return {
    id: `ashby:${url.toLowerCase()}`,
    title,
    company: company || '',
    location,
    salaryMin: sal.salaryMin,
    salaryMax: sal.salaryMax,
    url,
    description: job.descriptionPlain ? String(job.descriptionPlain) : common.stripHtml(job.descriptionHtml),
    source: 'ashby',
    query: { title: params.title || '', location: params.location || '' },
    created: job.publishedAt || null,
  };
}

async function fetchRoles(params = {}, target = 100, opts = {}) {
  const boards = resolveBoards(opts);
  if (!boards.length) {
    const err = new Error(
      'No Ashby boards configured. Add org slugs to lib/sources/ashby-companies.json, '
      + 'set ASHBY_COMPANIES="org1,org2", or pass opts.companies.'
    );
    err.code = 'NO_BOARDS';
    throw err;
  }
  return common.harvest({
    boards, params, target,
    sinceDays: common.resolveSinceDays(params, opts),
    httpGetJson: opts.httpGetJson,
    label: 'Ashby',
    urlFor: boardUrl,
    extractJobs: (data) => (Array.isArray(data && data.jobs) ? data.jobs : []),
    normalizeJob: normalize,
    filter: opts.filter,
  });
}

module.exports = { fetchRoles, normalize, credsPresent, boardUrl, resolveBoards, salaryFrom, BOARD_API };
