---
name: jobs-dashboard
description: The Job Hunt webapp over data/jobhunt.db — triage new jobs from the watchlist scan, track applications with undo, manage the company watchlist, and paste any job link to grow it.
---

# Jobs dashboard (M1)

```powershell
.\run-dashboard.ps1            # http://127.0.0.1:4188 (also the Admin-Brain HUD button)
```

## Jobs tab
- **New / Backlog**: jobs from the daily scan, ranked NYC first, then US-remote, then tier,
  then newest. Each row shows why
  it's there (title phrase, place, age, years asked, salary). Keys: `j`/`k` move, `i`
  interested, `d` dismiss, `o` open the posting, `u` undo, `Enter` details.
- **Pipeline**: interested → applied → screening → interview → offer. **Applied…** records
  the date, saves the JD (postings disappear), the resume used and a follow-up date 7 days
  out. Later stages are a dropdown on the row; every change can be undone.
- **Closed**: dismissed, rejected, withdrawn, ghosted, and postings that left their board.
- **Apply ↗** goes to the company's own posting. **Find on LinkedIn ↗** is a plain link to a
  LinkedIn people search for the company; you click it, nothing fetches LinkedIn.

## Tailored resume (per job, under "Resume & details")
- **Generate tailored resume** (optional note for Claude, e.g. "lead with customer-facing
  work"). Runs in the background, 20–90 s, on your Claude Code subscription.
- Only list bullets under Experience and Skills of the base resume (`config/resume.json`) are
  rewritten, in place, so fonts, bullets and spacing match the original exactly.
- Checks in code: a rewrite that adds a number not in your resume, or touches anything other
  than an editable bullet, is **rejected** (shown in red). New capitalised terms (tools,
  products), much longer bullets and overall growth are **warnings**: keep them only if true.
- JD keyword coverage before → after (+ gained, − lost), a before/after diff of every changed
  bullet, and a page preview with a page count (a PDF when LibreOffice is installed).
- **Accept** makes it the job's resume (the Applied form then defaults to it, and a job still in
  triage moves to Interested). **Regenerate** keeps every version; pick one from the list.
  **Open in Word** / **Download .docx**.
- Files: `Resumes/Pek_Liam_Resume_<Company>_<Title>.docx` (`_v2`, `_v3` for regenerations).

## Companies tab
- **Paste a job link**: any posting you found elsewhere, LinkedIn included. The link is
  never opened. Its company and job id are read from the URL text, the company joins the
  watchlist (board from the URL or auto-detected), and its board is scanned. The share of
  pasted postings the dashboard already had is your **coverage %**.
- **Discover companies**: web search (Claude) for current postings with your titles in NYC /
  US-remote; companies whose own board has a matching job are added (tier C) and scanned.
  Also runs weekly with the 7am scan.
- **Add a company** by name; its ATS board is detected and scanned. Workday companies: paste
  one of their myworkdayjobs.com posting links instead.
- **Watchlist**: tier (editable), board, open matches, new in 30 days, last scanned.

## Health bar
Last full scan (warns after 30 h), the 7am Windows task's next run, companies watched,
coverage %. **Scan now** runs the same scan as `npm run scan`.
