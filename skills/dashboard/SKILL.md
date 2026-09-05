---
name: jobs-dashboard
description: Track jobs applied to / interviews and render a dashboard (funnel + tiles + table) over the shared store. Self-contained HTML, no server, no deps.
---

# Jobs dashboard (goal 6)

Tracks the pipeline — **jobs applied to and interviews completed** — and renders a
self-contained HTML dashboard (plus a terminal summary) over the shared store
(`data/jobs.json`). No server, no dependencies; open the HTML file in any browser.

## Render

```bash
node skills/dashboard/dashboard.js                  # writes dashboard.html + prints a summary
node skills/dashboard/dashboard.js --out board.html # custom path
node skills/dashboard/dashboard.js --json           # structured aggregate
```

## Track (gives the dashboard real data)

```bash
node skills/dashboard/dashboard.js --apply "adzuna:12345"
node skills/dashboard/dashboard.js --status "adzuna:12345" interviewing
node skills/dashboard/dashboard.js --interview "adzuna:12345" --kind "phone screen" --notes "went well"
```

Statuses: `saved → applied → interviewing → offer → rejected`. `--apply` is a shortcut for
`--status <id> applied`. Any tracking command re-renders after saving.

## Serve (for the Admin Brain HUD button)

```bash
node skills/dashboard/dashboard.js --serve [--port 4188]   # live server, 127.0.0.1
.\run-dashboard.ps1 [-Port 4188]                            # PowerShell wrapper
```

`--serve` starts a tiny zero-dependency server that renders the **live** dashboard from the
store on every request (bound to `127.0.0.1`). This is what the Admin Brain HUD's per-project
**webapp button** launches — exactly like the Dota Coach webapp. Wire it up by adding to the
Job Hunt project note in the vault:

```yaml
webapp_url: "http://127.0.0.1:4188"
webapp_cmd: "powershell -NoProfile -ExecutionPolicy Bypass -File run-dashboard.ps1"
webapp_cwd: "C:/Users/liamm/job-hunt"
```

Then the HUD button probes the URL, launches `run-dashboard.ps1` if it's down, and opens the
dashboard — no HUD code change. `GET /health` returns `ok` for liveness checks.

## What it shows

- **Stat tiles** — Applied, Interviewing, Interviews logged, Offers, Saved.
- **Pipeline funnel** — monotonic Sourced → Applied → Interviewing → Offer.
- **Per-role table** — title (links out), company, location, status pill, interviews, applied date;
  sorted furthest-along first.

## Design

Reads the same store the searcher writes and the customizer/ATS read — one data shape threads
the whole project (goal 2 → 6). Deterministic / $0, no deps. All user data is HTML-escaped in
the output. `data/jobs.json` is gitignored (your data stays local).
