[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$WatcherTaskName = "MAD4B Staging Auto Deploy",
    [string]$SupervisorTaskName = "MAD4B Staging Autonomous Supervisor",
    [ValidateRange(30, 600)][int]$IntervalSeconds = 60,
    [switch]$Activate,
    [switch]$DiagnoseOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail([string]$Message) { throw "STAGING_AUTONOMOUS_INSTALL_BLOCKED: $Message" }
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot "Staging-TaskPrincipalIdentity.ps1")
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $scriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$expectedWatcher = [IO.Path]::GetFullPath((Join-Path $scriptRoot "Auto-Deploy-Staging.ps1"))
$supervisorScript = [IO.Path]::GetFullPath((Join-Path $scriptRoot "Staging-AutonomousSupervisor.ps1"))
if (-not (Test-Path -LiteralPath $supervisorScript -PathType Leaf)) { Fail "Supervisor source file missing" }
$policyPath = Join-Path $scriptRoot "autonomous-operations-policy.json"
$policy = Get-Content -Raw -LiteralPath $policyPath | ConvertFrom-Json -ErrorAction Stop
if ($policy.contract -ne "mad4b.staging-autonomous-operations.v1" -or $policy.environment -ne "staging") { Fail "Policy identity mismatch" }
if ($WatcherTaskName -cne [string]$policy.watcher_task_name -or $SupervisorTaskName -cne "MAD4B Staging Autonomous Supervisor") { Fail "Custom task names are outside the governed supervisor policy" }
foreach ($flag in @("production_mutation", "database_mutation", "migration_apply", "provider_mutation", "cloudflare_dns_mutation", "secret_logging")) {
    if ($policy.safety.$flag -ne $false) { Fail "Unsafe supervisor policy: $flag" }
}
$trustedPowerShell = [IO.Path]::GetFullPath((Join-Path $PSHOME "powershell.exe"))
$expectedPrincipal = "$env:USERDOMAIN\$env:USERNAME"
# Only root tasks are canonical. Reject ambiguous or malformed task records.
$watchers = @(Get-ScheduledTask -TaskPath "\" -TaskName $WatcherTaskName -ErrorAction SilentlyContinue)
$watcherCount = $watchers.Count
$watcher = if ($watcherCount -eq 1) { $watchers[0] } else { $null }
$actionCount = if ($null -ne $watcher) { @($watcher.Actions).Count } else { 0 }
$principalVerified = $false
$logonVerified = $false
$executableVerified = $false
$workingVerified = $false
$argumentsVerified = $false
$sourceRoot = [IO.Path]::GetFullPath([string]$scriptRoot).TrimEnd('\')
$targetRoot = [IO.Path]::GetFullPath([string]$RepositoryPath).TrimEnd('\')
if ($null -ne $watcher) {
    $principalVerified = Test-StagingTaskPrincipalIsCurrentUser ([string]$watcher.Principal.UserId)
    $logonVerified = ([string]$watcher.Principal.LogonType -eq "Interactive")
}
if ($actionCount -eq 1) {
    $action = @($watcher.Actions)[0]
    try {
        $executableVerified = ([IO.Path]::GetFullPath([string]$action.Execute) -ieq $trustedPowerShell)
        $working = [IO.Path]::GetFullPath([string]$action.WorkingDirectory).TrimEnd('\')
        $workingVerified = ($working -ieq $sourceRoot -or $working -ieq $targetRoot)
        $approved = '^-NoLogo\s+-NoProfile(?:\s+-WindowStyle\s+Hidden)?\s+-ExecutionPolicy\s+Bypass\s+-File\s+"' +
            [regex]::Escape($expectedWatcher) + '"\s+-RepositoryPath\s+"' + [regex]::Escape($RepositoryPath) +
            '"\s+-Watch\s+-PollSeconds\s+\d+\s+-BuildMode\s+(?:Smart|ForceBuild|SkipBuild)' +
            '\s+-TunnelMode\s+(?:disabled|windows_service|docker_sidecar)(?:\s+-EnableActivationGateway)?$'
        $argumentsVerified = [regex]::IsMatch([string]$action.Arguments, $approved, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    } catch {
        $executableVerified = $false
        $workingVerified = $false
        $argumentsVerified = $false
    }
}
if ($DiagnoseOnly) {
    $ready = ($watcherCount -eq 1 -and $actionCount -eq 1 -and $principalVerified -and
        $logonVerified -and $executableVerified -and $workingVerified -and $argumentsVerified)
    [ordered]@{
        contract = "mad4b.staging-supervisor-additive-preflight.v1"
        status = if ($ready) { "eligible_for_explicit_install" } else { "blocked" }
        watcher_task_count = $watcherCount
        watcher_action_count = $actionCount
        watcher_principal_same_windows_sid = $principalVerified
        watcher_logon_type_interactive = $logonVerified
        watcher_executable_verified = $executableVerified
        watcher_working_directory_verified = $workingVerified
        watcher_exact_arguments_verified = $argumentsVerified
        diagnostic_only = $true
        task_registered = $false
        production_mutation_allowed = $false
        secrets_included = $false
    } | ConvertTo-Json -Depth 5
    return
}
if ($watcherCount -ne 1) { Fail "watcher_task_count_invalid" }
if ($actionCount -ne 1) { Fail "watcher_action_count_invalid" }
if (-not $principalVerified) { Fail "watcher_principal_sid_mismatch" }
if (-not $logonVerified) { Fail "watcher_noninteractive_logon" }
if (-not $executableVerified) { Fail "watcher_executable_mismatch" }
if (-not $workingVerified) { Fail "watcher_working_directory_mismatch" }
if (-not $argumentsVerified) { Fail "watcher_arguments_mismatch" }

$arguments = "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$supervisorScript`" -RepositoryPath `"$RepositoryPath`" -IntervalSeconds $IntervalSeconds"
$installed = Get-ScheduledTask -TaskPath "\" -TaskName $SupervisorTaskName -ErrorAction SilentlyContinue
if ($null -ne $installed) {
    $existingActions = @($installed.Actions)
    if ($existingActions.Count -ne 1 -or [string]$existingActions[0].Arguments -cne $arguments -or
        [IO.Path]::GetFullPath([string]$existingActions[0].Execute) -ine $trustedPowerShell -or
        [IO.Path]::GetFullPath([string]$existingActions[0].WorkingDirectory).TrimEnd('\') -ine $sourceRoot -or
        -not (Test-StagingTaskPrincipalIsCurrentUser ([string]$installed.Principal.UserId)) -or
        [string]$installed.Principal.LogonType -ne "Interactive" -or
        [string]$installed.Principal.RunLevel -ne "Highest") {
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
$readback = Get-ScheduledTask -TaskPath "\" -TaskName $SupervisorTaskName -ErrorAction Stop
if (@($readback.Actions).Count -ne 1 -or [string]@($readback.Actions)[0].Arguments -cne $arguments -or
    [IO.Path]::GetFullPath([string]@($readback.Actions)[0].Execute) -ine $trustedPowerShell -or
    [IO.Path]::GetFullPath([string]@($readback.Actions)[0].WorkingDirectory).TrimEnd('\') -ine $sourceRoot -or
    -not (Test-StagingTaskPrincipalIsCurrentUser ([string]$readback.Principal.UserId))) { Fail "Supervisor installation readback mismatch" }
if ($Activate -and [string]$readback.State -ne "Running") { Start-ScheduledTask -TaskPath "\" -TaskName $SupervisorTaskName -ErrorAction Stop }
Write-Host "STAGING_SUPERVISOR_READBACK_PASS: task=$SupervisorTaskName active=$([bool]$Activate) unchanged_watcher=True provider_mutation=False production_mutation=False"
