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
