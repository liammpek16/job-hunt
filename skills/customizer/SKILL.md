---
name: resume-customizer
description: Tailor a resume to a specific job description — keyword-gap analysis + XYZ scoring, with concrete rewrite suggestions. Suggestions only; never edits the resume.
---

# Resume customizer (goal 3)

Tailors a resume to **one job description (JD)**. It reuses the goal-1 XYZ scorer
(`lib/xyz.js`) and adds keyword-gap analysis (`lib/tailor.js`):

1. Extract the JD's meaningful keywords (deterministic: tokenize, drop stopwords, rank by frequency).
2. Compute **keyword coverage** — which top JD keywords the resume already contains vs is missing.
3. Score the resume's bullets against XYZ.
4. Suggest weaving the **missing** keywords into the **weak** bullets — following XYZ, only where truthful.

**Suggestions only.** Editing the resume is an approval-gated step; the skill never writes to it.

## Run

```bash
node skills/customizer/customizer.js --resume resume.md --jd job.txt
node skills/customizer/customizer.js --resume resume.md --role "adzuna:12345"   # JD from the store
node skills/customizer/customizer.js --resume resume.md --jd job.txt --json      # structured
node skills/customizer/customizer.js --resume resume.md --jd job.txt --docx tailored.docx
node skills/customizer/customizer.js --resume resume.md --jd job.txt --pdf tailored.pdf
```

`--role` pulls the JD from a saved role in `data/jobs.json` (from the searcher), so the whole
pipeline — search → tailor — shares one store.

`--docx <out.docx>` writes a **new** tailored-resume Word file: weak bullets replaced by their
XYZ rewrite, and a header note listing the JD keywords to weave in (truthfully). The original
resume is never modified. `--pdf <out.pdf>` writes the same tailored resume as a PDF (pdfkit, no
Word required); pass both flags for both files.

## Output contract

Structured report `{ keywords, coverage:{present,missing,pct}, xyz, weakBullets, suggestions }`.
The ATS scanner (goal 4) reuses `extractKeywords` / `keywordCoverage` from `lib/tailor.js`.

## Design

Deterministic / $0 (no LLM): keyword extraction is frequency ranking over a stopword-filtered
tokenizer; coverage is whole-word set intersection. Honest limits: it flags *which* keywords to
add and *which* bullets are weak, but the actual rewrite is yours to make (a later optional LLM
pass could draft rewrites).
