---
type: plan
project: Job Hunt / Recruiter Helper
version: v1 (critiqued & expanded)
created: '2026-10-19'
based_on: Liam's revamp phases 0–4 (2026-10-19)
status: draft (pick v1 or v2)
---

# Job Hunt revamp: Plan v1 (critiqued & expanded)

**Goal:** one automated workflow that finds fresh postings for my titles and locations, tailors
my base resume to each one I pick, hands me the apply link, and tracks every application to
its outcome. Claude and code do the busywork; I apply myself.

This version keeps your five phases and their order. Part A critiques them; Part B is the
expanded plan.

---

## Part A: Critique of the original phases

### What's good
- **Human applies, machine prepares.** Not auto-submitting is right. Auto-apply bots get
  accounts flagged and produce sloppy applications.
- **Interest is the trigger.** Tailoring only on "Generate resume" keeps Claude usage and
  review time small.
- **Email as the status source.** Employers never update you anywhere else, so email is the
  only real signal.

### Weaknesses

**Phase 0, LinkedIn as the source**
1. **There is no LinkedIn integration for this.** LinkedIn's job APIs are partner-only
   (ATS vendors and job boards posting jobs, not reading them). The Job Posting API isn't taking
   new partners, and self-serve access covers sign-in and basic profile only. The existing
   `lib/sources/linkedin.js` already says this. You have to pick one of the workarounds in
   Part B.
2. **Never scrape while logged in to your own account.** LinkedIn restricts accounts that
   automate, and your LinkedIn profile matters more to this job hunt than any scraper. Anything
   automated must run logged out or through a third party.
3. **LinkedIn alone won't fix the data problems.** LinkedIn has its own stale, reposted,
   "Promoted", and ghost postings, and its location filter is loose ("New York" brings in
   NJ/CT/remote). The bad data has two causes:
   - The `claude` web-search source makes up or recalls old links.
   - Aggregators slip in. The store has 12 `jobs.lever.co/jobgether/...` rows, and Jobgether
     is a reposting aggregator, not an employer.

   The fix is a **validation layer** that every source passes through: posted ≤ N days ago,
   still accepting applications, title matches, location matches, dedupe, aggregator
   blocklist. A new source without that layer will bring the same problems back.
4. **Don't throw away Greenhouse/Lever/Ashby.** They are first-party data and always live.
   Use them as a second source, and to resolve a LinkedIn posting to the company's direct apply
   page. That page is often better than Easy Apply.
5. **The search profile isn't defined.** "My desired title" is really a list: Sales Engineer,
   Solutions Engineer, Solutions Consultant, Pre-Sales Engineer, Solutions Architect (junior),
   maybe Technical Account Manager. Location and exclusions also need settling: Boston (where
   your resume says you are), NYC, US-remote? Senior/Principal excluded? Write this down as a
   config file, not search-box text.
6. **The full job description is missing.** Search results carry snippets. Phase 2 needs the
   full JD, so add a "fetch JD" step at search time, while the posting is still up.

**Phase 1, Dashboard**
7. **There are three trackers today.** `data/jobs.json` plus the webapp, `dashboard.html`,
   and `Job_Applications.xlsx` (3 real rows: Radar, Yext, Kombo). Pick **one store** and
   migrate the 3 rows.
8. **Columns are missing.** Your list has no **company**, and Phase 4 email matching keys on
   company. Also add: date posted, source, salary (when listed), resume used, notes, last email
   update, next follow-up date.
9. **There's no triage step.** Without **Dismiss / Not interested**, the list fills with noise
   and you stop opening it. Every new job needs a one-click decision.
10. **Status needs to be a defined lifecycle with history**, not free text:
    `New → Interested → Resume ready → Applied → Screening → Interview → Offer`, plus
    `Rejected`, `Withdrawn`, `Ghosted`, `Dismissed`. Store each change with a timestamp and
    its cause (button vs email) so you can check the automation.

**Phase 2, Resume adjuster**
11. **Formatting will drift.** The current pipeline rebuilds the resume from Markdown
    (`lib/docx.js`), which loses your Word layout. The Kombo/Radar versions were edited by hand
    in a session. The adjuster should **edit a copy of the base .docx in place**: Claude returns
    `{paragraph → new text}`, and a script swaps the text inside the existing runs so fonts,
    bullets, and spacing are untouched.
12. **Which file is the base?** Three resume .docx files sit in the repo root. Choose one
    canonical base (`Pek_Liam_Resume_32726.docx` looks newest) and move it to
    `Resumes/_base/`.
13. **Guardrails are needed.** No invented employers, tools, metrics, or years; stay one
    page; keep XYZ form. Check these in code after Claude runs, not only in the prompt. Show a
    **before/after bullet diff** so the preview step is a 30-second check.
14. **How the button runs Claude Code.** The current webapp uses a file handoff that you
    trigger by hand. Instead, the local server should run `claude -p` headless (your
    subscription, no API key) as a background job with a spinner. That takes 30–90 s per
    resume.
15. **Preview needs a converter.** Browsers can't render .docx, and this PC has neither Word
    nor LibreOffice on PATH. Options: install LibreOffice and run
    `soffice --headless --convert-to pdf` for a faithful PDF preview (recommended), or use the
    `docx-preview` JS library in the page (fast, approximate).

**Phase 3, Applied button**
16. **It's too small for its own phase.** Fold it into Phase 1/2. Add: **save the JD text**
    when you click Applied, because postings disappear and you'll want it for interview prep.
    Also record the resume file used, set follow-up = +7 days, and add an Undo.
17. **Confirmations can be detected.** Easy Apply sends "Your application was sent to X", and
    most ATSs send "Thank you for applying". Phase 4 can confirm or set "Applied" from those
    emails, so a forgotten click doesn't drop a job.

**Phase 4, Email**
18. **Matching is harder than reading.** ATS emails come from no-reply domains
    (greenhouse-mail.io, hire.lever.co, ashbyhq, myworkday, icims) and rarely name the job ID.
    Match on company, then title. Ambiguous emails go to an **"Unmatched" tray** on the
    dashboard; never guess.
19. **Rejections are worded softly** ("we've decided to move forward with other candidates"),
    so a keyword filter isn't enough. Use rules for the obvious cases and Claude for the rest.
20. **Silence is an outcome.** Auto-mark `Ghosted` after ~30 days with no email.
21. **Privacy.** Use read-only access, scoped to a Gmail label (a Gmail filter files job
    emails into `Job Hunt`). Store only sender, subject, date, and the classification, not
    whole emails.

**Cross-cutting**
22. **There's no success measure.** The project exists to get interviews. Track applications
    per week, response rate, and interview rate, and use them to judge whether the tooling
    helps.
23. **There's no schedule.** "Find jobs" should run daily by itself (Windows Task Scheduler),
    with new jobs waiting for you, not on a button press.
24. **Cleanup.** Retire the `claude` web-search source and Adzuna, along with the "≥100 jobs"
    target, the Excel tracker, and the old README goals. Update the README and the Admin-Brain
    roadmap to the new workflow.

---

## Part B: The phased plan

### Phase 0: Reliable job finder · ~1–1.5 weeks

**0.1 Search profile.** `config/search-profile.json` holds the title list and synonyms,
exclusions (Senior, Principal, Manager, Director, Intern), locations (with radius and remote
policy), max posting age (default 7 days), and a company blocklist (Jobgether, staffing firms).

**0.2 LinkedIn source.** The options, ranked:

| # | Option | Cost | Reliability | Risk | Verdict |
|---|--------|------|-------------|------|---------|
| A | **Logged-out "guest" job search endpoint** (`linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&location=…&f_TPR=r604800`, plus `/jobPosting/<id>` for the full JD). This is what the open-source JobSpy library uses. | Free | Good at personal volume; HTML can change; rate-limited per IP | ToS grey area, but no login, so your account isn't at risk | **Primary.** Keep it slow: ≤ 1 search/day per title × location, small delays. |
| B | **Apify LinkedIn Jobs actor** (~$0.30–$5 per 1,000 jobs, priced per result; free plan credit likely covers you) | ~$0–5/mo | High; the vendor maintains the parser | Vendor does the scraping | **Fallback** if A breaks. Set a spend cap. |
| C | **RapidAPI-style LinkedIn jobs provider.** `lib/sources/linkedin.js` already supports it. | $0–25/mo | Varies by vendor | Same as B | Only if B is unavailable. |
| D | **LinkedIn job alert emails** parsed from Gmail | Free | High; official | None | Strong extra input once Phase 4's Gmail access exists. |
| E | Claude in Chrome browsing your logged-in LinkedIn | Free | Slow | **Account restriction** | Don't. |

**0.3 Validation pipeline** (`lib/validate.js`, used by every source): freshness, liveness
(the guest posting page shows "No longer accepting applications" when closed), title
match against the profile, location match (reuse the country-aware matcher from PR #15),
dedupe on `company + normalized title + city`, and the blocklist. Rejected rows are logged with
a reason so you can tune it.

**0.4 Keep Greenhouse/Lever/Ashby** as secondary sources. Drop `claude` and `adzuna`.

**0.5 Fetch and store the full JD** for every job that passes validation.

**0.6 Daily schedule.** A Windows Task Scheduler entry runs `npm run search` at 7am.

**Done when:** one run for the profile returns jobs where a spot-check of 20 finds ≥ 18 live,
on-title, in-location, and ≤ 7 days old. Tests use saved HTML fixtures, no network.

### Phase 1: Dashboard (+ Applied button) · ~1 week

- **One store:** SQLite through Node's built-in `node:sqlite` (Node 22+), with tables `jobs`,
  `status_events`, `resumes`, `emails`. Migrate `jobs.json` and the 3 Excel rows.
- **Columns:** Company · Title · Location · Posted · Source · Salary · Status · Date applied ·
  Resume · Last update · Links (LinkedIn ↗ / Direct apply ↗).
- **Views:** **New** (triage: Interested / Dismiss, keyboard shortcuts), **Pipeline**
  (Interested → Offer), **Closed**. Sort and filter on any column.
- **Applied button** (your Phase 3): sets status and date, saves the JD, records the resume
  used, sets follow-up = +7 days, has Undo. A "Mark applied" without a generated resume is
  allowed.
- Rebuild on the existing `lib/webapp.js` server (port 4188, Admin-Brain HUD button keeps
  working).

**Done when:** you can go from the morning's new jobs to "Interested" or "Dismissed" in under
5 minutes, and the old Excel file isn't needed.

### Phase 2: Resume adjuster · ~1–1.5 weeks

- **Base:** `Resumes/_base/Pek_Liam_Resume.docx` (your choice of the three).
- **Generate resume** button → server queues a job → `claude -p` with the base resume's
  paragraph map, the JD, and the XYZ rules → JSON of replacements (bullets, summary, skills
  line only) → `lib/docx-edit.js` swaps text in place → saved to
  `C:\Users\liamm\job-hunt\Resumes\Pek_Liam_Resume_<Company>_<Title>.docx`.
- **Guardrail checks in code:** employers, dates, and titles unchanged; no numbers that aren't
  in the base resume; still one page (checked on the PDF); every bullet ≤ 2 lines.
- **Preview panel:** PDF render (LibreOffice headless) beside a before/after bullet diff, an ATS
  keyword-coverage score before vs after (reuse `lib/ats.js`), and buttons for **Accept /
  Regenerate with note / Open in Word**.
- Status → `Resume ready` on Accept.

**Done when:** 5 resumes in a row look right in the preview and need ≤ 1 manual edit each.

### Phase 3: (merged into Phase 1)

### Phase 4: Email tracking · ~1.5 weeks

**Ways to connect your Gmail:**

| Option | How | Good | Bad |
|--------|-----|------|-----|
| **Gmail API (OAuth, `gmail.readonly`)** + a Node poller | One-time Google Cloud project + OAuth consent (you as test user); token stored locally | Runs on a schedule with no Claude session; free; deterministic; scoped to a label | ~1 hour of Google Cloud setup; test-mode refresh tokens expire every 7 days unless the app is published (personal "In production" unverified app works for yourself) |
| **Claude Gmail connector** (claude.ai connector, available here) | Connect in Settings → Connectors; a scheduled Claude task reads the label and calls the local CLI to update statuses | Almost no code; Claude does the classifying | Needs a Claude session/scheduled task to run; less deterministic; harder to test |
| IMAP + app password | `imapflow` with a Google app password (needs 2FA) | Simplest code | Full-mailbox credential; Google discourages it |

**Recommendation:** the Gmail API poller, with Claude (`claude -p`) only classifying emails the
rules can't. Set up a Gmail filter that labels emails from ATS domains, or with "application",
"interview", or "your candidacy" in the subject, as `Job Hunt`. The poller reads only that
label.

- **Classify:** `confirmation`, `rejection`, `interview_request`, `assessment`, `offer`,
  `recruiter_outreach`, `other`.
- **Match:** company domain and name → applied jobs; then title. Low confidence goes to the
  **Unmatched** tray.
- **Update:** status event with cause `email:<message-id>`, shown on the row as "Last update".
  Interview and offer trigger a Windows notification.
- **Ghost timer:** 30 days in `Applied` with no email → `Ghosted`.
- Runs every 2 hours through Task Scheduler.

**Done when:** over 2 weeks, ≥ 90% of job emails land on the right job with the right status,
and nothing is mis-set silently (everything uncertain goes to Unmatched).

---

## Part C: Summary checklist (candidate roadmap goals)
- [ ] Search profile config + validation pipeline (freshness, liveness, title, location, dedupe, blocklist)
- [ ] LinkedIn guest-endpoint source + JD fetch (Apify fallback behind a flag)
- [ ] Retire `claude` + `adzuna` sources; daily scheduled search
- [ ] SQLite store + migration (jobs.json + Excel)
- [ ] Dashboard rebuild: New / Pipeline / Closed views, triage, full columns
- [ ] Applied button + JD snapshot + follow-up date + undo
- [ ] Choose base resume; in-place .docx editor (`lib/docx-edit.js`)
- [ ] Generate-resume button → `claude -p` job + guardrail checks
- [ ] Resume preview: PDF render + bullet diff + ATS score + accept/regenerate
- [ ] Gmail API read-only poller on a `Job Hunt` label
- [ ] Email classifier + matcher + Unmatched tray + ghost timer
- [ ] Funnel metrics (apps/week, response rate, interview rate)
- [ ] get first interview (outcome, not a build task)
