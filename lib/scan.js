'use strict';
/**
 * scan.js — the daily watchlist scan.
 *
 * Fetches every covered company's ATS board (the companies table), keeps roles that pass the
 * search profile (title, location, years required) and aren't from a blocklisted company, and
 * merges them into the jobs table:
 *   • a job already stored gets lastSeen = now;
 *   • a newly seen job gets firstSeen/lastSeen, tier, ats, board, posted, and a status:
 *       "new"     — its board was scanned on an earlier run, and it was posted within
 *                   profile.maxAgeDays (or has no posted date);
 *       "backlog" — first scan of its board (so adding companies doesn't flood New), or older;
 *   • a stored job whose board was fetched but no longer lists it gets closedAt = now (and
 *     loses it again if it reappears). A board that comes back empty while we hold open jobs
 *     for it is treated as a glitch and closes nothing.
 *   • jobs still in triage (new/backlog) that no longer fit the profile's titles or locations
 *     are dismissed with cause "profile" (undoable), so changing the profile tidies the list.
 * Each run appends a summary to meta "scans" (last 60 kept).
 */
const profileLib = require('./profile');
const watchlist = require('./watchlist');
const store = require('./db');
const { withinDays } = require('./sources/board-common');

const KEEP_SCANS = 60;

function loadSource(ats) {
  return require(`./sources/${ats}`);
}

/**
 * opts: { profile, db, now?, httpGetJson?, httpJson?, loadSource? (tests), log?,
 *         only?: [company names], firstScanNew?: fresh roles on a first-scanned board → New }
 * Writes to opts.db; returns the run summary.
 */
async function runScan(opts) {
  const { profile, db } = opts;
  const now = opts.now || new Date();
  const nowIso = now.toISOString();
  const log = opts.log || (() => {});
  const getSource = opts.loadSource || loadSource;
  const wl = store.loadWatchlist(db);
  if (opts.only) {
    const want = new Set(opts.only.map(watchlist.norm));
    wl.companies = wl.companies.filter((c) => want.has(watchlist.norm(c.name)));
  }
  const scannedBefore = store.getMeta(db, 'companiesScanned', {});
  const scannedNow = { ...scannedBefore };
  const lastScanned = store.getMeta(db, 'boardsLastScanned', {});

  const keep = (role) => profileLib.titleCheck(role.title, profile).ok
    && profileLib.locationCheck(role.location, profile).ok;
  const summary = {
    at: nowIso, boards: 0, scanned: 0, errors: [], matched: 0,
    added: { new: 0, backlog: 0 }, seenAgain: 0, closed: 0, reopened: 0, dismissed: 0, rejected: {},
  };
  if (opts.only) summary.only = opts.only;

  for (const [ats, boards] of Object.entries(watchlist.boardsByAts(wl))) {
    if (!boards.length) continue;
    summary.boards += boards.length;
    const src = getSource(ats);
    const tierOf = Object.fromEntries(boards.map((b) => [b.token, b.tier]));
    const tokenOf = Object.fromEntries(boards.map((b) => [b.name, b.token]));
    let result;
    try {
      result = await src.fetchRoles(
        // searchTerms/titleOk: for boards that search server-side (Workday)
        { country: profile.country, sinceDays: 36500, searchTerms: profile.titles, titleOk: (t) => profileLib.titleCheck(t, profile).ok },
        Infinity,
        { companies: boards, filter: keep, httpGetJson: opts.httpGetJson, httpJson: opts.httpJson },
      );
    } catch (e) {
      summary.errors.push({ ats, error: e.message });
      continue;
    }
    summary.scanned += result.scanned.length;
    for (const err of result.errors) summary.errors.push({ ats, ...err });
    log(`  ${ats}: ${result.scanned.length}/${boards.length} boards, ${result.roles.length} matching roles`);

    store.tx(db, () => {
      for (const role of result.roles) {
        if (watchlist.isBlocked(role.company, wl)) { bump(summary.rejected, 'blocklisted company'); continue; }
        const verdict = profileLib.evaluate(role, profile);
        if (!verdict.ok) { bump(summary.rejected, verdict.reason.replace(/\d+\+/, 'N+')); continue; }
        summary.matched += 1;
        const existing = store.getJob(db, role.id);
        if (existing) {
          const patch = { lastSeen: nowIso };
          if (!existing.posted && role.created) patch.posted = role.created;
          if (role.description && role.description !== existing.description) patch.description = role.description; // JD edits (applied jobs keep their snapshot)
          store.updateJob(db, role.id, patch);
          summary.seenAgain += 1;
          continue;
        }
        const token = tokenOf[role.company];
        const board = `${ats}:${token}`;
        const fresh = !role.created || withinDays(role.created, profile.maxAgeDays, now.getTime());
        // A board's first scan goes to Backlog (no flood when seeding), unless the company was
        // just added on purpose (discovery, paste-a-link, add company): then fresh roles are New.
        const status = (scannedBefore[board] || opts.firstScanNew) && fresh ? 'new' : 'backlog';
        store.insertJob(db, {
          id: role.id, title: role.title, company: role.company, location: role.location,
          url: role.url, description: role.description, source: role.source, ats, board,
          tier: tierOf[token] || 'C', salaryMin: role.salaryMin ?? null, salaryMax: role.salaryMax ?? null,
          posted: role.created || null, firstSeen: nowIso, lastSeen: nowIso, status, updatedAt: nowIso,
        });
        summary.added[status] += 1;
      }
      for (const token of result.scanned) {
        const board = `${ats}:${token}`;
        if (!scannedNow[board]) scannedNow[board] = nowIso;
        lastScanned[board] = nowIso;
        const name = (boards.find((b) => b.token === token) || {}).name;
        markClosed(db, board, store.jobsForBoard(db, board, ats, name), new Set(result.onBoard[token] || []), nowIso, summary);
      }
    });
  }

  // Profile changed (e.g. a location dropped)? Jobs still in triage that no longer fit leave it.
  if (!opts.only) {
    store.tx(db, () => {
      for (const j of store.allJobs(db)) {
        if (!['new', 'backlog'].includes(j.status) || j.source === 'manual') continue;
        const t = profileLib.titleCheck(j.title, profile);
        const l = profileLib.locationCheck(j.location, profile);
        if (t.ok && l.ok) continue;
        store.setStatus(db, j.id, 'dismissed', { cause: 'profile', now, data: { reason: t.ok ? l.reason : t.reason } });
        summary.dismissed += 1;
      }
    });
  }

  store.setMeta(db, 'companiesScanned', scannedNow);
  store.setMeta(db, 'boardsLastScanned', lastScanned);
  store.setMeta(db, 'scans', [...store.getMeta(db, 'scans', []), summary].slice(-KEEP_SCANS));
  return summary;
}

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

/** Close jobs the board no longer lists; reopen closed ones that came back. */
function markClosed(db, board, jobs, live, nowIso, summary) {
  const open = jobs.filter((j) => !j.closedAt);
  if (!live.size && open.length) {
    const [ats, token] = board.split(':');
    summary.errors.push({ ats, token, error: 'board returned no postings; nothing closed' });
    return;
  }
  for (const j of jobs) {
    const patch = j.board ? {} : { board };
    if (live.has(j.id)) {
      if (j.closedAt) {
        patch.closedAt = null;
        summary.reopened += 1;
        store.addEvent(db, { jobId: j.id, at: nowIso, kind: 'reopened', cause: 'scan' });
      }
    } else if (!j.closedAt) {
      patch.closedAt = nowIso;
      summary.closed += 1;
      store.addEvent(db, { jobId: j.id, at: nowIso, kind: 'closed', cause: 'scan' });
    }
    if (Object.keys(patch).length) store.updateJob(db, j.id, patch);
  }
}

module.exports = { runScan };
