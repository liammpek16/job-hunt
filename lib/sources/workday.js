'use strict';
/**
 * Workday career-site source — key-less, browser-free.
 *
 * Many large employers (Salesforce, Adobe, Autodesk, PTC, …) run their careers site on Workday.
 * Each site has a public JSON API behind it:
 *   POST https://<tenant>.<wdN>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
 *        { searchText, limit, offset, appliedFacets }        → { total, jobPostings: [...] }
 *   GET  https://<tenant>.<wdN>.myworkdayjobs.com/wday/cxs/<tenant>/<site><externalPath>
 *                                                          → { jobPostingInfo: { location, … } }
 * Unlike the other boards, Workday searches server-side, so we ask for each profile title
 * (params.searchTerms) instead of downloading thousands of postings, keep the titles that pass
 * params.titleOk, then fetch only those postings' details (full location list, JD, date).
 *
 * A board's token is "<tenant>.<wdN>/<site>", e.g. "salesforce.wd12/External_Career_Site":
 * the part of the careers URL before .myworkdayjobs.com, then the site name in its path.
 */
const common = require('./board-common');
const { mapLimit } = require('../ats-detect');

const PAGE = 20;
const BOARD_CONCURRENCY = 4;
const MAX_PAGES = 2; // Workday search is fuzzy and relevance-ranked: real title matches sit on top

function credsPresent() { return true; }

/** "salesforce.wd12/External_Career_Site" → { host, tenant, site, api, web }. */
function parseToken(token) {
  const [host, site] = String(token || '').split('/');
  if (!host || !site || !/^[\w-]+\.wd\d+$/i.test(host)) throw new Error(`Bad Workday token "${token}" (want "<tenant>.wdN/<site>").`);
  const tenant = host.split('.')[0];
  return { host, tenant, site, api: `https://${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}`, web: `https://${host}.myworkdayjobs.com/${site}` };
}

/** Default HTTP: JSON in/out, 429s retried briefly (same policy as the other boards). */
async function defaultHttpJson(method, url, body) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (res.status !== 429 || attempt >= 3) break;
    const wait = common.retryWaitMs(res, attempt);
    if (wait == null) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) { const e = new Error(`Workday HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

/** "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" → ISO date (null for "30+"). */
function postedOnToDate(postedOn, now = Date.now()) {
  const s = String(postedOn || '').toLowerCase();
  let days = null;
  if (/today/.test(s)) days = 0;
  else if (/yesterday/.test(s)) days = 1;
  else { const m = s.match(/(\d+)\s+days?\s+ago/); if (m && !/\+/.test(s)) days = Number(m[1]); }
  return days == null ? null : new Date(now - days * 864e5).toISOString().slice(0, 10);
}

/** Search the site for each term, keep titles that pass, then fetch those postings' details. */
async function fetchPostings(board, params, httpJson) {
  const t = parseToken(board.token);
  const terms = [...new Set((params.searchTerms || [params.title]).filter(Boolean))];
  const titleOk = params.titleOk || (() => true);
  const found = new Map();
  await Promise.all(terms.map(async (term) => { // terms in parallel, pages in order
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await httpJson('POST', `${t.api}/jobs`, { appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText: term });
      const posts = Array.isArray(data && data.jobPostings) ? data.jobPostings : [];
      for (const p of posts) if (p.externalPath && !found.has(p.externalPath) && titleOk(p.title || '')) found.set(p.externalPath, p);
      if (posts.length < PAGE) break;
    }
  }));
  const out = [];
  for (const p of found.values()) {
    let info = {};
    try { info = ((await httpJson('GET', `${t.api}${p.externalPath}`)) || {}).jobPostingInfo || {}; } catch { /* keep the list data */ }
    out.push({ ...p, info, _web: t.web });
  }
  return out;
}

function normalize(job, company, params = {}) {
  if (!job || typeof job !== 'object' || !job.externalPath) return null;
  const info = job.info || {};
  const title = String(info.title || job.title || '').trim();
  if (!title) return null;
  const url = common.validPostingUrl(info.externalUrl || `${job._web}${job.externalPath}`);
  if (!url) return null;
  let location = [info.location, ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : [])]
    .filter(Boolean).join('; ') || String(job.locationsText || '');
  if (/remote/i.test(String(info.remoteType || '')) && !/remote/i.test(location)) location = location ? `${location} (Remote)` : 'Remote';
  return {
    id: `workday:${url.toLowerCase()}`,
    title,
    company: company || '',
    location,
    salaryMin: null,
    salaryMax: null,
    url,
    description: common.stripHtml(info.jobDescription),
    source: 'workday',
    query: { title: params.title || '', location: params.location || '' },
    created: info.startDate || postedOnToDate(job.postedOn),
  };
}

async function fetchRoles(params = {}, target = 100, opts = {}) {
  const boards = common.normalizeBoards(opts.companies || []);
  if (!boards.length) {
    const err = new Error('No Workday career sites given (pass opts.companies; add them on the Companies tab by pasting a myworkdayjobs.com link).');
    err.code = 'NO_BOARDS';
    throw err;
  }
  const httpJson = opts.httpJson || defaultHttpJson;
  // Each site needs many small requests, so fetch a few sites at once, then harvest in order.
  const fetched = new Map();
  await mapLimit(boards, BOARD_CONCURRENCY, async (b) => {
    try { fetched.set(b.token, await fetchPostings(b, params, httpJson)); } catch (e) { fetched.set(b.token, e); }
  });
  return common.harvest({
    boards, params, target,
    sinceDays: common.resolveSinceDays(params, opts),
    label: 'Workday',
    fetchJobs: async (board) => { const v = fetched.get(board.token); if (v instanceof Error) throw v; return v; },
    normalizeJob: normalize,
    filter: opts.filter,
  });
}

module.exports = { fetchRoles, fetchPostings, normalize, parseToken, postedOnToDate, credsPresent, PAGE };
