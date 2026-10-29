#!/usr/bin/env node
'use strict';
/**
 * discover.js — find new companies to watch (web search by Claude, verified against each
 * company's own job board), add them, and scan them.
 *
 * Usage:
 *   node skills/scan/discover.js            # discover + scan the new companies
 *   node skills/scan/discover.js --dry-run  # show what would be added
 *
 * The daily scan (skills/scan/scan.js) also runs this once a week by itself.
 */
const store = require('../../lib/db');
const profileLib = require('../../lib/profile');
const { discover } = require('../../lib/discover');
const { runScan } = require('../../lib/scan');

/** Discover, then scan only the added companies (fresh roles → New). Returns both summaries. */
async function discoverAndScan(db, profile, { log = () => {}, cause = 'button', deps = {} } = {}) {
  log('Searching the web for companies hiring for your titles (about a minute)…');
  const found = await discover(db, profile, { cause, ...deps });
  log(`  ${found.candidates} postings found → ${found.boards} new boards → ${found.added.length} added`);
  for (const a of found.added) log(`  + ${a.name} (${a.ats}/${a.slug}): ${a.matches} matching job(s)`);
  let scan = null;
  if (found.added.length) {
    scan = await runScan({ profile, db, only: found.added.map((a) => a.name), firstScanNew: true, ...deps });
    log(`  scanned them: ${scan.added.new} new, ${scan.added.backlog} backlog`);
  }
  return { ...found, scan };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = store.open();
  if (dryRun) db.exec('BEGIN');
  const out = await discoverAndScan(db, profileLib.load(), { log: console.log, cause: 'cli' });
  for (const s of out.skipped.slice(0, 15)) console.log(`  · ${s.company}: ${s.reason}`);
  if (dryRun) { db.exec('ROLLBACK'); console.log('(dry run — nothing saved)'); }
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { discoverAndScan };
