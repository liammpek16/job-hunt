'use strict';
/**
 * text.js — shared text normalization for GENERATED resume documents (goal: "remove
 * accents on resume").
 *
 * Applicant-tracking systems (ATS) and older resume parsers frequently mangle accented
 * letters and "smart" punctuation ("José" → "Jos?", "café" → "caf" ), so a resume that
 * reads fine on screen can arrive garbled. `asciiResumeText` folds a resume string to a
 * clean ASCII form:
 *   • diacritics are stripped (é→e, ñ→n, ü→u, ç→c, Å→A …) via Unicode NFKD decomposition,
 *   • common non-ASCII punctuation is mapped to ASCII (smart quotes/dashes → straight,
 *     … → ..., non-breaking space → space),
 *   • a few ligatures/symbols are spelled out (æ→ae, œ→oe, ß→ss, … ).
 *
 * Content is preserved — only glyphs change. Applied at the text-emission points in both
 * resume writers (lib/docx.js, lib/pdf.js), so every generated .docx / .pdf — from the
 * reviewer, customizer, ATS scanner and the webapp — is ATS-safe by construction. The
 * ORIGINAL resume file is never modified. Pure + dependency-free → unit-testable.
 */

// Multi-character folds that NFKD does not handle (ligatures, eszett, symbols).
const SPECIAL = new Map([
  ['æ', 'ae'], ['Æ', 'AE'], ['œ', 'oe'], ['Œ', 'OE'], ['ß', 'ss'],
  ['ø', 'o'], ['Ø', 'O'], ['đ', 'd'], ['Đ', 'D'], ['ð', 'd'], ['Ð', 'D'],
  ['þ', 'th'], ['Þ', 'Th'], ['ł', 'l'], ['Ł', 'L'], ['ı', 'i'],
]);

// Non-ASCII punctuation → ASCII equivalents (superset of lib/ats.atsCleanBullet's set).
const PUNCT = new Map([
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"], // ‘ ’ ‚ ‛
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'], // “ ” „ ‟
  ['–', '-'], ['—', '-'], ['―', '-'], ['−', '-'], // – — ― −
  ['…', '...'],                                                   // …
  ['•', '-'], ['·', '-'], ['⁃', '-'],                   // • · ⁃
  [' ', ' '], [' ', ' '], [' ', ' '], [' ', ' '],  // nbsp/thin/hair/narrow-nbsp
  ['‐', '-'], ['‑', '-'],                                    // hyphen / non-breaking hyphen
  ['™', '(TM)'], ['®', '(R)'], ['©', '(C)'],            // ™ ® ©
]);

/**
 * Strip diacritics from a string, leaving the base ASCII letters (é→e, ñ→n, ü→u).
 * Multi-char specials are folded first; then NFKD + combining-mark removal.
 */
function deaccent(input) {
  let s = String(input == null ? '' : input);
  for (const [from, to] of SPECIAL) s = s.split(from).join(to);
  // NFKD splits an accented letter into base + combining mark; drop the marks.
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Map non-ASCII punctuation/spaces to their ASCII equivalents. */
function asciiPunct(input) {
  let s = String(input == null ? '' : input);
  for (const [from, to] of PUNCT) s = s.split(from).join(to);
  return s;
}

/**
 * Full ASCII fold for a line of GENERATED resume text: punctuation → ASCII, accents
 * stripped, then any residual non-ASCII code point dropped (belt-and-braces so nothing
 * ATS-hostile slips through). Whitespace is left intact (renderers handle layout).
 */
function asciiResumeText(input) {
  const folded = deaccent(asciiPunct(input));
  // Drop any remaining non-ASCII (rare symbols/emoji) — keep printable ASCII + whitespace.
  return folded.replace(/[^\x00-\x7F]/g, '');
}

module.exports = { deaccent, asciiPunct, asciiResumeText, SPECIAL, PUNCT };
