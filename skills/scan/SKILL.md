---
name: watchlist-scan
description: Daily scan of a tiered company watchlist on official ATS job boards (Greenhouse, Ashby, Lever, SmartRecruiters, Workable, Workday), filtered by the search profile (NYC metro + US-remote), saved as new or backlog roles; weekly web-search discovery of new companies. No LinkedIn, no keys, no browser.
---

# Watchlist scan (M0 of the v4 plan)

Job boards can't be searched across companies, so the search **is the company list**. Every
covered company's public ATS board is fetched, filtered, and merged into `data/jobhunt.db`.
Postings come straight from the employer, so they are real and link to the direct apply page.

## Files
- `config/search-profile.json`: titles to include, words to exclude (Senior, Manager, Intern…),
  locations (place phrase or state code, plus US-remote), max years of experience the JD may
  ask for, and how many days old a role can be and still count as New.
- The watchlist (companies table; seeded from `config/companies.seed.json`): name, tier A/B/C,
  and a blocklist of aggregators and staffing firms. ATS board and job count are filled in by
  detection. Add companies or change tiers on the dashboard's Companies tab.

## Commands
```bash
npm run detect                    # find the ATS board for companies not yet checked
npm run detect -- --force         # re-check every company (e.g. monthly)
npm run detect -- --only "Rescale"
npm run detect -- --workable        # also try Workable for misses (slow, opt-in)
npm run scan                      # scan every covered board and save (+ weekly discovery)
npm run scan -- --no-discover     # scan only
npm run discover                  # find new companies now (web search via Claude Code)
npm run scan -- --dry-run         # scan and print only
```
Register the 7am daily run (per-user Windows scheduled task, `-Remove` to undo):
```powershell
.\scripts\register-daily-scan.ps1
```
The dashboard (`run-dashboard.ps1`) also has a **Scan watchlist now** button and shows `new`,
`backlog` and tier badges.

## How roles are classed
- **new**: first seen on a board that an earlier scan already covered, and posted within
  `maxAgeDays` (or no posted date).
- **backlog**: everything found on a board's first scan (so adding companies doesn't flood
  New), and reopened or old postings.
- **closed**: a stored role whose board was fetched but no longer lists it gets `closedAt` and
  is hidden on the dashboard (unless you applied); it reopens if it comes back. A board that
  suddenly returns nothing closes nothing (logged as an error instead).
- Each run appends to `data/scan.log` and the DB's scan history (shown in the dashboard's
  health bar).

Roles from the pre-revamp sources (Claude web search, old board searches, Jobgether) were moved
out of the store into `data/jobs-archive.json` before the M1 move to SQLite.

## Workday
Big employers (Salesforce, Adobe, Autodesk, PTC, Cisco, NVIDIA, …) post on Workday career
sites. Each has a public JSON API that searches server-side, so the scan asks it for each
profile title (2 result pages per title, 4 sites at a time) and fetches details only for
titles that pass. A site is identified by `<tenant>.wdN/<site>` from its URL; add one by
pasting any of its posting links on the Companies tab. Detection by name doesn't find Workday.

## Discovery (weekly, or `npm run discover` / the Companies-tab button)
Claude Code (`claude -p`, only the WebSearch tool, your subscription) searches for current
postings with your titles in your locations on the ATS hosts above. Claude only nominates
companies: each link is parsed for its board, and the company is added (tier C, origin
`discovery`) only if that board, read through its own API, has a job passing your profile
right now. Their fresh roles go to New. First run (2026-10-29): 43 postings → 24 companies.

## Profile changes
Jobs still in New/Backlog that no longer fit the profile's titles or locations are dismissed
by the next scan (cause "profile", undoable from Closed). Applied jobs are never touched.

## Detection rules
A board counts only if it has ≥ 1 open job. Boards that report a company name
(Greenhouse, SmartRecruiters, Workable) must match it. Lever and Ashby can't confirm the name,
so they're only tried with full-name slugs. Workable is opt-in (`--workable`): it rate-limits
hard (about one company per 30 s) and found 2 boards in the first ~20 tries. A company it can't
reach stays unchecked and is retried on the next `npm run detect`.
