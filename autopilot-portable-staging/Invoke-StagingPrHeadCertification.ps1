[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$PrNumber,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedCommit,
    [Parameter(Mandatory = $true)]
    [string]$Ref,
    [string]$RepositoryPath = "",
    [string]$ExpectedRepository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    [ValidateSet("disabled", "windows_service", "docker_sidecar")]
    [string]$TunnelMode = "windows_service",
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart",
    [Parameter(Mandatory = $true)]
    [ValidateSet("CERTIFY_STAGING_PR_HEAD")]
    [string]$Confirmation,
    [string]$EvidencePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "STAGING_PR_HEAD_CERTIFICATION_FAIL_CLOSED: $Message"
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail "Required command is missing: $Name"
    }
}

function Get-OptionalPropertyValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-VerifiedPullRequest([string]$Stage) {
    $raw = & gh api `
        -H "Accept: application/vnd.github+json" `
        -H "X-GitHub-Api-Version: 2022-11-28" `
        "repos/$ExpectedRepository/pulls/$PrNumber" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Fail "GitHub pull-request readback failed during $Stage"
    }

    try {
        $pr = ($raw | Out-String) | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Fail "GitHub pull-request readback was not valid JSON during $Stage"
    }

    if ([string]$pr.state -ne "open") { Fail "Pull request must remain open during $Stage" }
    if ([bool]$pr.draft) { Fail "Draft pull requests cannot certify live Staging during $Stage" }
    if ([string]$pr.base.ref -ne "main") { Fail "Pull request base must remain main during $Stage" }
    if ([string]$pr.head.repo.full_name -ne $ExpectedRepository) { Fail "Cross-repository pull requests are forbidden during $Stage" }
    if ([string]$pr.head.ref -ne $Ref) { Fail "Pull request head ref changed during $Stage" }
    if (([string]$pr.head.sha).ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant()) {
        Fail "Pull request head SHA changed during $Stage"
    }

    return [pscustomobject]@{
        stage = $Stage
        repository = $ExpectedRepository
        pr_number = $PrNumber
        state = [string]$pr.state
        draft = [bool]$pr.draft
        base_ref = [string]$pr.base.ref
        head_ref = [string]$pr.head.ref
        head_sha = ([string]$pr.head.sha).ToLowerInvariant()
        checked_at = (Get-Date).ToUniversalTime().ToString("o")
    }
}

if ($Confirmation -ne "CERTIFY_STAGING_PR_HEAD") { Fail "Explicit typed confirmation is required" }
if ($ExpectedRepository -ne "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os") {
    Fail "PR-head certification is bound to the canonical repository"
}
if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') { Fail "ExpectedCommit must be an exact 40-character SHA" }
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
if ($Ref -notmatch '^(gpt|cert|fix|feat|chore|docs|release)/[A-Za-z0-9._/-]+$') {
    Fail "Ref is not an approved governed work branch"
}
if ($Ref -eq "main" -or $Ref -eq "Production") {
    Fail "PR-head certification cannot target a protected branch"
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
} else {
    $RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
}
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $profileRoot = if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) { $env:USERPROFILE } else { [Environment]::GetFolderPath("UserProfile") }
    if ([string]::IsNullOrWhiteSpace($profileRoot)) { Fail "User profile path is unavailable for default certification evidence" }
    $evidenceDirectory = Join-Path $profileRoot "MAD4B-Staging-Evidence"
    $EvidencePath = Join-Path $evidenceDirectory ("staging-pr-head-certification-pr{0}-{1}.json" -f $PrNumber, $ExpectedCommit)
} else {
    $EvidencePath = [IO.Path]::GetFullPath($EvidencePath)
}

Require-Command "gh"
Require-Command "git"
Require-Command "powershell.exe"

$startAutoPilot = Join-Path $RepositoryPath "autopilot-portable-staging\Start-AutoPilot.ps1"
$statePath = Join-Path $RepositoryPath "autopilot-portable-staging\autopilot-state.json"
if (-not (Test-Path -LiteralPath $startAutoPilot -PathType Leaf)) {
    Fail "Start-AutoPilot.ps1 is missing: $startAutoPilot"
}

$preflight = Get-VerifiedPullRequest "preflight"

$previousAuthorityMode = $env:STAGING_CERT_AUTHORITY_MODE
$previousPrNumber = $env:STAGING_CERT_PR_NUMBER
$previousPrRepository = $env:STAGING_CERT_PR_REPOSITORY
try {
    $env:STAGING_CERT_AUTHORITY_MODE = "pull_request_head"
    $env:STAGING_CERT_PR_NUMBER = [string]$PrNumber
    $env:STAGING_CERT_PR_REPOSITORY = $ExpectedRepository

    $pilotArgs = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $startAutoPilot,
        "-RepositoryPath", $RepositoryPath,
        "-ExpectedRepository", $ExpectedRepository,
        "-Ref", $Ref,
        "-ExpectedCommit", $ExpectedCommit,
        "-TunnelMode", $TunnelMode,
        "-BuildMode", $BuildMode
    )
    & powershell.exe @pilotArgs
    $pilotExitCode = [int]$LASTEXITCODE
    if ($pilotExitCode -ne 0) {
        Fail "Start-AutoPilot.ps1 failed for the exact PR head with exit code $pilotExitCode"
    }
} finally {
    $env:STAGING_CERT_AUTHORITY_MODE = $previousAuthorityMode
    $env:STAGING_CERT_PR_NUMBER = $previousPrNumber
    $env:STAGING_CERT_PR_REPOSITORY = $previousPrRepository
}

$postflight = Get-VerifiedPullRequest "postflight"

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    Fail "Auto Pilot state is missing after certification: $statePath"
}
try {
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json -ErrorAction Stop
} catch {
    Fail "Auto Pilot state is invalid after certification"
}

$certificationStatus = [string](Get-OptionalPropertyValue $state "certification_status")
$certificationReady = Get-OptionalPropertyValue $state "certification_ready"
$certifiedCommit = ([string](Get-OptionalPropertyValue $state "certified_commit")).ToLowerInvariant()
$certifiedBranch = [string](Get-OptionalPropertyValue $state "certified_branch")
$artifactSetComplete = Get-OptionalPropertyValue $state "artifact_set_complete"
$certificationAuthorityMode = [string](Get-OptionalPropertyValue $state "certification_authority_mode")
$gatewayCertificationScope = [string](Get-OptionalPropertyValue $state "gateway_certification_scope")

if ($certificationAuthorityMode -ne "pull_request_head") { Fail "Live certification did not retain PR-head authority mode" }
if ($gatewayCertificationScope -ne "excluded_external_gateway") { Fail "PR-head certification must exclude external Activation Gateway authority" }
if ($certificationStatus -ne "ready" -or $certificationReady -ne $true) {
    Fail "Gate X0 requires live Staging certification status=ready"
}
if ($certifiedCommit -ne $ExpectedCommit) { Fail "Certified commit does not match the exact PR head" }
if ($certifiedBranch -ne $Ref) { Fail "Certified branch does not match the exact PR head ref" }
if ($artifactSetComplete -ne $true) { Fail "Live Staging artifact set is incomplete" }

$safetyFields = [ordered]@{
    production_deploy = Get-OptionalPropertyValue $state "production_deploy"
    database_mutated = Get-OptionalPropertyValue $state "database_mutated"
    migration_applied = Get-OptionalPropertyValue $state "migration_applied"
    provider_mutation = Get-OptionalPropertyValue $state "provider_mutation"
    ruleset_mutation = Get-OptionalPropertyValue $state "ruleset_mutation"
    secrets_included = Get-OptionalPropertyValue $state "secrets_included"
}
foreach ($entry in $safetyFields.GetEnumerator()) {
    if ($entry.Value -ne $false) {
        Fail "Certification safety field must be exactly false: $($entry.Key)"
    }
}

$evidence = [ordered]@{
    contract = "mad4b.staging-pr-head-live-certification.v1"
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    outcome = "passed"
    repository = $ExpectedRepository
    pr_number = $PrNumber
    ref = $Ref
    exact_head_sha = $ExpectedCommit
    preflight = $preflight
    postflight = $postflight
    live_staging_certification = [ordered]@{
        contract = [string](Get-OptionalPropertyValue $state "certification_contract")
        status = $certificationStatus
        ready = [bool]$certificationReady
        certified_commit = $certifiedCommit
        certified_branch = $certifiedBranch
        artifact_set_complete = [bool]$artifactSetComplete
        app_image_digest = [string](Get-OptionalPropertyValue $state "app_image_digest")
        app_tree_sha = [string](Get-OptionalPropertyValue $state "app_tree_sha")
        app_context_file_set_sha256 = [string](Get-OptionalPropertyValue $state "app_context_file_set_sha256")
        database_readiness = [string](Get-OptionalPropertyValue $state "database_readiness")
        local_connector_tunnel_status = [string](Get-OptionalPropertyValue $state "local_connector_tunnel_status")
        tunnel_mode = [string](Get-OptionalPropertyValue $state "tunnel_mode")
        authority_mode = $certificationAuthorityMode
        scope = "local_windows_compose_runtime_exact_pr_head"
        gateway_certification_scope = $gatewayCertificationScope
        gateway_configured = [bool](Get-OptionalPropertyValue $state "gateway_configured")
        gateway_required = [bool](Get-OptionalPropertyValue $state "gateway_required")
        checked_at = [string](Get-OptionalPropertyValue $state "certification_checked_at")
    }
    safety = $safetyFields
    source_of_truth = "local_windows_runtime_plus_exact_github_pr_readback"
    source_tree_self_attestation = $false
    release_certification = $false
    external_gateway_mutation = $false
    production_mutation_allowed = $false
    secrets_included = $false
}

$evidenceDirectory = Split-Path -Parent $EvidencePath
if (-not [string]::IsNullOrWhiteSpace($evidenceDirectory)) {
    New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
}
Set-Content -LiteralPath $EvidencePath -Encoding utf8 -Value ($evidence | ConvertTo-Json -Depth 10)

Write-Host "STAGING_PR_HEAD_CERTIFICATION_READY: pr=$PrNumber ref=$Ref commit=$ExpectedCommit evidence=$EvidencePath" -ForegroundColor Green
