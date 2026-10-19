---
name: watchlist-scan
description: Daily scan of a tiered company watchlist on official ATS job boards (Greenhouse, Ashby, Lever, SmartRecruiters, Workable), filtered by the search profile, saved to the shared store as new or backlog roles. No LinkedIn, no keys, no browser.
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
npm run scan                      # scan every covered board and save
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

## Detection rules
A board counts only if it has ≥ 1 open job. Boards that report a company name
(Greenhouse, SmartRecruiters, Workable) must match it. Lever and Ashby can't confirm the name,
so they're only tried with full-name slugs. Workable is opt-in (`--workable`): it rate-limits
hard (about one company per 30 s) and found 2 boards in the first ~20 tries. A company it can't
reach stays unchecked and is retried on the next `npm run detect`.
