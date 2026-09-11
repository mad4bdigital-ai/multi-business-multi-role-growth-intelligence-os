[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedCommit,
    [string]$ExpectedRepository = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os',
    [ValidateRange(60, 1800)]
    [int]$WaitSeconds = 1200,
    [string]$ReportPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ExpectedCommit = $ExpectedCommit.Trim().ToLowerInvariant()
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)

function Fail([string]$Message) {
    throw "STAGING_ACTIVATION_GATEWAY_CONVERGENCE_FAIL_CLOSED: $Message"
}

if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) {
    Fail "RepositoryPath is not a Git checkout: $RepositoryPath"
}
if ($ExpectedRepository -ne 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os') {
    Fail "Unexpected repository authority binding: $ExpectedRepository"
}

$registryPath = Join-Path $RepositoryPath 'http-generic-api\config\environment-convergence-registry.json'
if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
    Fail "Environment convergence registry is missing: $registryPath"
}
try {
    $registry = Get-Content -Raw -LiteralPath $registryPath | ConvertFrom-Json -ErrorAction Stop
} catch {
    Fail "Environment convergence registry is invalid JSON: $registryPath"
}

$profile = $registry.profiles.staging
if ($null -eq $profile -or [string]$profile.state_machine -ne 'environment_convergence.v1') {
    Fail 'Staging convergence profile is missing or not bound to environment_convergence.v1.'
}
$gateway = $profile.activation_gateway
$policyHash = ([string]$gateway.expected_policy_hash).Trim().ToLowerInvariant()
if ($policyHash -notmatch '^[0-9a-f]{64}$') {
    Fail 'Staging Activation Gateway expected policy hash is invalid.'
}
if ([string]$gateway.policy_key -ne 'activation_gateway_staging') {
    Fail 'Staging Activation Gateway profile is not bound to activation_gateway_staging.'
}
if ($gateway.governed_apply_ready -ne $false -or $null -ne $gateway.apply_capability) {
    Fail 'Legacy convergence helper may only run while Staging provider apply remains fail-closed.'
}

# This file intentionally remains as a compatibility tombstone for callers that
# still know the old helper path. It MUST NOT dispatch GitHub Actions, read provider
# credentials, mutate Cloudflare, install trust material, or retry the runtime.
# The top-level AutoPilot now consumes the shared convergence engine and stops at
# the governed authority checkpoint until a server-side Staging apply adapter exists.
$report = [ordered]@{
    contract = 'mad4b.staging.activation-gateway-convergence.v2'
    status = 'governed_authority_required'
    ready = $false
    environment = 'staging'
    state_machine = [string]$profile.state_machine
    expected_repository = $ExpectedRepository
    expected_commit = $ExpectedCommit
    profile_binding = [ordered]@{
        policy_key = [string]$gateway.policy_key
        policy_path = [string]$gateway.policy_path
        expected_policy_hash = $policyHash
        public_host = [string]$gateway.public_host
    }
    next_governed_handoff = [ordered]@{
        authority = 'server_governed'
        plan_capability = [string]$gateway.plan_capability
        apply_capability = $null
        execution_ready = $false
        apply_block_reason = [string]$gateway.apply_block_reason
        automatic_apply_allowed = $false
    }
    legacy_adapter = [ordered]@{
        retired_from_orchestration = $true
        workflow_dispatch_allowed = $false
        provider_mutation_allowed = $false
        local_origin_trust_mutation_allowed = $false
        retry_after_local_mutation_allowed = $false
    }
    provider_mutation = $false
    provider_mutation_initiated = $false
    provider_mutation_scope = 'none'
    workflow_dispatch = $false
    cloudflare_worker_mutation = $false
    cloudflare_dns_mutation = $false
    database_mutation = $false
    migration_apply = $false
    ruleset_mutation = $false
    production_deploy = $false
    production_mutation = $false
    local_origin_trust_mutation = $false
    secrets_included = $false
    wait_seconds_ignored = $WaitSeconds
}

$json = $report | ConvertTo-Json -Depth 8
if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
    $resolvedReportPath = if ([IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $RepositoryPath $ReportPath }
    $resolvedReportPath = [IO.Path]::GetFullPath($resolvedReportPath)
    $reportDirectory = Split-Path -Parent $resolvedReportPath
    if (-not (Test-Path -LiteralPath $reportDirectory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
    }
    Set-Content -LiteralPath $resolvedReportPath -Value $json -Encoding UTF8
}

Write-Output $json
Write-Error "Server-governed Staging Activation Gateway apply authority is required: $($gateway.apply_block_reason)"
exit 2
