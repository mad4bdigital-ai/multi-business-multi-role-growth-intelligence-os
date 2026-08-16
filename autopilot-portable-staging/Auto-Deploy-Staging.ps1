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
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$LogComponent = "auto-deploy"
Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "auto-deploy process started" -Data @{ watch = [bool]$Watch; ref = $Ref; poll_seconds = $PollSeconds }
trap {
    Write-StagingLog -Level error -Component $LogComponent -Stage "unhandled" -Message $_.Exception.Message -Data @{ error_type = $_.Exception.GetType().FullName }
    Write-Host "AUTO_DEPLOY_FAILURE_LOGGED: $(Get-StagingLogRoot)" -ForegroundColor Red
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
    Set-Content -Encoding utf8 -LiteralPath $Path -Value ($Value | ConvertTo-Json -Depth 6)
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $scriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$policyPath = Join-Path $scriptRoot "auto-deploy-policy.json"
$statePath = Join-Path $scriptRoot "auto-deploy-state.json"
$startScript = Join-Path $scriptRoot "Start-AutoPilot.ps1"
$Policy = Get-Policy $policyPath
Assert-Policy $Policy $Ref $ExpectedRepository

Require-Command "git"
Require-Command "gh"
Require-Command "powershell"
if (-not (Test-Path -LiteralPath $startScript)) { Fail "Start-AutoPilot.ps1 is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git"))) { Fail "RepositoryPath is not a Git repository: $RepositoryPath" }

$previous = Read-State $statePath
$iteration = 0
while ($true) {
    $iteration++
    $sha = Get-RemoteMainSha $RepositoryPath $Ref
    $eligibility = Get-LatestEligibility $Policy $ExpectedRepository $sha
    $alreadyDeployed = $previous -and ([string]$previous.deployed_commit).ToLowerInvariant() -eq $sha
    $observation = ("AUTO_DEPLOY_OBSERVATION: ref={0} sha={1} eligibility={2} reason={3} already_deployed={4}" -f $Ref, $sha, $eligibility.state, $eligibility.reason, $alreadyDeployed)
    Write-Host $observation
    Write-StagingLog -Level info -Component $LogComponent -Stage "poll" -Message "auto-deploy observation" -Data @{ ref = $Ref; sha = $sha; eligibility = $eligibility.state; reason = $eligibility.reason; already_deployed = $alreadyDeployed }

    if ($alreadyDeployed) {
        if (-not $Watch) { return }
    } elseif ($eligibility.state -eq "eligible") {
        $pilotArgs = @("-RepositoryPath", $RepositoryPath, "-Ref", $Ref, "-ExpectedCommit", $sha)
        if ($StartTunnel) { $pilotArgs += "-StartTunnel" }
        if ($ValidateOnly) { $pilotArgs += "-ValidateOnly" }
        if ($SkipBuild) { $pilotArgs += "-SkipBuild" }
        Write-Host ("> powershell.exe -File Start-AutoPilot.ps1 {0}" -f ($pilotArgs -join " "))
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $startScript @pilotArgs
        if ($LASTEXITCODE -ne 0) { Fail "Start-AutoPilot.ps1 failed for eligible commit $sha" }
        Write-State $statePath @{
            deployed_commit = $sha
            ref = $Ref
            eligibility_check = $Policy.eligibility_check_name
            eligibility_completed_at = $eligibility.completed_at
            tunnel_started = [bool]$StartTunnel
            validate_only = [bool]$ValidateOnly
            production_deploy = $false
            database_mutated = $false
            migration_applied = $false
            generated_at = (Get-Date).ToUniversalTime().ToString("o")
        }
        Write-Host "AUTO_DEPLOY_APPLIED: staging commit=$sha tunnel=$StartTunnel"
        Write-StagingOperationBoundary -Component $LogComponent -Stage "deploy" -Outcome "success" -Message "eligible Staging commit applied" -Data @{ sha = $sha; tunnel_started = [bool]$StartTunnel; validate_only = [bool]$ValidateOnly }
        if (-not $Watch) { return }
        $previous = Read-State $statePath
    } elseif ($eligibility.state -eq "blocked") {
        Fail "main commit $sha is blocked by CI eligibility: $($eligibility.reason)"
    } elseif (-not $Watch) {
        Fail "main commit $sha is not yet eligible: $($eligibility.reason)"
    }

    if (-not $Watch) { return }
    Write-StagingLog -Level info -Component $LogComponent -Stage "sleep" -Message "watcher sleeping before next poll" -Data @{ seconds = $PollSeconds }
    Start-Sleep -Seconds $PollSeconds
}
