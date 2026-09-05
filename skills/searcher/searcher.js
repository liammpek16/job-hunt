#!/usr/bin/env node
'use strict';
/**
 * searcher.js — goal 2: the job searcher skill.
 *
 * Given a title, location and salary range, queries an official jobs API
 * (Adzuna by default — legal, free-tier, paginates to >=100) and surfaces the
 * roles. The source is pluggable via --source; add lib/sources/<name>.js exporting
 * fetchRoles(params, target, opts) to swap in another data source.
 *
 * Roles are saved into the shared store (data/jobs.json) at status "saved", so the
 * customizer, ATS scanner and dashboard all read the same records. You pick which to
 * apply to (the human gate) — the searcher never applies to anything.
 *
 * Usage:
 *   ADZUNA_APP_ID=.. ADZUNA_APP_KEY=.. node skills/searcher/searcher.js \
 *     --title "Software Engineer" --location "Remote" --salary-min 120000 \
 *     --count 100 [--country us] [--source adzuna] [--json] [--no-save]
 */
const path = require('path');
const store = require('../../lib/store');

function parseArgs(argv) {
  const a = { title: '', location: '', salaryMin: null, salaryMax: null, country: 'us',
    count: 100, source: 'adzuna', json: false, save: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case '--title': a.title = next(); break;
      case '--location': a.location = next(); break;
      case '--salary-min': a.salaryMin = Number(next()); break;
      case '--salary-max': a.salaryMax = Number(next()); break;
      case '--country': a.country = next(); break;
      case '--count': a.count = Number(next()); break;
      case '--source': a.source = next(); break;
      case '--json': a.json = true; break;
      case '--no-save': a.save = false; break;
      default: break;
    }
  }
  return a;
}

function loadSource(name) {
  try {
    return require(`../../lib/sources/${name}`);
  } catch (e) {
    throw new Error(`Unknown source "${name}" (expected lib/sources/${name}.js).`);
  }
}

function summarize(roles, target) {
  const withSalary = roles.filter((r) => r.salaryMin != null).length;
  const companies = new Set(roles.map((r) => r.company).filter(Boolean)).size;
  return { returned: roles.length, target, met: roles.length >= target, withSalary, companies };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title) {
    console.error('Provide at least --title. See --help in SKILL.md.');
    process.exit(2);
  }
  const src = loadSource(args.source);
  const params = { title: args.title, location: args.location, salaryMin: args.salaryMin,
    salaryMax: args.salaryMax, country: args.country };

  let result;
  try {
    result = await src.fetchRoles(params, args.count);
  } catch (e) {
    if (e.code === 'NO_CREDS') {
      console.error(e.message);
      process.exit(3);
    }
    throw e;
  }

  const summary = summarize(result.roles, args.count);
  if (args.save) {
    const s = store.load();
    const { added, skipped } = store.addRoles(s, result.roles);
    store.save(s);
    summary.savedNew = added;
    summary.savedSkipped = skipped;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ summary, roles: result.roles }, null, 2) + '\n');
  } else {
    console.log(`Found ${summary.returned} roles (target ${summary.target}) — ${summary.met ? 'MET ✅' : 'under target ⚠️'}`);
    console.log(`${summary.companies} companies · ${summary.withSalary} with salary data · fetched ${result.pages} page(s)` +
      (summary.savedNew != null ? ` · saved ${summary.savedNew} new (${summary.savedSkipped} dupes)` : ''));
    result.roles.slice(0, 20).forEach((r, i) => {
      const sal = r.salaryMin ? ` · $${Math.round(r.salaryMin / 1000)}k+` : '';
      console.log(`${String(i + 1).padStart(2)}. ${r.title} — ${r.company || '?'} (${r.location || '?'})${sal}`);
    });
    if (result.roles.length > 20) console.log(`   … +${result.roles.length - 20} more (use --json for all; saved to ${path.relative(process.cwd(), store.DEFAULT_FILE)})`);
  }
  if (!summary.met) process.exit(1); // signal under-target so callers/tests can detect it
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { parseArgs, summarize, loadSource };
