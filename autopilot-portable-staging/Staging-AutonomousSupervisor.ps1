[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [int]$IntervalSeconds = 60,
    [switch]$Once,
    [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$LogComponent = "autonomous-supervisor"
$script:SupervisorMutex = $null
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$policyPath = Join-Path $PSScriptRoot "autonomous-operations-policy.json"
$Policy = Get-Content -Raw -LiteralPath $policyPath | ConvertFrom-Json -ErrorAction Stop
if ($Policy.contract -ne "mad4b.staging-autonomous-operations.v1" -or $Policy.environment -ne "staging") {
    throw "AUTONOMOUS_SUPERVISOR_BLOCKED: policy contract/environment mismatch"
}
foreach ($forbidden in @("production_mutation", "database_mutation", "migration_apply", "provider_mutation", "cloudflare_dns_mutation", "secret_logging")) {
    if ($Policy.safety.$forbidden -ne $false) { throw "AUTONOMOUS_SUPERVISOR_BLOCKED: unsafe policy" }
}
if ($IntervalSeconds -lt 30) { throw "AUTONOMOUS_SUPERVISOR_BLOCKED: interval below 30 seconds" }
$scriptRoot = $PSScriptRoot
$logRoot = Get-StagingLogRoot
$statePath = Join-Path $logRoot "autonomous-supervisor-state.json"
$acceptancePath = Join-Path $logRoot "autonomous-acceptance.json"
$leasePath = Join-Path $logRoot "deployment-lease.json"
$healthPath = Join-Path $logRoot "health-snapshot.json"
$deployPath = Join-Path $PSScriptRoot "auto-deploy-state.json"
$runtimePath = Join-Path $PSScriptRoot "autopilot-state.json"
$operationsPath = Join-Path $logRoot "operations.jsonl"
$expectedScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "Auto-Deploy-Staging.ps1"))
$expectedPrincipal = "$env:USERDOMAIN\$env:USERNAME"

function Get-Prop([object]$Value, [string]$Name) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Collections.IDictionary]) { return $Value[$Name] }
    $p = $Value.PSObject.Properties[$Name]
    if ($null -eq $p) { return $null }
    return $p.Value
}
function Read-Evidence([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    # Corrupt evidence must block acceptance, not silently become "missing".
    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -ErrorAction Stop
}
function Get-Time([object]$Value) {
    $result = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$Value, [ref]$result)) { return [DateTimeOffset]::MinValue }
    return $result.ToUniversalTime()
}
function Test-WatcherTaskIdentity([object]$Task) {
    if ($null -eq $Task -or @($Task.Actions).Count -ne 1) { return $false }
    $action = @($Task.Actions)[0]
    $arguments = [string]$action.Arguments
    if ([IO.Path]::GetFileName([string]$action.Execute) -ine "powershell.exe") { return $false }
    $working = [IO.Path]::GetFullPath([string]$action.WorkingDirectory).TrimEnd('\')
    if ($working -ine $scriptRoot.TrimEnd('\') -and $working -ine $RepositoryPath.TrimEnd('\')) { return $false }
    if ([string]$Task.Principal.UserId -ine $expectedPrincipal) { return $false }
    # Permit only the exact expected script and working checkout, never an arbitrary -Command.
    $scriptRegex = [regex]::Escape($expectedScript)
    $repoRegex = [regex]::Escape($RepositoryPath)
    # Exact approved action, no appended switches, injected command or new target.
    $approved = '^-NoLogo\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File\s+"' + $scriptRegex +
        '"\s+-RepositoryPath\s+"' + $repoRegex +
        '"\s+-Watch\s+-PollSeconds\s+\d+\s+-BuildMode\s+(?:Smart|ForceBuild|SkipBuild)' +
        '\s+-TunnelMode\s+(?:disabled|windows_service|docker_sidecar)(?:\s+-EnableActivationGateway)?$'
    return [regex]::IsMatch($arguments, $approved, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
}
function Get-RecentWatcherEvidence([DateTimeOffset]$Now, [DateTimeOffset]$LastTaskStart) {
    $result = [ordered]@{ cycles = 0; sleeps = 0; new_errors = 0; latest_poll = $null; latest_sleep = $null; run_id = ""; fresh = $false }
    if (-not (Test-Path -LiteralPath $operationsPath -PathType Leaf)) { return $result }
    $records = @()
    foreach ($line in @(Get-Content -LiteralPath $operationsPath -Tail 1500 -ErrorAction Stop)) {
        try {
            $obj = $line | ConvertFrom-Json -ErrorAction Stop
            if ([string]$obj.component -eq "auto-deploy") { $records += $obj }
        } catch { continue }
    }
    $polls = @($records | Where-Object { $_.stage -eq "poll" -and (Get-Time $_.timestamp) -ge $LastTaskStart })
    if ($polls.Count -eq 0) { return $result }
    $lastPoll = $polls[-1]
    $runId = [string]$lastPoll.run_id
    if ([string]::IsNullOrWhiteSpace($runId)) { return $result }
    $sameRun = @($records | Where-Object { [string]$_.run_id -eq $runId -and (Get-Time $_.timestamp) -ge $LastTaskStart })
    $polls = @($sameRun | Where-Object { $_.stage -eq "poll" })
    $sleeps = @($sameRun | Where-Object { $_.stage -eq "sleep" })
    $minCycles = [int]$Policy.minimum_distinct_poll_cycles
    $recentPolls = @($polls | Select-Object -Last $minCycles)
    $windowStart = if ($recentPolls.Count -eq $minCycles) { Get-Time $recentPolls[0].timestamp } else { $LastTaskStart }
    $recentSleeps = @($sleeps | Where-Object { (Get-Time $_.timestamp) -ge $windowStart })
    $errors = @($sameRun | Where-Object { (Get-Time $_.timestamp) -ge $windowStart -and ($_.level -eq "error" -or $_.stage -eq "fail_closed") })
    $result.cycles = $recentPolls.Count
    $result.sleeps = $recentSleeps.Count
    $result.new_errors = $errors.Count
    $result.run_id = $runId
    $result.latest_poll = [string]$polls[-1].timestamp
    if ($recentSleeps.Count -gt 0) { $result.latest_sleep = [string]$recentSleeps[-1].timestamp }
    $age = ($Now - (Get-Time $result.latest_poll)).TotalSeconds
    $result.fresh = ($age -ge 0 -and $age -le [int]$Policy.watcher_stale_after_seconds)
    return $result
}
function Get-ActiveLease([DateTimeOffset]$Now) {
    $lease = Read-Evidence $leasePath
    if ($null -eq $lease) { return $false }
    if ([string]$lease.contract -ne "mad4b.staging-deployment-lease.v1") { throw "Unexpected deployment lease contract" }
    $expiry = Get-Time (Get-Prop $lease "expires_at")
    if ($expiry -eq [DateTimeOffset]::MinValue) { throw "Invalid deployment lease expiry" }
    return ($expiry -gt $Now)
}
function Get-Acceptance([DateTimeOffset]$Now, [object]$Task, [object]$TaskInfo) {
    $reasons = New-Object System.Collections.Generic.List[string]
    $running = $null -ne $Task -and [string]$Task.State -eq "Running"
    $taskIdentity = $false
    try { $taskIdentity = Test-WatcherTaskIdentity $Task } catch { $taskIdentity = $false }
    if (-not $taskIdentity) { [void]$reasons.Add("watcher_task_identity_invalid") }
    if (-not $running) { [void]$reasons.Add("watcher_not_running") }
    $startTime = if ($null -ne $TaskInfo) { Get-Time $TaskInfo.LastRunTime } else { [DateTimeOffset]::MinValue }
    if ($startTime -eq [DateTimeOffset]::MinValue) { [void]$reasons.Add("watcher_start_unproven") }
    $evidence = Get-RecentWatcherEvidence $Now $startTime
    if ($evidence.cycles -lt [int]$Policy.minimum_distinct_poll_cycles -or $evidence.sleeps -lt [int]$Policy.minimum_distinct_poll_cycles) { [void]$reasons.Add("watcher_continuity_unproven") }
    if (-not $evidence.fresh) { [void]$reasons.Add("watcher_poll_stale") }
    if ($evidence.new_errors -ne 0) { [void]$reasons.Add("watcher_errors_observed") }

    $health = Read-Evidence $healthPath
    if ($null -eq $health -or $health.ok -ne $true -or $health.effective_ok -ne $true) { [void]$reasons.Add("staging_health_not_ready") }
    if ($null -ne $health) {
        $healthAge = ($Now - (Get-Time $health.timestamp)).TotalSeconds
        if ($healthAge -lt 0 -or $healthAge -gt [int]$Policy.health_stale_after_seconds) { [void]$reasons.Add("staging_health_stale") }
        if ((Get-Prop (Get-Prop $health "lifecycle") "grace_active") -eq $true) { [void]$reasons.Add("deployment_grace_active") }
    }
    $deploy = Read-Evidence $deployPath
    $runtime = Read-Evidence $runtimePath
    $desired = ([string](Get-Prop $deploy "desired_commit")).ToLowerInvariant()
    $deployed = ([string](Get-Prop $deploy "deployed_commit")).ToLowerInvariant()
    $certified = ([string](Get-Prop $deploy "certified_commit")).ToLowerInvariant()
    $runtimeCommit = ([string](Get-Prop $runtime "commit")).ToLowerInvariant()
    if ($desired -notmatch '^[0-9a-f]{40}$' -or $desired -ne $deployed -or $desired -ne $certified -or $desired -ne $runtimeCommit -or
        [string](Get-Prop $deploy "overall") -ne "ready" -or [string](Get-Prop $deploy "certification_status") -ne "ready" -or
        [string](Get-Prop $runtime "certification_status") -ne "ready" -or
        (Get-Prop $deploy "certification_ready") -ne $true -or
        (Get-Prop $runtime "certification_ready") -ne $true -or [string](Get-Prop $deploy "ref") -ne [string]$Policy.expected_ref) {
        [void]$reasons.Add("exact_commit_certification_not_ready")
    }
    foreach ($key in @("production_deploy", "database_mutated", "migration_applied", "ruleset_mutation")) {
        if ((Get-Prop $deploy $key) -ne $false) { [void]$reasons.Add("forbidden_deploy_flag_$key") }
    }
    $leaseActive = Get-ActiveLease $Now
    if ($leaseActive) { [void]$reasons.Add("deployment_lease_active") }
    $status = if ($reasons.Count -eq 0) { "operational_ready" } elseif ($reasons.Contains("watcher_task_identity_invalid") -or $reasons.Contains("forbidden_deploy_flag_production_deploy")) { "blocked" } else { "degraded" }
    return [ordered]@{
        contract = "mad4b.staging-autonomous-acceptance.v1"
        environment = "staging"
        checked_at = $Now.ToString("o")
        status = $status
        accepted = ($reasons.Count -eq 0)
        full_runtime_integrity_attested = $false
        runtime_integrity_note = "Operational readiness is distinct from independent artifact content attestation."
        reasons = @($reasons.ToArray())
        watcher = $evidence
        task_running = $running
        task_identity_verified = $taskIdentity
        lease_active = $leaseActive
        desired_commit = if ($desired -match '^[0-9a-f]{40}$') { $desired } else { $null }
        production_mutation = $false
        database_mutation = $false
        provider_mutation = $false
        secrets_included = $false
    }
}
function Recover-Watcher([DateTimeOffset]$Now, [object]$Task, [object]$Decision) {
    $history = Read-Evidence $statePath
    $prior = @()
    if ($null -ne $history) { $prior = @((Get-Prop $history "attempts_utc")) }
    $attempts = @($prior | Where-Object { (Get-Time $_) -gt $Now.AddHours(-24) -and (Get-Time $_) -le $Now })
    $result = "none"
    if (-not [bool]$Policy.recovery.start_stopped_watcher) { $result = "disabled" }
    elseif ($null -eq $Task -or [string]$Task.State -ne "Ready") { $result = "not_eligible" }
    elseif (-not $Decision.task_identity_verified -or $Decision.lease_active) { $result = "blocked_by_authority" }
    elseif ($Task.Settings.Enabled -eq $false) { $result = "disabled_task" }
    elseif ($attempts.Count -ge [int]$Policy.recovery.max_starts_per_24_hours) { $result = "attempt_limit" }
    elseif ($attempts.Count -gt 0 -and ($Now - (Get-Time $attempts[-1])).TotalSeconds -lt [int]$Policy.recovery.cooldown_seconds) { $result = "cooldown" }
    elseif ($DryRun) { $result = "dry_run" }
    else {
        # Persist attempt BEFORE any side effect. Never re-register or rewrite scheduled tasks.
        $attempts += $Now.ToString("o")
        Write-StagingAtomicJson $statePath ([ordered]@{
            contract = "mad4b.staging-autonomous-recovery-state.v1"
            attempts_utc = @($attempts)
            last_action = "start_existing_task"
            last_attempt_at = $Now.ToString("o")
            secrets_included = $false
        }) 8
        Start-ScheduledTask -TaskName ([string]$Policy.watcher_task_name) -ErrorAction Stop
        Write-StagingLog -Level warning -Component $LogComponent -Stage "recovery" -Message "started existing validated Staging watcher task" -Data @{ action = "start_existing_task"; attempts_24h = $attempts.Count }
        $result = "start_requested"
    }
    return $result
}
function Invoke-SupervisorCycle {
    $now = [DateTimeOffset]::UtcNow
    $task = Get-ScheduledTask -TaskName ([string]$Policy.watcher_task_name) -ErrorAction SilentlyContinue
    $taskInfo = if ($null -ne $task) { Get-ScheduledTaskInfo -TaskName ([string]$Policy.watcher_task_name) -ErrorAction SilentlyContinue } else { $null }
    $decision = Get-Acceptance $now $task $taskInfo
    $recovery = Recover-Watcher $now $task $decision
    $decision["recovery_action"] = $recovery
    if ($recovery -eq "start_requested") { $decision.status = "observing"; $decision.accepted = $false }
    Write-StagingAtomicJson $acceptancePath $decision 10
    Write-StagingHeartbeat -Component $LogComponent -Stage "acceptance" -Data @{ status = $decision.status; accepted = $decision.accepted; reasons = ($decision.reasons -join ","); recovery = $recovery }
    Write-Output ($decision | ConvertTo-Json -Depth 10 -Compress)
}
$mutexAcquired = $false
try {
    $script:SupervisorMutex = New-Object System.Threading.Mutex($false, "Global\Mad4bStagingAutonomousSupervisor")
    try { $mutexAcquired = $script:SupervisorMutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $mutexAcquired = $true }
    if (-not $mutexAcquired) { throw "AUTONOMOUS_SUPERVISOR_BLOCKED: another instance is active" }
    do {
        try {
            Invoke-SupervisorCycle
        } catch {
            # Invalid JSON, inconsistent authority or inaccessible scheduler all fail closed.
            Write-StagingLog -Level error -Component $LogComponent -Stage "acceptance" -Message "autonomous acceptance failed closed" -Data @{ failure_class = "autonomous_acceptance_failed"; error_type = $_.Exception.GetType().Name }
            Write-StagingAtomicJson $acceptancePath ([ordered]@{
                contract = "mad4b.staging-autonomous-acceptance.v1"
                environment = "staging"
                checked_at = ([DateTimeOffset]::UtcNow.ToString("o"))
                status = "blocked"
                accepted = $false
                reasons = @("supervisor_evidence_or_authority_invalid")
                secrets_included = $false
            }) 5
            if ($Once) { throw }
        }
        if (-not $Once) { Start-Sleep -Seconds $IntervalSeconds }
    } while (-not $Once)
} finally {
    if ($mutexAcquired -and $null -ne $script:SupervisorMutex) { try { $script:SupervisorMutex.ReleaseMutex() } catch { } }
    if ($null -ne $script:SupervisorMutex) { $script:SupervisorMutex.Dispose() }
}
