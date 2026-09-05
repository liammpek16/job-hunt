---
name: resume-reviewer
description: Score a Markdown/plain-text resume against the Google-XYZ rubric and suggest per-bullet rewrites. Suggestions only — never edits the resume.
---

# Resume reviewer (goal 1)

Scores every bullet in a resume against the Google-XYZ rubric —
"Accomplished **[X]**, as measured by **[Y]**, by doing **[Z]**" — and reports which
bullets are weak and how to fix them.

- **X** — leads with a strong action verb
- **Y** — a **quantified** result (%, $, count, time, magnitude)
- **Z** — the method (a "by …ing" clause, or using/via/leveraging)

## Run

```bash
node skills/reviewer/reviewer.js samples/sample-resume.md          # Markdown scorecard
node skills/reviewer/reviewer.js samples/sample-resume.md --json   # structured JSON
node skills/reviewer/reviewer.js --stdin < resume.md               # pipe in text
node skills/reviewer/reviewer.js resume.md --out scorecard.md      # write scorecard to a file
node skills/reviewer/reviewer.js resume.md --docx improved.docx    # NEW .docx with improved bullets
```

## `--docx` — generate an improved-resume Word file

`--docx <out.docx>` writes a **new** Word document that reproduces the resume with each weak
bullet replaced by its XYZ **rewrite scaffold** (full-XYZ bullets kept as-is). The scaffolds
contain `[bracketed]` placeholders — fill in real numbers before sending. The original resume
is **never modified**; this is a separate draft for your review. Rewrites are deterministic
(no LLM), so they mark *what* to add rather than invent metrics.

## Output contract (the shared core)

`lib/xyz.js` is the **reusable contract** for the whole project. Every bullet becomes:

```json
{ "text": "...", "hasX": true, "hasY": false, "hasZ": true, "score": 2,
  "missing": ["Y (add a quantified result …)"], "rewrite": "…scaffolded rewrite…" }
```

The customizer (goal 3), the ATS scanner (goal 4) and the dashboard (goal 6) all reuse
`reviewResume()` / `scoreBullet()` from `lib/xyz.js` — they do not re-implement critique.

## Design notes

- **Deterministic / $0.** No LLM: detection is action-verb list + quantifier/method regex,
  so it is fast, offline, and unit-tested (`npm test`).
- **Rewrites are scaffolds, not inventions.** With no LLM we cannot fabricate real metrics,
  so a rewrite keeps what the bullet has and inserts explicit `[placeholders]` for what's
  missing. It is a suggestion; the skill never writes to the resume.
- **Input:** Markdown / plain text. PDF/DOCX parsing is deferred (README scope).
