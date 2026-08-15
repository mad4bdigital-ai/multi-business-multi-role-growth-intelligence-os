[CmdletBinding()]
param(
    [string]$TaskName = "MAD4B Staging Auto Deploy",
    [switch]$StopStaging
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "AUTO_DEPLOY_TASK_REMOVED: task=$TaskName"
} else {
    Write-Host "AUTO_DEPLOY_TASK_NOT_FOUND: task=$TaskName"
}

if ($StopStaging) {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $startScript = Join-Path $scriptRoot "Start-AutoPilot.ps1"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $startScript -Stop
    if ($LASTEXITCODE -ne 0) { throw "AUTO_DEPLOY_FAIL_CLOSED: Staging stop failed" }
    Write-Host "AUTO_DEPLOY_STAGING_STOPPED"
}
