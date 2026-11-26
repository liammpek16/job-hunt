'use strict';
/**
 * linkedin.js — LinkedIn job search through LinkedIn's public, logged-out ("guest") job pages.
 *
 * No account, no key, no browser. These are the same endpoints linkedin.com/jobs/search uses
 * when you browse jobs signed out:
 *   search  https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…
 *           → an HTML fragment of up to 10 job cards per page (start=0,10,20,…)
 *   detail  https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>
 *           → the posting page: full JD, seniority, employment type, "no longer accepting"
 *
 * Unlike an ATS board this is a SEARCH, not a full listing: a job missing from today's
 * results hasn't necessarily closed, so the scan never closes LinkedIn jobs by absence.
 *
 * Be polite: requests are spaced out (delayMs) and a 429 (rate limited) ends the run early
 * with whatever was gathered. Heavy use can get your IP temporarily throttled by LinkedIn,
 * and automated access is against LinkedIn's user agreement: keep volumes personal-scale.
 *
 * The HTTP layer is injectable (opts.httpGetText) so parsing is unit-testable with fixtures.
 */
const { stripHtml, validPostingUrl } = require('./board-common');

const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DETAIL_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
const PAGE_SIZE = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a page as text. Throws err.status on non-2xx (429 = rate limited). */
async function defaultHttpGetText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!res.ok) {
    const err = new Error(`LinkedIn HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

/**
 * Search URL for one query. q: { keywords, location, remote?, sinceDays?, start? }.
 * remote → f_WT=2 (LinkedIn's "Remote" workplace filter); sinceDays → f_TPR=r<seconds>.
 */
function searchUrl(q) {
  const qs = new URLSearchParams({ keywords: q.keywords, location: q.location || '' });
  if (q.remote) qs.set('f_WT', '2');
  if (q.sinceDays) qs.set('f_TPR', `r${Math.round(q.sinceDays * 86400)}`);
  qs.set('start', String(q.start || 0));
  return `${SEARCH_URL}?${qs}`;
}

function detailUrl(id) { return `${DETAIL_URL}/${encodeURIComponent(id)}`; }

/** Canonical, tracking-free posting URL. */
function postingUrl(id) { return `https://www.linkedin.com/jobs/view/${id}/`; }

const text = (html) => stripHtml(html || '').replace(/\s+/g, ' ').trim();
const grab = (html, re) => { const m = html.match(re); return m ? m[1] : null; };

/** "$120,000.00 - $150,000.00" / "$60/hr" → { min, max } in yearly dollars (hourly ×2080). */
function parseSalary(s) {
  const nums = String(s || '').match(/\$?\s?(\d[\d,]*(?:\.\d+)?)\s*([kK])?/g);
  if (!nums) return { min: null, max: null };
  const hourly = /\/\s*(hr|hour)/i.test(s);
  const vals = nums.map((n) => {
    let v = Number(n.replace(/[^\d.]/g, ''));
    if (/k/i.test(n)) v *= 1000;
    if (hourly) v *= 2080;
    return Math.round(v);
  }).filter((v) => v >= 10000);
  if (!vals.length) return { min: null, max: null };
  return { min: Math.min(...vals), max: vals.length > 1 ? Math.max(...vals) : null };
}

/** Parse a search-results HTML fragment into roles (no JD yet). */
function parseSearch(html) {
  const roles = [];
  const cards = String(html || '').split(/<li[\s>]/).slice(1);
  for (const card of cards) {
    const id = grab(card, /urn:li:jobPosting:(\d+)/);
    if (!id) continue;
    const title = text(grab(card, /<h3[^>]*base-search-card__title[^>]*>([\s\S]*?)<\/h3>/));
    if (!title) continue;
    const company = text(grab(card, /<h4[^>]*base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/));
    const location = text(grab(card, /job-search-card__location[^>]*>([\s\S]*?)<\/span>/));
    const posted = grab(card, /<time[^>]*datetime="([\d-]+)"/);
    const salary = parseSalary(text(grab(card, /job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/)));
    roles.push({
      id: `linkedin:${id}`,
      linkedinId: id,
      title,
      company,
      location,
      salaryMin: salary.min,
      salaryMax: salary.max,
      url: validPostingUrl(postingUrl(id)),
      description: '',
      source: 'linkedin',
      created: posted ? new Date(`${posted}T12:00:00Z`).toISOString() : null,
    });
  }
  return roles;
}

/** Parse a job-detail page → { description, seniority, employmentType, industries, closed }. */
function parseDetail(html) {
  const h = String(html || '');
  const markup = grab(h, /show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<button|<\/section>)/)
    || grab(h, /description__text[^"]*"[^>]*>([\s\S]*?)<\/section>/);
  const criteria = {};
  const re = /description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(h))) criteria[text(m[1]).toLowerCase()] = text(m[2]);
  return {
    description: markup ? stripHtml(markup) : '',
    seniority: criteria['seniority level'] || null,
    employmentType: criteria['employment type'] || null,
    industries: criteria.industries || null,
    closed: /No longer accepting applications/i.test(h),
  };
}

/**
 * Run every query, page through results, dedupe, then fetch the JD for roles that pass
 * `filter` (cheap title/location check) — at most maxDetails of them.
 *
 * params: { queries: [{ keywords, location, remote? }], sinceDays?, pagesPerQuery?=3,
 *           maxDetails?=150, delayMs?=1200, skipDetail?(role) → true to not fetch its JD }
 * opts:   { httpGetText?, filter?(role), log?, sleep? }
 * Resolves { roles, requests, errors, rateLimited, searched }.
 */
async function fetchRoles(params = {}, opts = {}) {
  const get = opts.httpGetText || defaultHttpGetText;
  const wait = opts.sleep || sleep;
  const log = opts.log || (() => {});
  const keep = opts.filter || (() => true);
  const pages = params.pagesPerQuery ?? 3;
  const delayMs = params.delayMs ?? 1200;
  const maxDetails = params.maxDetails ?? 150;
  const out = { roles: [], requests: 0, errors: [], rateLimited: false, searched: 0, found: 0 };
  const byId = new Map();
  let first = true;

  // One GET with spacing and a single backoff retry on 429. null = give up (rate limited).
  const fetchText = async (url) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!first) await wait(attempt ? delayMs * 8 : delayMs);
      first = false;
      out.requests += 1;
      try { return await get(url); } catch (e) {
        if (e.status === 429 && attempt === 0) continue;
        if (e.status === 429) { out.rateLimited = true; return null; }
        throw e;
      }
    }
    return null;
  };

  for (const q of params.queries || []) {
    if (out.rateLimited) break;
    for (let p = 0; p < pages; p++) {
      let html;
      try { html = await fetchText(searchUrl({ ...q, sinceDays: params.sinceDays, start: p * PAGE_SIZE })); }
      catch (e) { out.errors.push({ query: q.keywords, location: q.location, error: e.message }); break; }
      if (html == null) break;
      const batch = parseSearch(html);
      out.searched += batch.length;
      for (const r of batch) {
        // LinkedIn shows remote jobs as just "United States": say "Remote" so location checks see it.
        if (!byId.has(r.id)) byId.set(r.id, r);
        const kept = byId.get(r.id);
        if (q.remote && !/\bremote\b/i.test(kept.location)) kept.location = `${kept.location || 'United States'} (Remote)`;
      }
      if (batch.length < PAGE_SIZE) break; // last page
    }
  }
  out.found = byId.size;
  log(`  linkedin: ${byId.size} unique postings from ${(params.queries || []).length} searches`);

  let details = 0;
  for (const role of byId.values()) {
    if (!keep(role)) continue;
    out.roles.push(role);
    if (out.rateLimited || details >= maxDetails) continue;
    if (params.skipDetail && params.skipDetail(role)) continue;
    let html;
    try { html = await fetchText(detailUrl(role.linkedinId)); }
    catch (e) { out.errors.push({ id: role.linkedinId, error: e.message }); continue; }
    if (html == null) continue;
    details += 1;
    Object.assign(role, parseDetail(html));
    role.detailed = true;
  }
  return out;
}

module.exports = {
  fetchRoles, parseSearch, parseDetail, parseSalary, searchUrl, detailUrl, postingUrl, defaultHttpGetText,
  SEARCH_URL, DETAIL_URL,
};
