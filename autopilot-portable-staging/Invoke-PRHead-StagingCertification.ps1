[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath,
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$PullRequestNumber,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedCommit,
    [Parameter(Mandatory = $true)]
    [string]$Ref,
    [string]$ExpectedRepository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    [string]$RepositoryUrl = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    [ValidateSet("disabled", "windows_service", "docker_sidecar")]
    [string]$TunnelMode = "windows_service",
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "STAGING_PR_HEAD_CERTIFICATION_FAIL_CLOSED: $Message"
}

function Get-ExactPullRequestEvidence {
    if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') { Fail "ExpectedCommit must be an exact 40-character SHA" }
    if ([string]::IsNullOrWhiteSpace($Ref) -or $Ref -eq "main") { Fail "PR-head certification requires a non-main branch ref" }
    if ($ExpectedRepository -ne "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os") { Fail "Unexpected repository identity" }
    if ($null -eq (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "GitHub CLI is required for read-only PR-head attestation" }

    $raw = (& gh api "repos/$ExpectedRepository/pulls/$PullRequestNumber" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { Fail "GitHub PR readback failed" }
    try { $pr = $raw | ConvertFrom-Json -ErrorAction Stop } catch { Fail "GitHub PR readback returned invalid JSON" }

    if ([string]$pr.state -ne "open") { Fail "Pull request must remain open" }
    if ($pr.draft -eq $true) { Fail "Draft pull requests cannot authorize live Staging certification" }
    if ([string]$pr.base.ref -ne "main") { Fail "Pull request base must be main" }
    if ([string]$pr.head.repo.full_name -ne $ExpectedRepository) { Fail "Pull request head repository mismatch" }
    if ([string]$pr.head.ref -ne $Ref) { Fail "Pull request head ref mismatch" }
    if (([string]$pr.head.sha).ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant()) { Fail "Pull request head SHA moved from ExpectedCommit" }
    if ([int]$pr.changed_files -gt 100) { Fail "PR-head certification is bounded to at most 100 changed files" }

    $filesRaw = (& gh api "repos/$ExpectedRepository/pulls/$PullRequestNumber/files?per_page=100" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($filesRaw)) { Fail "GitHub PR file readback failed" }
    try { $files = @($filesRaw | ConvertFrom-Json -ErrorAction Stop) } catch { Fail "GitHub PR file readback returned invalid JSON" }
    $gatewayPaths = @($files | ForEach-Object { [string]$_.filename } | Where-Object {
        $_ -match '^(edge/activation-gateway/|http-generic-api/activation-gateway-runtime/|autopilot-portable-staging/Converge-StagingActivationGateway\.ps1$|http-generic-api/scripts/build-staging-worker\.mjs$|\.github/workflows/staging-activation-worker\.yml$)'
    })
    if ($gatewayPaths.Count -gt 0) { Fail "PR-head app-runtime certification cannot cover Activation Gateway changes: $($gatewayPaths -join ',')" }

    return $pr
}

$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$startScript = Join-Path $RepositoryPath "autopilot-portable-staging\Start-AutoPilot.ps1"
$statePath = Join-Path $RepositoryPath "autopilot-portable-staging\autopilot-state.json"
$logDirectory = Join-Path $RepositoryPath "autopilot-portable-staging\logs"
$evidencePath = Join-Path $logDirectory "pr-head-staging-certification-$($ExpectedCommit.ToLowerInvariant()).json"
if (-not (Test-Path -LiteralPath $startScript -PathType Leaf)) { Fail "Start-AutoPilot.ps1 is missing" }

[void](Get-ExactPullRequestEvidence)

$env:MAD4B_STAGING_PR_HEAD_CERTIFICATION_PR = [string]$PullRequestNumber
$env:MAD4B_STAGING_PR_HEAD_CERTIFICATION_REF = $Ref
$env:MAD4B_STAGING_PR_HEAD_CERTIFICATION_SHA = $ExpectedCommit.ToLowerInvariant()
$env:MAD4B_STAGING_PR_HEAD_CERTIFICATION_SCOPE = "app_runtime_only"

$pilotArgs = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $startScript,
    "-RepositoryPath", $RepositoryPath,
    "-RepositoryUrl", $RepositoryUrl,
    "-ExpectedRepository", $ExpectedRepository,
    "-Ref", $Ref,
    "-ExpectedCommit", $ExpectedCommit,
    "-TunnelMode", $TunnelMode,
    "-BuildMode", $BuildMode
)
& powershell.exe @pilotArgs
$pilotExitCode = [int]$LASTEXITCODE
if ($pilotExitCode -ne 0) { Fail "Start-AutoPilot failed during PR-head certification with exit code $pilotExitCode" }

# Close the race window: the PR must still point at the same exact head after
# the live run finishes, otherwise the evidence is stale and must not be used.
[void](Get-ExactPullRequestEvidence)

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { Fail "Auto Pilot certification state is missing" }
try { $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json -ErrorAction Stop } catch { Fail "Auto Pilot certification state is invalid JSON" }
if ([string]$state.certification_status -ne "ready" -or $state.certification_ready -ne $true) { Fail "PR-head Gate X0 requires certification_status=ready" }
if (([string]$state.certified_commit).ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant()) { Fail "Certified commit does not match ExpectedCommit" }
if ([string]$state.certified_branch -ne $Ref) { Fail "Certified branch does not match Ref" }
if ($state.artifact_set_complete -ne $true) { Fail "Certified artifact set is incomplete" }

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$evidence = [ordered]@{
    contract = "mad4b.staging-pr-head-live-certification.v1"
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    repository = $ExpectedRepository
    pull_request_number = $PullRequestNumber
    ref = $Ref
    expected_commit = $ExpectedCommit.ToLowerInvariant()
    certification_contract = [string]$state.certification_contract
    certification_status = [string]$state.certification_status
    certification_ready = [bool]$state.certification_ready
    certified_commit = [string]$state.certified_commit
    certified_branch = [string]$state.certified_branch
    artifact_set_complete = [bool]$state.artifact_set_complete
    app_image_digest = [string]$state.app_image_digest
    app_tree_sha = [string]$state.app_tree_sha
    app_context_file_set_sha256 = [string]$state.app_context_file_set_sha256
    gateway_scope = "not_required_for_app_runtime_only_pr"
    pull_request_revalidated_after_certification = $true
    safety = [ordered]@{
        github_mutation = $false
        production_deploy = $false
        database_mutation = $false
        migration_apply = $false
        provider_mutation = $false
        ruleset_mutation = $false
        secrets_included = $false
    }
}
Set-Content -LiteralPath $evidencePath -Encoding utf8 -Value ($evidence | ConvertTo-Json -Depth 8)
Write-Host "STAGING_PR_HEAD_CERTIFICATION_READY: pr=$PullRequestNumber ref=$Ref commit=$($ExpectedCommit.ToLowerInvariant()) evidence=$evidencePath" -ForegroundColor Green
