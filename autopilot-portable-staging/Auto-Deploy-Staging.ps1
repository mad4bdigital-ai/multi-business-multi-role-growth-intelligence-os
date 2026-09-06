[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$RepositoryUrl = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    [string]$Ref = "main",
    [string]$ExpectedRepository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    [int]$PollSeconds = 300,
    [switch]$Watch,
    [switch]$StartTunnel,
    [ValidateSet("disabled", "windows_service", "docker_sidecar")]
    [string]$TunnelMode = "disabled",
    [switch]$ValidateOnly,
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart",
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($StartTunnel -and $TunnelMode -eq "disabled") { $TunnelMode = "windows_service" }
$TunnelSelected = $TunnelMode -ne "disabled"
if ($SkipBuild) {
    if ($BuildMode -ne "Smart") { throw "-SkipBuild cannot be combined with an explicit BuildMode" }
    $BuildMode = "SkipBuild"
}
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$GitSafetyPath = Join-Path $PSScriptRoot "Staging-GitSafety.ps1"
if (-not (Test-Path -LiteralPath $GitSafetyPath)) { throw "Missing shared Git safety helper: $GitSafetyPath" }
. $GitSafetyPath
$GitTransportPath = Join-Path $PSScriptRoot "Staging-GitTransport.ps1"
if (-not (Test-Path -LiteralPath $GitTransportPath)) { throw "Missing shared Git transport helper: $GitTransportPath" }
. $GitTransportPath
$WindowsPreflightPath = Join-Path $PSScriptRoot "Staging-Windows-Preflight.ps1"
if (-not (Test-Path -LiteralPath $WindowsPreflightPath)) { throw "Missing shared Windows preflight helper: $WindowsPreflightPath" }
. $WindowsPreflightPath
$LogComponent = "auto-deploy"
$script:AutoPilotRunMutex = $null
$script:DeploymentLeasePath = $null
$script:PhaseState = $null
$script:CurrentSha = ""
$script:CurrentEligibility = $null
$script:ProviderMutationPerformed = $false
$script:ProviderMutationInitiated = $false
$script:ProviderMutationScope = "none"
Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "auto-deploy process started" -Data @{ watch = [bool]$Watch; ref = $Ref; poll_seconds = $PollSeconds }

function Acquire-AutoPilotRunLock {
    try {
        $script:AutoPilotRunMutex = New-Object System.Threading.Mutex($false, "Global\Mad4bPortableStagingAutoPilot")
        if (-not $script:AutoPilotRunMutex.WaitOne(0)) { Fail "Another Staging operation is already running; refusing overlapping Auto Deploy" }
        Write-StagingLog -Level info -Component $LogComponent -Stage "run-lock" -Message "exclusive Staging operation lock acquired"
    } catch [System.Threading.AbandonedMutexException] {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "run-lock" -Message "recovered abandoned Staging operation lock"
    } catch {
        Fail "Unable to acquire Staging operation lock: $($_.Exception.Message)"
    }
}
function Release-AutoPilotRunLock {
    if ($null -ne $script:AutoPilotRunMutex) {
        try { $script:AutoPilotRunMutex.ReleaseMutex() } catch { }
        try { $script:AutoPilotRunMutex.Dispose() } catch { }
        $script:AutoPilotRunMutex = $null
    }
}
trap {
    $message = $_.Exception.Message
    if ($message -notmatch '^AUTO_DEPLOY_FAIL_CLOSED:') {
        Write-StagingLog -Level error -Component $LogComponent -Stage "unhandled" -Message $message -Data @{ error_type = $_.Exception.GetType().FullName }
    } else {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "unhandled" -Message "structured Auto Deploy failure propagated without replacing last-failure root cause" -Data @{ parent_error = "AUTO_DEPLOY_FAIL_CLOSED" }
    }
    Write-Host "AUTO_DEPLOY_FAILURE_LOGGED: $(Get-StagingLogRoot)" -ForegroundColor Red
    Exit-DeploymentLease
    Release-AutoPilotRunLock
    exit 1
}

function Fail([string]$Message, [hashtable]$Data = @{}) {
    if (-not $Data.ContainsKey("parent_error")) { $Data["parent_error"] = "AUTO_DEPLOY_FAIL_CLOSED" }
    Write-StagingLog -Level error -Component $LogComponent -Stage $(if ($Data.ContainsKey("stage") -and $Data.stage) { [string]$Data.stage } else { "fail_closed" }) -Message $Message -Data $Data
    throw "AUTO_DEPLOY_FAIL_CLOSED: $Message"
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Fail "Required command is missing: $Name" }
}

function Invoke-NativeText([string]$File, [string[]]$Arguments) {
    if ($File -ieq "git") {
        try {
            $gitResult = Invoke-StagingGit $Arguments
            Write-StagingOperationBoundary -Component $LogComponent -Stage "native:git-read" -Outcome "success" -Message "Git read completed with bounded retry" -Data @{ command = $File; arguments = ($Arguments -join " "); attempts = $gitResult.attempts; transport = $gitResult.transport }
            return (($gitResult.output | Out-String).Trim())
        } catch {
            Fail $_.Exception.Message
        }
    }
    $text = & $File @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "$File failed while reading remote state" }
    return (($text | Out-String).Trim())
}

function Get-Policy([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { Fail "Auto Deploy policy is missing: $Path" }
    return (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json)
}

function Assert-Policy($Policy, [string]$TargetRef, [string]$Repository) {
    if ($Policy.repository -ne $Repository) { Fail "Policy repository mismatch" }
    if ($Policy.ref -ne $TargetRef) { Fail "Only the policy ref '$($Policy.ref)' may be deployed; received '$TargetRef'" }
    if ($Policy.deployment_mode -ne "local_windows_task_scheduler") { Fail "Unsupported deployment mode: $($Policy.deployment_mode)" }
    foreach ($property in @("production_deploy", "hostinger_mutation", "cloudflare_dns_mutation", "database_mutation", "migration_applied", "provider_mutation")) {
        if ($Policy.safety.$property -ne $false) { Fail "Safety policy '$property' must be exactly false" }
    }
    if ($PollSeconds -lt [int]$Policy.minimum_poll_seconds) { Fail "PollSeconds is below the policy minimum" }
}

function Get-RemoteMainSha([string]$RepositoryPath, [string]$TargetRef) {
    Push-Location $RepositoryPath
    try {
        $line = Invoke-NativeText "git" @("ls-remote", "origin", "refs/heads/$TargetRef")
        $sha = ($line -split "\s+")[0]
        if ($sha -notmatch '^[0-9a-fA-F]{40}$') { Fail "origin/$TargetRef did not resolve to an exact commit SHA" }
        return $sha.ToLowerInvariant()
    } finally {
        Pop-Location
    }
}

function Get-LatestEligibility($Policy, [string]$Repository, [string]$Sha) {
    # Workflow Runs are the source of truth for this contract. Check Runs can be
    # stale or represent a different attempt, so never deploy from them alone.
    $raw = & gh run list --repo $Repository --workflow "staging-main-deploy-eligibility.yml" --commit $Sha --limit 20 --json status,conclusion,headSha,databaseId,updatedAt 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "GitHub workflow-runs query failed; refusing deployment" }
    try { $runs = @(($raw | Out-String | ConvertFrom-Json) | Where-Object { $_.headSha -eq $Sha }) }
    catch { Fail "GitHub workflow-runs response was not valid JSON; refusing deployment" }
    if ($runs.Count -eq 0) { return @{ state = "pending"; reason = "eligibility_workflow_missing"; sha = $Sha } }
    $latest = $runs | Sort-Object updatedAt -Descending | Select-Object -First 1
    if ($latest.status -ne "completed") { return @{ state = "pending"; reason = "eligibility_workflow_in_progress"; sha = $Sha; run_id = $latest.databaseId } }
    if ($latest.conclusion -ne "success") { return @{ state = "blocked"; reason = "eligibility_workflow_not_success:$($latest.conclusion)"; sha = $Sha; run_id = $latest.databaseId } }
    return @{ state = "eligible"; reason = "eligibility_workflow_success"; sha = $Sha; run_id = $latest.databaseId; completed_at = $latest.updatedAt }
}

function Read-State([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try { return (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json) } catch { Fail "Auto Deploy state file is invalid: $Path" }
}

function Write-State([string]$Path, [object]$Value) {
    Write-StagingAtomicJson $Path $Value 12
}

function New-PhaseState([string]$EligibilityStatus) {
    return [ordered]@{
        eligibility = $EligibilityStatus
        docker = "not_started"
        build = "not_started"
        deployment = "not_started"
        service_health = "not_started"
        staging_tunnel = if ($TunnelSelected) { "not_started" } else { "not_requested" }
        local_connector_tunnel = "unknown"
        convergence = "not_started"
        certification = "not_completed"
    }
}

function Get-OptionalPropertyValue([object]$Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Update-TunnelPhasesFromHealthSnapshot([object]$Phases) {
    $snapshotPath = Join-Path (Get-StagingLogRoot) "health-snapshot.json"
    $snapshot = Read-State $snapshotPath
    if ($null -eq $snapshot) { return }

    # Split tunnel fields were introduced after the original health snapshot
    # contract. Missing fields are optional historical evidence, not a deployment
    # failure, including while Set-StrictMode is enabled.
    $stagingTunnel = Get-OptionalPropertyValue $snapshot "staging_tunnel"
    $stagingStatus = Get-OptionalPropertyValue $stagingTunnel "status"
    if (-not [string]::IsNullOrWhiteSpace([string]$stagingStatus)) {
        $Phases.staging_tunnel = [string]$stagingStatus
    }

    $connectorTunnel = Get-OptionalPropertyValue $snapshot "local_connector_tunnel"
    $connectorStatus = Get-OptionalPropertyValue $connectorTunnel "status"
    if (-not [string]::IsNullOrWhiteSpace([string]$connectorStatus)) {
        $Phases.local_connector_tunnel = [string]$connectorStatus
    }
}

function Write-AutoDeployState([string]$Sha, $Eligibility, $Runtime, [bool]$ValidatedOnly, [object]$Phases = $null, [string]$Overall = "running", [hashtable]$Failure = @{}) {
    if ($null -eq $Phases) { $Phases = New-PhaseState $(if ($Eligibility.state -eq "eligible") { "passed" } else { [string]$Eligibility.state }) }
    Update-TunnelPhasesFromHealthSnapshot $Phases
    $state = [ordered]@{
        contract = "mad4b.staging-auto-deploy-state.v2"
        desired_commit = $Sha
        ref = $Ref
        phases = $Phases
        overall = $Overall
        eligibility_check = $Policy.eligibility_check_name
        eligibility_completed_at = $Eligibility.completed_at
        tunnel_started = [bool]$TunnelSelected
        tunnel_mode = $TunnelMode
        validate_only = [bool]$ValidatedOnly
        production_deploy = $false
        database_mutated = $false
        migration_applied = $false
        provider_mutation = [bool]$script:ProviderMutationPerformed
        provider_mutation_initiated = [bool]$script:ProviderMutationInitiated
        provider_mutation_scope = [string]$script:ProviderMutationScope
        provider_mutation_delegated = [bool]$script:ProviderMutationPerformed
        provider_mutation_authorized = $false
        ruleset_mutation = $false
        secrets_included = $false
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
    }
    if ($ValidatedOnly) {
        $state["validated_commit"] = $Sha
    } elseif ($null -ne $Runtime) {
        $state["deployed_commit"] = $Sha
        $state["certification_contract"] = [string](Get-OptionalPropertyValue $Runtime "certification_contract")
        $state["certification_status"] = [string](Get-OptionalPropertyValue $Runtime "certification_status")
        $state["certification_ready"] = ((Get-OptionalPropertyValue $Runtime "certification_ready") -eq $true)
        $state["certified_commit"] = [string](Get-OptionalPropertyValue $Runtime "certified_commit")
        $state["certified_branch"] = [string](Get-OptionalPropertyValue $Runtime "certified_branch")
        $state["certification_degraded_reasons"] = @((Get-OptionalPropertyValue $Runtime "certification_degraded_reasons"))
        $state["certification_blocking_failures"] = @((Get-OptionalPropertyValue $Runtime "certification_blocking_failures"))
        $state["database_readiness"] = [string](Get-OptionalPropertyValue $Runtime "database_readiness")
        $state["build_action"] = [string](Get-OptionalPropertyValue $Runtime "build_action")
        $state["app_image_digest"] = [string](Get-OptionalPropertyValue $Runtime "app_image_digest")
    }
    foreach ($key in $Failure.Keys) { $state[$key] = $Failure[$key] }
    Write-State $statePath $state
}

function Get-CertificationState([string]$RuntimeStatePath, [string]$Sha) {
    $runtime = Read-State $RuntimeStatePath
    if (-not $runtime) { Fail "Staging runtime state is missing after deployment/certification" }
    $runtimeCommit = ([string](Get-OptionalPropertyValue $runtime "commit")).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($runtimeCommit) -or $runtimeCommit -ne $Sha) { Fail "Staging runtime state commit mismatch after deployment/certification" }
    $certifiedCommit = ([string](Get-OptionalPropertyValue $runtime "certified_commit")).Trim().ToLowerInvariant()
    $certifiedBranch = [string](Get-OptionalPropertyValue $runtime "certified_branch")
    $certificationStatus = [string](Get-OptionalPropertyValue $runtime "certification_status")
    if ($certifiedCommit -and $certifiedCommit -ne $Sha) { Fail "Staging certified commit mismatch" }
    if ($certifiedBranch -and $certifiedBranch -ne $Ref) { Fail "Staging certified branch mismatch" }
    if ($certificationStatus -and $certificationStatus -notin @("ready", "degraded", "blocked", "pending")) { Fail "Staging runtime state has unsupported certification status" }
    foreach ($optional in @{
        certification_contract = ""
        certification_status = ""
        certification_ready = $false
        certified_commit = ""
        certified_branch = ""
        certification_degraded_reasons = @()
        certification_blocking_failures = @()
        database_readiness = ""
        build_action = ""
        app_image_digest = ""
    }.GetEnumerator()) {
        if ($null -eq $runtime.PSObject.Properties[$optional.Key]) {
            $runtime | Add-Member -NotePropertyName $optional.Key -NotePropertyValue $optional.Value
        }
    }
    return $runtime
}

function Enter-DeploymentLease([string]$Stage, [string]$Sha, [ValidateSet("bootstrapping", "deploying", "converging", "certifying")][string]$Status = "deploying", [int]$TtlSeconds = 900) {
    $now = [DateTime]::UtcNow
    $lease = [ordered]@{
        contract = "mad4b.staging-deployment-lease.v1"
        lease_id = [guid]::NewGuid().ToString("N")
        status = $Status
        stage = $Stage
        expected_commit = $Sha
        started_at = $now.ToString("o")
        expires_at = $now.AddSeconds($TtlSeconds).ToString("o")
        pid = $PID
        secrets_included = $false
    }
    Write-StagingAtomicJson $script:DeploymentLeasePath $lease 8
    Write-StagingLog -Level info -Component $LogComponent -Stage "deployment-lease" -Message "bounded deployment lease entered" -Data @{ lifecycle_status = $Status; lease_stage = $Stage; expected_commit = $Sha; expires_at = $lease.expires_at }
}
function Exit-DeploymentLease {
    if ($script:DeploymentLeasePath -and (Test-Path -LiteralPath $script:DeploymentLeasePath)) {
        Remove-Item -LiteralPath $script:DeploymentLeasePath -Force -ErrorAction SilentlyContinue
    }
}

function Test-LocalDeploymentHealthy([string]$Sha, $Runtime) {
    if ($null -eq $Runtime) { return $false }
    $runtimeCommit = ([string](Get-OptionalPropertyValue $Runtime "commit")).Trim().ToLowerInvariant()
    $imageDigest = [string](Get-OptionalPropertyValue $Runtime "app_image_digest")
    if ($runtimeCommit -ne $Sha) { return $false }
    if ($imageDigest -notmatch '^sha256:[0-9a-fA-F]{64}$') { return $false }
    $compose = @("compose", "-f", $composeBase, "-f", $composeStage, "--env-file", $envFile)
    foreach ($service in @("redis", "runtime-db", "governance-db", "persistence-db", "app")) {
        $id = (& docker @compose ps -q $service 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($id)) { return $false }
        $health = (& docker inspect --format "{{.State.Health.Status}}" $id 2>$null | Out-String).Trim()
        $running = (& docker inspect --format "{{.State.Running}}" $id 2>$null | Out-String).Trim().ToLowerInvariant()
        if ($health -ne "healthy" -or $running -ne "true") { return $false }
    }
    return $true
}

function Get-GatewayHealthEvidence([string]$Sha) {
    try {
        $body = Invoke-RestMethod -Uri "https://activation-dev.mad4b.com/health" -Method Get -TimeoutSec 15 -ErrorAction Stop
        $source = ([string]$body.sourceCommit).Trim().ToLowerInvariant()
        $worker = ([string]$body.workerBuildSha).Trim().ToLowerInvariant()
        return [pscustomobject]@{
            reachable = $true
            exact = ($body.ok -eq $true -and $body.stale -eq $false -and $source -eq $Sha -and $worker -eq $Sha)
            source_commit = $source
            worker_build_sha = $worker
            stale = $body.stale
            error = $null
        }
    } catch {
        return [pscustomobject]@{ reachable = $false; exact = $false; source_commit = $null; worker_build_sha = $null; stale = $null; error = $_.Exception.Message }
    }
}

function Get-GatewayOnlyRecovery($Runtime, [string]$Sha) {
    if ($null -eq $Runtime) { return $null }
    $runtimeCommit = ([string](Get-OptionalPropertyValue $Runtime "commit")).Trim().ToLowerInvariant()
    if ($runtimeCommit -ne $Sha) { return $null }
    if (-not (Test-LocalDeploymentHealthy $Sha $Runtime)) { return $null }

    # Connector evidence is intentionally independent here. A Connector failure
    # may block final certification, but cannot prevent repair of an independently
    # stale or unavailable Activation Gateway for the same exact local commit.
    $gatewayHealth = Get-GatewayHealthEvidence $Sha
    if ($gatewayHealth.exact) { return $null }
    $reason = if ($gatewayHealth.reachable) { "gateway_exact_commit" } else { "gateway_health_reachable" }
    return [pscustomobject]@{ reasons = @($reason); gateway = $gatewayHealth }
}

function Invoke-ReadOnlyConvergencePreflight([string]$Sha) {
    Enter-DeploymentLease "convergence_preflight" $Sha "converging" 900
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $schemaPreflightScript -RepositoryPath $RepositoryPath -ExpectedCommit $Sha -ReportPath $preflightReportPath
    if ($LASTEXITCODE -ne 0) {
        Fail "Read-only schema/governance preflight blocked Gateway convergence" @{ stage = "convergence"; failure_class = "gateway_convergence_preflight_blocked"; expected_commit = $Sha }
    }
    $report = Read-State $preflightReportPath
    if ($null -eq $report -or [string]$report.status -ne "passed" -or ([string]$report.expected_commit).ToLowerInvariant() -ne $Sha -or ([string]$report.observed_commit).ToLowerInvariant() -ne $Sha) {
        Fail "Read-only schema/governance preflight did not bind to exact commit" @{ stage = "convergence"; failure_class = "gateway_convergence_preflight_not_exact"; expected_commit = $Sha; observed_commit = if ($null -ne $report) { [string]$report.observed_commit } else { "" } }
    }
    if ($report.safety.production_access -ne $false -or $report.safety.provider_access -ne $false -or $report.safety.database_mutation -ne $false -or $report.safety.migration_apply -ne $false) {
        Fail "Gateway convergence preflight violated read-only safety" @{ stage = "convergence"; failure_class = "gateway_convergence_preflight_safety_violation"; expected_commit = $Sha }
    }
}

function Refresh-AppAfterOriginTrustChange([string]$Sha) {
    $compose = @("compose", "-f", $composeBase, "-f", $composeStage, "--env-file", $envFile)
    Enter-DeploymentLease "app_origin_trust_refresh" $Sha "deploying" 300
    & docker @($compose + @("up", "-d", "--no-build", "app"))
    if ($LASTEXITCODE -ne 0) { Fail "App runtime refresh after Gateway trust convergence failed" @{ stage = "convergence"; failure_class = "app_origin_trust_refresh_failed"; expected_commit = $Sha } }
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $id = (& docker @compose ps -q app 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($id)) {
            $health = (& docker inspect --format "{{.State.Health.Status}}" $id 2>$null | Out-String).Trim()
            if ($health -eq "healthy") { return }
            if ($health -eq "unhealthy") { break }
        }
        Start-Sleep -Seconds 2
    }
    Fail "App runtime did not become healthy after non-build trust refresh" @{ stage = "convergence"; failure_class = "app_origin_trust_refresh_unhealthy"; expected_commit = $Sha }
}

function Invoke-GatewayConvergence([string]$Sha, $Recovery) {
    $observed = if ($Recovery.gateway.source_commit) { [string]$Recovery.gateway.source_commit } else { "unavailable" }
    Write-Host "STAGING_CONVERGENCE_REQUIRED: component=activation_gateway expected=$Sha observed=$observed" -ForegroundColor Yellow
    Write-StagingLog -Level warning -Component $LogComponent -Stage "convergence" -Message "Activation Gateway exact-SHA convergence required" -Data @{ failure_class = "gateway_exact_commit_mismatch"; expected_commit = $Sha; observed_commit = $observed; blocking_reason = ($Recovery.reasons -join ",") }
    Invoke-ReadOnlyConvergencePreflight $Sha
    Enter-DeploymentLease "activation_gateway" $Sha "converging" 1200
    if (Test-Path -LiteralPath $convergenceReportPath) { Remove-Item -LiteralPath $convergenceReportPath -Force -ErrorAction SilentlyContinue }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $convergerScript -RepositoryPath $RepositoryPath -ExpectedCommit $Sha -ExpectedRepository $ExpectedRepository -ReportPath $convergenceReportPath
    if ($LASTEXITCODE -ne 0) {
        $after = Get-GatewayHealthEvidence $Sha
        Fail "Activation Gateway convergence failed" @{ stage = "convergence"; failure_class = "gateway_exact_commit_mismatch"; expected_commit = $Sha; observed_commit = [string]$after.source_commit; blocking_reason = ($Recovery.reasons -join ",") }
    }
    $report = Read-State $convergenceReportPath
    if ($null -eq $report -or $report.ready -ne $true -or ([string]$report.expected_commit).ToLowerInvariant() -ne $Sha) {
        Fail "Activation Gateway convergence report is not ready/exact" @{ stage = "convergence"; failure_class = "gateway_convergence_not_ready"; expected_commit = $Sha }
    }
    if ($report.production_mutation -ne $false -or $report.production_deploy -ne $false -or $report.cloudflare_dns_mutation -ne $false -or $report.database_mutation -ne $false -or $report.migration_apply -ne $false) {
        Fail "Activation Gateway convergence crossed a forbidden boundary" @{ stage = "convergence"; failure_class = "gateway_convergence_safety_violation"; expected_commit = $Sha }
    }
    $script:ProviderMutationPerformed = [bool]$report.provider_mutation
    $script:ProviderMutationInitiated = [bool]$report.provider_mutation_initiated
    $script:ProviderMutationScope = if ([string]::IsNullOrWhiteSpace([string]$report.provider_mutation_scope)) { "none" } else { [string]$report.provider_mutation_scope }
    if ($report.origin_trust_updated -eq $true) { Refresh-AppAfterOriginTrustChange $Sha }
    return $report
}

function Invoke-CertificationOnly([string]$Sha) {
    Enter-DeploymentLease "certification" $Sha "certifying" 600
    $certArgs = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $certificationScript, "-RepositoryPath", $RepositoryPath, "-ExpectedCommit", $Sha, "-Ref", $Ref, "-StatePath", $runtimeStatePath)
    $certArgs += @("-TunnelMode", $TunnelMode)
    Write-Host "> powershell.exe -File Invoke-StagingCertification.ps1 (re-certify exact deployed commit)"
    & powershell.exe @certArgs
    if ($LASTEXITCODE -ne 0) {
        $gateway = Get-GatewayHealthEvidence $Sha
        $runtime = Read-State $runtimeStatePath
        $recovery = Get-GatewayOnlyRecovery $runtime $Sha
        $failureClass = if ($null -ne $recovery) { "gateway_exact_commit_mismatch" } else { "certification_blocked" }
        Fail "Re-certification blocked deployed commit $Sha; refusing blind redeploy" @{ stage = "certification"; failure_class = $failureClass; expected_commit = $Sha; observed_commit = [string]$gateway.source_commit; blocking_reason = if ($null -ne $runtime) { (@((Get-OptionalPropertyValue $runtime "certification_blocking_failures")) -join ",") } else { "unavailable" } }
    }
    return Get-CertificationState $runtimeStatePath $Sha
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $scriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$policyPath = Join-Path $scriptRoot "auto-deploy-policy.json"
$statePath = Join-Path $scriptRoot "auto-deploy-state.json"
$runtimeStatePath = Join-Path $scriptRoot "autopilot-state.json"
$startScript = Join-Path $scriptRoot "Start-AutoPilot.ps1"
$certificationScript = Join-Path $scriptRoot "Invoke-StagingCertification.ps1"
$convergerScript = Join-Path $scriptRoot "Converge-StagingActivationGateway.ps1"
$schemaPreflightScript = Join-Path $scriptRoot "Staging-Schema-Governance-Preflight.ps1"
$preflightReportPath = Join-Path (Get-StagingLogRoot) "staging-schema-governance-preflight.json"
$convergenceReportPath = Join-Path (Get-StagingLogRoot) "staging-activation-gateway-convergence.json"
$script:DeploymentLeasePath = Join-Path (Get-StagingLogRoot) "deployment-lease.json"
$apiPath = Join-Path $RepositoryPath "http-generic-api"
$composeBase = Join-Path $apiPath "docker-compose.yml"
$composeStage = Join-Path $apiPath "docker-compose.staging.yml"
$envFile = Join-Path $apiPath ".env.staging"
$Policy = Get-Policy $policyPath
Assert-Policy $Policy $Ref $ExpectedRepository

Require-Command "git"
Require-Command "gh"
Require-Command "powershell"
Require-Command "docker"
if (-not (Test-Path -LiteralPath $startScript)) { Fail "Start-AutoPilot.ps1 is missing: $startScript" }
if (-not (Test-Path -LiteralPath $certificationScript)) { Fail "Invoke-StagingCertification.ps1 is missing: $certificationScript" }
if (-not (Test-Path -LiteralPath $convergerScript)) { Fail "Converge-StagingActivationGateway.ps1 is missing: $convergerScript" }
if (-not (Test-Path -LiteralPath $schemaPreflightScript)) { Fail "Staging-Schema-Governance-Preflight.ps1 is missing: $schemaPreflightScript" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git"))) { Fail "RepositoryPath is not a Git repository: $RepositoryPath" }
try { Assert-StagingOriginIdentity $RepositoryPath $ExpectedRepository }
catch { Fail $_.Exception.Message }
Acquire-AutoPilotRunLock

$previous = Read-State $statePath
$iteration = 0
while ($true) {
    $iteration++
    $sha = Get-RemoteMainSha $RepositoryPath $Ref
    $script:CurrentSha = $sha
    $eligibility = Get-LatestEligibility $Policy $ExpectedRepository $sha
    $script:CurrentEligibility = $eligibility
    $phaseState = New-PhaseState $(if ($eligibility.state -eq "eligible") { "passed" } else { [string]$eligibility.state })
    $script:PhaseState = $phaseState

    $sameDeployedCommit = $previous -and ([string]$previous.deployed_commit).ToLowerInvariant() -eq $sha
    $alreadyCertified = $sameDeployedCommit -and [string]$previous.certification_status -eq "ready" -and ([string]$previous.certified_commit).ToLowerInvariant() -eq $sha
    $observation = ("AUTO_DEPLOY_OBSERVATION: ref={0} sha={1} eligibility={2} reason={3} deployed={4} certified={5}" -f $Ref, $sha, $eligibility.state, $eligibility.reason, $sameDeployedCommit, $alreadyCertified)
    Write-Host $observation
    Write-StagingLog -Level info -Component $LogComponent -Stage "poll" -Message "auto-deploy observation" -Data @{ ref = $Ref; sha = $sha; eligibility = $eligibility.state; reason = $eligibility.reason; deployed = $sameDeployedCommit; certified = $alreadyCertified }

    if ($eligibility.state -eq "eligible") {
        Enter-DeploymentLease "docker_engine" $sha "bootstrapping" 300
        try {
            $dockerReady = Ensure-StagingDockerDesktopReady -TimeoutSeconds 180 -PollSeconds 3
            $phaseState.docker = "ready"
            Write-StagingOperationBoundary -Component $LogComponent -Stage "docker-readiness" -Outcome "success" -Message "Docker Desktop engine is ready" -Data @{ expected_commit = $sha; desktop_started = [bool]$dockerReady.desktop_started; context = [string]$dockerReady.context; attempts = [int]$dockerReady.attempts }
        } catch {
            $phaseState.docker = "blocked"
            Write-AutoDeployState $sha $eligibility $null $false $phaseState "blocked" @{ failure_class = "docker_engine_start_timeout" }
            Fail $_.Exception.Message @{ stage = "docker_readiness"; failure_class = if ($_.Exception.Message -match 'reason=([a-z0-9_]+)') { $Matches[1] } else { "docker_engine_unavailable" }; expected_commit = $sha }
        }
    }

    if ($alreadyCertified) {
        $phaseState.docker = "ready"
        $phaseState.build = "succeeded"
        $phaseState.deployment = "succeeded"
        $phaseState.service_health = "healthy"
        $phaseState.staging_tunnel = if ($TunnelSelected) { "healthy" } else { "not_requested" }
        $phaseState.convergence = "succeeded"
        $phaseState.certification = "ready"
        Write-AutoDeployState $sha $eligibility (Read-State $runtimeStatePath) $false $phaseState "ready"
        Exit-DeploymentLease
        if (-not $Watch) { Release-AutoPilotRunLock; return }
    } elseif ($sameDeployedCommit -and -not $ValidateOnly -and $eligibility.state -eq "eligible") {
        $runtimeBefore = Read-State $runtimeStatePath
        if (Test-LocalDeploymentHealthy $sha $runtimeBefore) {
            $phaseState.build = "succeeded"
            $phaseState.deployment = "succeeded"
            $phaseState.service_health = "healthy"
            $phaseState.staging_tunnel = if ($TunnelSelected) { "healthy" } else { "not_requested" }
            $recovery = Get-GatewayOnlyRecovery $runtimeBefore $sha
            if ($null -ne $recovery) {
                $phaseState.convergence = "required"
                Write-AutoDeployState $sha $eligibility $runtimeBefore $false $phaseState "degraded" @{ failure_class = "gateway_exact_commit_mismatch"; expected_commit = $sha; observed_commit = [string]$recovery.gateway.source_commit }
                [void](Invoke-GatewayConvergence $sha $recovery)
                $phaseState.convergence = "succeeded"
            } else {
                $phaseState.convergence = "succeeded"
            }
        }
        $runtimeState = Invoke-CertificationOnly $sha
        $phaseState.certification = [string]$runtimeState.certification_status
        Write-AutoDeployState $sha $eligibility $runtimeState $false $phaseState $(if ($runtimeState.certification_status -eq "ready") { "ready" } else { "degraded" })
        $previous = Read-State $statePath
        Exit-DeploymentLease
        if ([string]$runtimeState.certification_status -eq "ready") {
            Write-Host "AUTO_DEPLOY_CERTIFIED: staging commit=$sha"
        } else {
            Write-StagingLog -Level warning -Component $LogComponent -Stage "certification" -Message "deployed commit remains degraded; watcher will re-certify without redeploy" -Data @{ sha = $sha; reasons = @($runtimeState.certification_degraded_reasons) }
            if (-not $Watch) { Fail "Staging commit $sha is deployed but not certified ready" @{ stage = "certification"; failure_class = "certification_degraded"; expected_commit = $sha } }
        }
    } elseif ($eligibility.state -eq "eligible") {
        $phaseState.build = if ($ValidateOnly) { "validation_only" } else { "running" }
        $phaseState.deployment = if ($ValidateOnly) { "not_started" } else { "running" }
        Write-AutoDeployState $sha $eligibility $null $ValidateOnly $phaseState "running"
        Enter-DeploymentLease "local_deployment" $sha "deploying" 1200
        $pilotArgs = @("-RepositoryPath", $RepositoryPath, "-RepositoryUrl", $RepositoryUrl, "-ExpectedRepository", $ExpectedRepository, "-Ref", $Ref, "-ExpectedCommit", $sha, "-BuildMode", $BuildMode)
        $pilotArgs += @("-TunnelMode", $TunnelMode)
        if ($ValidateOnly) { $pilotArgs += "-ValidateOnly" }
        Write-Host ("> powershell.exe -File Start-AutoPilot.ps1 {0}" -f ($pilotArgs -join " "))
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $startScript @pilotArgs
        $pilotExitCode = $LASTEXITCODE
        if ($ValidateOnly) {
            if ($pilotExitCode -ne 0) { Fail "Start-AutoPilot.ps1 validation failed for eligible commit $sha" @{ stage = "validation"; failure_class = "autopilot_validation_failed"; expected_commit = $sha } }
            $phaseState.build = "validated"
            Write-AutoDeployState $sha $eligibility $null $true $phaseState "validated"
            Write-Host "AUTO_DEPLOY_VALIDATED: staging commit=$sha; deployment state was not advanced"
            Exit-DeploymentLease
            if (-not $Watch) { Release-AutoPilotRunLock; return }
            $previous = Read-State $statePath
        } else {
            $runtimeCandidate = Read-State $runtimeStatePath
            $localHealthy = Test-LocalDeploymentHealthy $sha $runtimeCandidate
            if ($localHealthy) {
                $phaseState.build = "succeeded"
                $phaseState.deployment = "succeeded"
                $phaseState.service_health = "healthy"
                $phaseState.staging_tunnel = if ($TunnelSelected) { "healthy" } else { "not_requested" }
            }

            if ($pilotExitCode -ne 0) {
                $recovery = if ($localHealthy) { Get-GatewayOnlyRecovery $runtimeCandidate $sha } else { $null }
                if ($null -ne $recovery) {
                    $phaseState.convergence = "required"
                    $phaseState.certification = "not_completed"
                    Write-AutoDeployState $sha $eligibility $runtimeCandidate $false $phaseState "degraded" @{ failure_class = "gateway_exact_commit_mismatch"; expected_commit = $sha; observed_commit = [string]$recovery.gateway.source_commit }
                    [void](Invoke-GatewayConvergence $sha $recovery)
                    $phaseState.convergence = "succeeded"
                    $runtimeState = Invoke-CertificationOnly $sha
                } else {
                    $gateway = Get-GatewayHealthEvidence $sha
                    $blocking = if ($null -ne $runtimeCandidate) { @((Get-OptionalPropertyValue $runtimeCandidate "certification_blocking_failures")) -join "," } else { "unavailable" }
                    $failureClass = if (-not $localHealthy) { "local_deployment_failed" } elseif ($blocking) { "certification_blocked" } else { "autopilot_failed" }
                    $phaseState.deployment = if ($localHealthy) { "succeeded" } else { "failed" }
                    $phaseState.service_health = if ($localHealthy) { "healthy" } else { "unknown" }
                    $phaseState.convergence = if ($localHealthy) { "blocked" } else { "not_started" }
                    Write-AutoDeployState $sha $eligibility $runtimeCandidate $false $phaseState "blocked" @{ failure_class = $failureClass; expected_commit = $sha; observed_commit = [string]$gateway.source_commit; blocking_reason = $blocking }
                    Fail "Start-AutoPilot.ps1 failed for eligible commit $sha" @{ stage = if ($localHealthy) { "certification" } else { "deployment" }; failure_class = $failureClass; expected_commit = $sha; observed_commit = [string]$gateway.source_commit; blocking_reason = $blocking }
                }
            } else {
                $runtimeState = Get-CertificationState $runtimeStatePath $sha
                $phaseState.convergence = "succeeded"
            }

            $phaseState.certification = [string]$runtimeState.certification_status
            Write-AutoDeployState $sha $eligibility $runtimeState $false $phaseState $(if ($runtimeState.certification_status -eq "ready") { "ready" } else { "degraded" })
            Write-Host "AUTO_DEPLOY_APPLIED: staging commit=$sha tunnel_mode=$TunnelMode certification=$($runtimeState.certification_status) phases=eligibility:$($phaseState.eligibility),build:$($phaseState.build),deployment:$($phaseState.deployment),service_health:$($phaseState.service_health),convergence:$($phaseState.convergence),certification:$($phaseState.certification)"
            Write-StagingOperationBoundary -Component $LogComponent -Stage "deploy" -Outcome "success" -Message "eligible Staging commit applied" -Data @{ sha = $sha; tunnel_started = [bool]$TunnelSelected; tunnel_mode = $TunnelMode; provider_mutation_authorized = $false; provider_mutation = [bool]$script:ProviderMutationPerformed; provider_mutation_scope = [string]$script:ProviderMutationScope; certification_status = $runtimeState.certification_status; deployment = $phaseState.deployment; convergence = $phaseState.convergence }
            Exit-DeploymentLease
            if ([string]$runtimeState.certification_status -eq "degraded" -and -not $Watch) { Fail "Staging commit $sha is running but not certified ready" @{ stage = "certification"; failure_class = "certification_degraded"; expected_commit = $sha } }
            if (-not $Watch) { Release-AutoPilotRunLock; return }
            $previous = Read-State $statePath
        }
    } elseif ($eligibility.state -eq "blocked") {
        $phaseState.eligibility = "blocked"
        Write-AutoDeployState $sha $eligibility $null $false $phaseState "blocked" @{ failure_class = "eligibility_blocked"; expected_commit = $sha; blocking_reason = [string]$eligibility.reason }
        Fail "main commit $sha is blocked by CI eligibility: $($eligibility.reason)" @{ stage = "eligibility"; failure_class = "eligibility_blocked"; expected_commit = $sha; blocking_reason = [string]$eligibility.reason }
    } elseif (-not $Watch) {
        $phaseState.eligibility = "pending"
        Write-AutoDeployState $sha $eligibility $null $false $phaseState "pending"
        Fail "main commit $sha is not yet eligible: $($eligibility.reason)" @{ stage = "eligibility"; failure_class = "eligibility_pending"; expected_commit = $sha; blocking_reason = [string]$eligibility.reason }
    }

    if (-not $Watch) { Exit-DeploymentLease; Release-AutoPilotRunLock; return }
    Exit-DeploymentLease
    Write-StagingLog -Level info -Component $LogComponent -Stage "sleep" -Message "watcher sleeping before next poll" -Data @{ seconds = $PollSeconds }
    Start-Sleep -Seconds $PollSeconds
}
