'use strict';
/**
 * ats-detect.js — find which applicant tracking system (ATS) a company's careers board lives
 * on, from just its name.
 *
 * For each ATS (Greenhouse, Ashby, Lever, Workable, SmartRecruiters) it tries a few likely
 * slugs ("dbt Labs" → dbtlabs, dbt-labs, dbt) against that ATS's public API. A hit must be
 * real: Greenhouse, Workable and SmartRecruiters report the company name, which must match;
 * Lever and Ashby don't, so they only count on a full-name slug. Every hit needs ≥ 1 open job:
 * companies leave old, empty boards behind after moving ATS, and Workable keeps dormant
 * accounts for many big companies. A company with no live board is "none" until re-detected.
 *
 * HTTP is injectable (`http(url) → { status, json }`) so this is testable without a network.
 */

const { retryWaitMs } = require('./sources/board-common');

// Workable last: it rate-limits hard and keeps dormant accounts for many big companies.
const ATS_ORDER = ['greenhouse', 'ashby', 'lever', 'smartrecruiters', 'workable'];
const SUFFIXES = new Set(['inc', 'corp', 'corporation', 'llc', 'ltd', 'co', 'company', 'hq',
  'technologies', 'technology', 'labs', 'lab', 'ai', 'io', 'software', 'systems', 'group', 'the']);

function words(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean);
}

/**
 * Likely slugs, best first. `full` slugs use every word of the name (safe for ATSs that can't
 * confirm the company name); the rest drop suffix words like "Labs" or "Inc".
 */
function slugCandidates(name) {
  const w = words(name);
  const core = w.filter((x) => !SUFFIXES.has(x));
  const full = [...new Set([w.join(''), w.join('-')])].filter(Boolean);
  const short = [...new Set([core.join(''), core.join('-'), core[0]])]
    .filter((s) => s && !full.includes(s) && s.length >= 3);
  return { full, short, all: [...full, ...short] };
}

/**
 * Do two company names refer to the same company? Loose: suffix-insensitive, containment ok.
 * Strict: every word must match ("Shield AI" ≠ "S.H.I.E.L.D."), used for shortened slugs.
 */
function sameCompany(a, b, { strict = false } = {}) {
  if (strict) return words(a).join('') === words(b).join('');
  const na = words(a).filter((x) => !SUFFIXES.has(x)).join('');
  const nb = words(b).filter((x) => !SUFFIXES.has(x)).join('');
  if (!na || !nb) return false;
  return na === nb || (Math.min(na.length, nb.length) >= 4 && (na.includes(nb) || nb.includes(na)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hosts that rate-limit: at most one request per interval, across all concurrent probes.
const THROTTLE_MS = { 'apply.workable.com': 1500 };
const nextSlot = {};
async function throttle(url) {
  const host = new URL(url).host;
  const gap = THROTTLE_MS[host];
  if (!gap) return;
  const at = Math.max(Date.now(), nextSlot[host] || 0);
  nextSlot[host] = at + gap;
  await sleep(at - Date.now());
}

/** GET JSON; on 429 (rate limited) wait and retry, unless told to wait more than 30 s. */
async function defaultHttp(url, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    await throttle(url);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.status === 429 && attempt < retries) {
        const wait = retryWaitMs(res, attempt);
        if (wait != null) { await sleep(wait); continue; }
      }
      const json = res.ok ? await res.json().catch(() => null) : null;
      return { status: res.status, json };
    } catch (e) {
      return { status: 0, json: null, error: e.message };
    }
  }
}

const enc = encodeURIComponent;

/** One probe: does `slug` exist on `ats`? → { exists, jobs, name } (name null when unknown). */
const PROBES = {
  async greenhouse(slug, http) {
    const b = await http(`https://boards-api.greenhouse.io/v1/boards/${enc(slug)}`);
    if (b.status !== 200 || !b.json) return { exists: false };
    const j = await http(`https://boards-api.greenhouse.io/v1/boards/${enc(slug)}/jobs`);
    const jobs = j.json && Array.isArray(j.json.jobs) ? j.json.jobs.length : 0;
    return { exists: true, jobs, name: b.json.name || null };
  },
  async ashby(slug, http) {
    const r = await http(`https://api.ashbyhq.com/posting-api/job-board/${enc(slug)}`);
    if (r.status !== 200 || !r.json) return { exists: false };
    return { exists: true, jobs: Array.isArray(r.json.jobs) ? r.json.jobs.length : 0, name: null };
  },
  async lever(slug, http) {
    const r = await http(`https://api.lever.co/v0/postings/${enc(slug)}?mode=json`);
    if (r.status !== 200 || !Array.isArray(r.json)) return { exists: false };
    return { exists: true, jobs: r.json.length, name: null };
  },
  async workable(slug, http) {
    const r = await http(`https://apply.workable.com/api/v1/widget/accounts/${enc(slug)}`);
    if (r.status === 429) return { exists: false, rateLimited: true };
    if (r.status !== 200 || !r.json) return { exists: false };
    return { exists: true, jobs: Array.isArray(r.json.jobs) ? r.json.jobs.length : 0, name: r.json.name || null };
  },
  async smartrecruiters(slug, http) {
    const r = await http(`https://api.smartrecruiters.com/v1/companies/${enc(slug)}/postings?limit=1`);
    if (r.status !== 200 || !r.json) return { exists: false };
    const first = Array.isArray(r.json.content) ? r.json.content[0] : null;
    const total = Number(r.json.totalFound || 0);
    // Unknown identifiers also return 200 with nothing, so an empty board doesn't count.
    if (!total || !first) return { exists: false };
    return { exists: true, jobs: total, name: (first.company && first.company.name) || null, slug: first.company && first.company.identifier };
  },
};

/**
 * Detect one company's ATS. `company` = { name, slugs?: [extra slug guesses] }.
 * → { ats, slug, jobs } or { ats: 'none' }.
 */
async function detectCompany(company, { http = defaultHttp, order = ATS_ORDER } = {}) {
  const { full, short } = slugCandidates(company.name);
  const extra = (company.slugs || []).map(String);
  for (const ats of order) {
    const canConfirmName = ats !== 'lever' && ats !== 'ashby';
    const tries = [...new Set([...extra, ...full, ...(canConfirmName ? short : [])])];
    for (const slug of tries) {
      const p = await PROBES[ats](slug, http);
      if (p.rateLimited) throw new Error(`${ats} rate-limited while checking ${company.name}; try again later`);
      if (!p.exists) continue;
      // Boards that report a name must match it (exactly, for a shortened slug).
      const strict = short.includes(slug) && !extra.includes(slug);
      if (canConfirmName && !(p.name && sameCompany(p.name, company.name, { strict }))) continue;
      if (p.jobs > 0) return { ats, slug: p.slug || slug, jobs: p.jobs };
    }
  }
  return { ats: 'none' };
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

module.exports = { ATS_ORDER, PROBES, slugCandidates, sameCompany, detectCompany, mapLimit, defaultHttp };
