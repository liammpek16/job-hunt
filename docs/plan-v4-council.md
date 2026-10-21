---
type: plan
project: Job Hunt / Recruiter Helper
version: v4 (council-revised v3)
created: '2026-10-19'
based_on: plan-v3-no-linkedin.md
status: draft (pick v3 or v4)
---

# Job Hunt revamp: Plan v4 (council-revised, no LinkedIn scraping)

Plan v3 (ATS boards only, no LinkedIn scraping) went through the 5-persona council a second
time. v4 keeps v3's sources and the hard no-LinkedIn rule. It changes three things:

- **The company watchlist becomes the product's core.** It gets its own tab, tiers, and a
  self-improving coverage loop.
- **Paste-a-link intake.** Any posting you find by hand, LinkedIn included, teaches the
  system a new company.
- **Gmail goes back to M3**, and M0 shrinks to what's needed to see real jobs in week 1.

---

## Part A: Council findings on v3

### Contrarian: "You traded a ban risk for a coverage hole. Measure it."
- **Big enterprises are invisible.** Salesforce, Cisco, Oracle, Siemens, Ansys/Synopsys, and
  most large CAE/engineering software vendors use Workday or similar. For an SE coming from CAE
  simulation, that's a big part of the market. → *Measure the hole before fixing it (coverage
  check, below). If ≥ 30% of the jobs you'd want sit on Workday, add a Workday source in M4.
  It reads the company's own public career site, not LinkedIn, and is opt-in per company.*
- **The first scan floods "New".** v3 handles this with Backlog. Keep it.
- **More companies means more noise.** At 300+ boards, a loose title filter will drown you.
  → *The title filter needs both an include list and an exclude list (Senior/Staff/Principal/
  Manager/Director/Partner/Intern), plus a "seniority guess" from the JD (years required).
  Test it on saved fixtures.*
- **Weekly Claude discovery can still waste effort** on dead or foreign slugs. It can't create
  fake jobs, because the API check stops that, but → *cap suggestions at 25/week and require
  ≥ 1 matching open role before suggesting a company.*

### First-Principles Thinker: "The unit of search is now the company"
With ATS boards you don't search postings; you **watch companies**. That's a better model
for an SE job hunt anyway:
- SE hiring is lumpy. A company opening its 2nd SE role in NYC is a growing team, which
  makes it a strong target and a good referral ask.
- A fixed watchlist gives **the earliest possible signal**: you see the role the day it goes
  up, often before it spreads to job boards. That's the "apply early" advantage from v2,
  without LinkedIn.
- → *Make the watchlist first-class: tier (A dream / B good / C ok), ATS, last scanned, open
  matching roles, notes, "not covered" flag. Rank New jobs by tier first, then freshness.*

### Expansionist: "Let every job you see by hand grow the system"
- **Paste-a-link intake.** A box on the dashboard: paste any posting URL (LinkedIn, Indeed, a
  friend's link, a careers page). The system **does not fetch LinkedIn**. It takes the
  company name from the URL or from what you type, runs ATS auto-detect, adds the company
  to the watchlist, and finds the same role on the company's own board. Nothing fetched from
  LinkedIn, ever.
- **Coverage check from intake.** Each pasted link records "did we already have this?" That
  ratio is your **coverage %**, the honest measure of what v3 gave up.
- **Company lookalikes.** When you mark an A-tier company, Claude suggests 5 similar companies
  (same space and size), auto-detected and shown as suggestions.
- **Growth signal.** Watchlist shows "SE roles opened in the last 30 days" per company.
- *Parked:* Workday source (decided by coverage data), cover letters, application-question
  drafts.

### Outsider: "Set expectations and make the morning obvious"
- **Volume will be lower than LinkedIn.** Expect ~3–10 relevant new roles a day from a few
  hundred companies. Show that up front so a quiet day doesn't feel broken. The health bar
  shows "312 boards scanned ✓, 4 new".
- **Two tabs, not one:** **Jobs** (New / Pipeline / Closed) and **Companies** (watchlist,
  suggestions, not-covered list). The Companies tab is where you shape the search.
- **"Find on LinkedIn" stays a plain link** you click. Label it so it's clear Claude never
  opens it.

### Executor: "Real jobs in week 1, then gate"
- v3's M0 holds too much (SQLite, validation, watchlist, auto-detect, new ATS, 150-company
  gate). → *Split: M0 gives a working daily scan over a starter watchlist on the existing JSON
  store, so you see good jobs within days. SQLite moves into M1, where the dashboard needs
  it.*
- **Gmail isn't needed early** now that LinkedIn alerts are gone. → *Gmail OAuth setup moves
  to M3.*
- Coverage % becomes a tracked number with a gate, so the Workday question is settled by data.

---

## Part B: Decisions locked by v4
1. **No LinkedIn data access by code or Claude.** You may paste a LinkedIn URL; the system only
   reads the company name from it.
2. **Jobs come only from official/public employer ATS APIs**: Greenhouse, Lever, Ashby,
   SmartRecruiters (+ Workable if confirmed). Workday only if coverage data justifies it.
3. **The company watchlist is the search.** Claude may *suggest* companies; only the ATS API
   can create a job row.
4. One store (SQLite, `jobs` + `companies` + `events`), in-place `.docx` tailoring with
   `claude -p`, Gmail API read-only on a label, you click Apply. All carried from v2.
5. **Metrics:** interviews/month (goal), apps/week, response rate, coverage %, median days
   first-seen → applied.

---

## Part C: The milestone plan

### M0: Real jobs this week · 3–5 days
- `config/search-profile.json`: titles + synonyms, exclude words, locations, max age.
- **Starter watchlist:** you + Claude draft ~100 companies with tiers. ATS auto-detect writes
  slugs. **Remove Jobgether**; add a blocklist.
- Tighten filters (include/exclude titles, US location matcher from PR #15). Use Greenhouse
  `first_published` and first-seen dates.
- Add the SmartRecruiters source; probe Workable's endpoint.
- Daily 7am scan through Task Scheduler on the current store; first run → Backlog.
- **Gate:** ≥ 80 covered companies and a 20-job spot check with ≥ 18 correct (right title,
  location, open).

### M1: Dashboard + store · 1–1.5 weeks
- SQLite (`node:sqlite`): `jobs`, `companies`, `events`; migrate `jobs.json` + Excel.
- **Jobs tab:** New (keyboard triage, match chips, ranked by tier then freshness) / Pipeline /
  Closed. Columns: Company · Tier · Title · Location · Posted · ATS · Status · Applied ·
  Resume · Last update · Apply ↗ · Find on LinkedIn ↗ (plain link).
- **Companies tab:** watchlist with tier, ATS, last scan, open matches, 30-day SE openings;
  Suggestions; Not covered.
- **Paste-a-link intake** + coverage % counter.
- Applied button: date, JD snapshot, resume used, follow-up +7 d, undo. Closed detection
  when a job disappears from its board.
- Health bar. Retire `claude` posting source, `adzuna`, `linkedin.js`, `dashboard.html`,
  Excel.
- **Gate:** a week of daily use, < 5 min/day triage, every application logged here.

### M2: Resume adjuster · 1–1.5 weeks
Same as v2/v3: canonical base in `Resumes/_base/`, `lib/docx-edit.js` in-place edits,
**Generate resume** → background `claude -p` → guardrail checks → saved to
`C:\Users\liamm\job-hunt\Resumes\Pek_Liam_Resume_<Company>_<Title>.docx` + PDF (LibreOffice) →
preview with bullet diff + ATS score → Accept / Regenerate-with-note.
**Gate:** 5 resumes, ≤ 1 manual edit each.

### M3: Email tracking · 1–1.5 weeks
- Google Cloud project + Gmail API `gmail.readonly` + `Job Hunt` label filter (ATS sender
  domains + application keywords).
- Poller every 2 h: rules, then `claude -p` for the rest. Classes: confirmation, rejection,
  interview_request, assessment, offer, recruiter_outreach, other.
- Match by company domain/name → title; low confidence → Unmatched tray. Every change shows
  its email and can be undone. 30 days of silence → Ghosted. Notification on interview/offer.
- **Gate:** 2 weeks, ≥ 90% correct, zero silent wrong rejections.

### M4: Hit rate + coverage · ongoing
- Funnel metrics + weekly Admin-Brain HUD digest; interview prep pack on `Interview`.
- Weekly Claude discovery sweep (company slugs only, ≤ 25 suggestions, each with ≥ 1 open
  match) + lookalike suggestions.
- **Workday decision:** if coverage % < 70% and the missed jobs are mostly Workday
  companies, add an opt-in Workday source for those companies' public career sites.

---

## Part D: Cut list
- All LinkedIn data access (guest endpoint, Apify, RapidAPI, alert-email parsing,
  `lib/sources/linkedin.js`)
- `claude` web search as a *posting* source (kept only as a slug-discovery helper in M4)
- Adzuna, Jobgether, "≥ 100 jobs", `dashboard.html`, `Job_Applications.xlsx`
- Markdown → .docx renderer for tailored resumes
- Auto-apply of any kind

## Part E: Cost
$0 beyond your Claude subscription: board APIs, Gmail API, LibreOffice, and Task Scheduler
are all free.

---

## Part F: Candidate roadmap goals (Admin-Brain, branch-sized)
- [ ] M0: search profile + include/exclude title filter (fixture tests)
- [ ] M0: starter watchlist with tiers + ATS auto-detect; remove Jobgether, add blocklist
- [ ] M0: SmartRecruiters source (+ Workable probe) on board-common
- [ ] M0: daily scheduled scan + Backlog on first run + Greenhouse first_published
- [ ] M0 gate: ≥ 80 companies, 18/20 spot check (human)
- [ ] M1: SQLite store (jobs, companies, events) + migrate jobs.json and Excel
- [ ] M1: Jobs tab (New/Pipeline/Closed, triage, chips, tier ranking) + Applied button
- [ ] M1: Companies tab + paste-a-link intake + coverage %
- [ ] M1: closed detection + health bar; retire old sources/pages
- [ ] M1 gate: one week of daily use (human)
- [ ] M2: canonical base resume + in-place .docx editor
- [ ] M2: Generate resume → `claude -p` + guardrails + preview (PDF, diff, ATS score)
- [ ] M2 gate: 5 resumes, ≤ 1 edit each (human)
- [ ] M3: Gmail API read-only poller on `Job Hunt` label
- [ ] M3: classifier + matcher + Unmatched tray + undo + ghost timer
- [ ] M3 gate: 2 weeks ≥ 90% correct (human)
- [ ] M4: funnel metrics + HUD digest + interview prep pack
- [ ] M4: discovery sweep + lookalikes; Workday decision from coverage %
- [ ] get first interview (outcome)
