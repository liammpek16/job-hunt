'use strict';
/**
 * relevance.js — deterministic relevance scoring for surfaced roles (goal: sort the
 * surfaced jobs by relevance).
 *
 * Every role the searcher saves carries the `query` it was found for ({title, location}).
 * This scores how well a role matches THAT query, with no LLM and no network — pure token
 * overlap, in the same spirit as the $0 tailoring core. Score is 0..100 (higher = closer).
 *
 * Signals (weights sum to 100):
 *   • title    (55): fraction of the query's title tokens present in the role title.
 *   • location (20): fraction of the query's location tokens present in the role location.
 *   • salary   (10): role carries salary data (10), and meets the query's salaryMin (full).
 *   • depth    (15): the role has a real description that echoes the query title (signal it
 *                    is a genuine match, not a bare listing).
 *
 * When a role has no stored query (older records / manual adds) an optional fallback query
 * can be passed in; with neither, title/location contribute 0 and the score reflects only
 * salary + description depth, so such rows sort last — which is the honest outcome.
 */
const { tokenize } = require('./tailor');

const WEIGHTS = { title: 55, location: 20, salary: 10, depth: 15 };

/** Fraction (0..1) of `wanted` tokens that appear in `have` (whole-token match). */
function coverageFraction(wantedText, haveText) {
  const wanted = [...new Set(tokenize(wantedText))];
  if (!wanted.length) return null; // nothing asked for → caller decides
  const have = new Set(tokenize(haveText));
  const hit = wanted.filter((t) => have.has(t)).length;
  return hit / wanted.length;
}

/**
 * Score one role against a query (defaults to the role's own stored `query`).
 * Returns { score, parts } where parts breaks the score down per signal (for tooltips/tests).
 */
function scoreRole(role = {}, fallbackQuery = null) {
  const query = role.query || fallbackQuery || {};
  const parts = { title: 0, location: 0, salary: 0, depth: 0 };

  const titleFrac = coverageFraction(query.title || '', role.title || '');
  if (titleFrac != null) parts.title = titleFrac * WEIGHTS.title;

  const locFrac = coverageFraction(query.location || '', role.location || '');
  if (locFrac != null) parts.location = locFrac * WEIGHTS.location;

  // Salary: half the weight just for carrying salary data, the other half for meeting the
  // query's minimum (or the full weight when no minimum was requested).
  if (role.salaryMin != null) {
    const wantMin = query.salaryMin != null ? Number(query.salaryMin) : null;
    const meets = wantMin == null || Number(role.salaryMin) >= wantMin;
    parts.salary = WEIGHTS.salary * (meets ? 1 : 0.5);
  }

  // Depth: a description that echoes the query title is a stronger match than a bare stub.
  const desc = String(role.description || '');
  if (desc.length >= 40) {
    const echo = coverageFraction(query.title || role.title || '', desc);
    parts.depth = WEIGHTS.depth * (echo == null ? 0.4 : 0.4 + 0.6 * echo);
  }

  const score = Math.round(parts.title + parts.location + parts.salary + parts.depth);
  return { score: Math.max(0, Math.min(100, score)), parts };
}

/** Attach a `relevance` number to each role and return a new array sorted high→low. */
function rankRoles(roles = [], fallbackQuery = null) {
  return roles
    .map((r) => ({ ...r, relevance: scoreRole(r, fallbackQuery).score }))
    .sort((a, b) => b.relevance - a.relevance
      || String(a.title || '').localeCompare(String(b.title || '')));
}

module.exports = { scoreRole, rankRoles, coverageFraction, WEIGHTS };
