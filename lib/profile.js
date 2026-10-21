'use strict';
/**
 * profile.js — the search profile (config/search-profile.json) and the filter every scanned
 * role passes through: title include/exclude, location, and years-of-experience required.
 *
 * evaluate(role, profile) → { ok, reason } so rejected roles can be logged with why.
 */
const fs = require('fs');
const path = require('path');
const { remoteInCountry } = require('./sources/board-common');

const DEFAULT_FILE = path.join(__dirname, '..', 'config', 'search-profile.json');

function load(file = DEFAULT_FILE) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    titles: p.titles || [],
    excludeTitleWords: p.excludeTitleWords || [],
    locations: p.locations || [],
    allowRemote: p.allowRemote !== false,
    country: p.country || 'us',
    maxYearsRequired: p.maxYearsRequired ?? null,
    maxAgeDays: p.maxAgeDays ?? 7,
  };
}

/** Lowercase, fold "pre-sales"/"pre sales" → "presales", punctuation → single spaces. */
function normalizeTitle(s) {
  return ` ${String(s || '').toLowerCase()
    .replace(/\bpre[\s-]+sales\b/g, 'presales')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()} `;
}

/** Title must contain one of the profile phrases and none of the excluded words. */
function titleCheck(title, profile) {
  const t = normalizeTitle(title);
  const bad = profile.excludeTitleWords.find((w) => t.includes(normalizeTitle(w)));
  if (bad) return { ok: false, reason: `title has "${bad}"` };
  if (!profile.titles.length) return { ok: true };
  const hit = profile.titles.find((p) => t.includes(normalizeTitle(p)));
  if (hit) return { ok: true, match: hit };
  return { ok: false, reason: 'title not in profile' };
}

/**
 * Location matches a profile entry when the whole place phrase appears ("new york", so
 * "Newark" or "New Zealand" don't count) or one of its state codes appears as ", MA"-style
 * text. Otherwise remote roles pass when allowRemote and the role is remote in-country.
 */
function locationCheck(location, profile) {
  const raw = String(location || '');
  const loc = ` ${raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  for (const l of profile.locations) {
    const phrase = ` ${String(l.query || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    if (phrase.trim() && loc.includes(phrase)) return { ok: true, match: l.query };
    for (const st of l.states || []) {
      if (new RegExp(`(^|[,(\\s])${st}(\\b|$)`).test(raw)) return { ok: true, match: st };
    }
  }
  if (!profile.locations.length) return { ok: true };
  if (profile.allowRemote && remoteInCountry(raw, profile.country)) return { ok: true, match: 'US remote' };
  return { ok: false, reason: 'location not in profile' };
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * Smallest "N+ years" / "N years of experience" / "minimum of N years" the JD asks for, or
 * null. The smallest is used because JDs often list a lower bar plus a "preferred" one.
 */
function yearsRequired(description) {
  const text = String(description || '').toLowerCase();
  const re = /(?:minimum of |at least )?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+|\s*-\s*\d{1,2}|\s+or more|\s+to\s+\d{1,2})?\s*(?:\+\s*)?years?(?:'|’)?\s+(?:of\s+)?(?:[\w-]+\s+){0,4}?(?:experience|exp\b)/g;
  let min = null;
  let m;
  while ((m = re.exec(text))) {
    const n = NUM_WORDS[m[1]] ?? Number(m[1]);
    if (n > 0 && n <= 20 && (min == null || n < min)) min = n;
  }
  return min;
}

function evaluate(role, profile) {
  const t = titleCheck(role.title, profile);
  if (!t.ok) return t;
  const l = locationCheck(role.location, profile);
  if (!l.ok) return l;
  if (profile.maxYearsRequired != null) {
    const yrs = yearsRequired(role.description);
    if (yrs != null && yrs > profile.maxYearsRequired) return { ok: false, reason: `asks for ${yrs}+ years` };
  }
  return { ok: true };
}

/**
 * Why a job is on the list, as dashboard chips: the title phrase and place it matched, how
 * many years the JD asks for, and how old the posting is.
 */
function explain(job, profile, now = Date.now()) {
  const t = titleCheck(job.title, profile);
  const l = locationCheck(job.location, profile);
  const posted = Date.parse(job.posted || job.firstSeen || '');
  return {
    title: t.ok ? (t.match || null) : null,
    location: l.ok ? (l.match || null) : null,
    years: yearsRequired(job.description),
    ageDays: Number.isNaN(posted) ? null : Math.max(0, Math.floor((now - posted) / 864e5)),
  };
}

module.exports = { DEFAULT_FILE, load, normalizeTitle, titleCheck, locationCheck, yearsRequired, evaluate, explain };
