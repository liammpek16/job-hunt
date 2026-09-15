'use strict';
/**
 * tailored.js — storage for per-role tailored ("refined") resumes (goals: refine button +
 * preview menu).
 *
 * When the webapp runs the customizer/tailoring core against a surfaced role, it saves the
 * report here so the row can later show a "Preview resume" panel. Each role's report is one
 * Markdown file under data/tailored/<safeId>.md; a JSON sidecar holds a small summary
 * (coverage %, XYZ counts, generated timestamp) so listing does not have to re-parse Markdown.
 *
 * No network, no LLM — the tailoring itself is lib/tailor.js. This module is pure filesystem,
 * unit-testable by pointing `dir` at a temp directory.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'tailored');

/** Filesystem-safe filename for a role id (ids look like "claude:https://…"). */
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'role';
}

function dirOf(opts = {}) {
  return opts.dir || DEFAULT_DIR;
}
function mdPath(id, opts = {}) {
  return path.join(dirOf(opts), `${safeId(id)}.md`);
}
function metaPath(id, opts = {}) {
  return path.join(dirOf(opts), `${safeId(id)}.json`);
}
/** Path to the generated tailored-resume PDF for a role (goal: preview .pdf button). */
function pdfPath(id, opts = {}) {
  return path.join(dirOf(opts), `${safeId(id)}.pdf`);
}
/** True when a generated tailored-resume PDF exists for a role. */
function hasPdf(id, opts = {}) {
  return fs.existsSync(pdfPath(id, opts));
}

/** Persist a tailored report for a role. `summary` is any small JSON-able object. */
function save(id, markdown, summary = {}, opts = {}) {
  const dir = dirOf(opts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mdPath(id, opts), String(markdown));
  const meta = { id, ...summary, generatedAt: summary.generatedAt || new Date().toISOString() };
  fs.writeFileSync(metaPath(id, opts), JSON.stringify(meta, null, 2));
  return meta;
}

function exists(id, opts = {}) {
  return fs.existsSync(mdPath(id, opts));
}

/** Load a tailored report ({ markdown, meta }) or null if the role has none. */
function load(id, opts = {}) {
  if (!exists(id, opts)) return null;
  const markdown = fs.readFileSync(mdPath(id, opts), 'utf8');
  let meta = { id };
  try { meta = JSON.parse(fs.readFileSync(metaPath(id, opts), 'utf8')); } catch { /* sidecar optional */ }
  return { markdown, meta };
}

/** Set of role ids that have a tailored report (for annotating the roles list). */
function refinedIds(opts = {}) {
  const dir = dirOf(opts);
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return new Set(); }
  return new Set(files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
}

/** True when a role id's safe form is in the refined set (avoids reversing safeId). */
function isRefined(id, refined = refinedIds()) {
  return refined.has(safeId(id));
}

module.exports = { safeId, mdPath, metaPath, pdfPath, hasPdf, save, exists, load, refinedIds, isRefined, DEFAULT_DIR };
