---
name: jobs-dashboard
description: The Job Hunt webapp over data/jobhunt.db — triage new jobs from the watchlist scan, track applications with undo, manage the company watchlist, and paste any job link to grow it.
---

# Jobs dashboard (M1)

```powershell
.\run-dashboard.ps1            # http://127.0.0.1:4188 (also the Admin-Brain HUD button)
```

## Jobs tab
- **New / Backlog**: jobs from the daily scan, ranked by tier then newest. Each row shows why
  it's there (title phrase, place, age, years asked, salary). Keys: `j`/`k` move, `i`
  interested, `d` dismiss, `o` open the posting, `u` undo, `Enter` details.
- **Pipeline**: interested → applied → screening → interview → offer. **Applied…** records
  the date, saves the JD (postings disappear), the resume used and a follow-up date 7 days
  out. Later stages are a dropdown on the row; every change can be undone.
- **Closed**: dismissed, rejected, withdrawn, ghosted, and postings that left their board.
- **Apply ↗** goes to the company's own posting. **Find on LinkedIn ↗** is a plain link to a
  LinkedIn people search for the company; you click it, nothing fetches LinkedIn.

## Companies tab
- **Paste a job link**: any posting you found elsewhere, LinkedIn included. The link is
  never opened. Its company and job id are read from the URL text, the company joins the
  watchlist (board from the URL or auto-detected), and its board is scanned. The share of
  pasted postings the dashboard already had is your **coverage %**.
- **Add a company** by name; its ATS board is detected and scanned.
- **Watchlist**: tier (editable), board, open matches, new in 30 days, last scanned.

## Health bar
Last full scan (warns after 30 h), the 7am Windows task's next run, companies watched,
coverage %. **Scan now** runs the same scan as `npm run scan`.
