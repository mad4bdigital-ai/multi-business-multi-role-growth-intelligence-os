param(
    [string]$RepositoryPath = "",
    [int]$IntervalSeconds = 60,
    [int]$MaxBackoffSeconds = 900,
    [switch]$Once
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$LogComponent = "health-monitor"
$script:HealthMonitorMutex = $null
$script:HealthStatePath = $null
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$apiPath = Join-Path $RepositoryPath "http-generic-api"
$envFile = Join-Path $apiPath ".env.staging"
$composeBase = Join-Path $apiPath "docker-compose.yml"
$composeStage = Join-Path $apiPath "docker-compose.staging.yml"
$script:HealthStatePath = Join-Path (Get-StagingLogRoot) "health-monitor-state.json"

function Acquire-HealthMonitorLock {
    try {
        $script:HealthMonitorMutex = New-Object System.Threading.Mutex($false, "Global\Mad4bStagingHealthMonitor")
        if (-not $script:HealthMonitorMutex.WaitOne(0)) { throw "another Health Monitor instance is already running" }
    } catch [System.Threading.AbandonedMutexException] {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "run-lock" -Message "recovered abandoned Health Monitor lock"
    } catch {
        throw "HEALTH_MONITOR_FAIL_CLOSED: $($_.Exception.Message)"
    }
}
function Release-HealthMonitorLock {
    if ($null -ne $script:HealthMonitorMutex) {
        try { $script:HealthMonitorMutex.ReleaseMutex() } catch { }
        try { $script:HealthMonitorMutex.Dispose() } catch { }
        $script:HealthMonitorMutex = $null
    }
}
function Read-HealthState {
    if (-not (Test-Path -LiteralPath $script:HealthStatePath)) {
        return [ordered]@{ schema_version = 2; status = "starting"; consecutive_failures = 0; suppressed_failures = 0; last_error = ""; last_logged_error = ""; failure_class = ""; last_failure_at = ""; last_transition_at = (Get-Date).ToUniversalTime().ToString("o") }
    }
    try { return Get-Content -Raw -LiteralPath $script:HealthStatePath | ConvertFrom-Json }
    catch { return [ordered]@{ schema_version = 2; status = "recovered_from_invalid_state"; consecutive_failures = 0; suppressed_failures = 0; last_error = "invalid prior health state"; last_logged_error = ""; failure_class = "state_invalid"; last_failure_at = ""; last_transition_at = (Get-Date).ToUniversalTime().ToString("o") } }
}
function Save-HealthState([object]$State) { Write-StagingAtomicJson $script:HealthStatePath $State 10 }
function Get-Env([string]$Name) {
    if (-not (Test-Path $envFile)) { return "" }
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -replace "^$([regex]::Escape($Name))=", "")
}
function Classify-HealthError([string]$Message) {
    if ($Message -match '(?i)docker|pipe|daemon|server') { return "docker_unavailable" }
    if ($Message -match '(?i)compose') { return "compose_invalid" }
    if ($Message -match '(?i)service') { return "service_unhealthy" }
    return "health_check_failed"
}
function Write-HealthFailure([string]$Message, [hashtable]$Data = @{}) {
    $state = Read-HealthState
    $state.consecutive_failures = [int]$state.consecutive_failures + 1
    $state.last_error = $Message
    $state.failure_class = Classify-HealthError $Message
    $state.status = "degraded"
    $state.last_failure_at = (Get-Date).ToUniversalTime().ToString("o")
    $shouldLog = ([int]$state.consecutive_failures -eq 1 -or ([int]$state.consecutive_failures % 5 -eq 0) -or [string]$state.last_logged_error -ne $Message)
    if (-not $shouldLog) { $state.suppressed_failures = [int]$state.suppressed_failures + 1 }
    if ($shouldLog) {
        $state.last_logged_error = $Message
        Write-StagingLog -Level error -Component $LogComponent -Stage "health-check" -Message $Message -Data ($Data + @{ failure_class = $state.failure_class; consecutive_failures = $state.consecutive_failures; suppressed_failures = $state.suppressed_failures })
        Write-Host "STAGING_HEALTH_FAILURE_LOGGED: class=$($state.failure_class) consecutive=$($state.consecutive_failures) suppressed=$($state.suppressed_failures)" -ForegroundColor Red
    }
    Save-HealthState $state
}
function Invoke-HealthCheck {
    $required = @("redis", "runtime-db", "governance-db", "persistence-db", "app")
    $snapshot = [ordered]@{
        schema_version = 2
        run_id = Get-StagingRunId
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        repository_path = $RepositoryPath
        docker_context = "unknown"
        services = @()
        tunnel_expected = ((Get-Env "CLOUDFLARE_TUNNEL_ENABLED") -eq "true")
        ok = $false
    }
    $state = Read-HealthState
    try {
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "docker command is missing" }
        if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { throw "remote Docker environment is forbidden" }
        $context = (& docker context show 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $context -notin @("default", "desktop-linux")) { throw "Docker context is not local: $context" }
        $server = (& docker info --format "{{.ServerVersion}}" 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($server)) { throw "Docker daemon is unavailable" }
        $snapshot.docker_context = $context
        $compose = @("compose", "-f", $composeBase, "-f", $composeStage, "--env-file", $envFile)
        & docker @compose config --quiet 2>$null
        if ($LASTEXITCODE -ne 0) { throw "Staging Compose model is invalid" }
        foreach ($service in $required) {
            $id = (& docker @compose ps -q $service 2>$null | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($id)) { throw "service container is missing: $service" }
            $health = (& docker inspect --format "{{.State.Health.Status}}" $id 2>$null | Out-String).Trim()
            $status = (& docker inspect --format "{{.State.Status}}" $id 2>$null | Out-String).Trim()
            $snapshot.services += [ordered]@{ service = $service; state = $status; health = $health }
            if ($health -ne "healthy" -or $status -ne "running") { throw "service is not healthy: $service state=$status health=$health" }
        }
        $snapshot.ok = $true
        if ([string]$state.status -eq "degraded") {
            Write-StagingLog -Level info -Component $LogComponent -Stage "recovery" -Message "Health Monitor recovered after Docker/service failure" -Data @{ previous_error = [string]$state.last_error; consecutive_failures = [int]$state.consecutive_failures; failure_class = [string]$state.failure_class }
        }
        $state.status = "healthy"
        $state.consecutive_failures = 0
        $state.suppressed_failures = 0
        $state.last_error = ""
        $state.last_logged_error = ""
        $state.last_transition_at = $snapshot.timestamp
        Save-HealthState $state
        Write-StagingHeartbeat -Component $LogComponent -Stage "health-check" -Data @{ services = ($required -join ","); docker_context = $context; recovery = $true }
        Write-StagingLog -Level info -Component $LogComponent -Stage "health-check" -Message "all required Staging services are healthy" -Data @{ services = ($required -join ","); docker_context = $context }
    } catch {
        $snapshot.ok = $false
        Write-HealthFailure $_.Exception.Message -Data @{ docker_context = $snapshot.docker_context }
    }
    Write-StagingAtomicJson (Get-StagingLogFile "health-snapshot.json") $snapshot 10
    return [bool]$snapshot.ok
}
function Get-NextDelay([object]$State) {
    if ([int]$State.consecutive_failures -le 0) { return [Math]::Max(30, $IntervalSeconds) }
    $exponent = [Math]::Min(4, [int]$State.consecutive_failures - 1)
    return [Math]::Min($MaxBackoffSeconds, [int]([Math]::Max(30, $IntervalSeconds) * [Math]::Pow(2, $exponent)))
}

if ($IntervalSeconds -lt 30) { throw "HEALTH_MONITOR_FAIL_CLOSED: interval must be at least 30 seconds" }
if ($MaxBackoffSeconds -lt $IntervalSeconds) { throw "HEALTH_MONITOR_FAIL_CLOSED: MaxBackoffSeconds cannot be below IntervalSeconds" }
Acquire-HealthMonitorLock
try {
    Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "health monitor started" -Data @{ interval_seconds = $IntervalSeconds; max_backoff_seconds = $MaxBackoffSeconds; once = [bool]$Once }
    while ($true) {
        $ok = Invoke-HealthCheck
        if ($Once) { if (-not $ok) { exit 1 }; exit 0 }
        $state = Read-HealthState
        $delay = Get-NextDelay $state
        Write-StagingLog -Level info -Component $LogComponent -Stage "sleep" -Message "health monitor sleeping" -Data @{ seconds = $delay; status = [string]$state.status; consecutive_failures = [int]$state.consecutive_failures }
        Start-Sleep -Seconds $delay
    }
} finally {
    Release-HealthMonitorLock
}
