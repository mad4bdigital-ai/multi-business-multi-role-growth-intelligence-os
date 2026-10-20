[CmdletBinding()]
param(
    [string]$TaskName = "MAD4B Staging Auto Deploy",
    [string]$HealthTaskName = "MAD4B Staging Health Monitor",
    [string]$SupervisorTaskName = "MAD4B Staging Autonomous Supervisor",
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
$healthTask = Get-ScheduledTask -TaskName $HealthTaskName -ErrorAction SilentlyContinue
if ($healthTask) {
    Unregister-ScheduledTask -TaskName $HealthTaskName -Confirm:$false
    Write-Host "STAGING_HEALTH_TASK_REMOVED: task=$HealthTaskName"
} else {
    Write-Host "STAGING_HEALTH_TASK_NOT_FOUND: task=$HealthTaskName"
}

$supervisorTask = Get-ScheduledTask -TaskName $SupervisorTaskName -ErrorAction SilentlyContinue
if ($supervisorTask) {
    Unregister-ScheduledTask -TaskName $SupervisorTaskName -Confirm:$false
    Write-Host "STAGING_SUPERVISOR_TASK_REMOVED: task=$SupervisorTaskName"
} else {
    Write-Host "STAGING_SUPERVISOR_TASK_NOT_FOUND: task=$SupervisorTaskName"
}

if ($StopStaging) {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $startScript = Join-Path $scriptRoot "Start-AutoPilot.ps1"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $startScript -Stop
    if ($LASTEXITCODE -ne 0) { throw "AUTO_DEPLOY_FAIL_CLOSED: Staging stop failed" }
    Write-Host "AUTO_DEPLOY_STAGING_STOPPED"
}
