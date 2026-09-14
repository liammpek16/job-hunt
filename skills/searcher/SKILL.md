---
name: job-searcher
description: Surface >=100 real roles for a given title/location/salary from an official jobs API (Adzuna), saved to the shared store. Never applies to anything — you pick.
---

# Job searcher (goal 2)

Given a **title, location and salary range**, queries an **official jobs API** and surfaces
roles — targeting the roadmap's **>=100 roles** bar. Results are saved to the shared store
(`data/jobs.json`) at status `saved`; **you** pick which to apply to (the human gate). The
skill never applies to anything.

## Why an API, not scraping

LinkedIn/Indeed scraping hits anti-bot / ToS limits — the roadmap's flagged biggest risk.
**Adzuna** (developer.adzuna.com) is a legal, free-tier aggregator across many boards with
title/location/salary filters and pagination, so it reliably reaches >=100.

## Sources & auto-detection (Claude subscription vs Adzuna vs LinkedIn)

The searcher **auto-selects** its source (override with `--source`):

- If a **LinkedIn-jobs provider key** is present (`LINKEDIN_JOBS_API_KEY`), it uses the
  `linkedin` source.
- Else if an **Adzuna key** is present (`ADZUNA_APP_ID` + `ADZUNA_APP_KEY`), it uses `adzuna`.
- **Otherwise** — no API key at all — it uses the **`claude` source**, which runs the search on
  your **Claude Code subscription** with **no API key and no metered credits**.

### `claude` source (no API key, runs on the subscription)

Mirrors Admin Brain's "$0 harness hands the reasoning to Claude Code" pattern via a two-phase
**file handoff** (no network, no key, no deps):

1. **First run** (`--source claude`, or just no key set): writes a request spec
   `data/claude-search-<slug>.request.json`, prints the exact search prompt for Claude Code, and
   exits **code 4** (handoff pending).
2. **Claude Code** performs the web search on the subscription and writes the roles it found to
   `data/claude-search-<slug>.results.json` — a JSON array (or `{ "roles": [...] }`) of
   `{ title, company, location, salaryMin, salaryMax, url, description, created }`.
3. **Re-run the same command**: the source reads, validates, normalizes (`source:"claude"`) and
   dedupes that file into the shared store — the same records the customizer / ATS / dashboard read.

Exit codes: `1` = under target, `3` = missing credentials (keyed sources), **`4` = Claude handoff pending**.

**Honest caveat on LinkedIn:** LinkedIn has **no first-party public job-search API** for
individuals — their Jobs/Talent APIs are partner-gated (employers/ATS vendors, approval
required), and scraping LinkedIn breaks their ToS. So the `linkedin` source targets a
**third-party LinkedIn-jobs provider** (e.g. a RapidAPI "LinkedIn Jobs Search" endpoint, or
Proxycurl) that relicenses the data — you supply *that provider's* key:

```bash
export LINKEDIN_JOBS_API_KEY=your_provider_key
export LINKEDIN_JOBS_API_HOST=linkedin-jobs-search.p.rapidapi.com   # or your provider's host
# optional: export LINKEDIN_JOBS_API_URL=https://your-provider/endpoint
```

No LinkedIn key → the searcher just uses Adzuna. Either way the results normalize to the same
shared shape and land in the same store.

## Setup (one time)

Get a free key at **developer.adzuna.com** (gives an `app_id` + `app_key`), then:

```bash
export ADZUNA_APP_ID=your_id
export ADZUNA_APP_KEY=your_key
```

Windows PowerShell:

```powershell
$env:ADZUNA_APP_ID="your_id"; $env:ADZUNA_APP_KEY="your_key"
```

## Run

```bash
node skills/searcher/searcher.js --title "Software Engineer" --location "Remote" \
  --salary-min 120000 --count 100 --country us
node skills/searcher/searcher.js --title "Data Scientist" --count 100 --json   # full JSON
node skills/searcher/searcher.js --title "PM" --count 50 --no-save              # don't write store
```

Exit code `1` = under target (fewer than `--count` found), `3` = missing credentials.

## Pluggable source

`--source <name>` loads `lib/sources/<name>.js`, which must export
`fetchRoles(params, target, opts)` returning `{ roles, pages, total }`. Adzuna is the default;
add another file to swap the data source without touching the skill.

## Shared store

Roles are normalized to `{ id, title, company, location, salaryMin, salaryMax, url, description,
source, created }` and written to `data/jobs.json` via `lib/store.js`. The customizer (goal 3),
ATS scanner (goal 4) and dashboard (goal 6) all read the same store. Credentials come only from
the environment — never committed, never in the URL path.
