'use strict';
/**
 * xyz.js — the shared Google-XYZ scorer.
 *
 * This is the reusable contract for the whole project. The reviewer (goal 1),
 * the customizer (goal 3), the ATS scanner (goal 4) and the dashboard (goal 6)
 * all consume the SAME per-bullet shape produced here:
 *
 *   { text, hasX, hasY, hasZ, score, missing:[...], rewrite }
 *
 * A Google-XYZ bullet reads: "Accomplished [X], as measured by [Y], by doing [Z]."
 *   X = a strong action verb / accomplishment (leads the bullet)
 *   Y = a QUANTIFIED result (a number, %, $, magnitude, time, count)
 *   Z = the method / how (a "by ...ing" clause, "using", "via", tools)
 *
 * Detection is fully deterministic (no LLM, $0) so it is unit-testable and cheap.
 */

// A compact but broad set of strong past-tense resume action verbs (X).
const ACTION_VERBS = new Set([
  'accelerated', 'achieved', 'acquired', 'adapted', 'administered', 'analyzed',
  'architected', 'authored', 'automated', 'built', 'boosted', 'championed',
  'coached', 'completed', 'conducted', 'consolidated', 'converted', 'created', 'cut', 'decreased',
  'delivered', 'deployed', 'designed', 'developed', 'devised', 'directed',
  'doubled', 'drove', 'eliminated', 'enabled', 'engineered', 'enhanced',
  'established', 'exceeded', 'executed', 'expanded', 'expedited', 'generated',
  'grew', 'implemented', 'improved', 'increased', 'initiated', 'innovated',
  'integrated', 'introduced', 'launched', 'led', 'leveraged', 'maintained',
  'managed', 'migrated', 'minimized', 'modernized', 'negotiated', 'optimized',
  'orchestrated', 'overhauled', 'performed', 'pioneered', 'produced', 'programmed', 'provided',
  'reduced', 'redesigned', 'refactored', 'resolved', 'restructured', 'saved',
  'scaled', 'shipped', 'slashed', 'spearheaded', 'standardized', 'streamlined',
  'strengthened', 'tripled', 'won',
]);

// Y — a quantified result. Numbers with a unit/symbol, bare percentages,
// money, magnitudes (k/m/bn), multipliers (3x), or a plain count of things.
const QUANT_PATTERNS = [
  /\$\s?\d[\d.,]*\s?(k|m|b|bn|million|billion|thousand)?/i, // money
  /\b\d[\d.,]*\s?%/,                                        // percent (symbol)
  /\b\d[\d.,]*\s?(percent|pct)\b/i,                         // percent (word)
  /\b\d[\d.,]*\s?x\b/i,                                     // 3x, 10x
  /\b\d[\d.,]*\s?(k|m|bn)\b/i,                              // 50k, 2m
  /\b\d[\d.,]*\s?(million|billion|thousand)\b/i,
  /\b\d[\d.,]*\s?(hours?|days?|weeks?|months?|years?|minutes?|seconds?)\b/i,
  /\b\d[\d.,]*\s?(users?|customers?|clients?|people|engineers?|teams?|projects?|requests?|queries|records?|rows?|apis?|services?|tickets?|deals?|leads?)\b/i,
  /\bby\s+\d[\d.,]*\b/i,                                    // "by 40"
  /\bto\s+\d[\d.,]*\b/i,                                    // "to 99.9"
  // A plain count: a 1-3 digit number (not a 4-digit year) directly quantifying a
  // following word — "5 proof of concepts", "18 different deflectors", "3 designs".
  /\b\d{1,3}(?:,\d{3})*\s+[a-z]{3,}/i,
];

// Z — the method / how. A "by <gerund>" clause or an explicit method word.
const METHOD_PATTERNS = [
  /\bby\s+\w+ing\b/i,          // by automating, by migrating
  /\b(using|via|through|leveraging|with|by implementing|by building|by designing|by introducing)\b/i,
];

function firstWord(text) {
  const m = String(text).trim().match(/^[•\-*\d.)\s]*([A-Za-z][\w'-]*)/);
  return m ? m[1].toLowerCase() : '';
}

function anyMatch(patterns, text) {
  return patterns.some((re) => re.test(text));
}

/** Score a single bullet against the XYZ rubric. Deterministic. */
function scoreBullet(rawText) {
  const text = String(rawText).trim();
  const lead = firstWord(text);
  const hasX = ACTION_VERBS.has(lead);
  const hasY = anyMatch(QUANT_PATTERNS, text);
  const hasZ = anyMatch(METHOD_PATTERNS, text);
  const score = (hasX ? 1 : 0) + (hasY ? 1 : 0) + (hasZ ? 1 : 0);

  const missing = [];
  if (!hasX) missing.push('X (lead with a strong action verb)');
  if (!hasY) missing.push('Y (add a quantified result — %, $, count, time)');
  if (!hasZ) missing.push('Z (say how — a "by …ing" method clause)');

  return { text, hasX, hasY, hasZ, score, missing, rewrite: suggestRewrite(text, { hasX, hasY, hasZ }) };
}

/**
 * A deterministic rewrite SCAFFOLD. With no LLM we can't invent real metrics,
 * so we return the strongest honest template: keep what the bullet already has,
 * insert explicit placeholders for what's missing. Suggestion only — never applied.
 */
function suggestRewrite(text, { hasX, hasY, hasZ }) {
  if (hasX && hasY && hasZ) return null; // already full XYZ
  const core = text.replace(/^[•\-*\d.)\s]+/, '').trim();
  const x = hasX ? '' : '[strong action verb] ';
  const y = hasY ? '' : ' as measured by [quantified result — %, $, count, or time]';
  const z = hasZ ? '' : ' by [method — what you did/built/used]';
  return `${x}${core}${y}${z}`.replace(/\s+/g, ' ').trim();
}

/** Pull bullet lines out of a Markdown / plain-text resume. */
function extractBullets(markdown) {
  const bullets = [];
  const lines = String(markdown).split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/);
    if (m && m[1].trim().length > 0) bullets.push(m[1].trim());
  }
  return bullets;
}

/** Review a whole resume → structured report other skills reuse. */
function reviewResume(markdown) {
  const bullets = extractBullets(markdown).map(scoreBullet);
  const total = bullets.length;
  const full = bullets.filter((b) => b.score === 3).length;
  const weak = bullets.filter((b) => b.score <= 1).length;
  const avg = total ? bullets.reduce((s, b) => s + b.score, 0) / total : 0;
  return {
    summary: {
      totalBullets: total,
      fullXYZ: full,
      weak,
      avgScore: Number(avg.toFixed(2)),
      pctFull: total ? Math.round((full / total) * 100) : 0,
    },
    bullets,
  };
}

/** Render the structured review as a human-readable Markdown scorecard. */
function formatReport(review) {
  const { summary, bullets } = review;
  const lines = [];
  lines.push('# Resume XYZ scorecard', '');
  lines.push(
    `**${summary.fullXYZ}/${summary.totalBullets} bullets are full XYZ** ` +
      `(${summary.pctFull}%) · avg score ${summary.avgScore}/3 · ${summary.weak} weak (≤1).`,
    ''
  );
  bullets.forEach((b, i) => {
    const tag = b.score === 3 ? '✅' : b.score === 2 ? '🟡' : '🔴';
    lines.push(`### ${tag} Bullet ${i + 1} — ${b.score}/3  [${b.hasX ? 'X' : '·'}${b.hasY ? 'Y' : '·'}${b.hasZ ? 'Z' : '·'}]`);
    lines.push(`> ${b.text}`);
    if (b.missing.length) lines.push('', `Missing: ${b.missing.join('; ')}.`);
    if (b.rewrite) lines.push('', `Suggested rewrite: _${b.rewrite}_`);
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = { scoreBullet, extractBullets, reviewResume, formatReport, ACTION_VERBS };
