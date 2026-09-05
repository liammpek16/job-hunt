#!/usr/bin/env node
'use strict';
/**
 * dashboard.js — goal 6: track jobs applied to / interviews and render a dashboard.
 *
 * Reads the shared store (data/jobs.json). By default it renders a self-contained HTML
 * dashboard (funnel + stat tiles + per-role table) and prints a terminal summary. It also
 * carries the lightweight tracking commands that give the dashboard real data.
 *
 * Usage:
 *   node skills/dashboard/dashboard.js                       # render dashboard.html + summary
 *   node skills/dashboard/dashboard.js --out board.html      # custom output path
 *   node skills/dashboard/dashboard.js --json                # print aggregate JSON
 *   node skills/dashboard/dashboard.js --apply <id>          # mark a role applied
 *   node skills/dashboard/dashboard.js --status <id> <status># set status (saved..rejected)
 *   node skills/dashboard/dashboard.js --interview <id> [--kind "phone screen"] [--notes "..."]
 */
const fs = require('fs');
const path = require('path');
const store = require('../../lib/store');
const { aggregate, renderHtml, renderTerminal } = require('../../lib/dashboard');

function parseArgs(argv) {
  const a = { out: null, json: false, apply: null, status: null, statusVal: null, interview: null, kind: 'interview', notes: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i];
    else if (k === '--json') a.json = true;
    else if (k === '--apply') a.apply = argv[++i];
    else if (k === '--status') { a.status = argv[++i]; a.statusVal = argv[++i]; }
    else if (k === '--interview') a.interview = argv[++i];
    else if (k === '--kind') a.kind = argv[++i];
    else if (k === '--notes') a.notes = argv[++i];
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const s = store.load();
  let mutated = false;

  if (args.apply) { store.setStatus(s, args.apply, 'applied'); mutated = true; }
  if (args.status) { store.setStatus(s, args.status, args.statusVal); mutated = true; }
  if (args.interview) { store.addInterview(s, args.interview, { kind: args.kind, notes: args.notes }); mutated = true; }
  if (mutated) { store.save(s); console.error('Store updated.'); }

  const agg = aggregate(s);

  if (args.json) { process.stdout.write(JSON.stringify(agg, null, 2) + '\n'); return; }

  const outPath = path.resolve(args.out || 'dashboard.html');
  fs.writeFileSync(outPath, renderHtml(agg));
  console.log(renderTerminal(agg));
  console.log(`\nHTML dashboard → ${path.relative(process.cwd(), outPath)}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { parseArgs };
