'use strict';
/**
 * discover.js — grow the watchlist with companies you'd never have listed yourself.
 *
 * Claude (`claude -p` with only the WebSearch tool, on your subscription) searches the web for
 * current postings matching your titles in NYC / US-remote on the ATS hosts we can read
 * (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Workday). Claude only nominates
 * COMPANIES: each URL is parsed for its board (lib/intake parseUrl), and a company is added only
 * if its board, fetched through the official API, has at least one job passing your profile
 * right now. So a wrong or stale link can't add a job — at worst it adds nothing.
 *
 * New companies join as tier C with origin "discovery", and their boards are scanned with
 * fresh roles going to New (not Backlog).
 */
const { spawn } = require('child_process');
const store = require('./db');
const watchlist = require('./watchlist');
const profileLib = require('./profile');
const { parseUrl, titleCase } = require('./intake');
const { PROBES } = require('./ats-detect');

const HOSTS = 'job-boards.greenhouse.io, boards.greenhouse.io, jobs.lever.co, jobs.ashbyhq.com, '
  + 'jobs.smartrecruiters.com, apply.workable.com, or <company>.wdN.myworkdayjobs.com';

/** Split the profile's titles into a few search groups (one Claude search each). */
function titleGroups(profile) {
  const t = profile.titles;
  const pick = (re) => t.filter((x) => re.test(x));
  const groups = [
    pick(/^(sales|technical sales|presales) engineer/),
    pick(/solutions? (engineer|consultant)|presales consultant/),
    pick(/forward deployed|customer engineer/),
    pick(/application/),
  ].filter((g) => g.length);
  const used = new Set(groups.flat());
  const rest = t.filter((x) => !used.has(x));
  if (rest.length) groups.push(rest);
  return groups;
}

function buildPrompt(titles, profile, known) {
  const places = profile.locations.map((l) => l.query).join(', ');
  return [
    `Use web search to find up to 15 CURRENT, open job postings whose title is one of: ${titles.map((x) => `"${x}"`).join(', ')}.`,
    `Location: ${places}${profile.allowRemote ? ', or remote within the United States' : ''}.`,
    `Only postings hosted on ${HOSTS}. Skip senior, staff, principal, lead and manager roles.`,
    `Prefer companies NOT in this list (we already watch them): ${known.slice(0, 250).join(', ')}.`,
    'Skip staffing agencies and job aggregators.',
    'Reply with ONLY a JSON array: [{"company": "...", "title": "...", "url": "https://..."}]. No commentary.',
  ].join('\n');
}

/** Run one web-search prompt through Claude Code; resolves with the parsed JSON array. */
function claudeSearch(prompt, { timeoutMs = 300e3 } = {}) {
  return new Promise((resolve, reject) => {
    const cmd = 'claude -p --output-format json --tools WebSearch --allowedTools WebSearch --max-turns 10 --no-session-persistence';
    const child = spawn(cmd, { shell: true, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Discovery search took too long.')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let j;
      try { j = JSON.parse(out); } catch { return reject(new Error(`Claude Code failed (exit ${code}): ${(err || out).slice(0, 200)}`)); }
      if (j.is_error) return reject(new Error(`Claude: ${String(j.result || j.subtype).slice(0, 200)}`));
      const text = String(j.result || '');
      const a = text.indexOf('[');
      const b = text.lastIndexOf(']');
      try { resolve(a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : []); } catch { resolve([]); }
    });
    child.stdin.end(prompt);
  });
}

function loadSource(ats) { return require(`./sources/${ats}`); }

/** How many jobs on this board pass the profile right now (0 = don't add). */
async function boardMatches(ats, slug, name, profile, deps) {
  const src = (deps.loadSource || loadSource)(ats);
  const keep = (r) => profileLib.titleCheck(r.title, profile).ok && profileLib.locationCheck(r.location, profile).ok;
  const res = await src.fetchRoles(
    { country: profile.country, sinceDays: 36500, searchTerms: profile.titles, titleOk: (t) => profileLib.titleCheck(t, profile).ok },
    Infinity, { companies: [{ token: slug, name }], filter: keep, httpGetJson: deps.httpGetJson, httpJson: deps.httpJson },
  );
  if (res.errors && res.errors.length) throw new Error(res.errors[0].error);
  return res.roles.length;
}

/** The board's own spelling of the company name, when the ATS reports one. */
async function boardName(ats, slug, fallback, deps) {
  if (!['greenhouse', 'workable'].includes(ats)) return fallback;
  try { const p = await PROBES[ats](slug, deps.http || require('./ats-detect').defaultHttp); return p.name || fallback; }
  catch { return fallback; }
}

/**
 * Run discovery. deps (tests): { search(prompt) → [{company,title,url}], loadSource, http,
 * httpGetJson, httpJson, now }. → { searches, candidates, added: [{name, ats, slug, matches}],
 * skipped: [{company, url, reason}] }.
 */
async function discover(db, profile, deps = {}) {
  const now = deps.now || new Date();
  const wl = store.loadWatchlist(db);
  const knownBoards = new Set(wl.companies.filter((c) => c.slug).map((c) => `${c.ats}:${String(c.slug).toLowerCase()}`));
  const knownNames = new Set(wl.companies.map((c) => watchlist.norm(c.name)));
  const groups = titleGroups(profile);
  const search = deps.search || claudeSearch;

  const results = await Promise.all(groups.map((g) => search(buildPrompt(g, profile, wl.companies.map((c) => c.name))).catch(() => [])));
  const urls = new Set();
  const items = results.flat().filter((x) => x && x.url && !urls.has(x.url) && urls.add(x.url)); // searches overlap
  const seen = new Map();
  const skipped = [];
  for (const it of items) {
    const p = parseUrl(it.url);
    if (p.error || !p.ats || !p.slug) { skipped.push({ company: it.company, url: it.url, reason: 'not a board we can read' }); continue; }
    const key = `${p.ats}:${String(p.slug).toLowerCase()}`;
    const name = String(it.company || '').trim() || p.companyGuess || titleCase(p.slug);
    if (knownBoards.has(key) || knownNames.has(watchlist.norm(name))) continue; // already watched
    if (watchlist.isBlocked(name, wl)) { skipped.push({ company: name, url: it.url, reason: 'blocklisted' }); continue; }
    if (!seen.has(key)) seen.set(key, { ats: p.ats, slug: p.slug, name, url: it.url });
  }

  const added = [];
  for (const c of seen.values()) {
    let matches;
    try { matches = await boardMatches(c.ats, c.slug, c.name, profile, deps); }
    catch (e) { skipped.push({ company: c.name, url: c.url, reason: `board unreadable (${e.message})` }); continue; }
    if (!matches) { skipped.push({ company: c.name, url: c.url, reason: 'no job on the board matches your profile now' }); continue; }
    const name = await boardName(c.ats, c.slug, c.name, deps);
    if (knownNames.has(watchlist.norm(name))) continue;
    store.upsertCompany(db, { name, tier: 'C', ats: c.ats, slug: c.slug, checkedAt: now.toISOString().slice(0, 10), addedAt: now.toISOString(), origin: 'discovery' });
    knownNames.add(watchlist.norm(name));
    added.push({ name, ats: c.ats, slug: c.slug, matches });
  }
  const summary = { at: now.toISOString(), searches: groups.length, candidates: items.length, boards: seen.size, added, skipped };
  store.setMeta(db, 'lastDiscovery', { at: summary.at, searches: summary.searches, candidates: summary.candidates, added: added.length });
  store.addEvent(db, { at: summary.at, kind: 'discovery', cause: deps.cause || 'button', data: { added: added.map((a) => a.name), candidates: items.length } });
  return summary;
}

module.exports = { discover, titleGroups, buildPrompt, claudeSearch, HOSTS };
