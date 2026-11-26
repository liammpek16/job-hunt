---
type: plan
project: Job Hunt / Recruiter Helper
version: v2 (council-revised)
created: '2026-10-19'
based_on: plan-v1-guideline.md
status: draft (pick v1 or v2)
---

# Job Hunt revamp: Plan v2 (council-revised)

Plan v1 went through the Admin-Brain 5-persona council (**Contrarian, First-Principles
Thinker, Expansionist, Outsider, Executor**). v2 keeps v1's technical choices (validation
layer, in-place .docx editing, `claude -p`, Gmail read-only) but changes the plan's **shape**:

- **Gmail moves to the front.** One Gmail connection powers both job finding (LinkedIn job
  alert emails) and tracking.
- **A measured source bake-off** picks the LinkedIn route before anything is built on it.
- **Four gated milestones**, each with a usage gate, replace five phases.
- **A cut list.**
- The goal is measured in **interviews**, not features.

---

## Part A: Council findings on v1

### Contrarian: "The tool isn't the bottleneck, and the scraper is the weakest bet"
- **The real number is applications sent and responses.** The tracker shows 3 applications.
  A beautiful pipeline that's done in 6 weeks loses to 30 well-aimed applications sent in
  those 6 weeks. → *Keep applying by hand during the build. Each milestone must make the next
  week's applications faster, or it's cut.*
- **The guest endpoint is a stopgap, not a foundation.** It's undocumented, it changes
  without notice, and LinkedIn blocks IPs. v1 makes it "Primary" without testing. → *Run a
  1-week bake-off on real data first; pick on measured precision.*
- **LinkedIn Easy Apply is the most crowded channel.** Hundreds of applicants per posting
  within hours. → *Prefer the company's direct apply link when one exists, and rank jobs
  posted < 72 h higher.*
- **Auto-setting statuses from email can quietly be wrong.** → *Every email-driven change
  shows its source email and can be reverted. Rejection and offer need ≥ high confidence or
  go to the tray.*
- **Build-time creep.** v1 is ~5 weeks of evenings. → *Time-box every milestone. If one
  overruns 50%, stop and cut scope.*

### First-Principles Thinker: "What actually gets an interview?"
Interviews come from **(1) applying early** (first 1–3 days), **(2) a resume that clears the
ATS and a 6-second human skim** for that JD, and **(3) a human connection** (referral or
direct note to the hiring manager), which multiplies response rates. Everything else is
bookkeeping.
- **Freshness beats coverage.** Retire "≥ 100 jobs". Aim for ~5–15 *right* new jobs a day,
  delivered every morning.
- **The data model is the product.** One `job` record, an append-only `events` log (search,
  triage, resume, applied, email), and every screen is a view of that. Design it first.
- **Email is the event stream.** Confirmations, rejections, interviews, and LinkedIn job
  alerts all arrive by email. Connecting Gmail once serves both ends of the pipeline.

### Expansionist: "Let the same pieces do more"
- **LinkedIn job alert emails as a source.** Set 3–4 saved-search alerts on LinkedIn (daily).
  They're official, free, ToS-safe, and arrive with job IDs and links. The Gmail poller
  you need anyway turns them into jobs, and the guest JD page fills in the description. This
  may make scraping search pages unnecessary.
- **Referral nudge.** On "Interested", show a link to LinkedIn people search for
  `<company> + "sales engineer"` and your 1st/2nd-degree connections. It's one URL; you
  reach out by hand.
- **Interview prep pack.** When status hits `Interview`, Claude builds a one-pager: saved JD,
  the resume you sent, company summary, likely questions, your matching stories.
- **Learning loop.** Track which resume emphasis and which source got responses; a weekly
  digest goes to the Admin-Brain HUD.
- *Parked (post-v2):* cover letters, application-question drafts, salary data.

### Outsider: "What does a normal morning look like?"
- **The daily flow must beat a spreadsheet** or you won't use it: open dashboard → **"12 new
  today"** → arrow keys + `I`/`D` to triage → on Interested, *Generate* runs in the
  background → review the diff → **Open apply link** → apply → **Applied**. Target: under
  15 minutes for the day.
- **Show why a job is there:** match chips (title ✓, NYC ✓, 2 days old, direct link ✓) so you
  trust the list.
- **Show what the system did:** a small activity feed ("Yext → Rejected, from email 'Update
  on your application', undo").
- **A broken dashboard is a dead dashboard.** Show a status bar: last search ran 7:02 ✓, last
  email check 9:00 ✓, LinkedIn source ⚠ blocked.

### Executor: "Gates, time boxes, branch-sized goals"
- Four milestones, each ending in a **usage gate** (you used it for real for a week), not a
  "code merged" gate.
- Every goal is one PR the Admin-Brain loop can run, with fixtures so VERIFY can test without
  the network.
- The source decision is **data, not opinion**: a scored bake-off spreadsheet.
- Retire old code in the same PR that replaces it, so there's never two of anything.

---

## Part B: Decisions locked by this plan
1. **No logged-in automation of your LinkedIn account. Ever.**
2. **One store:** SQLite (`node:sqlite`) with `jobs` + append-only `events`. Excel and
   `jobs.json` are retired after migration.
3. **Gmail API, read-only, label-scoped** is the single email integration. It's used for job
   alerts *and* status tracking. The Claude Gmail connector is the fallback if Google Cloud
   OAuth setup turns out painful.
4. **Resumes are edited in place** from one canonical base `.docx`. They're never rebuilt from
   Markdown.
5. **Claude runs headless (`claude -p`) on your subscription.** No API key, no manual handoff.
6. **You click Apply.** No auto-submit, no auto-reply to emails.
7. **Success metric:** interviews per month. Tracked: apps/week, response rate, interview
   rate, median days posted → applied.

---

## Part C: The milestone plan

### M0: Foundations + source bake-off · 1 week
- **Search profile** `config/search-profile.json`: titles + synonyms, exclusions, locations
  (Boston / NYC / US-remote: you decide), max age, blocklist (Jobgether, staffing agencies).
- **Data model + migration:** SQLite `jobs`, `events`; import `jobs.json` + the 3 Excel rows.
- **Validation module** (freshness, liveness, title, location, dedupe, blocklist) with
  rejection reasons logged.
- **Gmail API read-only connection** + `Job Hunt` label filter (also catches LinkedIn alert
  emails).
- **Bake-off:** run four sources on the same profile for 5 days:
  (a) LinkedIn job-alert emails, (b) LinkedIn guest search endpoint, (c) Apify LinkedIn Jobs
  actor (free credit), (d) existing Greenhouse/Lever/Ashby. Score each on **precision**
  (live, right title, right location, ≤ 7 days; spot-check 20), **unique new jobs/day**,
  and **breakage**.
- **Gate:** pick the source mix that gives ≥ 90% precision and ≥ 5 good new jobs/day.
  Expected answer: alerts + guest JD fetch, with board sources for coverage.

### M1: Find + triage, used daily · 1 week
- Chosen sources + JD fetch + daily 7am schedule. Retire `claude`, `adzuna`, the Markdown
  renderer path, `dashboard.html`, the Excel file.
- **Dashboard** (on the existing `lib/webapp.js`, port 4188, HUD button kept):
  - **New** view with keyboard triage and match chips. **Pipeline** view by status.
    **Closed** view.
  - Columns: Company · Title · Location · Posted · Source · Status · Applied · Resume ·
    Last update · LinkedIn ↗ · Direct apply ↗.
  - **Applied** button: date, JD snapshot, resume used, follow-up +7 d, undo.
  - Referral link on each Interested job. Health status bar.
- **Gate:** you triage daily for a week in < 5 min/day and send every application from it.

### M2: Resume adjuster · 1–1.5 weeks
- Canonical base resume → `Resumes/_base/`.
- `lib/docx-edit.js`: paragraph map out, replacements in, runs and formatting untouched.
- **Generate resume** → background `claude -p` job → guardrail checks (no new employers,
  dates, tools, or numbers; one page; ≤ 2 lines per bullet) → saved to
  `C:\Users\liamm\job-hunt\Resumes\Pek_Liam_Resume_<Company>_<Title>.docx` + PDF.
- **Preview:** PDF (install LibreOffice for headless conversion) + before/after bullet diff +
  ATS keyword score before/after + Accept / Regenerate-with-note / Open in Word.
- **Gate:** 5 consecutive resumes you'd send with ≤ 1 manual edit each.

### M3: Email tracking · 1–1.5 weeks
- Poller every 2 h on the `Job Hunt` label. Rules first; `claude -p` for the rest.
- Classes: confirmation, rejection, interview_request, assessment, offer, recruiter_outreach,
  linkedin_alert (→ M1 source), other.
- Match on company domain/name → title. Low confidence → **Unmatched** tray. Each change is
  logged with its email and undoable.
- Confirmation emails auto-confirm `Applied`. 30 days of silence → `Ghosted`. Windows
  notification on interview/offer.
- **Gate:** 2 weeks with ≥ 90% correct auto-updates and zero silent wrong rejections.

### M4: Improve the hit rate · ongoing
- Funnel metrics + weekly digest to the Admin-Brain HUD.
- Interview prep pack on `Interview`.
- Review which sources and resume angles get responses; adjust the profile.
- *Then consider:* cover letters, application-question drafts.

---

## Part D: Cut list
- `claude` web-search source (main cause of fake and old postings)
- Adzuna source and the RapidAPI LinkedIn path (unless the bake-off picks it)
- "≥ 100 jobs" target
- Markdown → .docx/.pdf resume renderer for tailored resumes (reviewer can keep it)
- `dashboard.html` static page and `Job_Applications.xlsx`
- Auto-apply of any kind

---

## Part E: Cost
| Item | Cost |
|------|------|
| Claude (`claude -p`) | Your existing subscription |
| Gmail API | Free |
| LinkedIn alerts / guest endpoint | Free |
| Apify (only if chosen) | ~$0–5/month with a spend cap |
| LibreOffice | Free |

---

## Part F: First week (concrete)
1. Decide titles, locations, and the canonical base resume (human, 15 min).
2. Create 3–4 LinkedIn job alerts (daily) for the profile (human, 10 min).
3. Google Cloud project + Gmail API OAuth + `Job Hunt` filter (human + Claude, ~1 h).
4. Build SQLite store + migration + validation module (PR).
5. Build the four bake-off sources behind one interface; run for 5 days (PR).
6. Keep applying by hand meanwhile; log them in the new store.

---

## Part G: Candidate roadmap goals (Admin-Brain, branch-sized)
- [ ] M0: search profile config + validation module (fixture tests)
- [ ] M0: SQLite store (jobs + events) + migrate jobs.json and Excel
- [ ] M0: Gmail API read-only poller on the `Job Hunt` label
- [ ] M0: bake-off sources (alerts, guest, Apify, boards) + scoring report
- [ ] M0 gate: pick the source mix (human)
- [ ] M1: daily scheduled search + JD fetch; retire claude/adzuna/dashboard.html/Excel
- [ ] M1: dashboard New/Pipeline/Closed + keyboard triage + match chips + health bar
- [ ] M1: Applied button + JD snapshot + follow-up + undo + referral link
- [ ] M1 gate: one week of daily use (human)
- [ ] M2: canonical base resume + in-place .docx editor
- [ ] M2: Generate resume → `claude -p` job + guardrail checks
- [ ] M2: preview (PDF + diff + ATS score + accept/regenerate)
- [ ] M2 gate: 5 resumes, ≤ 1 edit each (human)
- [ ] M3: email classifier + matcher + Unmatched tray + undo log
- [ ] M3: ghost timer + confirmation auto-apply + notifications
- [ ] M3 gate: 2 weeks ≥ 90% correct (human)
- [ ] M4: funnel metrics + weekly HUD digest + interview prep pack
- [ ] get first interview (outcome)
