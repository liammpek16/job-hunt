---
name: ats-scanner
description: Scan a (tailored) resume for ATS auto-rejection risks — keyword match vs the JD, un-parseable formatting, missing contact/sections, weak quantification. Risks only; never edits.
---

# ATS scanner (goal 4)

Acts like an Applicant Tracking System: scans a resume for what would get it
**auto-rejected or mis-parsed**, and reports each risk with a severity + an overall
ATS risk score (0–100). Risks only — it never edits the resume.

## Checks

- **Keyword match** vs the JD (reuses `lib/tailor.js`) — low coverage is the #1 auto-reject cause.
- **Parseability** — tables/pipes, images, raw HTML, non-standard bullet glyphs, smart punctuation.
- **Contact info** — email (high), phone (low).
- **Standard sections** — Experience, Skills, Education (ATS keys off standard headers).
- **Quantification** — reuses `lib/xyz.js`; flags if few bullets have a measurable result.
- **Length** — too short (missing keyword surface) or too long (diluted density).

## Run

```bash
node skills/ats/ats.js --resume resume.md                      # format-only checks
node skills/ats/ats.js --resume resume.md --jd job.txt         # + keyword match vs JD
node skills/ats/ats.js --resume resume.md --role "adzuna:123"  # JD from the shared store
node skills/ats/ats.js --resume resume.md --jd job.txt --json  # structured
```

Exit code `1` on **high risk** so a pipeline can gate on it. JD is optional (without it,
keyword checks are skipped).

## Score

Start at 100; subtract per finding (high −20, med −10, low −3), floored at 0.
≥80 low risk · 60–79 moderate · <60 high risk.

## Design

Deterministic / $0 (no LLM). It reuses the reviewer's XYZ scorer and the customizer's keyword
coverage, so all three skills share one contract. It cannot see PDF/DOCX layout (input is
Markdown/text) — parseability checks target the text-level issues that break most ATS.
