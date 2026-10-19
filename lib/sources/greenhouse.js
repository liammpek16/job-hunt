'use strict';
/**
 * Greenhouse job-board source — a real, key-less, ToS-clean job "scraper".
 *
 * Greenhouse publishes an OFFICIAL public Job Board API meant for exactly this:
 *   https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true
 * No key, no browser, no HTML parsing — plain JSON. Given a seed list of company board tokens
 * (lib/sources/greenhouse-companies.json, or GREENHOUSE_COMPANIES / a
 * data/greenhouse-companies.json override), it pulls every open posting, filters by title +
 * location + recency, dedupes, and normalizes to the shared role shape.
 *
 * The generic harvest/filter/resolve machinery lives in ./board-common; this file only
 * defines Greenhouse's URL, job-array extraction, and per-job normalization. The HTTP layer is
 * injectable (`opts.httpGetJson`) so it is fully unit-testable with fixtures — no network.
 */
const path = require('path');
const common = require('./board-common');

const BOARD_API = 'https://boards-api.greenhouse.io/v1/boards';
const BOARD_CFG = {
  envVar: 'GREENHOUSE_COMPANIES',
  dataFileName: 'greenhouse-companies.json',
  bundledFile: path.join(__dirname, 'greenhouse-companies.json'),
};

/** This source needs no credentials — Greenhouse boards are public. */
function credsPresent() { return true; }

/** The board-jobs endpoint for a company token (content=true includes the JD HTML). */
function boardUrl(token) {
  return `${BOARD_API}/${encodeURIComponent(String(token).trim())}/jobs?content=true`;
}

/** Resolve the seed boards (opts.companies → env → data file → bundled seed). */
function resolveBoards(opts = {}) {
  return common.resolveBoards(opts, BOARD_CFG);
}

/** Normalize a Greenhouse job into the project's shared role shape (null if unusable). */
function normalize(job, company, params = {}) {
  if (!job || typeof job !== 'object') return null;
  const title = String(job.title || '').trim();
  if (!title) return null;
  const url = common.validPostingUrl(job.absolute_url);
  if (!url) return null; // must link to a real posting
  return {
    id: `greenhouse:${url.toLowerCase()}`,
    title,
    company: company || (job.company_name ? String(job.company_name) : ''),
    location: (job.location && job.location.name) ? String(job.location.name).trim() : '',
    salaryMin: null, // Greenhouse boards rarely expose salary in the list payload
    salaryMax: null,
    url,
    description: common.stripHtml(job.content),
    source: 'greenhouse',
    query: { title: params.title || '', location: params.location || '' },
    // first_published is the real posting date; updated_at moves on every edit.
    created: job.first_published || job.updated_at || null,
  };
}

/** Pull roles from every seed board (filter title/location/recency, dedupe, cap at target). */
async function fetchRoles(params = {}, target = 100, opts = {}) {
  const boards = resolveBoards(opts);
  if (!boards.length) {
    const err = new Error(
      'No Greenhouse boards configured. Add company tokens to lib/sources/greenhouse-companies.json, '
      + 'set GREENHOUSE_COMPANIES="tok1,tok2", or pass opts.companies.'
    );
    err.code = 'NO_BOARDS';
    throw err;
  }
  return common.harvest({
    boards, params, target,
    sinceDays: common.resolveSinceDays(params, opts),
    httpGetJson: opts.httpGetJson,
    label: 'Greenhouse',
    urlFor: boardUrl,
    extractJobs: (data) => (Array.isArray(data && data.jobs) ? data.jobs : []),
    normalizeJob: normalize,
    filter: opts.filter,
  });
}

module.exports = {
  fetchRoles, normalize, credsPresent, boardUrl, resolveBoards,
  titleMatches: common.titleMatches, locationMatches: common.locationMatches,
  stripHtml: common.stripHtml, BOARD_API,
};
