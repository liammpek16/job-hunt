'use strict';
/**
 * Lever job-board source — key-less, browser-free, ToS-clean (like the greenhouse source).
 *
 * Lever publishes an OFFICIAL public postings API:
 *   https://api.lever.co/v0/postings/<company>?mode=json
 * Plain JSON array of a company's open roles — no key, no browser, no HTML parsing. Given a
 * seed list of company tokens (lib/sources/lever-companies.json, or LEVER_COMPANIES / a
 * data/lever-companies.json override), it pulls every open posting, filters by title +
 * location + recency, dedupes, and normalizes to the shared role shape.
 *
 * All the generic machinery is in ./board-common; this file defines only Lever's URL,
 * job-array shape, and per-job normalization. HTTP is injectable via opts.httpGetJson.
 */
const path = require('path');
const common = require('./board-common');

const POSTINGS_API = 'https://api.lever.co/v0/postings';
const BOARD_CFG = {
  envVar: 'LEVER_COMPANIES',
  dataFileName: 'lever-companies.json',
  bundledFile: path.join(__dirname, 'lever-companies.json'),
};

function credsPresent() { return true; }

/** The postings endpoint for a company token (mode=json → a plain JSON array). */
function boardUrl(token) {
  return `${POSTINGS_API}/${encodeURIComponent(String(token).trim())}?mode=json`;
}

function resolveBoards(opts = {}) {
  return common.resolveBoards(opts, BOARD_CFG);
}

/** Normalize a Lever posting into the shared role shape (null if unusable). */
function normalize(job, company, params = {}) {
  if (!job || typeof job !== 'object') return null;
  const title = String(job.text || '').trim();
  if (!title) return null;
  const url = common.validPostingUrl(job.hostedUrl || job.applyUrl);
  if (!url) return null;
  const cats = job.categories || {};
  let location = String(cats.location || '').trim();
  // Fold Lever's workplaceType so remote roles match a located search.
  if (/^remote$/i.test(String(job.workplaceType || '')) && !/remote/i.test(location)) {
    location = location ? `${location} (Remote)` : 'Remote';
  }
  // createdAt is epoch ms → ISO for the shared recency filter.
  let created = null;
  if (job.createdAt != null && !Number.isNaN(Number(job.createdAt))) {
    created = new Date(Number(job.createdAt)).toISOString();
  }
  return {
    id: `lever:${url.toLowerCase()}`,
    title,
    company: company || '',
    location,
    salaryMin: null,
    salaryMax: null,
    url,
    description: job.descriptionPlain ? String(job.descriptionPlain) : common.stripHtml(job.description),
    source: 'lever',
    query: { title: params.title || '', location: params.location || '' },
    created,
  };
}

async function fetchRoles(params = {}, target = 100, opts = {}) {
  const boards = resolveBoards(opts);
  if (!boards.length) {
    const err = new Error(
      'No Lever boards configured. Add tokens to lib/sources/lever-companies.json, '
      + 'set LEVER_COMPANIES="tok1,tok2", or pass opts.companies.'
    );
    err.code = 'NO_BOARDS';
    throw err;
  }
  return common.harvest({
    boards, params, target,
    sinceDays: common.resolveSinceDays(params, opts),
    httpGetJson: opts.httpGetJson,
    label: 'Lever',
    urlFor: boardUrl,
    extractJobs: (data) => (Array.isArray(data) ? data : (Array.isArray(data && data.postings) ? data.postings : [])),
    normalizeJob: normalize,
  });
}

module.exports = { fetchRoles, normalize, credsPresent, boardUrl, resolveBoards, POSTINGS_API };
