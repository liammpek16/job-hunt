<#
.SYNOPSIS
    Launch the Job Hunt dashboard as a local web server.

.DESCRIPTION
    Serves the live pipeline dashboard (jobs applied to / interviews) from the shared
    store (data/jobs.json) at http://127.0.0.1:<port>. This is what the Admin Brain HUD's
    "webapp" button launches for the Job Hunt project — the analogue of run-webapp.ps1 for
    Dota Coach. Runs from the repo root regardless of the current directory. Ctrl-C to stop.

.EXAMPLE
    .\run-dashboard.ps1
    Serve on the default port 4188.

.EXAMPLE
    .\run-dashboard.ps1 -Port 4200
#>
param(
    [int]$Port = 4188
)

Set-Location $PSScriptRoot
Write-Host "Job Hunt dashboard" -ForegroundColor Cyan
Write-Host ("  project root : {0}" -f $PSScriptRoot)
Write-Host ("  serving      : http://127.0.0.1:{0}  (Ctrl-C to stop)`n" -f $Port)
& node skills/dashboard/dashboard.js --serve --port $Port
