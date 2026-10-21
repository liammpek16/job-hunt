#!/usr/bin/env node
'use strict';
/**
 * customizer.js — goal 3: the resume customizer skill.
 *
 * Tailors a resume to a specific job description: keyword-gap analysis + reuse of the
 * XYZ scorer, producing concrete suggestions to weave missing JD keywords into weak
 * bullets. Suggestions only — resume edits are approval-gated, never automatic.
 *
 * The JD can be a file, or a role id already in the shared store (from the searcher).
 *
 * With --docx it ALSO writes a NEW tailored-resume .docx: weak bullets replaced by their
 * XYZ rewrite, and a header note listing the JD keywords to weave in (truthfully). The
 * original resume is never modified.
 *
 * Usage:
 *   node skills/customizer/customizer.js --resume resume.md --jd job.txt [--json] [--out f]
 *   node skills/customizer/customizer.js --resume resume.md --role "adzuna:12345" [--docx out.docx]
 */
const fs = require('fs');
const path = require('path');
const { tailorResume, formatTailorReport } = require('../../lib/tailor');
const { scoreBullet } = require('../../lib/xyz');
const { writeResumeDocx } = require('../../lib/docx');
const { writeResumePdf } = require('../../lib/pdf');
const store = require('../../lib/db');

function parseArgs(argv) {
  const a = { resume: null, jd: null, role: null, json: false, out: null, docx: null, pdf: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--resume') a.resume = argv[++i];
    else if (k === '--jd') a.jd = argv[++i];
    else if (k === '--role') a.role = argv[++i];
    else if (k === '--json') a.json = true;
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--docx') a.docx = argv[++i];
    else if (k === '--pdf') a.pdf = argv[++i];
  }
  return a;
}

function resolveJd(args) {
  if (args.jd) return { text: fs.readFileSync(path.resolve(args.jd), 'utf8'), label: path.basename(args.jd) };
  if (args.role) {
    const role = store.getJob(store.open(), args.role);
    if (!role) throw new Error(`No job "${args.role}" in the store — run the scan first.`);
    return { text: `${role.title}\n${role.description || ''}`, label: `${role.title} @ ${role.company}` };
  }
  throw new Error('Provide a JD via --jd <file> or --role <id>.');
}

function improveBullet(text) {
  const b = scoreBullet(text);
  return b.score === 3 ? text : (b.rewrite || text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.resume) { console.error('Provide --resume <file>.'); process.exit(2); }
  const resumeText = fs.readFileSync(path.resolve(args.resume), 'utf8');
  const jd = resolveJd(args);
  const report = tailorResume(resumeText, jd.text);
  const out = args.json ? JSON.stringify(report, null, 2) : formatTailorReport(report, jd.label);
  if (args.out) { fs.writeFileSync(path.resolve(args.out), out); console.error(`Wrote report to ${args.out}`); }
  else if (!args.docx && !args.pdf) process.stdout.write(out + '\n');

  const missing = report.coverage.missing.map((k) => k.term).slice(0, 15).join(', ');
  const note = `Tailored for ${jd.label}. Weave these missing JD keywords in where truthful: `
    + `${missing || '(none — good coverage)'}. Weak bullets below carry XYZ rewrite scaffolds — `
    + 'fill the [bracketed] placeholders. Original resume unchanged; review before sending.';
  if (args.docx) {
    const written = await writeResumeDocx(resumeText, improveBullet, args.docx, note);
    console.error(`Wrote tailored-resume .docx to ${path.relative(process.cwd(), written)}`);
  }
  if (args.pdf) {
    const written = await writeResumePdf(resumeText, improveBullet, args.pdf, note);
    console.error(`Wrote tailored-resume .pdf to ${path.relative(process.cwd(), written)}`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { parseArgs, resolveJd, improveBullet };
