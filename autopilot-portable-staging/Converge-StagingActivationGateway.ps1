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
$workflow = 'staging-main-deploy-eligibility.yml'
$healthUrl = 'https://activation-dev.mad4b.com/health'
$policyPath = Join-Path $RepositoryPath 'edge\activation-gateway\generated\route-policy.staging.json'
$gitTransportPath = Join-Path $RepositoryPath 'autopilot-portable-staging\Staging-GitTransport.ps1'

function Fail([string]$Message) {
    throw "STAGING_ACTIVATION_GATEWAY_CONVERGENCE_FAIL_CLOSED: $Message"
}

if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { Fail "RepositoryPath is not a Git checkout: $RepositoryPath" }
if (-not (Test-Path -LiteralPath $policyPath -PathType Leaf)) { Fail "Staging Activation Gateway policy is missing: $policyPath" }
if (-not (Test-Path -LiteralPath $gitTransportPath -PathType Leaf)) { Fail "Staging Git transport helper is missing: $gitTransportPath" }
. $gitTransportPath
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI is unavailable after One-Click prerequisite closure.' }

try { $policy = Get-Content -Raw -LiteralPath $policyPath | ConvertFrom-Json -ErrorAction Stop }
catch { Fail "Staging Activation Gateway policy is invalid JSON: $policyPath" }
$expectedPolicyHash = ([string]$policy.content_hash_sha256).Trim().ToLowerInvariant()
$expectedPolicyKey = ([string]$policy.policy_key).Trim()
if ($expectedPolicyHash -notmatch '^[0-9a-f]{64}$') { Fail 'Staging Activation Gateway policy content_hash_sha256 is invalid.' }
if ($expectedPolicyKey -ne 'activation_gateway_staging') { Fail "Unexpected Staging Activation Gateway policy key: $expectedPolicyKey" }

function Get-RemoteMainSha {
    try { $result = Invoke-StagingGit @('-C', $RepositoryPath, 'ls-remote', 'origin', 'refs/heads/main') }
    catch { Fail $_.Exception.Message }
    $line = (($result.output | Out-String).Trim())
    $sha = (($line -split '\s+')[0]).Trim().ToLowerInvariant()
    if ($sha -notmatch '^[0-9a-f]{40}$') { Fail 'origin/main did not resolve to an exact SHA.' }
    return $sha
}

function Get-GatewayHealthEvidence {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 20
        $status = [int]$response.StatusCode
        try { $body = $response.Content | ConvertFrom-Json -ErrorAction Stop }
        catch {
            return [pscustomobject]@{
                reachable = $true; exact = $false; status = $status; error = 'invalid_json'
                source_commit = $null; worker_build_sha = $null; policy_hash = $null; policy_key = $null
                stale = $null; secrets_included = $null
            }
        }
        $sourceCommit = ([string]$body.sourceCommit).Trim().ToLowerInvariant()
        $workerBuildSha = ([string]$body.workerBuildSha).Trim().ToLowerInvariant()
        $policyHash = ([string]$body.policyHash).Trim().ToLowerInvariant()
        $policyKey = ([string]$body.policyKey).Trim()
        $exact = $status -eq 200 `
            -and $body.ok -eq $true `
            -and $body.stale -eq $false `
            -and $sourceCommit -eq $ExpectedCommit `
            -and $workerBuildSha -eq $ExpectedCommit `
            -and $policyHash -eq $expectedPolicyHash `
            -and $policyKey -eq $expectedPolicyKey `
            -and $body.secretsIncluded -eq $false
        return [pscustomobject]@{
            reachable = $true; exact = [bool]$exact; status = $status; error = $null
            source_commit = $sourceCommit; worker_build_sha = $workerBuildSha
            policy_hash = $policyHash; policy_key = $policyKey
            stale = $body.stale; secrets_included = $body.secretsIncluded
        }
    } catch {
        $status = $null
        try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch { }
        return [pscustomobject]@{
            reachable = $false; exact = $false; status = $status; error = $_.Exception.Message
            source_commit = $null; worker_build_sha = $null; policy_hash = $null; policy_key = $null
            stale = $null; secrets_included = $null
        }
    }
}

function Get-WorkflowDispatchRuns {
    $raw = & gh run list --repo $ExpectedRepository --workflow $workflow --commit $ExpectedCommit --event workflow_dispatch --limit 30 --json status,conclusion,headSha,databaseId,createdAt,updatedAt,url 2>$null
    if ($LASTEXITCODE -ne 0) { Fail 'Could not read Staging Worker workflow_dispatch runs from GitHub.' }
    try {
        $parsedRuns = ($raw | Out-String) | ConvertFrom-Json -ErrorAction Stop
        $runs = if ($null -eq $parsedRuns) { @() } else { @($parsedRuns) }
    } catch { Fail 'GitHub workflow run listing did not return valid JSON.' }
    return @($runs | Where-Object {
        $null -ne $_ `
            -and $_.PSObject.Properties.Name -contains 'headSha' `
            -and ([string]$_.headSha).ToLowerInvariant() -eq $ExpectedCommit
    })
}

function Wait-WorkflowRun([long]$RunId) {
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $raw = & gh run view $RunId --repo $ExpectedRepository --json status,conclusion,headSha,url 2>$null
        if ($LASTEXITCODE -ne 0) { Fail "Could not inspect Staging Worker workflow run $RunId." }
        try { $run = ($raw | Out-String) | ConvertFrom-Json -ErrorAction Stop }
        catch { Fail "Staging Worker workflow run $RunId did not return valid JSON." }
        if (([string]$run.headSha).ToLowerInvariant() -ne $ExpectedCommit) { Fail "Staging Worker workflow run $RunId is not bound to ExpectedCommit." }
        if ([string]$run.status -eq 'completed') {
            if ([string]$run.conclusion -ne 'success') { Fail "Staging Worker workflow run $RunId completed with $($run.conclusion)." }
            return $run
        }
        Start-Sleep -Seconds 10
    }
    Fail "Timed out waiting for Staging Worker workflow run $RunId after $WaitSeconds seconds."
}

function Wait-GatewayExactHealth {
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        $health = Get-GatewayHealthEvidence
        if ($health.exact -eq $true) { return $health }
        Start-Sleep -Seconds 5
    }
    $last = Get-GatewayHealthEvidence
    Fail "Staging Activation Gateway did not converge to exact SHA/policy health after deployment. observed_source=$($last.source_commit) observed_worker=$($last.worker_build_sha) stale=$($last.stale) status=$($last.status)"
}

$initialHealth = Get-GatewayHealthEvidence
$providerMutation = $false
$providerMutationInitiated = $false
$runId = $null
$action = 'already_current'

if ($initialHealth.exact -ne $true) {
    $remoteMain = Get-RemoteMainSha
    if ($remoteMain -ne $ExpectedCommit) { Fail "origin/main moved before Staging Worker convergence: expected=$ExpectedCommit observed=$remoteMain" }

    $active = @(Get-WorkflowDispatchRuns | Where-Object { [string]$_.status -ne 'completed' } | Sort-Object updatedAt -Descending | Select-Object -First 1)
    if ($active.Count -gt 0) {
        $runId = [long]$active[0].databaseId
        $action = 'wait_existing_run'
        Write-Host "STAGING_GATEWAY_CONVERGENCE_WAIT: run=$runId sha=$ExpectedCommit"
        [void](Wait-WorkflowRun $runId)
        $afterExisting = Get-GatewayHealthEvidence
        if ($afterExisting.exact -eq $true) {
            $providerMutation = $true
            $finalHealth = $afterExisting
            $action = 'reused_existing_run'
        }
    }

    if ($action -ne 'reused_existing_run') {
        $remoteMain = Get-RemoteMainSha
        if ($remoteMain -ne $ExpectedCommit) { Fail "origin/main moved before governed Staging Worker dispatch: expected=$ExpectedCommit observed=$remoteMain" }
        $beforeIds = @((Get-WorkflowDispatchRuns | ForEach-Object { [long]$_.databaseId }))
        $dispatchStarted = [DateTime]::UtcNow.AddSeconds(-5)
        $dispatchOutput = (& gh workflow run $workflow --repo $ExpectedRepository --ref main -f operation=deploy_activation_worker -f "source_sha=$ExpectedCommit" -f confirmation=DEPLOY_STAGING_ACTIVATION_WORKER 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { Fail "Governed Staging Worker workflow dispatch failed: $dispatchOutput" }
        $match = [regex]::Match($dispatchOutput, '/actions/runs/(?<id>\d+)')
        if ($match.Success) { $runId = [long]$match.Groups['id'].Value }
        if ($null -eq $runId) {
            for ($attempt = 0; $attempt -lt 15 -and $null -eq $runId; $attempt++) {
                Start-Sleep -Seconds 2
                $candidate = @(Get-WorkflowDispatchRuns | Where-Object {
                    $beforeIds -notcontains [long]$_.databaseId -and [DateTime]$_.createdAt -ge $dispatchStarted
                } | Sort-Object createdAt -Descending | Select-Object -First 1)
                if ($candidate.Count -gt 0) { $runId = [long]$candidate[0].databaseId }
            }
        }
        if ($null -eq $runId) { Fail 'Governed Staging Worker dispatch succeeded but its workflow run ID could not be resolved.' }
        Write-Host "STAGING_GATEWAY_CONVERGENCE_DEPLOY: run=$runId sha=$ExpectedCommit"
        [void](Wait-WorkflowRun $runId)
        $providerMutation = $true
        $providerMutationInitiated = $true
        $action = 'deployed'
        $finalHealth = Wait-GatewayExactHealth
    }
} else {
    $finalHealth = $initialHealth
}

$report = [ordered]@{
    contract = 'mad4b.staging.activation-gateway-convergence.v1'
    expected_commit = $ExpectedCommit
    expected_policy_hash = $expectedPolicyHash
    expected_policy_key = $expectedPolicyKey
    action = $action
    workflow = $workflow
    workflow_run_id = $runId
    initial_health = $initialHealth
    final_health = $finalHealth
    ready = [bool]$finalHealth.exact
    provider_mutation = [bool]$providerMutation
    provider_mutation_initiated = [bool]$providerMutationInitiated
    provider_mutation_scope = if ($providerMutation) { 'staging_activation_worker_exact_sha_only' } else { 'none' }
    cloudflare_worker_mutation = [bool]$providerMutation
    cloudflare_dns_mutation = $false
    production_mutation = $false
    production_deploy = $false
    database_mutation = $false
    migration_apply = $false
    ruleset_mutation = $false
    secrets_included = $false
    generated_at = [DateTime]::UtcNow.ToString('o')
}
if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
    $fullReportPath = [IO.Path]::GetFullPath($ReportPath)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fullReportPath) | Out-Null
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $fullReportPath -Encoding utf8
}
$report | ConvertTo-Json -Depth 8
