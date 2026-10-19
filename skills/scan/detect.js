#!/usr/bin/env node
'use strict';
/**
 * detect.js — fill in each watchlist company's ATS board (config/companies.json).
 *
 * Companies without an `ats` are probed against Greenhouse, Ashby, Lever, Workable and
 * SmartRecruiters; the hit (or "none") is written back with the open-job count and date.
 *
 * Usage:
 *   node skills/scan/detect.js                 # detect unchecked companies only
 *   node skills/scan/detect.js --force         # re-detect every company
 *   node skills/scan/detect.js --only "Rescale"
 *   node skills/scan/detect.js --workable      # also try Workable for misses (slow: it
 *                                              # rate-limits, ~1 company/30 s; low yield)
 */
const watchlist = require('../../lib/watchlist');
const { ATS_ORDER, detectCompany, mapLimit } = require('../../lib/ats-detect');

// Workable rate-limits hard, so it's an opt-in slow pass over the companies the others missed.
const FAST = ATS_ORDER.filter((a) => a !== 'workable');

function parseArgs(argv) {
  const a = { force: false, only: null, concurrency: 6, workable: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') a.force = true;
    else if (argv[i] === '--only') a.only = argv[++i];
    else if (argv[i] === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (argv[i] === '--workable') a.workable = true;
  }
  return a;
}

async function run(args, { file = watchlist.DEFAULT_FILE, http, log = console.log } = {}) {
  const wl = watchlist.load(file);
  const todo = wl.companies.filter((c) => !watchlist.isBlocked(c.name, wl)
    && (args.only ? watchlist.norm(c.name) === watchlist.norm(args.only) : (args.force || !c.ats)));
  const today = new Date().toISOString().slice(0, 10);
  const opts = (order) => (http ? { http, order } : { order });

  // Save after every company so an interrupted run keeps its progress.
  const record = (c, r) => {
    c.ats = r.ats;
    if (r.ats === 'none') { delete c.slug; delete c.jobs; } else { c.slug = r.slug; c.jobs = r.jobs; }
    c.checkedAt = today;
    watchlist.save(wl, file);
    log(`  ${r.ats === 'none' ? '·' : '✓'} ${c.name} → ${r.ats}${r.slug ? `/${r.slug} (${r.jobs} jobs)` : ''}`);
  };

  log(`Detecting ATS for ${todo.length} compan${todo.length === 1 ? 'y' : 'ies'} (${FAST.join(', ')})…`);
  await mapLimit(todo, args.concurrency || 6, async (c) => {
    try { record(c, await detectCompany(c, opts(FAST))); }
    catch (e) { delete c.ats; log(`  ? ${c.name}: ${e.message} (left unchecked)`); }
  });

  const misses = todo.filter((c) => c.ats === 'none');
  if (args.workable && misses.length) {
    log(`
Trying Workable for ${misses.length} remaining (one at a time; it rate-limits)…`);
    await mapLimit(misses, 1, async (c) => {
      try {
        const r = await detectCompany(c, opts(['workable']));
        if (r.ats !== 'none') record(c, r);
      } catch (e) { delete c.ats; watchlist.save(wl, file); log(`  ? ${c.name}: ${e.message} (left unchecked)`); }
    });
  }

  watchlist.save(wl, file);
  const cov = watchlist.coverage(wl);
  log(`
Covered ${cov.covered}/${cov.companies} companies (${cov.notCovered} not covered, ${cov.unchecked} unchecked). `
    + Object.entries(cov.byAts).map(([a, n]) => `${a} ${n}`).join(' · '));
  return cov;
}

if (require.main === module) {
  run(parseArgs(process.argv.slice(2))).catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { parseArgs, run };
