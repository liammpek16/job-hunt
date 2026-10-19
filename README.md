# Job Hunt / Recruiter Helper

A personal agent that runs my job search end to end — from sharpening my resume to finding
roles, tailoring applications, pre-screening them the way a recruiter's ATS would, and tracking
the pipeline through to a first interview.

## Ultimate goal

The full workflow the agent should support:

1. **Resume review.** Take in my resume and review it against the **Google XYZ format**
   ("Accomplished **X** as measured by **Y** by doing **Z**"). Suggest improvements and,
   **after my approval**, implement them.
2. **Job search.** Given my desired **job title, location, and salary range**, search
   LinkedIn and/or Indeed for roles matching that profile. Surface **at least 100 jobs**.
   Show me the list; I pick the ones I want to apply to.
3. **Resume tailoring.** For each job I select, tailor my resume to that job description —
   again following the Google XYZ format.
4. **ATS check.** Act as an **ATS scanner** and check every tailored resume for weaknesses
   that would get it auto-rejected (keywords, formatting, parseability), and report them.
5. **Track & land.** Track jobs applied to and interviews completed on a dashboard, and drive
   the whole thing toward the real outcome: **a first interview**.

## Scope / roadmap

Each build target is a discrete skill (or, for the last two, a tracked outcome). Ordered as in
`Admin-Brain/vault/Plans/job-hunt-recruiter-helper-roadmap.md`:

| # | Target | Priority | Notes |
|---|--------|----------|-------|
| 1 | **Resume reviewer skill** — score/critique a resume against Google XYZ; propose rewrites | high | The shared XYZ rubric other skills reuse. Build first. |
| 2 | **Job searcher skill** — surface ≥100 roles for a given title/location/salary | high | The hard one — see Risks (anti-bot / ToS / data source). |
| 3 | **Resume customizer skill** — tailor the resume to a specific job description (XYZ) | med | Reuses the reviewer's rubric. |
| 4 | **ATS scanner skill** — flag ATS-rejection risks in a tailored resume | med | Reuses the reviewer's rubric. |
| 5 | **Pipeline test** — run the full pipeline end to end on my real resume | high | Needs a real resume as input. |
| 6 | **Dashboard** — track jobs applied to / interviews completed | — | Reporting layer over the pipeline. |
| 7 | **Get first interview** — the real-world outcome the whole project is for | — | The success metric, not a code task. |

## Conventions / definitions

- **Google XYZ bullet:** "Accomplished [X], as measured by [Y], by doing [Z]." Every resume
  bullet should be expressible in this shape, with a **quantified [Y]**. This rubric is the
  shared contract across skills 1, 3, and 4.
- **Inputs:** my resume (start with Markdown / plain text; PDF/DOCX parsing deferred), and a
  target profile (title, location, salary) and/or a specific job description.
- **Human gates:** resume edits (goal 1) and job selection (goal 2) require my approval — the
  agent proposes, I approve before anything is applied.

## Risks

- **Job-board access** (LinkedIn/Indeed) may hit anti-bot / ToS limits — reliably surfacing
  ≥100 roles is the hardest part and may need an official API or an alternate data source.
- **Over-editing** — "improvements" and "tailoring" need a real resume + approval gates so the
  agent proposes rather than silently rewrites.

## Status

**Revamp in progress** on the approved v4 plan (`docs/plan-v4-council.md`, on the
`docs/revamp-plan` branch): jobs come only from employers' own ATS boards, no LinkedIn
scraping, and a tiered company watchlist is the search.

**M0 (watchlist scan)** is built, see `skills/scan/SKILL.md`:
- `config/search-profile.json`: titles, exclude words, locations, max years required.
- `config/companies.json`: tiered watchlist + blocklist; `npm run detect` finds each
  company's Greenhouse / Ashby / Lever / SmartRecruiters / Workable board.
- `npm run scan`: daily scan (`scripts/register-daily-scan.ps1` registers 7am), roles saved as
  `new` or `backlog`.

The original skills (reviewer, customizer, ATS scanner, dashboard) still work; M1–M3 replace
the dashboard, tailoring and tracking.
