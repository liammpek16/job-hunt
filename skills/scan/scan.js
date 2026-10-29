#!/usr/bin/env node
'use strict';
/**
 * scan.js — run the daily watchlist scan and save results into data/jobhunt.db.
 *
 * Reads config/search-profile.json and the companies table, fetches every covered company's
 * ATS board, adds matching jobs as "new" (fresh, on an already-watched board) or "backlog",
 * and closes jobs that left their board. Appends a one-line result to data/scan.log. Once a
 * week it also runs company discovery (skills/scan/discover.js) after the scan.
 * Registered to run daily at 7am by scripts/register-daily-scan.ps1.
 *
 * Usage:
 *   node skills/scan/scan.js            # scan and save
 *   node skills/scan/scan.js --dry-run  # scan, print, don't save
 *   node skills/scan/scan.js --no-discover  # skip the weekly company discovery
 */
const fs = require('fs');
const path = require('path');
const store = require('../../lib/db');
const profileLib = require('../../lib/profile');
const watchlist = require('../../lib/watchlist');
const { runScan } = require('../../lib/scan');
const { discoverAndScan } = require('./discover');

const DISCOVER_EVERY_DAYS = 7;

const LOG_FILE = path.join(__dirname, '..', '..', 'data', 'scan.log');

function oneLine(sum) {
  const rej = Object.values(sum.rejected).reduce((a, b) => a + b, 0);
  return `${sum.at} scanned ${sum.scanned}/${sum.boards} boards · ${sum.matched} matching · `
    + `${sum.added.new} new · ${sum.added.backlog} backlog · ${sum.seenAgain} seen again · `
    + `${sum.closed || 0} closed · ${sum.reopened || 0} reopened · ${sum.dismissed || 0} dismissed (profile) · `
    + `${rej} rejected after JD check · ${sum.errors.length} errors`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = store.open();
  const profile = profileLib.load();
  console.log(`Scanning ${watchlist.coverage(store.loadWatchlist(db)).covered} covered companies…`);
  if (dryRun) db.exec('BEGIN'); // everything below is rolled back
  const sum = await runScan({ profile, db, log: console.log });
  const line = oneLine(sum);
  console.log(`\n${line}`);
  if (Object.keys(sum.rejected).length) {
    console.log('Rejected after JD check: ' + Object.entries(sum.rejected).map(([k, v]) => `${k} ×${v}`).join(', '));
  }
  for (const e of sum.errors.slice(0, 10)) console.log(`  ! ${e.ats}/${e.token || ''}: ${e.error}`);
  const fresh = store.allJobs(db).filter((j) => j.status === 'new' && j.firstSeen === sum.at);
  fresh.sort((a, b) => watchlist.TIER_RANK[a.tier] - watchlist.TIER_RANK[b.tier]);
  for (const j of fresh.slice(0, 25)) console.log(`  NEW [${j.tier}] ${j.title} — ${j.company} (${j.location})`);
  if (dryRun) { db.exec('ROLLBACK'); console.log('(dry run — nothing saved)'); return; }
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n');

  // Once a week, also look for new companies to watch (web search via Claude Code).
  const last = store.getMeta(db, 'lastDiscovery');
  const due = !last || Date.now() - Date.parse(last.at) > DISCOVER_EVERY_DAYS * 864e5;
  if (due && !process.argv.includes('--no-discover')) {
    try {
      const d = await discoverAndScan(db, profile, { log: console.log, cause: 'schedule' });
      fs.appendFileSync(LOG_FILE, `${d.at} discovery: ${d.candidates} postings, ${d.added.length} companies added`
        + (d.scan ? `, ${d.scan.added.new} new jobs` : '') + '\n');
    } catch (e) { console.log(`Discovery skipped: ${e.message}`); }
  }
}

if (require.main === module) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { oneLine };
