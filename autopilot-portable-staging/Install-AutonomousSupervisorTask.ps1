[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$WatcherTaskName = "MAD4B Staging Auto Deploy",
    [string]$SupervisorTaskName = "MAD4B Staging Autonomous Supervisor",
    [ValidateRange(30, 600)][int]$IntervalSeconds = 60,
    [switch]$Activate
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail([string]$Message) { throw "STAGING_AUTONOMOUS_INSTALL_BLOCKED: $Message" }
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $scriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$expectedWatcher = [IO.Path]::GetFullPath((Join-Path $scriptRoot "Auto-Deploy-Staging.ps1"))
$supervisorScript = [IO.Path]::GetFullPath((Join-Path $scriptRoot "Staging-AutonomousSupervisor.ps1"))
if (-not (Test-Path -LiteralPath $supervisorScript -PathType Leaf)) { Fail "Supervisor source file missing" }
$policyPath = Join-Path $scriptRoot "autonomous-operations-policy.json"
$policy = Get-Content -Raw -LiteralPath $policyPath | ConvertFrom-Json -ErrorAction Stop
if ($policy.contract -ne "mad4b.staging-autonomous-operations.v1" -or $policy.environment -ne "staging") { Fail "Policy identity mismatch" }
$expectedPrincipal = "$env:USERDOMAIN\$env:USERNAME"
$watcher = Get-ScheduledTask -TaskName $WatcherTaskName -ErrorAction SilentlyContinue
if ($null -eq $watcher) { Fail "Existing Staging watcher task is missing" }
if ([string]$watcher.Principal.UserId -ine $expectedPrincipal -or @($watcher.Actions).Count -ne 1) { Fail "Unexpected watcher principal/actions" }
$action = @($watcher.Actions)[0]
if ([IO.Path]::GetFileName([string]$action.Execute) -ine "powershell.exe") { Fail "Watcher executable identity mismatch" }
$working = [IO.Path]::GetFullPath([string]$action.WorkingDirectory).TrimEnd('\')
if ($working -ine $scriptRoot.TrimEnd('\') -and $working -ine $RepositoryPath.TrimEnd('\')) { Fail "Watcher working directory drift" }
$approved = '^-NoLogo\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File\s+"' +
    [regex]::Escape($expectedWatcher) + '"\s+-RepositoryPath\s+"' + [regex]::Escape($RepositoryPath) +
    '"\s+-Watch\s+-PollSeconds\s+\d+\s+-BuildMode\s+(?:Smart|ForceBuild|SkipBuild)' +
    '\s+-TunnelMode\s+(?:disabled|windows_service|docker_sidecar)(?:\s+-EnableActivationGateway)?$'
if (-not [regex]::IsMatch([string]$action.Arguments, $approved, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) { Fail "Existing Staging watcher task action/path does not match this checkout" }

$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$supervisorScript`" -RepositoryPath `"$RepositoryPath`" -IntervalSeconds $IntervalSeconds"
$installed = Get-ScheduledTask -TaskName $SupervisorTaskName -ErrorAction SilentlyContinue
if ($null -ne $installed) {
    $existingActions = @($installed.Actions)
    if ($existingActions.Count -ne 1 -or [string]$existingActions[0].Arguments -cne $arguments -or
        [IO.Path]::GetFileName([string]$existingActions[0].Execute) -ine "powershell.exe" -or
        [string]$installed.Principal.UserId -ine $expectedPrincipal) {
        Fail "Supervisor task exists with a different configuration; refusing overwrite"
    }
    Write-Host "STAGING_SUPERVISOR_ALREADY_INSTALLED: configuration=verified"
} else {
    $principal = New-ScheduledTaskPrincipal -UserId $expectedPrincipal -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    $taskAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME "powershell.exe") -Argument $arguments -WorkingDirectory $scriptRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $expectedPrincipal
    $trigger.Delay = "PT60S"
    Register-ScheduledTask -TaskName $SupervisorTaskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -ErrorAction Stop | Out-Null
    Write-Host "STAGING_SUPERVISOR_INSTALLED: existing_watcher_unchanged=True"
}
$readback = Get-ScheduledTask -TaskName $SupervisorTaskName -ErrorAction Stop
if (@($readback.Actions).Count -ne 1 -or [string]@($readback.Actions)[0].Arguments -cne $arguments) { Fail "Supervisor installation readback mismatch" }
if ($Activate -and [string]$readback.State -ne "Running") { Start-ScheduledTask -TaskName $SupervisorTaskName -ErrorAction Stop }
Write-Host "STAGING_SUPERVISOR_READBACK_PASS: task=$SupervisorTaskName active=$([bool]$Activate) unchanged_watcher=True provider_mutation=False production_mutation=False"
