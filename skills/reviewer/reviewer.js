#!/usr/bin/env node
'use strict';
/**
 * reviewer.js — goal 1: the resume reviewer skill.
 *
 * Reads a Markdown / plain-text resume, scores every bullet against the Google-XYZ
 * rubric (via lib/xyz.js — the shared contract), and prints a per-bullet scorecard
 * with rewrite suggestions. Suggestions only — it NEVER edits the resume.
 *
 * Usage:
 *   node skills/reviewer/reviewer.js <resume.md> [--json] [--out <file>]
 *   node skills/reviewer/reviewer.js --stdin < resume.md
 */
const fs = require('fs');
const path = require('path');
const { reviewResume, formatReport } = require('../../lib/xyz');

function parseArgs(argv) {
  const args = { json: false, stdin: false, out: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--stdin') args.stdin = true;
    else if (a === '--out') args.out = argv[++i];
    else if (!a.startsWith('--')) args.file = a;
  }
  return args;
}

function readInput(args) {
  if (args.stdin) return fs.readFileSync(0, 'utf8');
  if (!args.file) {
    console.error('Usage: reviewer.js <resume.md> [--json] [--out <file>] | --stdin');
    process.exit(2);
  }
  return fs.readFileSync(path.resolve(args.file), 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const md = readInput(args);
  const review = reviewResume(md);
  const output = args.json ? JSON.stringify(review, null, 2) : formatReport(review);

  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), output);
    console.error(`Wrote ${args.json ? 'JSON' : 'scorecard'} to ${args.out}`);
  } else {
    process.stdout.write(output + '\n');
  }
  // Non-zero exit if there is nothing to score, so callers can detect an empty/bad resume.
  if (review.summary.totalBullets === 0) {
    console.error('No bullet lines found — is this a Markdown/plain-text resume with "- " bullets?');
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { parseArgs };
