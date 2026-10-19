---
type: plan
project: Job Hunt / Recruiter Helper
version: v3 (v2 without LinkedIn scraping)
created: '2026-10-19'
based_on: plan-v2-council.md
status: draft (input to the v4 council pass)
---

# Job Hunt revamp: Plan v3 (no LinkedIn scraping)

**Change from v2:** no LinkedIn scraping of any kind: no guest endpoint, no Apify actor, no
RapidAPI provider, no fetching LinkedIn JD pages. Jobs come from **companies' own applicant
tracking systems (ATSs)**: Greenhouse, Lever, Ashby, plus other ATSs with public JSON. Every
posting comes straight from the employer's official board, so it's real, current, and links
to the direct apply page.

Everything else from v2 stays: SQLite store, validation, in-place .docx tailoring with
`claude -p`, Gmail read-only tracking, gated milestones, cut list.

---

## What changes, and why it matters

### The real limit is the company list, not the scraper
Board APIs can't be searched across companies. You ask one company at a time
("Datadog, what's open?"). Today the seed lists hold **20 companies** in total (8 Greenhouse,
5 Lever, 7 Ashby). One of them is **Jobgether**, an aggregator, which explains the
foreign/duplicate roles. So the job finder is only as good as its **company watchlist**.
v3's main new piece is building and growing that list.

### What gets better without LinkedIn
- **Nothing fake.** Postings come from the employer's ATS API. If it's listed, it's open.
- **Closures are detected automatically.** Rescan daily; a job that disappears from its
  board is marked `Closed`. No liveness scraping needed.
- **Direct apply links.** These go to the company's own form, not Easy Apply.
- **Zero account risk, zero cost, no keys.**

### What gets worse
- **Coverage.** Companies on Workday, iCIMS, Taleo, SuccessFactors, or custom career sites
  (many big enterprises) aren't covered by the current three sources.
- **Posted date.** Greenhouse gives a real `first_published` date (checked on Datadog's board);
  others don't always. We also record **first seen** ourselves (daily scans make this accurate
  within a day) and use the API's date where it exists.

---

## Sources in v3

| Source | Access | Status |
|--------|--------|--------|
| Greenhouse `boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true` | Public JSON, official | Have it |
| Lever `api.lever.co/v0/postings/<slug>?mode=json` | Public JSON, official | Have it |
| Ashby `api.ashbyhq.com/posting-api/job-board/<slug>` | Public JSON, official | Have it |
| SmartRecruiters `api.smartrecruiters.com/v1/companies/<id>/postings` | Public JSON, official (checked: 200) | New, small |
| Workable (public job widget) | Public JSON; exact endpoint unconfirmed (test probes 404'd) | New if M0 confirms it |
| Recruitee `<slug>.recruitee.com/api/offers` | Public JSON | Optional |

Workday is left out of v3. Its career-site JSON is undocumented and differs per tenant.
Revisit if coverage checks show it matters.

## Building the company watchlist (new)

1. **Your target list.** You + Claude draft 100–200 companies that hire Sales/Solutions
   Engineers in your locations and fit your background (simulation/CAE, engineering software,
   dev tools, data, security, vertical SaaS). Stored in `config/companies.json` with a
   priority tier.
2. **ATS auto-detect.** For each company name, try likely slugs against each ATS API. Whichever
   returns a valid board is saved. If none hit, mark "not covered" (show a careers-page link).
3. **Discovery sweep (weekly).** Claude web search for
   `site:boards.greenhouse.io "solutions engineer" "New York"`-style queries (same for Lever,
   Ashby, Workable). This harvests **company slugs only**. Postings are then pulled from the
   official API, so a hallucinated or stale link can't reach the dashboard. This turns the
   retired `claude` source into a safe discovery tool.
4. **Blocklist** aggregators and staffing firms (Jobgether first).

## Milestones (v2 shape, updated)

### M0: Foundations + watchlist · 1 week
- Search profile config; SQLite `jobs` + `events`; migrate `jobs.json` + Excel rows.
- Validation module: title, location, dedupe, blocklist, first-seen freshness.
- `config/companies.json` + ATS auto-detect + SmartRecruiters source (+ Workable if its
  endpoint is confirmed).
- First run marks everything existing as **Backlog**, so "New" means genuinely new.
- **Gate:** ≥ 150 covered companies; spot-check 20 results with ≥ 18 correct.

### M1: Find + triage, used daily · 1 week
- Daily 7am scan of every watched board; disappeared jobs → `Closed`.
- Weekly discovery sweep adds new companies (shown as "Suggested companies" to approve).
- Dashboard: New / Pipeline / Closed, keyboard triage, match chips, health bar.
  Columns: Company · Title · Location · First seen · Source ATS · Status · Applied · Resume ·
  Last update · **Apply ↗** (direct). An optional **"Find on LinkedIn"** button just opens a
  LinkedIn search for that company + title in your browser, to check connections. You click
  it yourself; nothing is fetched.
- Applied button: date, JD snapshot, resume used, follow-up +7 d, undo.
- Retire `claude` (as a posting source), `adzuna`, `linkedin.js`, `dashboard.html`, Excel.
- **Gate:** a week of daily triage under 5 min/day.

### M2: Resume adjuster · 1–1.5 weeks
Unchanged from v2: canonical base → in-place `.docx` edit via `claude -p` → guardrail checks
→ saved to `C:\Users\liamm\job-hunt\Resumes\` → PDF + bullet diff + ATS score preview →
Accept / Regenerate. **Gate:** 5 resumes, ≤ 1 manual edit each.

### M3: Email tracking · 1–1.5 weeks
Unchanged from v2 (Gmail API read-only on a `Job Hunt` label, rules then `claude -p`, match
by company/title, Unmatched tray, ghost timer, undo log). LinkedIn job-alert parsing is
removed. **Gate:** 2 weeks ≥ 90% correct.

### M4: Improve the hit rate · ongoing
Funnel metrics, weekly HUD digest, interview prep pack, watchlist pruning.

## Cut list (v3)
Everything in v2's cut list, plus **all LinkedIn data access**: `lib/sources/linkedin.js`,
guest endpoint, Apify, RapidAPI, and LinkedIn alert-email parsing.
