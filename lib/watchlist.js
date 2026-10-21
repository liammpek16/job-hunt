'use strict';
/**
 * watchlist.js — helpers over the company watchlist: which companies the daily scan checks,
 * their priority tier, and which ATS board each one lives on.
 *
 * The watchlist lives in the companies table (lib/db.js, loadWatchlist → { blocklist,
 * companies }); config/companies.seed.json is only the starting list the migration imports.
 * A company: { name, tier: "A"|"B"|"C", ats?, slug?, jobs?, checkedAt?, slugs?: [guesses] }.
 * `ats` is filled by detection: greenhouse | ashby | lever | workable | smartrecruiters, or
 * "none" when no public board was found (not covered).
 */
const ATS_NAMES = ['greenhouse', 'ashby', 'lever', 'workable', 'smartrecruiters'];
const TIER_RANK = { A: 0, B: 1, C: 2 };

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Is this company (or a role's company name) on the blocklist? */
function isBlocked(name, wl) {
  const n = norm(name);
  return Boolean(n) && wl.blocklist.some((b) => norm(b) === n);
}

/** Covered, non-blocked companies grouped by ATS → { greenhouse: [{ token, name, tier }], … }. */
function boardsByAts(wl) {
  const out = Object.fromEntries(ATS_NAMES.map((a) => [a, []]));
  for (const c of wl.companies) {
    if (!c.slug || !out[c.ats] || isBlocked(c.name, wl)) continue;
    out[c.ats].push({ token: c.slug, name: c.name, tier: c.tier || 'C' });
  }
  return out;
}

function coverage(wl) {
  const live = wl.companies.filter((c) => !isBlocked(c.name, wl));
  const covered = live.filter((c) => ATS_NAMES.includes(c.ats));
  return {
    companies: live.length,
    covered: covered.length,
    notCovered: live.filter((c) => c.ats === 'none').length,
    unchecked: live.filter((c) => !c.ats).length,
    byAts: Object.fromEntries(ATS_NAMES.map((a) => [a, covered.filter((c) => c.ats === a).length])),
  };
}

module.exports = { ATS_NAMES, TIER_RANK, norm, isBlocked, boardsByAts, coverage };
