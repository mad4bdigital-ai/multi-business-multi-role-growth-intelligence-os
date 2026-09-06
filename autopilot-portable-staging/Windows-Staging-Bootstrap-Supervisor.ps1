[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$ExpectedRepository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    [string]$Ref = "main",
    [ValidateRange(60, 3600)]
    [int]$PollSeconds = 300,
    [switch]$Watch,
    [ValidateSet("disabled", "windows_service", "docker_sidecar")]
    [string]$TunnelMode = "windows_service",
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart",
    [ValidateRange(30, 600)]
    [int]$DockerTimeoutSeconds = 180,
    [ValidateRange(60, 1800)]
    [int]$LeaseSeconds = 900
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $PSCommandPath
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..")) }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)

. (Join-Path $scriptRoot "Staging-Operations-Log.ps1")
. (Join-Path $scriptRoot "Staging-Windows-Preflight.ps1")
. (Join-Path $scriptRoot "Staging-GitTransport.ps1")

$LogComponent = "windows-bootstrap-supervisor"
$leasePath = Join-Path (Get-StagingLogRoot) "deployment-lease.json"
$statePath = Join-Path $scriptRoot "auto-deploy-state.json"
$runtimeStatePath = Join-Path $scriptRoot "autopilot-state.json"
$failurePath = Join-Path (Get-StagingLogRoot) "last-failure.json"
$autoDeployScript = Join-Path $scriptRoot "Auto-Deploy-Staging.ps1"
$certificationScript = Join-Path $scriptRoot "Invoke-StagingCertification.ps1"
$convergenceScript = Join-Path $scriptRoot "Converge-StagingActivationGateway.ps1"
$connectorRepairScript = Join-Path $scriptRoot "Repair-LocalConnectorTunnel.ps1"
$envFile = Join-Path $RepositoryPath "http-generic-api\.env.staging"
$composeBase = Join-Path $RepositoryPath "http-generic-api\docker-compose.yml"
$composeStage = Join-Path $RepositoryPath "http-generic-api\docker-compose.staging.yml"
$script:SupervisorMutex = $null

function Get-NowIso { return [DateTime]::UtcNow.ToString("o") }

function Read-Json([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
}

function Convert-ObjectToHashtable([object]$Object) {
    $table = @{}
    if ($null -eq $Object) { return $table }
    foreach ($property in $Object.PSObject.Properties) { $table[$property.Name] = $property.Value }
    return $table
}

function Get-EnvValue([string]$Name) {
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { return "" }
    $pattern = "^$([regex]::Escape($Name))=(.*)$"
    $lines = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -match $pattern })
    if ($lines.Count -ne 1) { return "" }
    return ($lines[0] -replace "^$([regex]::Escape($Name))=", "")
}

function Set-Lease([string]$Status, [string]$Stage, [string]$ExpectedCommit = "") {
    $lease = [ordered]@{
        contract = "mad4b.staging.deployment-lease.v1"
        status = $Status
        stage = $Stage
        expected_commit = $ExpectedCommit
        owner_pid = $PID
        started_at = Get-NowIso
        expires_at = [DateTime]::UtcNow.AddSeconds($LeaseSeconds).ToString("o")
        secrets_included = $false
    }
    Write-StagingAtomicJson $leasePath $lease 8
}

function Clear-Lease {
    if (Test-Path -LiteralPath $leasePath) { Remove-Item -LiteralPath $leasePath -Force -ErrorAction SilentlyContinue }
}

function Acquire-SupervisorLock {
    try {
        $script:SupervisorMutex = New-Object System.Threading.Mutex($false, "Global\Mad4bWindowsStagingBootstrapSupervisor")
        if (-not $script:SupervisorMutex.WaitOne(0)) { throw "another Windows Staging Bootstrap Supervisor instance is already running" }
    } catch [System.Threading.AbandonedMutexException] {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "run-lock" -Message "recovered abandoned supervisor lock"
    }
}

function Release-SupervisorLock {
    if ($null -ne $script:SupervisorMutex) {
        try { $script:SupervisorMutex.ReleaseMutex() } catch { }
        try { $script:SupervisorMutex.Dispose() } catch { }
        $script:SupervisorMutex = $null
    }
}

function New-PhaseState([string]$ExpectedCommit = "") {
    return [ordered]@{
        schema_version = 2
        contract = "mad4b.staging.auto-deploy-phased-state.v1"
        ref = $Ref
        expected_commit = $ExpectedCommit
        phases = [ordered]@{
            eligibility = "pending"
            docker = "pending"
            build = "pending"
            deployment = "pending"
            service_health = "pending"
            staging_tunnel = "pending"
            local_connector_tunnel = "pending"
            convergence = "pending"
            certification = "not_completed"
        }
        overall = "starting"
        failure_class = ""
        stage = "bootstrap"
        expected_observed = [ordered]@{
            expected_commit = $ExpectedCommit
            local_app_commit = $null
            gateway_source_commit = $null
            gateway_worker_build_sha = $null
        }
        generated_at = Get-NowIso
        production_deploy = $false
        database_mutated = $false
        migration_applied = $false
        ruleset_mutation = $false
        secrets_included = $false
    }
}

function Write-PhaseState([object]$PhaseState) {
    $existing = Read-Json $statePath
    $merged = Convert-ObjectToHashtable $existing
    foreach ($property in $PhaseState.PSObject.Properties) { $merged[$property.Name] = $property.Value }
    $merged["generated_at"] = Get-NowIso
    $merged["secrets_included"] = $false
    Write-StagingAtomicJson $statePath $merged 12
}

function Write-StructuredFailure(
    [string]$FailureClass,
    [string]$Stage,
    [string]$ExpectedCommit,
    [string]$ObservedCommit = "",
    [string]$ParentError = "AUTO_DEPLOY_FAIL_CLOSED",
    [string]$Message = "",
    [bool]$Recovered = $false
) {
    $snapshot = [ordered]@{
        schema_version = 3
        run_id = Get-StagingRunId
        timestamp = Get-NowIso
        component = $LogComponent
        status = if ($Recovered) { "recovered" } else { "failed" }
        failure_class = $FailureClass
        stage = $Stage
        expected_commit = $ExpectedCommit
        observed_commit = if ([string]::IsNullOrWhiteSpace($ObservedCommit)) { $null } else { $ObservedCommit }
        parent_error = $ParentError
        message = $Message
        recovered = $Recovered
        secrets_included = $false
    }
    Write-StagingAtomicJson $failurePath $snapshot 8
}

function Get-RemoteMainSha {
    try { $result = Invoke-StagingGit @("-C", $RepositoryPath, "ls-remote", "origin", "refs/heads/$Ref") }
    catch { throw "SUPERVISOR_REMOTE_SHA_FAILED: $($_.Exception.Message)" }
    $sha = (((($result.output | Out-String).Trim()) -split "\s+")[0]).ToLowerInvariant()
    if ($sha -notmatch '^[0-9a-f]{40}$') { throw "SUPERVISOR_REMOTE_SHA_INVALID: $sha" }
    return $sha
}

function Get-Eligibility([string]$Sha) {
    $raw = & gh run list --repo $ExpectedRepository --workflow "staging-main-deploy-eligibility.yml" --commit $Sha --limit 20 --json status,conclusion,headSha,databaseId,updatedAt 2>$null
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ state = "blocked"; reason = "eligibility_query_failed" } }
    try { $runs = @(($raw | Out-String | ConvertFrom-Json) | Where-Object { ([string]$_.headSha).ToLowerInvariant() -eq $Sha }) }
    catch { return [pscustomobject]@{ state = "blocked"; reason = "eligibility_invalid_json" } }
    if ($runs.Count -eq 0) { return [pscustomobject]@{ state = "pending"; reason = "eligibility_workflow_missing" } }
    $latest = $runs | Sort-Object updatedAt -Descending | Select-Object -First 1
    if ([string]$latest.status -ne "completed") { return [pscustomobject]@{ state = "pending"; reason = "eligibility_workflow_in_progress"; run_id = $latest.databaseId } }
    if ([string]$latest.conclusion -ne "success") { return [pscustomobject]@{ state = "blocked"; reason = "eligibility_workflow_not_success:$($latest.conclusion)"; run_id = $latest.databaseId } }
    return [pscustomobject]@{ state = "passed"; reason = "eligibility_workflow_success"; run_id = $latest.databaseId }
}

function Get-LocalDeploymentEvidence([string]$Sha) {
    $runtime = Read-Json $runtimeStatePath
    $result = [ordered]@{ exact = $false; healthy = $false; runtime_commit = $null; image_id = $null; reason = "runtime_state_missing" }
    if ($null -eq $runtime) { return [pscustomobject]$result }
    $runtimeCommit = ([string]$runtime.commit).Trim().ToLowerInvariant()
    $result.runtime_commit = $runtimeCommit
    if ($runtimeCommit -ne $Sha) { $result.reason = "runtime_commit_mismatch"; return [pscustomobject]$result }
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { $result.reason = "env_missing"; return [pscustomobject]$result }
    $compose = @("compose", "-f", $composeBase, "-f", $composeStage, "--env-file", $envFile)
    $containerId = (& docker @($compose + @("ps", "-q", "app")) 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[0-9a-fA-F]{64}$') { $result.reason = "app_container_missing"; return [pscustomobject]$result }
    $health = (& docker inspect --format "{{.State.Health.Status}}" $containerId 2>$null | Out-String).Trim().ToLowerInvariant()
    $status = (& docker inspect --format "{{.State.Status}}" $containerId 2>$null | Out-String).Trim().ToLowerInvariant()
    $imageId = (& docker inspect --format "{{.Image}}" $containerId 2>$null | Out-String).Trim().ToLowerInvariant()
    $result.image_id = $imageId
    if ($LASTEXITCODE -ne 0 -or $imageId -notmatch '^sha256:[0-9a-f]{64}$') { $result.reason = "app_image_invalid"; return [pscustomobject]$result }
    $labelCommit = (& docker image inspect --format "{{index .Config.Labels \"org.mad4b.staging.build.commit\"}}" $imageId 2>$null | Out-String).Trim().ToLowerInvariant()
    $result.exact = ($labelCommit -eq $Sha)
    $result.healthy = ($health -eq "healthy" -and $status -eq "running")
    $result.reason = if (-not $result.exact) { "image_commit_mismatch" } elseif (-not $result.healthy) { "app_not_healthy" } else { "exact_healthy" }
    return [pscustomobject]$result
}

function Get-GatewayHealth {
    try {
        $body = Invoke-RestMethod -Uri "https://activation-dev.mad4b.com/health" -Method Get -TimeoutSec 15 -ErrorAction Stop
        return [pscustomobject]@{
            reachable = $true
            ok = ($body.ok -eq $true)
            stale = ($body.stale -eq $true)
            source_commit = ([string]$body.sourceCommit).Trim().ToLowerInvariant()
            worker_build_sha = ([string]$body.workerBuildSha).Trim().ToLowerInvariant()
            policy_hash = [string]$body.policyHash
            error = $null
        }
    } catch {
        return [pscustomobject]@{ reachable = $false; ok = $false; stale = $null; source_commit = ""; worker_build_sha = ""; policy_hash = ""; error = "gateway_health_unavailable" }
    }
}

function Test-StagingTunnelHealth {
    if ($TunnelMode -eq "disabled") { return [pscustomobject]@{ expected = $false; healthy = $true; status = "not_expected" } }
    try {
        $response = Invoke-WebRequest -Uri "https://dev.mad4b.com/health" -UseBasicParsing -TimeoutSec 12 -ErrorAction Stop
        return [pscustomobject]@{ expected = $true; healthy = ([int]$response.StatusCode -eq 200); status = if ([int]$response.StatusCode -eq 200) { "healthy" } else { "unhealthy" } }
    } catch {
        return [pscustomobject]@{ expected = $true; healthy = $false; status = "unhealthy" }
    }
}

function Invoke-ConnectorRecovery {
    if (-not (Test-Path -LiteralPath $connectorRepairScript -PathType Leaf)) { return [pscustomobject]@{ healthy = $false; status = "repair_script_missing" } }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $connectorRepairScript
    $exit = $LASTEXITCODE
    $connectorState = Read-Json (Join-Path $scriptRoot "logs\local-connector-tunnel-state.json")
    $status = if ($null -ne $connectorState) { [string]$connectorState.status } elseif ($exit -eq 0) { "healthy" } else { "unhealthy" }
    return [pscustomobject]@{ healthy = ($exit -eq 0); status = $status; state = $connectorState }
}

function Invoke-ActivationConvergence([string]$Sha) {
    if (-not (Test-Path -LiteralPath $convergenceScript -PathType Leaf)) { throw "activation_gateway_convergence_script_missing" }
    Set-Lease "converging" "activation_gateway" $Sha
    Write-Host "STAGING_CONVERGENCE_REQUIRED: component=activation_gateway expected=$Sha"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $convergenceScript -RepositoryPath $RepositoryPath -ExpectedCommit $Sha -ExpectedRepository $ExpectedRepository -ReportPath (Join-Path $scriptRoot "logs\staging-activation-gateway-convergence.json")
    if ($LASTEXITCODE -ne 0) { throw "activation_gateway_convergence_failed" }
    $health = Get-GatewayHealth
    if (-not $health.reachable -or -not $health.ok -or $health.stale -or $health.source_commit -ne $Sha -or $health.worker_build_sha -ne $Sha) {
        throw "activation_gateway_exact_sha_readback_failed"
    }
    return $health
}

function Invoke-Certification([string]$Sha) {
    Set-Lease "certifying" "certification" $Sha
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $certificationScript, "-RepositoryPath", $RepositoryPath, "-ExpectedCommit", $Sha, "-Ref", $Ref, "-StatePath", $runtimeStatePath)
    if ($TunnelMode -ne "disabled") { $args += "-StartTunnel" }
    & powershell.exe @args
    $exit = $LASTEXITCODE
    $runtime = Read-Json $runtimeStatePath
    $status = if ($null -ne $runtime) { [string]$runtime.certification_status } else { "missing" }
    return [pscustomobject]@{ exit_code = $exit; status = $status; runtime = $runtime; ready = ($exit -eq 0 -and $status -eq "ready") }
}

function Invoke-AutoDeployOnce([string]$Sha) {
    Set-Lease "deploying" "auto_deploy" $Sha
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $autoDeployScript, "-RepositoryPath", $RepositoryPath, "-ExpectedRepository", $ExpectedRepository, "-Ref", $Ref, "-PollSeconds", "$PollSeconds", "-TunnelMode", $TunnelMode, "-BuildMode", $BuildMode)
    & powershell.exe @args
    return [int]$LASTEXITCODE
}

function Invoke-SupervisorIteration {
    Set-Lease "bootstrapping" "docker_readiness" ""
    $docker = Ensure-StagingDockerDesktopReady -TimeoutSeconds $DockerTimeoutSeconds -PollSeconds 3
    $sha = Get-RemoteMainSha
    $phase = [pscustomobject](New-PhaseState $sha)
    $phase.phases.docker = "ready"
    $phase.stage = "eligibility"
    Write-PhaseState $phase

    $eligibility = Get-Eligibility $sha
    if ($eligibility.state -ne "passed") {
        $phase.phases.eligibility = $eligibility.state
        $phase.overall = if ($eligibility.state -eq "pending") { "waiting" } else { "blocked" }
        $phase.failure_class = [string]$eligibility.reason
        $phase.stage = "eligibility"
        Write-PhaseState $phase
        if ($eligibility.state -eq "blocked") {
            Write-StagingLog -Level error -Component $LogComponent -Stage "eligibility" -Message "Staging eligibility blocked supervisor" -Data @{ sha = $sha; reason = $eligibility.reason }
            Write-StructuredFailure "eligibility_blocked" "eligibility" $sha "" "AUTO_DEPLOY_FAIL_CLOSED" ([string]$eligibility.reason)
        }
        Clear-Lease
        return [pscustomobject]@{ ready = $false; retry = $true; reason = $eligibility.reason }
    }
    $phase.phases.eligibility = "passed"

    $connector = Invoke-ConnectorRecovery
    $phase.phases.local_connector_tunnel = if ($connector.healthy) { "healthy" } else { "degraded" }

    $local = Get-LocalDeploymentEvidence $sha
    $phase.expected_observed.local_app_commit = $local.runtime_commit
    if ($local.exact -and $local.healthy) {
        $phase.phases.build = "reused_exact_provenance"
        $phase.phases.deployment = "succeeded"
        $phase.phases.service_health = "healthy"
    } else {
        $phase.stage = "deployment"
        $phase.phases.build = "running"
        $phase.phases.deployment = "running"
        Write-PhaseState $phase
        $childExit = Invoke-AutoDeployOnce $sha
        $local = Get-LocalDeploymentEvidence $sha
        $phase.expected_observed.local_app_commit = $local.runtime_commit
        if ($local.exact -and $local.healthy) {
            $phase.phases.build = "succeeded_or_reused"
            $phase.phases.deployment = "succeeded"
            $phase.phases.service_health = "healthy"
            if ($childExit -ne 0) {
                Write-StagingLog -Level warning -Component $LogComponent -Stage "deployment" -Message "Auto Deploy child exited nonzero after exact local deployment; supervisor will resume from convergence/certification" -Data @{ sha = $sha; child_exit = $childExit }
            }
        } else {
            $phase.phases.build = "failed_or_incomplete"
            $phase.phases.deployment = "failed"
            $phase.phases.service_health = if ($local.healthy) { "healthy" } else { "unhealthy" }
            $phase.overall = "degraded"
            $phase.failure_class = [string]$local.reason
            $phase.stage = "deployment"
            Write-PhaseState $phase
            Write-StagingLog -Level error -Component $LogComponent -Stage "deployment" -Message "Auto Deploy did not produce an exact healthy local deployment" -Data @{ sha = $sha; child_exit = $childExit; reason = $local.reason; observed_commit = $local.runtime_commit }
            Write-StructuredFailure "local_deployment_not_exact" "deployment" $sha ([string]$local.runtime_commit) "AUTO_DEPLOY_FAIL_CLOSED" ([string]$local.reason)
            Clear-Lease
            return [pscustomobject]@{ ready = $false; retry = $true; reason = $local.reason }
        }
    }

    $stagingTunnel = Test-StagingTunnelHealth
    $phase.phases.staging_tunnel = $stagingTunnel.status

    $activationExpected = (Get-EnvValue "ACTIVATION_STAGING_GATEWAY_ENABLED").Trim().ToLowerInvariant() -eq "true"
    if ($activationExpected) {
        $gateway = Get-GatewayHealth
        $phase.expected_observed.gateway_source_commit = $gateway.source_commit
        $phase.expected_observed.gateway_worker_build_sha = $gateway.worker_build_sha
        $gatewayExact = $gateway.reachable -and $gateway.ok -and -not $gateway.stale -and $gateway.source_commit -eq $sha -and $gateway.worker_build_sha -eq $sha
        if (-not $gatewayExact) {
            $phase.phases.convergence = "required"
            $phase.stage = "convergence"
            Write-PhaseState $phase
            Write-StagingLog -Level warning -Component $LogComponent -Stage "convergence" -Message "Activation Gateway exact-SHA convergence required" -Data @{ expected_commit = $sha; observed_commit = $gateway.source_commit; worker_build_sha = $gateway.worker_build_sha }
            try {
                $gateway = Invoke-ActivationConvergence $sha
                $phase.expected_observed.gateway_source_commit = $gateway.source_commit
                $phase.expected_observed.gateway_worker_build_sha = $gateway.worker_build_sha
                $phase.phases.convergence = "succeeded"
                Write-StructuredFailure "gateway_exact_commit_mismatch" "convergence" $sha ([string]$phase.expected_observed.gateway_source_commit) "AUTO_DEPLOY_FAIL_CLOSED" "Gateway mismatch recovered without rebuilding healthy local app" $true
            } catch {
                $phase.phases.convergence = "blocked"
                $phase.phases.certification = "not_completed"
                $phase.overall = "degraded"
                $phase.failure_class = "gateway_exact_commit_mismatch"
                $phase.stage = "convergence"
                Write-PhaseState $phase
                Write-StagingLog -Level error -Component $LogComponent -Stage "convergence" -Message $_.Exception.Message -Data @{ expected_commit = $sha; observed_commit = $gateway.source_commit }
                Write-StructuredFailure "gateway_exact_commit_mismatch" "convergence" $sha ([string]$gateway.source_commit) "AUTO_DEPLOY_FAIL_CLOSED" $_.Exception.Message
                Clear-Lease
                return [pscustomobject]@{ ready = $false; retry = $true; reason = "gateway_exact_commit_mismatch" }
            }
        } else {
            $phase.phases.convergence = "succeeded"
        }
    } else {
        $phase.phases.convergence = "not_required"
    }

    $phase.stage = "certification"
    $phase.phases.certification = "running"
    Write-PhaseState $phase
    $certification = Invoke-Certification $sha
    if ($certification.exit_code -ne 0 -or $certification.status -eq "blocked") {
        $runtime = $certification.runtime
        $blocking = if ($null -ne $runtime) { @($runtime.certification_blocking_failures | ForEach-Object { [string]$_ }) } else { @() }
        $failureClass = if ($blocking -contains "gateway_exact_commit") { "gateway_exact_commit_mismatch" } elseif ($blocking.Count -gt 0) { "certification_blocked:$($blocking[0])" } else { "certification_blocked" }
        $phase.phases.certification = "blocked"
        $phase.overall = "degraded"
        $phase.failure_class = $failureClass
        Write-PhaseState $phase
        Write-StagingLog -Level error -Component $LogComponent -Stage "certification" -Message "Staging certification blocked after component convergence" -Data @{ expected_commit = $sha; blocking_failures = ($blocking -join ",") }
        Write-StructuredFailure $failureClass "certification" $sha ([string]$phase.expected_observed.gateway_source_commit) "AUTO_DEPLOY_FAIL_CLOSED" ($blocking -join ",")
        Clear-Lease
        return [pscustomobject]@{ ready = $false; retry = $true; reason = $failureClass }
    }

    $phase.phases.certification = [string]$certification.status
    $phase.overall = if ($certification.status -eq "ready" -and $stagingTunnel.healthy -and $connector.healthy) { "ready" } else { "degraded" }
    $phase.failure_class = if (-not $connector.healthy) { "connector_tunnel_unhealthy" } elseif (-not $stagingTunnel.healthy) { "staging_tunnel_unhealthy" } else { "" }
    $phase.stage = "complete"
    Write-PhaseState $phase
    Clear-Lease

    if ($phase.overall -eq "ready") {
        Write-Host "STAGING_SUPERVISOR_READY: commit=$sha certification=$($certification.status) connector=healthy"
        Write-StagingOperationBoundary -Component $LogComponent -Stage "complete" -Outcome "success" -Message "Windows Staging Bootstrap Supervisor converged all required components" -Data @{ sha = $sha; certification = $certification.status; connector = $connector.status; staging_tunnel = $stagingTunnel.status }
        return [pscustomobject]@{ ready = $true; retry = $false; reason = "ready" }
    }

    Write-Host "STAGING_SUPERVISOR_DEGRADED: commit=$sha certification=$($certification.status) connector=$($connector.status) staging_tunnel=$($stagingTunnel.status)"
    return [pscustomobject]@{ ready = $false; retry = $true; reason = $phase.failure_class }
}

if ($Ref -ne "main") { throw "STAGING_SUPERVISOR_FAIL_CLOSED: only main is supported" }
foreach ($command in @("git", "gh", "docker", "powershell.exe")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "STAGING_SUPERVISOR_FAIL_CLOSED: required command is missing: $command" }
}
foreach ($required in @($autoDeployScript, $certificationScript, $convergenceScript, $connectorRepairScript)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "STAGING_SUPERVISOR_FAIL_CLOSED: required supervisor dependency is missing: $required" }
}

Acquire-SupervisorLock
try {
    Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "Windows Staging Bootstrap Supervisor started" -Data @{ watch = [bool]$Watch; poll_seconds = $PollSeconds; tunnel_mode = $TunnelMode; docker_timeout_seconds = $DockerTimeoutSeconds }
    while ($true) {
        try {
            $result = Invoke-SupervisorIteration
        } catch {
            $message = $_.Exception.Message
            Write-StagingLog -Level error -Component $LogComponent -Stage "unhandled" -Message $message -Data @{ error_type = $_.Exception.GetType().FullName }
            Write-StructuredFailure "supervisor_unhandled" "unhandled" "" "" "STAGING_SUPERVISOR_FAIL_CLOSED" $message
            Clear-Lease
            $result = [pscustomobject]@{ ready = $false; retry = $true; reason = "supervisor_unhandled" }
        }
        if (-not $Watch) {
            if ($result.ready) { exit 0 }
            exit 1
        }
        Write-StagingLog -Level info -Component $LogComponent -Stage "sleep" -Message "supervisor sleeping before next reconciliation" -Data @{ seconds = $PollSeconds; reason = $result.reason }
        Start-Sleep -Seconds $PollSeconds
    }
} finally {
    Clear-Lease
    Release-SupervisorLock
}
