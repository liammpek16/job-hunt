'use strict';
/**
 * Workable job-board source — key-less, browser-free.
 *
 * Workable serves each company's public job widget as JSON:
 *   https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true
 * → { name, description, jobs: [{ title, url, published_on, city, state, country,
 *     telecommuting, description, … }] }. Unknown slugs return 404.
 *
 * Seed boards: lib/sources/workable-companies.json, WORKABLE_COMPANIES, or a
 * data/workable-companies.json override. The watchlist scan passes its own boards.
 */
const path = require('path');
const common = require('./board-common');

const WIDGET_API = 'https://apply.workable.com/api/v1/widget/accounts';
const BOARD_CFG = {
  envVar: 'WORKABLE_COMPANIES',
  dataFileName: 'workable-companies.json',
  bundledFile: path.join(__dirname, 'workable-companies.json'),
};

function credsPresent() { return true; }

function boardUrl(token) {
  return `${WIDGET_API}/${encodeURIComponent(String(token).trim())}?details=true`;
}

function resolveBoards(opts = {}) {
  return common.resolveBoards(opts, BOARD_CFG);
}

function normalize(job, company, params = {}) {
  if (!job || typeof job !== 'object') return null;
  const title = String(job.title || '').trim();
  if (!title) return null;
  const url = common.validPostingUrl(job.url || job.shortlink);
  if (!url) return null;
  let location = [job.city, job.state, job.country].filter(Boolean).join(', ');
  if (job.telecommuting && !/remote/i.test(location)) location = location ? `${location} (Remote)` : 'Remote';
  return {
    id: `workable:${url.toLowerCase()}`,
    title,
    company: company || '',
    location,
    salaryMin: null,
    salaryMax: null,
    url,
    description: common.stripHtml(job.description),
    source: 'workable',
    query: { title: params.title || '', location: params.location || '' },
    created: job.published_on || job.created_at || null,
  };
}

async function fetchRoles(params = {}, target = 100, opts = {}) {
  const boards = resolveBoards(opts);
  if (!boards.length) {
    const err = new Error(
      'No Workable boards configured. Add account slugs to lib/sources/workable-companies.json, '
      + 'set WORKABLE_COMPANIES="slug1,slug2", or pass opts.companies.'
    );
    err.code = 'NO_BOARDS';
    throw err;
  }
  return common.harvest({
    boards, params, target,
    sinceDays: common.resolveSinceDays(params, opts),
    httpGetJson: opts.httpGetJson,
    label: 'Workable',
    urlFor: boardUrl,
    extractJobs: (data) => (Array.isArray(data && data.jobs) ? data.jobs : []),
    normalizeJob: normalize,
    filter: opts.filter,
  });
}

module.exports = { fetchRoles, normalize, credsPresent, boardUrl, resolveBoards, WIDGET_API };
