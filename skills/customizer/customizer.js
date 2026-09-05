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
 * Usage:
 *   node skills/customizer/customizer.js --resume resume.md --jd job.txt [--json] [--out f]
 *   node skills/customizer/customizer.js --resume resume.md --role "adzuna:12345"
 */
const fs = require('fs');
const path = require('path');
const { tailorResume, formatTailorReport } = require('../../lib/tailor');
const store = require('../../lib/store');

function parseArgs(argv) {
  const a = { resume: null, jd: null, role: null, json: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--resume') a.resume = argv[++i];
    else if (k === '--jd') a.jd = argv[++i];
    else if (k === '--role') a.role = argv[++i];
    else if (k === '--json') a.json = true;
    else if (k === '--out') a.out = argv[++i];
  }
  return a;
}

function resolveJd(args) {
  if (args.jd) return { text: fs.readFileSync(path.resolve(args.jd), 'utf8'), label: path.basename(args.jd) };
  if (args.role) {
    const s = store.load();
    const role = s.roles[args.role];
    if (!role) throw new Error(`No role "${args.role}" in the store — run the searcher first.`);
    return { text: `${role.title}\n${role.description || ''}`, label: `${role.title} @ ${role.company}` };
  }
  throw new Error('Provide a JD via --jd <file> or --role <id>.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.resume) { console.error('Provide --resume <file>.'); process.exit(2); }
  const resumeText = fs.readFileSync(path.resolve(args.resume), 'utf8');
  const jd = resolveJd(args);
  const report = tailorResume(resumeText, jd.text);
  const out = args.json ? JSON.stringify(report, null, 2) : formatTailorReport(report, jd.label);
  if (args.out) { fs.writeFileSync(path.resolve(args.out), out); console.error(`Wrote report to ${args.out}`); }
  else process.stdout.write(out + '\n');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { parseArgs, resolveJd };
