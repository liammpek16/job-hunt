'use strict';
/**
 * SmartRecruiters job-board source — key-less, browser-free.
 *
 * SmartRecruiters publishes an OFFICIAL public Posting API:
 *   https://api.smartrecruiters.com/v1/companies/<companyIdentifier>/postings?limit=100&offset=N
 * The list has no job description, so the JD is fetched per posting (only for roles that pass
 * the filter) from /postings/<id>. Unknown company identifiers return 200 with no postings.
 *
 * Seed boards: lib/sources/smartrecruiters-companies.json, SMARTRECRUITERS_COMPANIES, or a
 * data/smartrecruiters-companies.json override. The watchlist scan passes its own boards.
 */
const path = require('path');
const common = require('./board-common');

const API = 'https://api.smartrecruiters.com/v1/companies';
const PAGE = 100;
const MAX_PAGES = 10;
const BOARD_CFG = {
  envVar: 'SMARTRECRUITERS_COMPANIES',
  dataFileName: 'smartrecruiters-companies.json',
  bundledFile: path.join(__dirname, 'smartrecruiters-companies.json'),
};

function credsPresent() { return true; }

function listUrl(token, offset = 0, country = null) {
  const c = country ? `&country=${encodeURIComponent(country)}` : '';
  return `${API}/${encodeURIComponent(String(token).trim())}/postings?limit=${PAGE}&offset=${offset}${c}`;
}

function detailUrl(token, id) {
  return `${API}/${encodeURIComponent(String(token).trim())}/postings/${encodeURIComponent(id)}`;
}

function resolveBoards(opts = {}) {
  return common.resolveBoards(opts, BOARD_CFG);
}

/** Every posting on a company board (paged), optionally limited to one country. */
async function fetchAllPostings(board, httpGetJson = common.defaultHttpGetJson, country = null) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await httpGetJson(listUrl(board.token, page * PAGE, country), 'SmartRecruiters');
    const content = Array.isArray(data && data.content) ? data.content : [];
    out.push(...content);
    if (content.length < PAGE || out.length >= Number(data.totalFound || 0)) break;
  }
  return out;
}

function locationOf(loc = {}) {
  let s = String(loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(', '))
    .replace(/,\s*,/g, ',').trim();
  if (loc.remote && !/remote/i.test(s)) s = s ? `${s} (Remote)` : 'Remote';
  return s;
}

function normalize(job, company, params = {}) {
  if (!job || typeof job !== 'object' || !job.id) return null;
  const title = String(job.name || '').trim();
  if (!title) return null;
  const ident = (job.company && job.company.identifier) || '';
  const url = common.validPostingUrl(`https://jobs.smartrecruiters.com/${ident}/${job.id}`);
  if (!url || !ident) return null;
  return {
    id: `smartrecruiters:${url.toLowerCase()}`,
    title,
    company: company || (job.company && job.company.name) || '',
    location: locationOf(job.location),
    salaryMin: null,
    salaryMax: null,
    url,
    description: '',
    source: 'smartrecruiters',
    query: { title: params.title || '', location: params.location || '' },
    created: job.releasedDate || null,
  };
}

/** Fill in the JD (and the canonical posting URL) from the posting detail endpoint. */
async function enrich(role, job, board, httpGetJson = common.defaultHttpGetJson) {
  const d = await httpGetJson(detailUrl(board.token, job.id), 'SmartRecruiters');
  const sections = (d && d.jobAd && d.jobAd.sections) || {};
  role.description = ['jobDescription', 'qualifications', 'additionalInformation']
    .map((k) => common.stripHtml(sections[k] && sections[k].text))
    .filter(Boolean).join(' ');
  const posting = common.validPostingUrl(d && d.postingUrl);
  if (posting) role.url = posting;
}

async function fetchRoles(params = {}, target = 100, opts = {}) {
  const boards = resolveBoards(opts);
  if (!boards.length) {
    const err = new Error(
      'No SmartRecruiters boards configured. Add company identifiers to '
      + 'lib/sources/smartrecruiters-companies.json, set SMARTRECRUITERS_COMPANIES="id1,id2", or pass opts.companies.'
    );
    err.code = 'NO_BOARDS';
    throw err;
  }
  return common.harvest({
    boards, params, target,
    sinceDays: common.resolveSinceDays(params, opts),
    httpGetJson: opts.httpGetJson,
    label: 'SmartRecruiters',
    fetchJobs: (board, http) => fetchAllPostings(board, http, params.country || null),
    normalizeJob: normalize,
    filter: opts.filter,
    enrich,
  });
}

module.exports = {
  fetchRoles, fetchAllPostings, normalize, enrich, credsPresent, listUrl, detailUrl,
  resolveBoards, locationOf, API,
};
