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
$envHelperPath = Join-Path $RepositoryPath 'autopilot-portable-staging\Staging-Environment.ps1'
$envFilePath = Join-Path $RepositoryPath 'http-generic-api\.env.staging'
$originTrustArtifactName = "staging-activation-origin-trust-$ExpectedCommit"

function Fail([string]$Message) {
    throw "STAGING_ACTIVATION_GATEWAY_CONVERGENCE_FAIL_CLOSED: $Message"
}

if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { Fail "RepositoryPath is not a Git checkout: $RepositoryPath" }
if (-not (Test-Path -LiteralPath $policyPath -PathType Leaf)) { Fail "Staging Activation Gateway policy is missing: $policyPath" }
if (-not (Test-Path -LiteralPath $gitTransportPath -PathType Leaf)) { Fail "Staging Git transport helper is missing: $gitTransportPath" }
if (-not (Test-Path -LiteralPath $envHelperPath -PathType Leaf)) { Fail "Staging environment helper is missing: $envHelperPath" }
. $gitTransportPath
. $envHelperPath
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

function Get-LocalRecoveryTrustEvidence {
    if (-not (Test-Path -LiteralPath $envFilePath -PathType Leaf)) {
        return [pscustomobject]@{
            configured = $false; exact = $false; reason = 'env_missing'; key_id = $null
            expected_deployment_sha = $null; replay_directory = $null; secrets_included = $false
        }
    }
    $mode = (Get-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_MODE').Trim().ToLowerInvariant()
    $strip = (Get-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS').Trim().ToLowerInvariant()
    $proxy = (Get-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUST_PROXY_HOST_HEADERS').Trim().ToLowerInvariant()
    $publicKey = Get-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY'
    $keyId = (Get-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_KEY_ID').Trim()
    $canonicalHost = (Get-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST').Trim().ToLowerInvariant()
    $audience = (Get-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE').Trim()
    $issuer = (Get-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_ISSUER').Trim()
    $expectedSha = (Get-StagingEnvValue $envFilePath 'REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA').Trim().ToLowerInvariant()
    $replayDirectory = (Get-StagingEnvValue $envFilePath 'RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY').Trim()
    $publicKeyShape = $publicKey.StartsWith('-----BEGIN PUBLIC KEY-----\n') -and $publicKey.Contains('\n-----END PUBLIC KEY-----\n')
    $exact = $mode -eq 'signature' `
        -and $strip -eq 'true' `
        -and $proxy -eq 'true' `
        -and $publicKeyShape `
        -and $keyId -match '^[A-Za-z0-9._:-]{16,128}$' `
        -and $canonicalHost -eq 'activation-dev.mad4b.com' `
        -and $audience -eq 'https://dev.mad4b.com' `
        -and $issuer -eq 'https://activation-dev.mad4b.com' `
        -and $expectedSha -eq $ExpectedCommit `
        -and $replayDirectory -eq '/app/data/recovery-ingress'
    return [pscustomobject]@{
        configured = [bool]($publicKeyShape -and $keyId)
        exact = [bool]$exact
        reason = if ($exact) { $null } else { 'origin_trust_not_exact' }
        key_id = if ($keyId) { $keyId } else { $null }
        expected_deployment_sha = if ($expectedSha) { $expectedSha } else { $null }
        replay_directory = if ($replayDirectory) { $replayDirectory } else { $null }
        secrets_included = $false
    }
}

function Install-OriginTrustFromRun([long]$RunId) {
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("mad4b-staging-origin-trust-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    try {
        $download = (& gh run download $RunId --repo $ExpectedRepository --name $originTrustArtifactName --dir $tempRoot 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { Fail "Could not download exact-SHA Recovery origin trust artifact from run $RunId: $download" }
        $artifactPath = Join-Path $tempRoot 'origin-trust.json'
        if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { Fail "Recovery origin trust artifact is missing from run $RunId." }
        try { $trust = Get-Content -Raw -LiteralPath $artifactPath | ConvertFrom-Json -ErrorAction Stop }
        catch { Fail "Recovery origin trust artifact from run $RunId is invalid JSON." }
        if ([string]$trust.contract -ne 'mad4b.staging.activation-recovery-origin-trust.v1') { Fail 'Recovery origin trust contract mismatch.' }
        if (([string]$trust.source_commit).Trim().ToLowerInvariant() -ne $ExpectedCommit) { Fail 'Recovery origin trust source commit mismatch.' }
        if (([string]$trust.worker_build_sha).Trim().ToLowerInvariant() -ne $ExpectedCommit) { Fail 'Recovery origin trust Worker build SHA mismatch.' }
        if (([string]$trust.policy_hash).Trim().ToLowerInvariant() -ne $expectedPolicyHash) { Fail 'Recovery origin trust policy hash mismatch.' }
        if ([string]$trust.gateway_host -ne 'activation-dev.mad4b.com' -or [string]$trust.canonical_host -ne 'activation-dev.mad4b.com') { Fail 'Recovery origin trust gateway host mismatch.' }
        if ([string]$trust.audience -ne 'https://dev.mad4b.com' -or [string]$trust.issuer -ne 'https://activation-dev.mad4b.com') { Fail 'Recovery origin trust issuer/audience mismatch.' }
        if ([string]$trust.trusted_ingress_mode -ne 'signature' -or $trust.strip_caller_headers -ne $true) { Fail 'Recovery origin trust signed-ingress mode mismatch.' }
        if ([string]$trust.replay_store_scope -ne 'single_filesystem') { Fail 'Recovery origin trust replay-store scope mismatch.' }
        if ($trust.secrets_included -ne $false) { Fail 'Recovery origin trust artifact must declare secrets_included=false.' }
        $keyId = ([string]$trust.key_id).Trim()
        $publicKey = [string]$trust.public_key_pem_escaped
        if ($keyId -notmatch '^[A-Za-z0-9._:-]{16,128}$') { Fail 'Recovery origin trust key ID is invalid.' }
        if (-not $publicKey.StartsWith('-----BEGIN PUBLIC KEY-----\n') -or -not $publicKey.Contains('\n-----END PUBLIC KEY-----\n')) { Fail 'Recovery origin trust public key is not an escaped PEM public key.' }
        foreach ($property in @($trust.PSObject.Properties.Name)) {
            if ($property -ne 'secrets_included' -and $property -match '(?i)private|secret|credential|token') {
                Fail "Recovery origin trust artifact contains forbidden secret-shaped field: $property"
            }
        }

        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUST_PROXY_HOST_HEADERS' 'true'
        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_MODE' 'signature'
        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS' 'true'
        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY' $publicKey
        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_KEY_ID' $keyId
        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST' 'activation-dev.mad4b.com'
        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE' 'https://dev.mad4b.com'
        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_TRUSTED_INGRESS_ISSUER' 'https://activation-dev.mad4b.com'
        Set-StagingEnvValue $envFilePath 'REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA' $ExpectedCommit
        Set-StagingEnvValue $envFilePath 'RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY' '/app/data/recovery-ingress'

        $installed = Get-LocalRecoveryTrustEvidence
        if ($installed.exact -ne $true) { Fail 'Recovery origin trust was written but did not validate as exact.' }
        return $installed
    } finally {
        if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
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
$initialTrust = Get-LocalRecoveryTrustEvidence
$providerMutation = $false
$providerMutationInitiated = $false
$originTrustUpdated = $false
$runId = $null
$action = 'already_current'

if ($initialHealth.exact -ne $true -or $initialTrust.exact -ne $true) {
    $remoteMain = Get-RemoteMainSha
    if ($remoteMain -ne $ExpectedCommit) { Fail "origin/main moved before Staging Worker convergence: expected=$ExpectedCommit observed=$remoteMain" }

    $active = @(Get-WorkflowDispatchRuns | Where-Object { [string]$_.status -ne 'completed' } | Sort-Object updatedAt -Descending | Select-Object -First 1)
    if ($active.Count -gt 0) {
        $runId = [long]$active[0].databaseId
        $action = 'wait_existing_run'
        Write-Host "STAGING_GATEWAY_CONVERGENCE_WAIT: run=$runId sha=$ExpectedCommit"
        [void](Wait-WorkflowRun $runId)
        [void](Install-OriginTrustFromRun $runId)
        $originTrustUpdated = $true
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
        [void](Install-OriginTrustFromRun $runId)
        $originTrustUpdated = $true
        $providerMutation = $true
        $providerMutationInitiated = $true
        $action = 'deployed'
        $finalHealth = Wait-GatewayExactHealth
    }
} else {
    $finalHealth = $initialHealth
}

$finalTrust = Get-LocalRecoveryTrustEvidence
if ($finalTrust.exact -ne $true) { Fail 'Staging Recovery origin trust did not converge to the exact Worker deployment.' }

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
    initial_origin_trust = $initialTrust
    final_origin_trust = $finalTrust
    origin_trust_updated = [bool]$originTrustUpdated
    recovery_ingress_replay_scope = 'single_filesystem'
    ready = [bool]($finalHealth.exact -and $finalTrust.exact)
    provider_mutation = [bool]$providerMutation
    provider_mutation_initiated = [bool]$providerMutationInitiated
    provider_mutation_scope = if ($providerMutation) { 'staging_activation_worker_exact_sha_only' } else { 'none' }
    local_origin_trust_config_mutation = [bool]$originTrustUpdated
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
