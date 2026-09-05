'use strict';
/**
 * ats.js — the ATS-risk scanner core (goal 4).
 *
 * Flags things that get a resume auto-rejected or mis-parsed by Applicant Tracking
 * Systems: missing/weak JD keyword coverage, un-parseable formatting (tables, images,
 * HTML), missing contact info / standard sections, weak quantification, and length.
 *
 * Reuses lib/tailor.js (keyword coverage vs a JD) and lib/xyz.js (quantification), so
 * the ATS view shares the same contract as the reviewer and customizer.
 *
 * Deterministic / $0. Reports risks — it never edits the resume.
 */
const { reviewResume } = require('./xyz');
const { extractKeywords, keywordCoverage } = require('./tailor');

const SEVERITY_WEIGHT = { high: 20, med: 10, low: 3 };

function finding(severity, code, message) {
  return { severity, code, message };
}

/** Scan a resume for ATS-rejection risks. `opts.jdText` enables keyword-match checks. */
function scanResume(resumeText, opts = {}) {
  const text = String(resumeText);
  const findings = [];
  const lower = text.toLowerCase();

  // --- Parseability / formatting ---
  if (/^\s*\|.*\|.*$/m.test(text)) {
    findings.push(finding('high', 'tables', 'Markdown/pipe tables detected — many ATS scramble multi-column tables. Use plain lines.'));
  }
  if (/!\[[^\]]*\]\([^)]*\)/.test(text) || /<img\b/i.test(text)) {
    findings.push(finding('high', 'images', 'Images detected — ATS cannot read text inside images. Move any content into plain text.'));
  }
  if (/<\/?[a-z][\s\S]*?>/i.test(text)) {
    findings.push(finding('med', 'html', 'HTML tags detected — export to plain text/PDF; raw HTML can confuse parsers.'));
  }
  if (/[•▪‣⁃●]/.test(text)) {
    findings.push(finding('low', 'bullets', 'Non-standard bullet glyphs (•/▪/‣) — some parsers prefer simple "-" hyphen bullets.'));
  }
  if (/[‘’“”–—]/.test(text)) {
    findings.push(finding('low', 'smart-punct', 'Smart quotes / en–em dashes — older ATS may mangle them; prefer straight ASCII.'));
  }

  // --- Contact info ---
  if (!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) {
    findings.push(finding('high', 'no-email', 'No email address found — ATS needs it to route your application.'));
  }
  if (!/(\+?\d[\d\s().-]{7,}\d)/.test(text)) {
    findings.push(finding('low', 'no-phone', 'No phone number found — add one so recruiters can reach you.'));
  }

  // --- Standard sections ---
  if (!/\b(experience|employment|work history)\b/i.test(lower)) {
    findings.push(finding('med', 'no-experience', 'No "Experience" section header — ATS keys off standard section names.'));
  }
  if (!/\b(education|academic)\b/i.test(lower)) {
    findings.push(finding('low', 'no-education', 'No "Education" section — add one (even brief) for section parsing.'));
  }
  if (!/\b(skills|technologies|technical)\b/i.test(lower)) {
    findings.push(finding('med', 'no-skills', 'No "Skills" section — a keyword-rich skills list helps ATS keyword matching.'));
  }

  // --- Quantification (reuse the XYZ scorer) ---
  const review = reviewResume(text);
  if (review.summary.totalBullets > 0) {
    const quantPct = Math.round(
      (review.bullets.filter((b) => b.hasY).length / review.summary.totalBullets) * 100
    );
    if (quantPct < 40) {
      findings.push(finding('med', 'weak-quant', `Only ${quantPct}% of bullets have a quantified result — ATS-scored resumes favor measurable impact.`));
    }
  } else {
    findings.push(finding('med', 'no-bullets', 'No bullet points detected — ATS parses accomplishments best as bullets.'));
  }

  // --- Length ---
  const words = (text.match(/\b\w+\b/g) || []).length;
  if (words < 200) findings.push(finding('med', 'too-short', `Very short (${words} words) — likely missing detail ATS keyword-matches on.`));
  else if (words > 1200) findings.push(finding('low', 'too-long', `Long (${words} words) — trim to keep keyword density high.`));

  // --- JD keyword match (if a JD is supplied) ---
  let coverage = null;
  if (opts.jdText) {
    const keywords = extractKeywords(opts.jdText, opts.topN || 25);
    coverage = keywordCoverage(text, keywords);
    if (coverage.pct < 50) {
      findings.push(finding('high', 'low-keyword-match', `Only ${coverage.pct}% of top JD keywords present — high auto-reject risk. Add the missing ones (truthfully).`));
    } else if (coverage.pct < 75) {
      findings.push(finding('med', 'moderate-keyword-match', `${coverage.pct}% JD keyword coverage — add a few more of the missing keywords.`));
    }
  }

  // --- Score ---
  const penalty = findings.reduce((s, f) => s + (SEVERITY_WEIGHT[f.severity] || 0), 0);
  const score = Math.max(0, 100 - penalty);
  const verdict = score >= 80 ? 'low risk' : score >= 60 ? 'moderate risk' : 'high risk';

  return { score, verdict, findings, coverage, quantifiedPct: review.summary.totalBullets ? Math.round((review.bullets.filter((b) => b.hasY).length / review.summary.totalBullets) * 100) : 0 };
}

/** Render the scan as Markdown. */
function formatScan(scan) {
  const icon = { high: '🔴', med: '🟡', low: '🔵' };
  const lines = [];
  lines.push('# ATS scan', '');
  lines.push(`**ATS risk score: ${scan.score}/100 — ${scan.verdict}.**`);
  if (scan.coverage) lines.push(`Keyword coverage vs the JD: ${scan.coverage.pct}%.`);
  lines.push('');
  if (scan.findings.length === 0) {
    lines.push('No ATS risks detected. ✅');
  } else {
    lines.push('## Findings (most severe first)');
    const order = { high: 0, med: 1, low: 2 };
    [...scan.findings].sort((a, b) => order[a.severity] - order[b.severity]).forEach((f) => {
      lines.push(`- ${icon[f.severity]} **${f.severity.toUpperCase()}** [${f.code}] ${f.message}`);
    });
  }
  lines.push('', '_Risks only — the scanner never edits your resume._');
  return lines.join('\n');
}

module.exports = { scanResume, formatScan, SEVERITY_WEIGHT };
