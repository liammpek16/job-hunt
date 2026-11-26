'use strict';
/**
 * linkedin-scan.js — the LinkedIn half of the daily scan.
 *
 * Searches LinkedIn (lib/sources/linkedin.js) for every profile title, in the profile's
 * LinkedIn locations plus US-remote, and merges matches into the jobs table:
 *   • same checks as board jobs: title, location, blocklist, years required (from the JD);
 *     plus LinkedIn's own facts: employment type (contract/temp/internship dropped),
 *     seniority (director/executive dropped), staffing agencies (optional), and
 *     "No longer accepting applications";
 *   • a job a watched company's own ATS board already gave us (same company + title) is
 *     skipped, since the board copy has the real apply link and closes when it's filled;
 *   • new jobs land in New when posted within profile.maxAgeDays, else Backlog; company tier
 *     comes from the watchlist when known, else C;
 *   • LinkedIn is a search, not a full listing, so nothing is closed for missing from today's
 *     results. A job in triage not seen for staleDays is closed instead, and one whose page
 *     says it stopped taking applications is closed on the spot.
 * The run summary is appended to meta "linkedinScans" (last 60 kept).
 */
const profileLib = require('./profile');
const watchlist = require('./watchlist');
const store = require('./db');
const source = require('./sources/linkedin');
const { withinDays } = require('./sources/board-common');

const KEEP_SCANS = 60;
const BAD_TYPES = /contract|temporary|internship|volunteer/i;
const BAD_SENIORITY = /director|executive/i;
const STAFFING = /staffing|recruit/i;

/** Defaults for profile.linkedin (config/search-profile.json). */
function settings(profile) {
  const li = profile.linkedin || {};
  return {
    enabled: li.enabled !== false,
    locations: li.locations || ['New York City Metropolitan Area'],
    remote: li.remote ?? profile.allowRemote !== false,
    remoteLocation: li.remoteLocation || 'United States',
    pagesPerQuery: li.pagesPerQuery ?? 3,
    sinceDays: li.sinceDays ?? Math.max(profile.maxAgeDays || 7, 1),
    maxDetails: li.maxDetails ?? 150,
    delayMs: li.delayMs ?? 1200,
    excludeStaffingAgencies: li.excludeStaffingAgencies !== false,
    staleDays: li.staleDays ?? 21,
  };
}

/** One search per title × location (plus a US-remote search per title). */
function buildQueries(profile, cfg = settings(profile)) {
  const q = [];
  for (const t of profile.titles) {
    for (const loc of cfg.locations) q.push({ keywords: t, location: loc });
    if (cfg.remote) q.push({ keywords: t, location: cfg.remoteLocation, remote: true });
  }
  return q;
}

/** LinkedIn-specific reasons to drop a role (after the detail page is read). */
function linkedinCheck(role, cfg) {
  if (role.closed) return { ok: false, reason: 'no longer accepting applications' };
  if (role.employmentType && BAD_TYPES.test(role.employmentType)) return { ok: false, reason: `employment type ${role.employmentType.toLowerCase()}` };
  if (role.seniority && BAD_SENIORITY.test(role.seniority)) return { ok: false, reason: `seniority ${role.seniority.toLowerCase()}` };
  if (cfg.excludeStaffingAgencies && role.industries && STAFFING.test(role.industries)) return { ok: false, reason: 'staffing agency' };
  return { ok: true };
}

/** "Acme Inc." + "Solutions Engineer II" → a key that matches the same job from an ATS board. */
function companyKey(company) {
  return watchlist.norm(String(company || '').replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b\.?/gi, ''));
}
function dupKey(company, title) {
  return `${companyKey(company)}|${profileLib.normalizeTitle(title).trim()}`;
}

/**
 * opts: { profile, db, now?, httpGetText?, sleep?, log? }. Writes to opts.db; returns the
 * run summary { at, searches, found, matched, added, seenAgain, closed, duplicates, rejected, errors, rateLimited }.
 */
async function runLinkedInScan(opts) {
  const { profile, db } = opts;
  const now = opts.now || new Date();
  const nowIso = now.toISOString();
  const log = opts.log || (() => {});
  const cfg = settings(profile);
  const summary = {
    at: nowIso, searches: 0, found: 0, matched: 0, added: { new: 0, backlog: 0 }, seenAgain: 0,
    closed: 0, duplicates: 0, rejected: {}, errors: [], rateLimited: false, requests: 0,
  };
  if (!cfg.enabled) { summary.disabled = true; return summary; }

  const wl = store.loadWatchlist(db);
  const tierOf = new Map(wl.companies.map((c) => [companyKey(c.name), c.tier || 'C']));
  const onBoards = new Set(store.allJobs(db)
    .filter((j) => j.source !== 'linkedin' && j.source !== 'manual' && !j.closedAt)
    .map((j) => dupKey(j.company, j.title)));

  const queries = buildQueries(profile, cfg);
  summary.searches = queries.length;
  const cheap = (r) => profileLib.titleCheck(r.title, profile).ok && profileLib.locationCheck(r.location, profile).ok;

  const result = await source.fetchRoles({
    queries, sinceDays: cfg.sinceDays, pagesPerQuery: cfg.pagesPerQuery,
    maxDetails: cfg.maxDetails, delayMs: cfg.delayMs,
    // Already stored with a JD, or a duplicate of a board job: no need to open the page.
    skipDetail: (r) => onBoards.has(dupKey(r.company, r.title))
      || Boolean((store.getJob(db, r.id) || {}).description),
  }, { httpGetText: opts.httpGetText, sleep: opts.sleep, filter: cheap, log });

  summary.found = result.found;
  summary.requests = result.requests;
  summary.rateLimited = result.rateLimited;
  summary.errors = result.errors;
  if (result.rateLimited) log('  linkedin: rate limited (HTTP 429), kept what was gathered so far');

  store.tx(db, () => {
    for (const role of result.roles) {
      if (watchlist.isBlocked(role.company, wl)) { bump(summary.rejected, 'blocklisted company'); continue; }
      if (onBoards.has(dupKey(role.company, role.title))) { summary.duplicates += 1; continue; }
      const existing = store.getJob(db, role.id);
      const verdict = profileLib.evaluate(role.detailed ? role : { ...role, description: existing ? existing.description : '' }, profile);
      const li = linkedinCheck(role, cfg);
      if (existing) {
        const patch = { lastSeen: nowIso };
        if (role.detailed && role.description) patch.description = role.description;
        if (role.closed && !existing.closedAt) {
          patch.closedAt = nowIso;
          summary.closed += 1;
          store.addEvent(db, { jobId: role.id, at: nowIso, kind: 'closed', cause: 'linkedin' });
        }
        store.updateJob(db, role.id, patch);
        summary.seenAgain += 1;
        continue;
      }
      if (!verdict.ok) { bump(summary.rejected, verdict.reason.replace(/\d+\+/, 'N+')); continue; }
      if (!li.ok) { bump(summary.rejected, li.reason); continue; }
      summary.matched += 1;
      const fresh = !role.created || withinDays(role.created, profile.maxAgeDays, now.getTime());
      const status = fresh ? 'new' : 'backlog';
      store.insertJob(db, {
        id: role.id, title: role.title, company: role.company, location: role.location,
        url: role.url, description: role.description || '', source: 'linkedin', ats: 'linkedin',
        board: 'linkedin:search', tier: tierOf.get(companyKey(role.company)) || 'C',
        salaryMin: role.salaryMin ?? null, salaryMax: role.salaryMax ?? null,
        posted: role.created || null, firstSeen: nowIso, lastSeen: nowIso, status, updatedAt: nowIso,
      });
      summary.added[status] += 1;
    }

    // Not seen in staleDays and still untriaged → treat as closed (search results can't say).
    if (!result.rateLimited && !result.errors.length) {
      const cutoff = now.getTime() - cfg.staleDays * 864e5;
      for (const j of store.allJobs(db)) {
        if (j.source !== 'linkedin' || j.closedAt || !['new', 'backlog'].includes(j.status)) continue;
        if (Date.parse(j.lastSeen) >= cutoff) continue;
        store.updateJob(db, j.id, { closedAt: nowIso });
        store.addEvent(db, { jobId: j.id, at: nowIso, kind: 'closed', cause: 'linkedin-stale' });
        summary.closed += 1;
      }
    }
  });

  store.setMeta(db, 'linkedinScans', [...store.getMeta(db, 'linkedinScans', []), summary].slice(-KEEP_SCANS));
  return summary;
}

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

function oneLine(s) {
  if (s.disabled) return `${s.at} linkedin: disabled in search-profile.json`;
  const rej = Object.values(s.rejected).reduce((a, b) => a + b, 0);
  return `${s.at} linkedin: ${s.searches} searches · ${s.found} postings · ${s.matched} matching · `
    + `${s.added.new} new · ${s.added.backlog} backlog · ${s.seenAgain} seen again · ${s.duplicates} already on a watched board · `
    + `${s.closed} closed · ${rej} rejected · ${s.errors.length} errors${s.rateLimited ? ' · RATE LIMITED' : ''}`;
}

module.exports = { runLinkedInScan, settings, buildQueries, linkedinCheck, dupKey, oneLine };
