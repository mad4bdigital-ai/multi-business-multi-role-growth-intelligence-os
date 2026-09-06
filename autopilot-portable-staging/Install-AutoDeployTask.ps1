[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$TaskName = "MAD4B Staging Auto Deploy",
    [string]$HealthTaskName = "MAD4B Staging Health Monitor",
    [string]$DockerBootstrapTaskName = "MAD4B Staging Docker Bootstrap",
    [int]$PollSeconds = 300,
    [int]$HealthIntervalSeconds = 60,
    [ValidateRange(0, 300)]
    [int]$LogonDelaySeconds = 25,
    [ValidateRange(60, 600)]
    [int]$BootGraceSeconds = 180,
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
$preflightScript = Join-Path $scriptRoot "Staging-Windows-Preflight.ps1"
if (-not (Test-Path -LiteralPath $autoDeployScript)) { Fail "Auto-Deploy-Staging.ps1 is missing" }
if (-not (Test-Path -LiteralPath $policyPath)) { Fail "auto-deploy-policy.json is missing" }
if (-not (Test-Path -LiteralPath $healthScript)) { Fail "Staging-HealthMonitor.ps1 is missing" }
if (-not (Test-Path -LiteralPath $preflightScript)) { Fail "Staging-Windows-Preflight.ps1 is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git"))) { Fail "RepositoryPath is not a Git repository: $RepositoryPath" }

$escapedScript = $autoDeployScript.Replace('"', '\"')
$escapedRepo = $RepositoryPath.Replace('"', '\"')
$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$escapedScript`" -RepositoryPath `"$escapedRepo`" -Watch -PollSeconds $PollSeconds -BuildMode $BuildMode -TunnelMode $TunnelMode"

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

# Restore the local Docker engine independently from GitHub deployment eligibility.
# This task can only start/wait for Docker Desktop; it never selects a commit,
# runs Compose, mutates a database, or touches any provider. Auto Deploy remains
# the sole authority for deployment/certification after its eligibility gate.
$escapedPreflightLiteral = $preflightScript.Replace("'", "''")
$dockerBootstrapCommand = ". '$escapedPreflightLiteral'; `$dockerReady = Ensure-StagingDockerDesktopReady -TimeoutSeconds $BootGraceSeconds -PollSeconds 3; if (`$dockerReady.ready -ne `$true) { throw 'STAGING_DOCKER_BOOTSTRAP_NOT_READY' }"
$encodedDockerBootstrapCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($dockerBootstrapCommand))
$dockerAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME "powershell.exe") -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedDockerBootstrapCommand" -WorkingDirectory $scriptRoot
$dockerTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$dockerDelaySeconds = [Math]::Min(10, $LogonDelaySeconds)
$dockerTrigger.Delay = "PT${dockerDelaySeconds}S"
Register-ScheduledTask -TaskName $DockerBootstrapTaskName -Action $dockerAction -Trigger $dockerTrigger -Settings $settings -Principal $principal -Force | Out-Null

$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME "powershell.exe") -Argument $arguments -WorkingDirectory $scriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT${LogonDelaySeconds}S"
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$healthEscapedScript = $healthScript.Replace('"', '\"')
$healthEscapedRepo = $RepositoryPath.Replace('"', '\"')
$healthArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$healthEscapedScript`" -RepositoryPath `"$healthEscapedRepo`" -IntervalSeconds $HealthIntervalSeconds -BootGraceSeconds $BootGraceSeconds"
$healthAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME "powershell.exe") -Argument $healthArguments -WorkingDirectory $scriptRoot
$healthTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$healthDelaySeconds = [Math]::Min(300, [Math]::Max($LogonDelaySeconds + 10, 35))
$healthTrigger.Delay = "PT${healthDelaySeconds}S"
Register-ScheduledTask -TaskName $HealthTaskName -Action $healthAction -Trigger $healthTrigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "STAGING_DOCKER_BOOTSTRAP_TASK_INSTALLED: task=$DockerBootstrapTaskName user=$env:USERDOMAIN\$env:USERNAME logon_delay_seconds=$dockerDelaySeconds local_runtime_bootstrap_only=True deployment_authorized=False"
Write-Host "AUTO_DEPLOY_TASK_INSTALLED: task=$TaskName user=$env:USERDOMAIN\$env:USERNAME poll_seconds=$PollSeconds tunnel_mode=$TunnelMode logon_delay_seconds=$LogonDelaySeconds multiple_instances=IgnoreNew provider_mutation_authorized=False"
Write-Host "STAGING_HEALTH_TASK_INSTALLED: task=$HealthTaskName interval_seconds=$HealthIntervalSeconds boot_grace_seconds=$BootGraceSeconds logon_delay_seconds=$healthDelaySeconds"
Write-Host "All tasks run only when this Windows user is logged in and never change Production, DNS, Hostinger, or database state."
