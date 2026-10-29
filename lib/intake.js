'use strict';
/**
 * intake.js — paste-a-link intake: any job URL you found by hand teaches the watchlist.
 *
 * The pasted URL is NEVER fetched (so a LinkedIn link is never scraped). Only its text is read:
 *   • ATS links (Greenhouse, Lever, Ashby, SmartRecruiters, Workable) give the board slug and
 *     job id directly;
 *   • LinkedIn "/jobs/view/<title>-at-<company>-<id>" links give a company + title guess;
 *   • anything else gives a company guess from the domain (you can type the name instead).
 * Then: was this job already in the DB (→ coverage %)? Is the company watched? If not, it's
 * added (ATS from the URL, or auto-detected). A covered company's board is scanned right away
 * so the role shows up if it matches your profile.
 */
const store = require('./db');
const watchlist = require('./watchlist');
const { detectCompany } = require('./ats-detect');
const { runScan } = require('./scan');

const FAST = ['greenhouse', 'ashby', 'lever', 'smartrecruiters'];
const HOST_NOISE = new Set(['www', 'careers', 'career', 'jobs', 'job', 'boards', 'apply', 'talent',
  'join', 'work', 'hire', 'com', 'io', 'co', 'ai', 'dev', 'org', 'net', 'us', 'app']);

function titleCase(s) {
  return String(s || '').replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Read what we can from a job URL's text. → { url, host, ats?, slug?, jobKey?, companyGuess?, titleGuess?, linkedin? } */
function parseUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { error: 'That is not a valid URL.' }; }
  if (!/^https?:$/.test(u.protocol)) return { error: 'That is not a web link.' };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const out = { url: u.href, host };

  if (/(^|\.)linkedin\.com$/.test(host)) {
    out.linkedin = true;
    const view = parts[0] === 'jobs' && parts[1] === 'view' ? parts[2] : null;
    const m = view && view.match(/^(.+)-at-(.+)-(\d+)$/);
    if (m) { out.titleGuess = m[1].replace(/-/g, ' '); out.companyGuess = titleCase(m[2]); }
    return out;
  }
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    out.ats = 'greenhouse';
    if (parts[0] === 'embed') { out.slug = u.searchParams.get('for'); out.jobKey = u.searchParams.get('token'); }
    else { out.slug = parts[0]; out.jobKey = parts[1] === 'jobs' ? parts[2] : undefined; }
  } else if (host === 'jobs.lever.co') {
    Object.assign(out, { ats: 'lever', slug: parts[0], jobKey: parts[1] });
  } else if (host === 'jobs.ashbyhq.com') {
    Object.assign(out, { ats: 'ashby', slug: parts[0], jobKey: parts[1] });
  } else if (host === 'jobs.smartrecruiters.com') {
    Object.assign(out, { ats: 'smartrecruiters', slug: parts[0], jobKey: (parts[1] || '').split('-')[0] || undefined });
  } else if (/\.wd\d+\.myworkdayjobs\.com$/.test(host)) {
    // https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site/job/<loc>/<title>_JR362037
    const site = parts.find((x) => !/^[a-z]{2}-[A-Z]{2}$/.test(x));
    const last = parts[parts.length - 1] || '';
    Object.assign(out, { ats: 'workday', slug: site ? `${host.replace(/\.myworkdayjobs\.com$/, '')}/${site}` : undefined,
      jobKey: (last.match(/_([A-Z]*\d[\w-]*)$/) || [])[1] });
    out.companyGuess = titleCase(host.split('.')[0]);
    return out;
  } else if (host === 'apply.workable.com') {
    const j = parts.indexOf('j');
    Object.assign(out, { ats: 'workable', slug: j > 0 ? parts[0] : (j === -1 ? parts[0] : undefined), jobKey: j >= 0 ? parts[j + 1] : undefined });
  }
  const ghJid = u.searchParams.get('gh_jid');
  if (ghJid) { out.ats = out.ats || 'greenhouse'; out.jobKey = ghJid; }
  if (out.slug) out.companyGuess = titleCase(out.slug);
  else {
    const label = host.split('.').find((x) => !HOST_NOISE.has(x));
    if (label) out.companyGuess = titleCase(label.replace(/(hq|inc)$/, ''));
  }
  return out;
}

function words(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

/** A job already in the DB that is this posting: same URL, same job id, or same company + title. */
function findExisting(db, p, company) {
  const jobs = store.allJobs(db);
  const url = String(p.url || '').toLowerCase();
  let hit = jobs.find((j) => String(j.url || '').toLowerCase() === url);
  if (!hit && p.jobKey && String(p.jobKey).length >= 5) {
    hit = jobs.find((j) => String(j.url || '').toLowerCase().includes(String(p.jobKey).toLowerCase())
      && (!p.ats || !j.ats || j.ats === p.ats));
  }
  if (!hit && p.titleGuess && company) {
    const want = new Set(words(p.titleGuess));
    hit = jobs.find((j) => {
      if (watchlist.norm(j.company) !== watchlist.norm(company)) return false;
      const have = words(j.title);
      const overlap = have.filter((w) => want.has(w)).length;
      return want.size && overlap / Math.max(want.size, have.length) >= 0.6;
    });
  }
  return hit || null;
}

/**
 * Run the intake. input: { url, company?, tier? }. deps (tests): { profile, http, httpGetJson,
 * detect, scan, now }. → { company, tier, ats, covered, added, had, jobId, jobStatus, message }.
 */
async function intake(db, input, deps = {}) {
  const now = deps.now || new Date();
  const p = parseUrl(input.url);
  if (p.error) { const e = new Error(p.error); e.status = 400; throw e; }

  const wl = store.loadWatchlist(db);
  let c = (input.company && wl.companies.find((x) => watchlist.norm(x.name) === watchlist.norm(input.company)))
    || (p.slug && wl.companies.find((x) => x.ats === p.ats && String(x.slug).toLowerCase() === String(p.slug).toLowerCase()))
    || (p.companyGuess && wl.companies.find((x) => watchlist.norm(x.name) === watchlist.norm(p.companyGuess)));
  const name = (c && c.name) || String(input.company || '').trim() || p.companyGuess;
  if (!name) { const e = new Error('Could not tell the company from that link. Type the company name too.'); e.status = 400; throw e; }
  if (watchlist.isBlocked(name, wl)) { const e = new Error(`${name} is on the blocklist (aggregator / staffing firm).`); e.status = 400; throw e; }

  const had = findExisting(db, p, name);
  let added = false;
  const today = now.toISOString().slice(0, 10);
  if (!c) {
    c = { name, tier: input.tier || 'C', origin: 'intake', addedAt: now.toISOString() };
    if (p.ats && p.slug) Object.assign(c, { ats: p.ats, slug: p.slug, checkedAt: today });
    else {
      const r = await (deps.detect || detectCompany)(c, { order: FAST, ...(deps.http ? { http: deps.http } : {}) });
      Object.assign(c, r.ats === 'none' ? { ats: 'none' } : { ats: r.ats, slug: r.slug, jobs: r.jobs }, { checkedAt: today });
      // The name was only guessed from the link: prefer the board's own spelling ("GitLab").
      if (!input.company && r.name && watchlist.norm(r.name) === watchlist.norm(c.name)) c.name = r.name;
    }
    store.upsertCompany(db, c);
    added = true;
  } else if ((!c.ats || c.ats === 'none') && p.ats && p.slug) {
    Object.assign(c, { ats: p.ats, slug: p.slug, checkedAt: today }); // the link taught us the board
    store.upsertCompany(db, c);
  }

  const covered = Boolean(c.slug && watchlist.ATS_NAMES.includes(c.ats));
  if (covered && deps.profile) {
    await (deps.scan || runScan)({ profile: deps.profile, db, only: [c.name], now, httpGetJson: deps.httpGetJson, firstScanNew: true });
  }
  const found = had || findExisting(db, p, c.name);

  let message;
  if (had) message = `Already had it: ${had.title} (${had.status}).`;
  else if (found) message = `Found it on ${c.name}'s ${c.ats} board and added it: ${found.title}.`;
  else if (covered) message = `${c.name} is watched on ${c.ats}, but this posting isn't in your list: it doesn't match your profile (title, location, years) or is closed.`;
  else message = `${c.name} has no public Greenhouse / Ashby / Lever / SmartRecruiters board, so it can't be watched automatically.`;
  if (added) message = `Added ${c.name} (tier ${c.tier}) to the watchlist. ${message}`;

  store.addEvent(db, { jobId: found ? found.id : null, at: now.toISOString(), kind: 'intake', cause: 'button',
    data: { url: p.url, company: c.name, linkedin: Boolean(p.linkedin), had: Boolean(had), found: found ? found.id : null, covered, added } });
  return { company: c.name, tier: c.tier, ats: c.ats || null, covered, added, had: Boolean(had),
    jobId: found ? found.id : null, jobStatus: found ? found.status : null, message };
}

/** Add a company to the watchlist by name: detect its board, then scan it if covered. */
async function addCompany(db, input, deps = {}) {
  const now = deps.now || new Date();
  const name = String(input.name || '').trim();
  if (!name) { const e = new Error('Company name is required.'); e.status = 400; throw e; }
  const wl = store.loadWatchlist(db);
  if (watchlist.isBlocked(name, wl)) { const e = new Error(`${name} is on the blocklist.`); e.status = 400; throw e; }
  if (wl.companies.some((x) => watchlist.norm(x.name) === watchlist.norm(name))) {
    const e = new Error(`${name} is already on the watchlist.`); e.status = 400; throw e;
  }
  const c = { name, tier: input.tier || 'C', origin: 'manual', addedAt: now.toISOString() };
  const r = await (deps.detect || detectCompany)(c, { order: FAST, ...(deps.http ? { http: deps.http } : {}) });
  Object.assign(c, r.ats === 'none' ? { ats: 'none' } : { ats: r.ats, slug: r.slug, jobs: r.jobs }, { checkedAt: now.toISOString().slice(0, 10) });
  store.upsertCompany(db, c);
  const covered = r.ats !== 'none';
  let scan = null;
  if (covered && deps.profile) scan = await (deps.scan || runScan)({ profile: deps.profile, db, only: [name], now, httpGetJson: deps.httpGetJson, firstScanNew: true });
  const found = scan ? scan.added.new + scan.added.backlog : 0;
  return { company: name, tier: c.tier, ats: c.ats, covered,
    message: covered ? `Added ${name}: ${c.ats} board with ${r.jobs} open jobs, ${found} match your profile.`
      : `Added ${name}, but no public Greenhouse / Ashby / Lever / SmartRecruiters board was found (not covered).` };
}

/** Coverage %: of the postings you pasted, how many did the dashboard already have? */
function intakeStats(db) {
  const all = store.events(db, { kind: 'intake', limit: 100000 });
  const had = all.filter((e) => e.data && e.data.had).length;
  return { total: all.length, had, pct: all.length ? Math.round((100 * had) / all.length) : null };
}

module.exports = { parseUrl, findExisting, intake, addCompany, intakeStats, titleCase };
