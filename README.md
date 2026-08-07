# Job Hunt / Recruiter Helper

A personal agent that runs my job search end to end — from sharpening my resume to
finding roles, tailoring applications, and pre-screening them the way a recruiter's ATS
would.

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

## Initial scope (v1)

The first build targets — each a discrete skill:

1. **Resume reviewer skill** — score/critique a resume against Google XYZ; propose rewrites.
2. **Job searcher skill** — surface ≥100 roles for a given title/location/salary.
3. **Resume customizer skill** — tailor the resume to a specific job description (XYZ).
4. **ATS scanner skill** — flag ATS-rejection risks in a tailored resume.
5. **Test on my current resume** — run the pipeline end to end on a real resume.

## Conventions / definitions

- **Google XYZ bullet:** "Accomplished [X], as measured by [Y], by doing [Z]." Every resume
  bullet should be expressible in this shape, with a quantified [Y].
- **Inputs:** my resume (source format TBD — e.g. Markdown/DOCX/plain text), and a target
  profile (title, location, salary) and/or a specific job description.
- **Human gates:** resume edits (goal 1) and job selection (goal 2) require my approval.

## Status

Just scoped. No code yet — the reviewer skill is first.
