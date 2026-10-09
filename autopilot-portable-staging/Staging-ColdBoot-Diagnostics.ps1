[CmdletBinding()]
param(
    [string]$RepositoryPath = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")

# Read-only observations. Never repair tasks, deploy Compose, rewrite DNS,
# change credentials, invoke Docker mutating commands or infer Production readiness.
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$now = [DateTimeOffset]::UtcNow

function Get-ColdBootTask([string]$Name, [bool]$Continuous) {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        return [ordered]@{ name = $Name; state = "missing"; last_result = $null; running = $false; last_run_failed = $false; continuous = $Continuous }
    }
    $info = Get-ScheduledTaskInfo -TaskName $Name -ErrorAction SilentlyContinue
    $running = ([string]$task.State -eq "Running")
    $lastResult = if ($null -ne $info) { [int64]$info.LastTaskResult } else { $null }
    return [ordered]@{
        name = $Name
        state = [string]$task.State
        last_result = $lastResult
        running = $running
        last_run_failed = ($null -ne $lastResult -and $lastResult -notin @(0, 267009) -and -not $running)
        continuous = $Continuous
    }
}
function Test-ColdBootDns([string]$HostName) {
    try {
        $addresses = @([System.Net.Dns]::GetHostAddresses($HostName))
        return ($addresses.Count -gt 0)
    } catch {
        return $false
    }
}
function Read-ColdBootEvidence([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop) }
    catch { return [pscustomobject]@{ invalid = $true } }
}

$tasks = @(
    (Get-ColdBootTask "MAD4B Staging Docker Bootstrap" $false),
    (Get-ColdBootTask "MAD4B Staging Auto Deploy" $true),
    (Get-ColdBootTask "MAD4B Staging Health Monitor" $true),
    (Get-ColdBootTask "MAD4B Staging Autonomous Supervisor" $true)
)
$repositoryAvailable = (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git") -PathType Container)
$dockerContext = "unavailable"
$dockerEngineReady = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    if (-not $env:DOCKER_HOST -and -not $env:DOCKER_CONTEXT) {
        $dockerContext = ((& docker context show 2>$null | Out-String).Trim())
        if ($LASTEXITCODE -eq 0 -and $dockerContext -in @("default", "desktop-linux")) {
            $serverVersion = ((& docker info --format '{{.ServerVersion}}' 2>$null | Out-String).Trim())
            $dockerEngineReady = ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($serverVersion))
        }
    } else {
        $dockerContext = "environment_override_forbidden"
    }
}
$logRoot = Get-StagingLogRoot
$transport = Read-ColdBootEvidence (Join-Path $logRoot "auto-deploy-transport.json")
$health = Read-ColdBootEvidence (Join-Path $logRoot "health-snapshot.json")
$acceptance = Read-ColdBootEvidence (Join-Path $logRoot "autonomous-acceptance.json")
$healthObserved = $null -ne $health -and $health.ok -eq $true -and $health.effective_ok -eq $true
$healthFresh = $false
if ($healthObserved) {
    $stamp = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse([string]$health.timestamp, [ref]$stamp)) {
        $age = ($now - $stamp.ToUniversalTime()).TotalSeconds
        $healthFresh = ($age -ge 0 -and $age -le 180)
    }
}
$missingTasks = @($tasks | Where-Object { $_.state -eq "missing" } | ForEach-Object { $_.name })
$stoppedWatchers = @($tasks | Where-Object { $_.continuous -and -not $_.running } | ForEach-Object { $_.name })
$failedTasks = @($tasks | Where-Object { $_.last_run_failed } | ForEach-Object { $_.name })
$dns = [ordered]@{
    auth_host_resolved = (Test-ColdBootDns "auth.mad4b.com")
    github_host_resolved = (Test-ColdBootDns "github.com")
}
$blockers = @()
if (-not $repositoryAvailable) { $blockers += "repository_unavailable" }
if (-not $dockerEngineReady) { $blockers += "docker_engine_unavailable" }
if ($missingTasks.Count -gt 0) { $blockers += "scheduled_task_missing" }
if ($stoppedWatchers.Count -gt 0) { $blockers += "continuous_task_not_running" }
if (-not $dns.github_host_resolved) { $blockers += "git_dns_unresolved" }
if (-not $dns.auth_host_resolved) { $blockers += "auth_dns_unresolved" }
if (-not $healthFresh) { $blockers += "live_staging_health_unproven" }
if ($null -eq $acceptance -or $acceptance.accepted -ne $true) { $blockers += "supervisor_acceptance_unproven" }
$report = [ordered]@{
    contract = "mad4b.staging-coldboot-diagnostics.v1"
    environment = "staging"
    checked_at = $now.ToString("o")
    status = if ($blockers.Count -gt 0) { "degraded" } else { "observed_healthy_not_certified" }
    tasks = $tasks
    repository_available = $repositoryAvailable
    docker_context = $dockerContext
    docker_engine_ready = $dockerEngineReady
    dns = $dns
    missing_tasks = $missingTasks
    stopped_watchers = $stoppedWatchers
    failed_task_history = $failedTasks
    last_git_transport_status = if ($null -ne $transport) { [string]$transport.status } else { "unobserved" }
    staging_health_fresh = $healthFresh
    supervisor_acceptance = if ($null -ne $acceptance) { [string]$acceptance.status } else { "missing" }
    blockers = $blockers
    read_only = $true
    production_mutation_allowed = $false
    provider_mutation_allowed = $false
    device_generation_certified = $false
    production_promotion_authorized = $false
    secrets_included = $false
}
Write-StagingAtomicJson (Join-Path $logRoot "coldboot-diagnostics.json") $report 10
$report | ConvertTo-Json -Depth 10
