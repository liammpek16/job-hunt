'use strict';
/**
 * scan.js — the daily watchlist scan.
 *
 * Fetches every covered company's ATS board (config/companies.json), keeps roles that pass the
 * search profile (title, location, years required) and aren't from a blocklisted company, and
 * merges them into the store:
 *   • a role already in the store gets lastSeen = now;
 *   • a newly seen role gets firstSeen/lastSeen, tier, ats, posted, and a triage state:
 *       "new"     — its board was scanned on an earlier run, and it was posted within
 *                   profile.maxAgeDays (or has no posted date);
 *       "backlog" — first scan of its board (so the first run doesn't flood New), or older;
 *   • a stored role whose board was fetched but no longer lists it gets closedAt = now (and
 *     loses it again if it reappears). A board that comes back empty while we hold open roles
 *     for it is treated as a glitch and closes nothing.
 * Each run appends a summary to store.meta.scans (last 60 kept).
 */
const profileLib = require('./profile');
const watchlist = require('./watchlist');
const { withinDays } = require('./sources/claude');

const KEEP_SCANS = 60;

function loadSource(ats) {
  return require(`./sources/${ats}`);
}

/**
 * opts: { profile, wl, store, now?, httpGetJson?, loadSource? (for tests), log? }
 * Mutates opts.store; returns the run summary.
 */
async function runScan(opts) {
  const { profile, wl, store } = opts;
  const now = opts.now || new Date();
  const nowIso = now.toISOString();
  const log = opts.log || (() => {});
  const getSource = opts.loadSource || loadSource;
  store.meta = store.meta || {};
  const scannedBefore = { ...(store.meta.companiesScanned || {}) };
  store.meta.companiesScanned = store.meta.companiesScanned || {};

  const keep = (role) => profileLib.titleCheck(role.title, profile).ok
    && profileLib.locationCheck(role.location, profile).ok;
  const summary = {
    at: nowIso, boards: 0, scanned: 0, errors: [], matched: 0,
    added: { new: 0, backlog: 0 }, seenAgain: 0, closed: 0, reopened: 0, rejected: {},
  };

  for (const [ats, boards] of Object.entries(watchlist.boardsByAts(wl))) {
    if (!boards.length) continue;
    summary.boards += boards.length;
    const src = getSource(ats);
    const tierOf = Object.fromEntries(boards.map((b) => [b.token, b.tier]));
    const nameToToken = Object.fromEntries(boards.map((b) => [b.name, b.token]));
    let result;
    try {
      result = await src.fetchRoles(
        { country: profile.country, sinceDays: 36500 },
        Infinity,
        { companies: boards, filter: keep, httpGetJson: opts.httpGetJson },
      );
    } catch (e) {
      summary.errors.push({ ats, error: e.message });
      continue;
    }
    summary.scanned += result.scanned.length;
    for (const err of result.errors) summary.errors.push({ ats, ...err });
    log(`  ${ats}: ${result.scanned.length}/${boards.length} boards, ${result.roles.length} matching roles`);

    for (const role of result.roles) {
      if (watchlist.isBlocked(role.company, wl)) { bump(summary.rejected, 'blocklisted company'); continue; }
      const verdict = profileLib.evaluate(role, profile);
      if (!verdict.ok) { bump(summary.rejected, verdict.reason.replace(/\d+\+/, 'N+')); continue; }
      summary.matched += 1;
      const existing = store.roles[role.id];
      if (existing) {
        existing.lastSeen = nowIso;
        if (!existing.posted && role.created) existing.posted = role.created;
        summary.seenAgain += 1;
        continue;
      }
      const token = nameToToken[role.company];
      const boardKey = `${ats}:${token}`;
      const fresh = !role.created || withinDays(role.created, profile.maxAgeDays, now.getTime());
      const triage = scannedBefore[boardKey] && fresh ? 'new' : 'backlog';
      store.roles[role.id] = {
        ...role,
        tier: tierOf[token] || 'C',
        ats,
        board: boardKey,
        posted: role.created || null,
        firstSeen: nowIso,
        lastSeen: nowIso,
        triage,
      };
      summary.added[triage] += 1;
    }
    for (const token of result.scanned) {
      const key = `${ats}:${token}`;
      if (!store.meta.companiesScanned[key]) store.meta.companiesScanned[key] = nowIso;
      markClosed(store, key, boardRoles(store, ats, token, boards), new Set(result.onBoard[token] || []), nowIso, summary);
    }
  }

  store.meta.scans = [...(store.meta.scans || []), summary].slice(-KEEP_SCANS);
  return summary;
}

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

/** Stored roles that came from this board (older scans didn't record `board`; match on company). */
function boardRoles(store, ats, token, boards) {
  const key = `${ats}:${token}`;
  const name = (boards.find((b) => b.token === token) || {}).name;
  return Object.values(store.roles).filter((r) => r.board === key
    || (!r.board && r.triage && r.ats === ats && r.company === name));
}

/** Close roles the board no longer lists; reopen closed ones that came back. */
function markClosed(store, key, roles, live, nowIso, summary) {
  const open = roles.filter((r) => !r.closedAt);
  if (!live.size && open.length) {
    const [ats, token] = key.split(':');
    summary.errors.push({ ats, token, error: 'board returned no postings; nothing closed' });
    return;
  }
  for (const r of roles) {
    if (!r.board) r.board = key;
    if (live.has(r.id)) {
      if (r.closedAt) { delete r.closedAt; summary.reopened += 1; }
    } else if (!r.closedAt) {
      r.closedAt = nowIso;
      summary.closed += 1;
    }
  }
}

module.exports = { runScan };
