'use strict';
/**
 * tailor.js — the reusable tailoring core (goal 3), also reused by the ATS scanner (goal 4).
 *
 * Given a resume and a job description (JD), it:
 *   1. extracts the JD's meaningful keywords (deterministic: tokenize, drop stopwords, rank),
 *   2. computes keyword coverage (which JD keywords the resume already contains / is missing),
 *   3. reuses lib/xyz.js to score the resume's bullets,
 * and produces suggestions to weave missing keywords into weak bullets — following XYZ.
 *
 * Suggestions only. Editing the resume is a separate, approval-gated step (never automatic).
 */
const { reviewResume } = require('./xyz');

// Common English + resume-filler stopwords we never treat as JD keywords.
const STOPWORDS = new Set(
  ('a an the and or but if then else of to in on at by for with without from into over under '
    + 'as is are was were be been being do does did will would shall should can could may might must '
    + 'this that these those it its they them their you your we our us he she his her i me my '
    + 'not no yes all any some more most other such own same so than too very just also about '
    + 'we are looking look seek seeking ideal candidate candidates role position job work working experience years year '
    + 'ability able strong excellent good great plus preferred required requirements responsibilities '
    + 'you\'ll will have has had who what when where why how which team teams company across including '
    + 'etc e.g i.e using use used help helping ensure ensuring build building develop developing '
    + 'skills skill knowledge understanding proficiency familiarity plus benefits per week day '
    + 'opportunity opportunities environment fast paced paced growth grow join joining apply')
    .split(/\s+/)
);

/** Lowercased word tokens (letters/digits/+/#/. inside a token, e.g. c++, node.js, ci/cd → ci cd). */
function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((w) => w && w.length > 1);
}

/** Rank the JD's keywords by frequency (dropping stopwords + pure numbers). */
function extractKeywords(jdText, topN = 25) {
  const freq = new Map();
  for (const w of tokenize(jdText)) {
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue; // bare numbers aren't keywords
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([term, count]) => ({ term, count }));
}

/** Which JD keywords the resume already contains (whole-word) vs is missing. */
function keywordCoverage(resumeText, keywords) {
  const resumeTokens = new Set(tokenize(resumeText));
  const present = [];
  const missing = [];
  for (const k of keywords) (resumeTokens.has(k.term) ? present : missing).push(k);
  const total = keywords.length;
  return {
    total,
    present,
    missing,
    pct: total ? Math.round((present.length / total) * 100) : 0,
  };
}

/**
 * Full tailoring report. Returns structured data (reused by the ATS scanner) plus
 * concrete, XYZ-aware suggestions — never an edited resume.
 */
function tailorResume(resumeText, jdText, opts = {}) {
  const topN = opts.topN || 25;
  const keywords = extractKeywords(jdText, topN);
  const coverage = keywordCoverage(resumeText, keywords);
  const review = reviewResume(resumeText);
  const weakBullets = review.bullets.filter((b) => b.score <= 1);

  const suggestions = [];
  if (coverage.missing.length) {
    suggestions.push(
      `Weave these missing JD keywords into relevant bullets (only where truthful): `
        + coverage.missing.slice(0, 12).map((k) => k.term).join(', ') + '.'
    );
  }
  if (weakBullets.length) {
    suggestions.push(
      `Strengthen ${weakBullets.length} weak bullet(s) to full XYZ while adding the missing `
        + `keywords — e.g. "${weakBullets[0].text}" → add a quantified result + method.`
    );
  }
  if (!coverage.missing.length && !weakBullets.length) {
    suggestions.push('Strong match: all top JD keywords present and every bullet is solid XYZ.');
  }

  return { keywords, coverage, xyz: review.summary, weakBullets, suggestions };
}

/** Render the tailoring report as Markdown. */
function formatTailorReport(report, jdLabel = 'the job') {
  const { coverage, xyz, weakBullets, suggestions } = report;
  const lines = [];
  lines.push(`# Tailoring report — ${jdLabel}`, '');
  lines.push(`**Keyword coverage: ${coverage.pct}%** (${coverage.present.length}/${coverage.total} top JD keywords present).`);
  lines.push(`**Resume XYZ:** ${xyz.fullXYZ}/${xyz.totalBullets} bullets full XYZ · ${weakBullets.length} weak.`, '');
  if (coverage.missing.length) {
    lines.push('## Missing JD keywords', coverage.missing.map((k) => `- ${k.term} (JD mentions ${k.count}×)`).join('\n'), '');
  }
  if (coverage.present.length) {
    lines.push('## Already covered', coverage.present.map((k) => `- ${k.term}`).join('\n'), '');
  }
  lines.push('## Suggestions', suggestions.map((s) => `- ${s}`).join('\n'), '');
  lines.push('_Suggestions only — apply after your review; the skill never edits your resume._');
  return lines.join('\n');
}

module.exports = { tokenize, extractKeywords, keywordCoverage, tailorResume, formatTailorReport, STOPWORDS };
