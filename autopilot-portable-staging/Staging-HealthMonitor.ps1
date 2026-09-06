param(
    [string]$RepositoryPath = "",
    [int]$IntervalSeconds = 60,
    [int]$MaxBackoffSeconds = 900,
    [ValidateRange(60, 600)]
    [int]$BootGraceSeconds = 180,
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
$runtimeStatePath = Join-Path $PSScriptRoot "autopilot-state.json"
$script:HealthStatePath = Join-Path (Get-StagingLogRoot) "health-monitor-state.json"
$deploymentLeasePath = Join-Path (Get-StagingLogRoot) "deployment-lease.json"

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
function New-HealthState([string]$Status = "starting") {
    $now = [DateTime]::UtcNow
    return @{
        schema_version = 3
        status = $Status
        consecutive_failures = 0
        suppressed_failures = 0
        last_error = ""
        last_logged_error = ""
        failure_class = ""
        last_failure_class = ""
        last_failure_at = ""
        last_transition_at = $now.ToString("o")
        monitor_started_at = $now.ToString("o")
        grace_deadline = $now.AddSeconds($BootGraceSeconds).ToString("o")
    }
}
function Read-HealthState {
    if (-not (Test-Path -LiteralPath $script:HealthStatePath)) { return New-HealthState }
    try {
        $parsed = Get-Content -Raw -LiteralPath $script:HealthStatePath | ConvertFrom-Json
        $state = @{}
        foreach ($property in $parsed.PSObject.Properties) { $state[$property.Name] = $property.Value }
        foreach ($key in (New-HealthState).Keys) {
            if (-not $state.ContainsKey($key)) { $state[$key] = (New-HealthState)[$key] }
        }
        return $state
    } catch {
        $state = New-HealthState "recovered_from_invalid_state"
        $state.last_error = "invalid prior health state"
        $state.last_failure_class = "state_invalid"
        return $state
    }
}
function Save-HealthState([object]$State) { Write-StagingAtomicJson $script:HealthStatePath $State 10 }
function Get-Env([string]$Name) {
    if (-not (Test-Path $envFile)) { return "" }
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -replace "^$([regex]::Escape($Name))=", "")
}
function Get-ObjectProperty([object]$Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}
function Read-JsonFileSafe([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { return $null }
}
function Classify-HealthError([string]$Message) {
    if ($Message -match '(?i)cloudflare[_ -]?1033|\b1033\b') { return "connector_tunnel_cloudflare_1033" }
    if ($Message -match '(?i)local connector tunnel|connector\.mad4b\.com') { return "connector_tunnel_unhealthy" }
    if ($Message -match '(?i)staging tunnel|dev\.mad4b\.com|mcp-dev\.mad4b\.com') { return "staging_tunnel_unhealthy" }
    if ($Message -match '(?i)GATEWAY_POLICY_STALE|activation gateway.*stale|gateway.*policy.*stale') { return "activation_policy_stale" }
    if ($Message -match '(?i)activation gateway|gateway health') { return "activation_gateway_unavailable" }
    if ($Message -match '(?i)docker|pipe|daemon|server') { return "docker_unavailable" }
    if ($Message -match '(?i)compose') { return "compose_invalid" }
    if ($Message -match '(?i)service') { return "service_unhealthy" }
    return "health_check_failed"
}
function Get-ActiveLifecycleContext([hashtable]$State) {
    $now = [DateTime]::UtcNow
    $lease = Read-JsonFileSafe $deploymentLeasePath
    if ($null -ne $lease) {
        $expires = [DateTime]::MinValue
        if ([DateTime]::TryParse([string]$lease.expires_at, [ref]$expires) -and $expires.ToUniversalTime() -gt $now) {
            return [pscustomobject]@{
                grace_active = $true
                source = "deployment_lease"
                status = if ([string]$lease.status -in @("bootstrapping", "deploying", "converging", "certifying")) { [string]$lease.status } else { "deploying" }
                stage = [string]$lease.stage
                expected_commit = [string]$lease.expected_commit
                deadline = $expires.ToUniversalTime().ToString("o")
            }
        }
    }
    $deadline = [DateTime]::MinValue
    if ([DateTime]::TryParse([string]$State.grace_deadline, [ref]$deadline) -and $deadline.ToUniversalTime() -gt $now) {
        return [pscustomobject]@{
            grace_active = $true
            source = "boot_grace"
            status = "bootstrapping"
            stage = "windows_logon"
            expected_commit = ""
            deadline = $deadline.ToUniversalTime().ToString("o")
        }
    }
    return [pscustomobject]@{ grace_active = $false; source = "none"; status = "steady_state"; stage = "health"; expected_commit = ""; deadline = "" }
}
function Write-HealthFailure([string]$Message, [hashtable]$Data = @{}) {
    $state = Read-HealthState
    $lifecycle = Get-ActiveLifecycleContext $state
    $failureClass = Classify-HealthError $Message
    $startupSensitive = $failureClass -in @("docker_unavailable", "service_unhealthy", "staging_tunnel_unhealthy", "connector_tunnel_unhealthy", "connector_tunnel_cloudflare_1033")
    if ($lifecycle.grace_active -and $startupSensitive) {
        $previousStatus = [string]$state.status
        $state.status = [string]$lifecycle.status
        $state.failure_class = ""
        $state.last_error = ""
        $state.last_transition_at = (Get-Date).ToUniversalTime().ToString("o")
        if ($previousStatus -ne $state.status) {
            Write-StagingLog -Level info -Component $LogComponent -Stage "lifecycle-grace" -Message "transient startup health state suppressed inside bounded grace" -Data ($Data + @{
                lifecycle_status = $state.status
                lifecycle_source = $lifecycle.source
                lifecycle_stage = $lifecycle.stage
                grace_deadline = $lifecycle.deadline
                transient_class = $failureClass
            })
        }
        Save-HealthState $state
        return $true
    }

    $state.consecutive_failures = [int]$state.consecutive_failures + 1
    $state.last_error = $Message
    $state.failure_class = $failureClass
    $state.last_failure_class = $failureClass
    $state.status = "degraded"
    $state.last_failure_at = (Get-Date).ToUniversalTime().ToString("o")
    $shouldLog = ([int]$state.consecutive_failures -eq 1 -or ([int]$state.consecutive_failures % 5 -eq 0) -or [string]$state.last_logged_error -ne $Message)
    if (-not $shouldLog) { $state.suppressed_failures = [int]$state.suppressed_failures + 1 }
    if ($shouldLog) {
        $state.last_logged_error = $Message
        Write-StagingLog -Level error -Component $LogComponent -Stage "health-check" -Message $Message -Data ($Data + @{ failure_class = $failureClass; consecutive_failures = $state.consecutive_failures; suppressed_failures = $state.suppressed_failures })
        Write-Host "STAGING_HEALTH_FAILURE_LOGGED: class=$failureClass consecutive=$($state.consecutive_failures) suppressed=$($state.suppressed_failures)" -ForegroundColor Red
    }
    Save-HealthState $state
    return $false
}
function Get-WebFailureText([object]$ErrorRecord) {
    $text = [string]$ErrorRecord.Exception.Message
    try {
        $response = $ErrorRecord.Exception.Response
        if ($null -ne $response) {
            $stream = $response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                $body = $reader.ReadToEnd()
                if (-not [string]::IsNullOrWhiteSpace($body)) { $text += " $body" }
            }
        }
    } catch { }
    return $text
}
function Invoke-RemoteHealthProbe([string]$Uri) {
    try {
        $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        return [pscustomobject]@{ ok = ([int]$response.StatusCode -eq 200); status_code = [int]$response.StatusCode; error = $null }
    } catch {
        $statusCode = $null
        try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch { }
        $failureText = Get-WebFailureText $_
        $errorClass = if ($failureText -match '(?i)\b1033\b' -or $statusCode -eq 530) { "cloudflare_1033" } else { "remote_unavailable" }
        return [pscustomobject]@{ ok = $false; status_code = $statusCode; error = $errorClass }
    }
}
function Get-StagingTunnelSnapshot([string[]]$ComposeArgs, [object]$RuntimeState) {
    $expectedFromRuntime = $null -ne $RuntimeState -and (Get-ObjectProperty $RuntimeState "tunnel_started") -eq $true
    $expectedFromEnv = (Get-Env "CLOUDFLARE_TUNNEL_ENABLED").ToLowerInvariant() -eq "true"
    $expected = [bool]($expectedFromRuntime -or $expectedFromEnv)
    $snapshot = [ordered]@{
        expected = $expected
        hostnames = @("dev.mad4b.com", "mcp-dev.mad4b.com")
        status = if ($expected) { "checking" } else { "not_expected" }
        runtime = "none"
        remote_health = "not_checked"
        error = $null
    }
    if (-not $expected) { return $snapshot }

    $dockerRunning = $false
    $containerId = (& docker @($ComposeArgs + @("ps", "-q", "cloudflared")) 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($containerId)) {
        $running = (& docker inspect --format "{{.State.Running}}" $containerId 2>$null | Out-String).Trim().ToLowerInvariant()
        if ($LASTEXITCODE -eq 0 -and $running -eq "true") { $dockerRunning = $true; $snapshot.runtime = "docker" }
    }
    if (-not $dockerRunning) {
        $windowsService = Get-Service -Name "Mad4B-Staging-Cloudflared" -ErrorAction SilentlyContinue
        if ($null -ne $windowsService -and $windowsService.Status -eq "Running") { $snapshot.runtime = "windows_service" }
    }
    $runtimeReady = $snapshot.runtime -ne "none"
    $remote = Invoke-RemoteHealthProbe "https://dev.mad4b.com/health"
    $snapshot.remote_health = if ($remote.ok) { "healthy" } else { "unhealthy" }
    if ($runtimeReady -and $remote.ok) {
        $snapshot.status = "healthy"
    } else {
        $snapshot.status = "unhealthy"
        $snapshot.error = if (-not $runtimeReady) { "runtime_not_running" } else { [string]$remote.error }
    }
    return $snapshot
}
function Get-LocalConnectorTunnelSnapshot {
    $nodeService = Get-Service -Name "local-connector" -ErrorAction SilentlyContinue
    $cloudflaredService = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    $nodeTask = Get-ScheduledTask -TaskName "GrowthIntelligence-LocalConnector" -ErrorAction SilentlyContinue
    $tunnelTask = Get-ScheduledTask -TaskName "GrowthIntelligence-CloudflaredTunnel" -ErrorAction SilentlyContinue
    $remote = Invoke-RemoteHealthProbe "https://connector.mad4b.com/health"
    $runtimeEvidence = @()
    if ($null -ne $nodeService) { $runtimeEvidence += "service:local-connector=$($nodeService.Status)" }
    if ($null -ne $cloudflaredService) { $runtimeEvidence += "service:cloudflared=$($cloudflaredService.Status)" }
    if ($null -ne $nodeTask) { $runtimeEvidence += "task:GrowthIntelligence-LocalConnector=$($nodeTask.State)" }
    if ($null -ne $tunnelTask) { $runtimeEvidence += "task:GrowthIntelligence-CloudflaredTunnel=$($tunnelTask.State)" }
    return [ordered]@{
        expected = $true
        hostname = "connector.mad4b.com"
        status = if ($remote.ok) { "healthy" } else { "unhealthy" }
        http_status = $remote.status_code
        error = $remote.error
        runtime_evidence = $runtimeEvidence
    }
}
function Invoke-HealthCheck {
    $required = @("redis", "runtime-db", "governance-db", "persistence-db", "app")
    $state = Read-HealthState
    $lifecycle = Get-ActiveLifecycleContext $state
    $runtimeState = Read-JsonFileSafe $runtimeStatePath
    $snapshot = [ordered]@{
        schema_version = 3
        run_id = Get-StagingRunId
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        repository_path = $RepositoryPath
        docker_context = "unknown"
        lifecycle = [ordered]@{
            status = $lifecycle.status
            source = $lifecycle.source
            stage = $lifecycle.stage
            grace_active = [bool]$lifecycle.grace_active
            deadline = $lifecycle.deadline
        }
        services = @()
        tunnel_expected = $false
        staging_tunnel = [ordered]@{ expected = $false; hostnames = @("dev.mad4b.com", "mcp-dev.mad4b.com"); status = "not_checked" }
        local_connector_tunnel = [ordered]@{ expected = $true; hostname = "connector.mad4b.com"; status = "not_checked" }
        ok = $false
        effective_ok = $false
    }
    $activationExpected = ((Get-Env "ACTIVATION_STAGING_GATEWAY_ENABLED").ToLowerInvariant() -eq "true")
    $activationHost = Get-Env "ACTIVATION_HOST_GATEWAY_HOST"
    try {
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "docker command is missing" }
        if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { throw "remote Docker environment is forbidden" }
        $context = (& docker context show 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $context -notin @("default", "desktop-linux")) { throw "Docker context is not local: $context" }
        $server = (& docker info --format "{{.ServerVersion}}" 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($server)) { throw "Docker daemon is unavailable" }
        $snapshot.docker_context = $context
        $snapshot.activation_gateway = [ordered]@{ expected = $activationExpected; host = $activationHost; status = "not_checked"; stale = $null; code = $null; source_commit = $null; worker_build_sha = $null; policy_hash = $null }
        if ($activationExpected) {
            if ([string]::IsNullOrWhiteSpace($activationHost) -or $activationHost -notmatch '^(?i:activation-dev\.mad4b\.com)$') { throw "Activation Gateway host is missing or outside the Staging allowlist" }
            try {
                $gatewayHealth = Invoke-RestMethod -Uri ("https://" + $activationHost + "/health") -Method Get -TimeoutSec 10 -ErrorAction Stop
            } catch { throw "Activation Gateway health request failed: $($_.Exception.Message)" }
            $gatewayOk = Get-ObjectProperty $gatewayHealth "ok"
            $gatewayStale = Get-ObjectProperty $gatewayHealth "stale"
            $gatewayError = Get-ObjectProperty $gatewayHealth "error"
            $gatewayCode = if ($null -ne (Get-ObjectProperty $gatewayHealth "code")) { [string](Get-ObjectProperty $gatewayHealth "code") } elseif ($null -ne (Get-ObjectProperty $gatewayError "code")) { [string](Get-ObjectProperty $gatewayError "code") } else { $null }
            $snapshot.activation_gateway.status = if ($gatewayOk -eq $true) { "healthy" } else { "unhealthy" }
            $snapshot.activation_gateway.stale = if ($null -ne $gatewayStale) { [bool]$gatewayStale } else { $null }
            $snapshot.activation_gateway.code = $gatewayCode
            $snapshot.activation_gateway.source_commit = if ($null -ne (Get-ObjectProperty $gatewayHealth "sourceCommit")) { [string](Get-ObjectProperty $gatewayHealth "sourceCommit") } else { $null }
            $snapshot.activation_gateway.worker_build_sha = if ($null -ne (Get-ObjectProperty $gatewayHealth "workerBuildSha")) { [string](Get-ObjectProperty $gatewayHealth "workerBuildSha") } else { $null }
            $snapshot.activation_gateway.policy_hash = if ($null -ne (Get-ObjectProperty $gatewayHealth "policyHash")) { [string](Get-ObjectProperty $gatewayHealth "policyHash") } else { $null }
            if ($gatewayOk -ne $true) { throw "Activation Gateway health is not ready" }
            if ($gatewayStale -eq $true -or [string]$gatewayCode -eq "GATEWAY_POLICY_STALE") { throw "GATEWAY_POLICY_STALE: Activation Gateway policy is stale" }
        }
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

        $stagingTunnel = Get-StagingTunnelSnapshot $compose $runtimeState
        $snapshot.staging_tunnel = $stagingTunnel
        $snapshot.tunnel_expected = [bool]$stagingTunnel.expected
        if ($stagingTunnel.expected -and $stagingTunnel.status -ne "healthy") {
            throw "Staging tunnel is unhealthy: error=$($stagingTunnel.error)"
        }

        $connectorTunnel = Get-LocalConnectorTunnelSnapshot
        $snapshot.local_connector_tunnel = $connectorTunnel
        if ($connectorTunnel.expected -and $connectorTunnel.status -ne "healthy") {
            if ([string]$connectorTunnel.error -eq "cloudflare_1033") { throw "Local connector tunnel connector.mad4b.com is unhealthy: cloudflare_1033" }
            throw "Local connector tunnel connector.mad4b.com is unhealthy: $($connectorTunnel.error)"
        }

        $snapshot.ok = $true
        $snapshot.effective_ok = $true
        if ([string]$state.status -eq "degraded") {
            Write-StagingLog -Level info -Component $LogComponent -Stage "recovery" -Message "Health Monitor recovered after component failure" -Data @{ previous_error = [string]$state.last_error; consecutive_failures = [int]$state.consecutive_failures; failure_class = [string]$state.failure_class }
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$state.failure_class)) { $state.last_failure_class = [string]$state.failure_class }
        $state.status = "healthy"
        $state.consecutive_failures = 0
        $state.suppressed_failures = 0
        $state.last_error = ""
        $state.last_logged_error = ""
        $state.failure_class = ""
        $state.last_transition_at = $snapshot.timestamp
        Save-HealthState $state
        Write-StagingHeartbeat -Component $LogComponent -Stage "health-check" -Data @{ services = ($required -join ","); docker_context = $context; staging_tunnel = $stagingTunnel.status; local_connector_tunnel = $connectorTunnel.status; recovery = $true }
        Write-StagingLog -Level info -Component $LogComponent -Stage "health-check" -Message "all required Staging and local-control-plane components are healthy" -Data @{ services = ($required -join ","); docker_context = $context; staging_tunnel = $stagingTunnel.status; local_connector_tunnel = $connectorTunnel.status }
    } catch {
        $snapshot.ok = $false
        $suppressed = Write-HealthFailure $_.Exception.Message -Data @{ docker_context = $snapshot.docker_context }
        $snapshot.effective_ok = [bool]$suppressed
        if ($suppressed) {
            $stateAfter = Read-HealthState
            $snapshot.lifecycle.status = [string]$stateAfter.status
        }
    }
    Write-StagingAtomicJson (Get-StagingLogFile "health-snapshot.json") $snapshot 12
    return [bool]$snapshot.effective_ok
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
    Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "health monitor started" -Data @{ interval_seconds = $IntervalSeconds; max_backoff_seconds = $MaxBackoffSeconds; boot_grace_seconds = $BootGraceSeconds; once = [bool]$Once }
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
