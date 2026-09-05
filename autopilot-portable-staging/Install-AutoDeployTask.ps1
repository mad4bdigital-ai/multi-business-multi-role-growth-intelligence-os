[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$TaskName = "MAD4B Staging Auto Deploy",
    [string]$HealthTaskName = "MAD4B Staging Health Monitor",
    [int]$PollSeconds = 300,
    [int]$HealthIntervalSeconds = 60,
    [switch]$StartTunnel,
    [ValidateSet("disabled", "windows_service", "docker_sidecar")]
    [string]$TunnelMode = "disabled",
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart",
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($StartTunnel -and $TunnelMode -eq "disabled") { $TunnelMode = "windows_service" }
if ($SkipBuild) {
    if ($BuildMode -ne "Smart") { Fail "-SkipBuild cannot be combined with an explicit BuildMode" }
    $BuildMode = "SkipBuild"
}

function Fail([string]$Message) { throw "AUTO_DEPLOY_INSTALL_FAIL_CLOSED: $Message" }
if ($PollSeconds -lt 60) { Fail "PollSeconds must be at least 60" }
if ($HealthIntervalSeconds -lt 30) { Fail "HealthIntervalSeconds must be at least 30" }

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $scriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$autoDeployScript = Join-Path $scriptRoot "Auto-Deploy-Staging.ps1"
$policyPath = Join-Path $scriptRoot "auto-deploy-policy.json"
$healthScript = Join-Path $scriptRoot "Staging-HealthMonitor.ps1"
if (-not (Test-Path -LiteralPath $autoDeployScript)) { Fail "Auto-Deploy-Staging.ps1 is missing" }
if (-not (Test-Path -LiteralPath $policyPath)) { Fail "auto-deploy-policy.json is missing" }
if (-not (Test-Path -LiteralPath $healthScript)) { Fail "Staging-HealthMonitor.ps1 is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git"))) { Fail "RepositoryPath is not a Git repository: $RepositoryPath" }

$escapedScript = $autoDeployScript.Replace('"', '\"')
$escapedRepo = $RepositoryPath.Replace('"', '\"')
$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$escapedScript`" -RepositoryPath `"$escapedRepo`" -Watch -PollSeconds $PollSeconds -BuildMode $BuildMode -TunnelMode $TunnelMode"

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME "powershell.exe") -Argument $arguments -WorkingDirectory $scriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
$healthEscapedScript = $healthScript.Replace('"', '\"')
$healthEscapedRepo = $RepositoryPath.Replace('"', '\"')
$healthArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$healthEscapedScript`" -RepositoryPath `"$healthEscapedRepo`" -IntervalSeconds $HealthIntervalSeconds"
$healthAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME "powershell.exe") -Argument $healthArguments -WorkingDirectory $scriptRoot
$healthTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME" -RandomDelay (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $HealthTaskName -Action $healthAction -Trigger $healthTrigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "AUTO_DEPLOY_TASK_INSTALLED: task=$TaskName user=$env:USERDOMAIN\$env:USERNAME poll_seconds=$PollSeconds tunnel_mode=$TunnelMode provider_mutation_authorized=False"
Write-Host "STAGING_HEALTH_TASK_INSTALLED: task=$HealthTaskName interval_seconds=$HealthIntervalSeconds"
Write-Host "Both tasks run only when this Windows user is logged in and never change Production, DNS, Hostinger, or database state."
