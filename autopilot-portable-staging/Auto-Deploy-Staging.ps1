[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$RepositoryUrl = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    [string]$Ref = "main",
    [string]$ExpectedRepository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    [int]$PollSeconds = 300,
    [switch]$Watch,
    [switch]$StartTunnel,
    [switch]$ValidateOnly,
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart",
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
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
$LogComponent = "auto-deploy"
$script:AutoPilotRunMutex = $null
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
    Write-StagingLog -Level error -Component $LogComponent -Stage "unhandled" -Message $_.Exception.Message -Data @{ error_type = $_.Exception.GetType().FullName }
    Write-Host "AUTO_DEPLOY_FAILURE_LOGGED: $(Get-StagingLogRoot)" -ForegroundColor Red
    Release-AutoPilotRunLock
    exit 1
}

function Fail([string]$Message) {
    Write-StagingLog -Level error -Component $LogComponent -Stage "fail_closed" -Message $Message
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

function Write-State([string]$Path, [hashtable]$Value) {
    Set-Content -Encoding utf8 -LiteralPath $Path -Value ($Value | ConvertTo-Json -Depth 8)
}

function Get-CertificationState([string]$RuntimeStatePath, [string]$Sha) {
    $runtime = Read-State $RuntimeStatePath
    if (-not $runtime) { Fail "Staging runtime state is missing after deployment/certification" }
    if ([string]$runtime.commit -ne $Sha) { Fail "Staging runtime state commit mismatch after deployment/certification" }
    if ([string]$runtime.certified_commit -and ([string]$runtime.certified_commit).ToLowerInvariant() -ne $Sha) { Fail "Staging certified commit mismatch" }
    if ([string]$runtime.certified_branch -and [string]$runtime.certified_branch -ne $Ref) { Fail "Staging certified branch mismatch" }
    if ([string]$runtime.certification_status -notin @("ready", "degraded")) { Fail "Staging runtime state has unsupported certification status" }
    return $runtime
}

function Write-AutoDeployState([string]$Sha, $Eligibility, $Runtime, [bool]$ValidatedOnly) {
    if ($ValidatedOnly) {
        Write-State $statePath @{
            validated_commit = $Sha
            ref = $Ref
            eligibility_check = $Policy.eligibility_check_name
            eligibility_completed_at = $Eligibility.completed_at
            validate_only = $true
            production_deploy = $false
            database_mutated = $false
            migration_applied = $false
            generated_at = (Get-Date).ToUniversalTime().ToString("o")
        }
        return
    }
    Write-State $statePath @{
        deployed_commit = $Sha
        ref = $Ref
        eligibility_check = $Policy.eligibility_check_name
        eligibility_completed_at = $Eligibility.completed_at
        tunnel_started = [bool]$StartTunnel
        validate_only = $false
        certification_contract = [string]$Runtime.certification_contract
        certification_status = [string]$Runtime.certification_status
        certification_ready = ($Runtime.certification_ready -eq $true)
        certified_commit = [string]$Runtime.certified_commit
        certified_branch = [string]$Runtime.certified_branch
        certification_degraded_reasons = @($Runtime.certification_degraded_reasons)
        database_readiness = [string]$Runtime.database_readiness
        production_deploy = $false
        database_mutated = $false
        migration_applied = $false
        provider_mutation = $false
        ruleset_mutation = $false
        secrets_included = $false
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
    }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $scriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$policyPath = Join-Path $scriptRoot "auto-deploy-policy.json"
$statePath = Join-Path $scriptRoot "auto-deploy-state.json"
$runtimeStatePath = Join-Path $scriptRoot "autopilot-state.json"
$startScript = Join-Path $scriptRoot "Start-AutoPilot.ps1"
$certificationScript = Join-Path $scriptRoot "Invoke-StagingCertification.ps1"
$Policy = Get-Policy $policyPath
Assert-Policy $Policy $Ref $ExpectedRepository

Require-Command "git"
Require-Command "gh"
Require-Command "powershell"
if (-not (Test-Path -LiteralPath $startScript)) { Fail "Start-AutoPilot.ps1 is missing: $startScript" }
if (-not (Test-Path -LiteralPath $certificationScript)) { Fail "Invoke-StagingCertification.ps1 is missing: $certificationScript" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git"))) { Fail "RepositoryPath is not a Git repository: $RepositoryPath" }
try { Assert-StagingOriginIdentity $RepositoryPath $ExpectedRepository }
catch { Fail $_.Exception.Message }
Acquire-AutoPilotRunLock

$previous = Read-State $statePath
$iteration = 0
while ($true) {
    $iteration++
    $sha = Get-RemoteMainSha $RepositoryPath $Ref
    $eligibility = Get-LatestEligibility $Policy $ExpectedRepository $sha
    $sameDeployedCommit = $previous -and ([string]$previous.deployed_commit).ToLowerInvariant() -eq $sha
    $alreadyCertified = $sameDeployedCommit -and [string]$previous.certification_status -eq "ready" -and ([string]$previous.certified_commit).ToLowerInvariant() -eq $sha
    $observation = ("AUTO_DEPLOY_OBSERVATION: ref={0} sha={1} eligibility={2} reason={3} deployed={4} certified={5}" -f $Ref, $sha, $eligibility.state, $eligibility.reason, $sameDeployedCommit, $alreadyCertified)
    Write-Host $observation
    Write-StagingLog -Level info -Component $LogComponent -Stage "poll" -Message "auto-deploy observation" -Data @{ ref = $Ref; sha = $sha; eligibility = $eligibility.state; reason = $eligibility.reason; deployed = $sameDeployedCommit; certified = $alreadyCertified }

    if ($alreadyCertified) {
        if (-not $Watch) { Release-AutoPilotRunLock; return }
    } elseif ($sameDeployedCommit -and -not $ValidateOnly -and $eligibility.state -eq "eligible") {
        $certArgs = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $certificationScript, "-RepositoryPath", $RepositoryPath, "-ExpectedCommit", $sha, "-Ref", $Ref, "-StatePath", $runtimeStatePath)
        if ($StartTunnel) { $certArgs += "-StartTunnel" }
        Write-Host "> powershell.exe -File Invoke-StagingCertification.ps1 (re-certify exact deployed commit)"
        & powershell.exe @certArgs
        if ($LASTEXITCODE -ne 0) { Fail "Re-certification blocked deployed commit $sha; refusing blind redeploy" }
        $runtimeState = Get-CertificationState $runtimeStatePath $sha
        Write-AutoDeployState $sha $eligibility $runtimeState $false
        $previous = Read-State $statePath
        if ([string]$runtimeState.certification_status -eq "ready") {
            Write-Host "AUTO_DEPLOY_CERTIFIED: staging commit=$sha"
        } else {
            Write-StagingLog -Level warning -Component $LogComponent -Stage "certification" -Message "deployed commit remains degraded; watcher will re-certify without redeploy" -Data @{ sha = $sha; reasons = @($runtimeState.certification_degraded_reasons) }
            if (-not $Watch) { Fail "Staging commit $sha is deployed but not certified ready" }
        }
    } elseif ($eligibility.state -eq "eligible") {
        $pilotArgs = @("-RepositoryPath", $RepositoryPath, "-RepositoryUrl", $RepositoryUrl, "-ExpectedRepository", $ExpectedRepository, "-Ref", $Ref, "-ExpectedCommit", $sha, "-BuildMode", $BuildMode)
        if ($StartTunnel) { $pilotArgs += "-StartTunnel" }
        if ($ValidateOnly) { $pilotArgs += "-ValidateOnly" }
        Write-Host ("> powershell.exe -File Start-AutoPilot.ps1 {0}" -f ($pilotArgs -join " "))
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $startScript @pilotArgs
        if ($LASTEXITCODE -ne 0) { Fail "Start-AutoPilot.ps1 failed for eligible commit $sha" }
        if ($ValidateOnly) {
            Write-AutoDeployState $sha $eligibility $null $true
            Write-Host "AUTO_DEPLOY_VALIDATED: staging commit=$sha; deployment state was not advanced"
            if (-not $Watch) { Release-AutoPilotRunLock; return }
            $previous = Read-State $statePath
        } else {
            $runtimeState = Get-CertificationState $runtimeStatePath $sha
            Write-AutoDeployState $sha $eligibility $runtimeState $false
            Write-Host "AUTO_DEPLOY_APPLIED: staging commit=$sha tunnel=$StartTunnel certification=$($runtimeState.certification_status)"
            Write-StagingOperationBoundary -Component $LogComponent -Stage "deploy" -Outcome "success" -Message "eligible Staging commit applied" -Data @{ sha = $sha; tunnel_started = [bool]$StartTunnel; certification_status = $runtimeState.certification_status }
            if ([string]$runtimeState.certification_status -eq "degraded" -and -not $Watch) { Fail "Staging commit $sha is running but not certified ready" }
            if (-not $Watch) { Release-AutoPilotRunLock; return }
            $previous = Read-State $statePath
        }
    } elseif ($eligibility.state -eq "blocked") {
        Fail "main commit $sha is blocked by CI eligibility: $($eligibility.reason)"
    } elseif (-not $Watch) {
        Fail "main commit $sha is not yet eligible: $($eligibility.reason)"
    }

    if (-not $Watch) { Release-AutoPilotRunLock; return }
    Write-StagingLog -Level info -Component $LogComponent -Stage "sleep" -Message "watcher sleeping before next poll" -Data @{ seconds = $PollSeconds }
    Start-Sleep -Seconds $PollSeconds
}
