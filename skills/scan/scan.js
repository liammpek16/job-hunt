#!/usr/bin/env node
'use strict';
/**
 * scan.js — run the daily watchlist scan and save results into data/jobs.json.
 *
 * Reads config/search-profile.json and config/companies.json, fetches every covered company's
 * ATS board, and adds matching roles as "new" (fresh, on an already-watched board) or
 * "backlog". Appends a one-line result to data/scan.log. Registered to run daily at 7am by
 * scripts/register-daily-scan.ps1.
 *
 * Usage:
 *   node skills/scan/scan.js            # scan and save
 *   node skills/scan/scan.js --dry-run  # scan, print, don't save
 */
const fs = require('fs');
const path = require('path');
const store = require('../../lib/store');
const profileLib = require('../../lib/profile');
const watchlist = require('../../lib/watchlist');
const { runScan } = require('../../lib/scan');

const LOG_FILE = path.join(__dirname, '..', '..', 'data', 'scan.log');

function oneLine(sum) {
  const rej = Object.values(sum.rejected).reduce((a, b) => a + b, 0);
  return `${sum.at} scanned ${sum.scanned}/${sum.boards} boards · ${sum.matched} matching · `
    + `${sum.added.new} new · ${sum.added.backlog} backlog · ${sum.seenAgain} seen again · `
    + `${sum.closed || 0} closed · ${sum.reopened || 0} reopened · `
    + `${rej} rejected after JD check · ${sum.errors.length} errors`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const profile = profileLib.load();
  const wl = watchlist.load();
  const s = store.load();
  console.log(`Scanning ${watchlist.coverage(wl).covered} covered companies…`);
  const sum = await runScan({ profile, wl, store: s, log: console.log });
  const line = oneLine(sum);
  console.log(`\n${line}`);
  if (Object.keys(sum.rejected).length) {
    console.log('Rejected after JD check: ' + Object.entries(sum.rejected).map(([k, v]) => `${k} ×${v}`).join(', '));
  }
  for (const e of sum.errors.slice(0, 10)) console.log(`  ! ${e.ats}/${e.token || ''}: ${e.error}`);
  if (dryRun) { console.log('(dry run — nothing saved)'); return; }
  store.save(s);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n');
  const fresh = Object.values(s.roles).filter((r) => r.triage === 'new' && r.firstSeen === sum.at);
  fresh.sort((a, b) => watchlist.TIER_RANK[a.tier] - watchlist.TIER_RANK[b.tier]);
  for (const r of fresh.slice(0, 25)) console.log(`  NEW [${r.tier}] ${r.title} — ${r.company} (${r.location})`);
}

if (require.main === module) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { oneLine };
