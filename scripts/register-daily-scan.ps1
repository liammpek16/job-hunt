<#
.SYNOPSIS
    Register (or remove) the daily Job Hunt watchlist scan in Windows Task Scheduler.

.DESCRIPTION
    Creates a per-user task "JobHunt Daily Scan" that runs `node skills/scan/scan.js` from the
    repo root every day at 07:00 (runs as soon as possible if the PC was off at 7). Output is
    appended to data/scan-task.log; each run also adds a line to data/scan.log.

.EXAMPLE
    .\scripts\register-daily-scan.ps1
    .\scripts\register-daily-scan.ps1 -At 06:30
    .\scripts\register-daily-scan.ps1 -Remove
#>
param(
    [string]$At = '07:00',
    [switch]$Remove
)

$TaskName = 'JobHunt Daily Scan'
$Root = Split-Path -Parent $PSScriptRoot

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed '$TaskName'."
    return
}

$Node = (Get-Command node -ErrorAction Stop).Source
$Log = Join-Path $Root 'data\scan-task.log'
$Cmd = "cd /d `"$Root`" && `"$Node`" skills\scan\scan.js >> `"$Log`" 2>&1"

$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $Cmd" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Daily -At $At
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description 'Scans the Job Hunt company watchlist for new roles (job-hunt repo).' -Force | Out-Null
Write-Host "Registered '$TaskName' daily at $At -> $Root"
Write-Host "Run now:  Start-ScheduledTask -TaskName '$TaskName'"
