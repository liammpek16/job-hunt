#!/usr/bin/env node
'use strict';
/**
 * ats.js (skill) — goal 4: the ATS scanner skill.
 *
 * Scans a (tailored) resume for Applicant-Tracking-System rejection risks: keyword
 * match vs the JD, formatting/parseability, missing contact info / sections, weak
 * quantification, and length. Reports risks with severity + an ATS risk score.
 * Risks only — it never edits the resume.
 *
 * Usage:
 *   node skills/ats/ats.js --resume resume.md [--jd job.txt | --role <id>] [--json] [--out f]
 */
const fs = require('fs');
const path = require('path');
const { scanResume, formatScan } = require('../../lib/ats');
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

function resolveJdText(args) {
  if (args.jd) return fs.readFileSync(path.resolve(args.jd), 'utf8');
  if (args.role) {
    const s = store.load();
    const role = s.roles[args.role];
    if (!role) throw new Error(`No role "${args.role}" in the store.`);
    return `${role.title}\n${role.description || ''}`;
  }
  return null; // JD is optional; without it, keyword checks are skipped.
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.resume) { console.error('Provide --resume <file>.'); process.exit(2); }
  const resumeText = fs.readFileSync(path.resolve(args.resume), 'utf8');
  const jdText = resolveJdText(args);
  const scan = scanResume(resumeText, { jdText });
  const out = args.json ? JSON.stringify(scan, null, 2) : formatScan(scan);
  if (args.out) { fs.writeFileSync(path.resolve(args.out), out); console.error(`Wrote scan to ${args.out}`); }
  else process.stdout.write(out + '\n');
  // Exit 1 on high risk so the pipeline can gate on it.
  if (scan.verdict === 'high risk') process.exit(1);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(2); }
}
module.exports = { parseArgs, resolveJdText };
