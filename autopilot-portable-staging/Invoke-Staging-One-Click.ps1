[CmdletBinding()]
param(
    [string]$RepositoryPath = '',
    [ValidateSet('disabled','windows_service','docker_sidecar')]
    [string]$TunnelMode = 'windows_service',
    [switch]$EnableActivationGateway,
    [switch]$NoAutoDeploy,
    [switch]$RequireSchemaBundle,
    [switch]$ApplySchemaBundle,
    [switch]$ProvisionMcpApp,
    [string]$McpRedirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect',
    [ValidateRange(65,300)]
    [int]$TunnelStabilitySeconds = 95,
    [ValidateSet('Smart','ForceBuild','SkipBuild')]
    [string]$BuildMode = 'Smart'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$core = Join-Path $root 'Invoke-Staging-One-Click-Core.ps1'
$envAuthorityGuard = Join-Path $root 'Assert-StagingEnvAuthority.ps1'
$convergenceBridge = ''
$trustInstaller = ''
$preflightReportPath = Join-Path $root 'logs\staging-schema-governance-preflight.json'
$runtimeStatePath = Join-Path $root 'autopilot-state.json'
$expectedRepository = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os'

function Fail([string]$Message) { throw "STAGING_DUAL_MODE_SMART_ONE_CLICK_FAIL_CLOSED: $Message" }

function Write-Lines([object[]]$Lines) {
    foreach ($line in @($Lines)) { Write-Host ([string]$line) }
}

function Get-FinalJson([object[]]$Lines) {
    $textLines = @($Lines | ForEach-Object { [string]$_ })
    for ($index = $textLines.Count - 1; $index -ge 0; $index--) {
        if (-not $textLines[$index].TrimStart().StartsWith('{')) { continue }
        $candidate = ($textLines[$index..($textLines.Count - 1)] -join "`n")
        try {
            $json = $candidate | ConvertFrom-Json -ErrorAction Stop
            return [pscustomobject]@{
                json = $json
                prefix = if ($index -gt 0) { @($textLines[0..($index - 1)]) } else { @() }
            }
        } catch { }
    }
    return $null
}

function Invoke-NodeJson([object[]]$Arguments) {
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = $null
    $lines = @()
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& node @Arguments 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = [int]$LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($null -eq $exitCode) { Fail 'Node helper did not expose a native exit code.' }
    return [pscustomobject]@{ exit_code = $exitCode; lines = $lines; final = (Get-FinalJson $lines) }
}

function Invoke-EnvAuthorityGuard {
    if (-not (Test-Path -LiteralPath $envAuthorityGuard -PathType Leaf)) {
        Fail "Staging environment authority guard is missing: $envAuthorityGuard"
    }
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = $null
    $lines = @()
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& powershell.exe @(
            '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$envAuthorityGuard,
            '-RepositoryPath',$RepositoryPath
        ) 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = [int]$LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    Write-Lines $lines
    if ($null -eq $exitCode) { Fail 'Staging environment authority guard did not expose a native exit code.' }
    if ($exitCode -ne 0) { Fail "Staging environment authority guard exited with code $exitCode" }
}

function New-CoreArguments {
    $arguments = @(
        '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$core,
        '-RepositoryPath',$RepositoryPath,
        '-TunnelMode',$TunnelMode,
        '-McpRedirectUri',$McpRedirectUri,
        '-TunnelStabilitySeconds',"$TunnelStabilitySeconds",
        '-BuildMode',$BuildMode
    )
    if ($EnableActivationGateway) { $arguments += '-EnableActivationGateway' }
    if ($NoAutoDeploy) { $arguments += '-NoAutoDeploy' }
    if ($RequireSchemaBundle) { $arguments += '-RequireSchemaBundle' }
    if ($ApplySchemaBundle) { $arguments += '-ApplySchemaBundle' }
    if ($ProvisionMcpApp) { $arguments += '-ProvisionMcpApp' }
    return $arguments
}

function Invoke-Core {
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = $null
    $lines = @()
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& powershell.exe @(New-CoreArguments) 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = [int]$LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($null -eq $exitCode) { Fail 'Dual-mode core did not expose a native exit code.' }
    return [pscustomobject]@{ exit_code = $exitCode; lines = $lines }
}

function Read-LocalStagingEnvValue([string]$Name) {
    $envFile = Join-Path $RepositoryPath 'http-generic-api\.env.staging'
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { return '' }
    $pattern = "^$([regex]::Escape($Name))=(.*)$"
    $matches = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -match $pattern })
    if ($matches.Count -gt 1) { Fail "Duplicate Staging environment key is forbidden: $Name" }
    if ($matches.Count -eq 0) { return '' }
    return ($matches[0] -replace "^$([regex]::Escape($Name))=", '')
}

function Test-LocalRecoveryTrustExact([string]$Commit) {
    $mode = (Read-LocalStagingEnvValue 'REMOTE_MCP_TRUSTED_INGRESS_MODE').Trim().ToLowerInvariant()
    $strip = (Read-LocalStagingEnvValue 'REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS').Trim().ToLowerInvariant()
    $proxy = (Read-LocalStagingEnvValue 'REMOTE_MCP_TRUST_PROXY_HOST_HEADERS').Trim().ToLowerInvariant()
    $publicKey = Read-LocalStagingEnvValue 'REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY'
    $keyId = (Read-LocalStagingEnvValue 'REMOTE_MCP_TRUSTED_INGRESS_KEY_ID').Trim()
    $canonicalHost = (Read-LocalStagingEnvValue 'REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST').Trim().ToLowerInvariant()
    $audience = (Read-LocalStagingEnvValue 'REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE').Trim()
    $issuer = (Read-LocalStagingEnvValue 'REMOTE_MCP_TRUSTED_INGRESS_ISSUER').Trim()
    $expectedSha = (Read-LocalStagingEnvValue 'REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA').Trim().ToLowerInvariant()
    $replayDirectory = (Read-LocalStagingEnvValue 'RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY').Trim()
    return $mode -eq 'signature' `
        -and $strip -eq 'true' `
        -and $proxy -eq 'true' `
        -and $publicKey.StartsWith('-----BEGIN PUBLIC KEY-----\n') `
        -and $publicKey.Contains('\n-----END PUBLIC KEY-----\n') `
        -and $keyId -match '^[A-Za-z0-9._:-]{16,128}$' `
        -and $canonicalHost -eq 'activation-dev.mad4b.com' `
        -and $audience -eq 'https://dev.mad4b.com' `
        -and $issuer -eq 'https://activation-dev.mad4b.com' `
        -and $expectedSha -eq $Commit `
        -and $replayDirectory -eq '/app/data/recovery-ingress'
}

function Get-RuntimeCommit {
    if (-not (Test-Path -LiteralPath $runtimeStatePath -PathType Leaf)) { return '' }
    try {
        $runtime = Get-Content -Raw -LiteralPath $runtimeStatePath | ConvertFrom-Json -ErrorAction Stop
        $commit = ([string]$runtime.commit).Trim().ToLowerInvariant()
        if ($commit -match '^[0-9a-f]{40}$') { return $commit }
    } catch { }
    return ''
}

function Assert-TrustInstallerSafety([object]$Result) {
    if ($Result.provider_mutation -ne $false `
        -or $Result.cloudflare_mutation -ne $false `
        -or $Result.workflow_dispatch -ne $false `
        -or $Result.production_mutation -ne $false `
        -or $Result.database_mutation -ne $false `
        -or $Result.secrets_included -ne $false) {
        Fail 'Local recovery trust installer violated its mutation boundary.'
    }
}

function Invoke-LocalRecoveryTrustRefresh {
    if (-not $EnableActivationGateway) {
        return [pscustomobject]@{ status = 'not_enabled'; installed = $false; mutated = $false }
    }
    if ($RequireSchemaBundle -or $ApplySchemaBundle) {
        return [pscustomobject]@{ status = 'schema_bundle_mode'; installed = $false; mutated = $false }
    }
    $commit = Get-RuntimeCommit
    if ([string]::IsNullOrWhiteSpace($commit)) {
        return [pscustomobject]@{ status = 'runtime_commit_unavailable'; installed = $false; mutated = $false }
    }
    if (Test-LocalRecoveryTrustExact $commit) {
        return [pscustomobject]@{ status = 'already_exact'; installed = $false; mutated = $false; expected_sha = $commit }
    }
    if (-not (Test-Path -LiteralPath $trustInstaller -PathType Leaf)) { Fail "Staging trust installer is missing: $trustInstaller" }
    $envFile = Join-Path $RepositoryPath 'http-generic-api\.env.staging'
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { Fail "Missing local .env.staging: $envFile" }

    $dry = Invoke-NodeJson @(
        $trustInstaller,
        '--expected-sha',$commit,
        '--env-file',$envFile,
        '--mode','dry_run'
    )
    if ($null -eq $dry.final) {
        Write-Lines $dry.lines
        Fail 'Staging trust installer dry-run did not emit canonical JSON.'
    }
    Assert-TrustInstallerSafety $dry.final.json
    if ($dry.exit_code -eq 2 -and $dry.final.json.ready -ne $true) {
        return [pscustomobject]@{ status = 'public_gateway_not_exact'; installed = $false; mutated = $false; expected_sha = $commit }
    }
    if ($dry.exit_code -ne 0 -or $dry.final.json.ready -ne $true) {
        Write-Lines $dry.lines
        Fail "Staging trust installer dry-run failed with code $($dry.exit_code)"
    }

    $apply = Invoke-NodeJson @(
        $trustInstaller,
        '--expected-sha',$commit,
        '--env-file',$envFile,
        '--mode','apply'
    )
    if ($null -eq $apply.final) {
        Write-Lines $apply.lines
        Fail 'Staging trust installer apply did not emit canonical JSON.'
    }
    Assert-TrustInstallerSafety $apply.final.json
    if ($apply.exit_code -ne 0 -or $apply.final.json.ready -ne $true) {
        Write-Lines $apply.lines
        Fail "Staging trust installer apply failed with code $($apply.exit_code)"
    }
    if (-not (Test-LocalRecoveryTrustExact $commit)) {
        Fail 'Staging trust installer completed but local Recovery trust is not exact.'
    }
    return [pscustomobject]@{
        status = 'exact_public_gateway_trust_installed_locally'
        installed = $true
        mutated = [bool]$apply.final.json.mutated
        expected_sha = $commit
        key_id = [string]$apply.final.json.key_id
        public_key_sha256 = [string]$apply.final.json.public_key_sha256
    }
}

function Invoke-SharedConvergence([int]$ChildExitCode) {
    if (-not $EnableActivationGateway) { return $null }
    if ($RequireSchemaBundle -or $ApplySchemaBundle) { return $null }
    if (-not (Test-Path -LiteralPath $runtimeStatePath -PathType Leaf)) { return $null }
    if (-not (Test-Path -LiteralPath $preflightReportPath -PathType Leaf)) { return $null }
    if (-not (Test-Path -LiteralPath $convergenceBridge -PathType Leaf)) { Fail "Shared convergence bridge is missing: $convergenceBridge" }

    $runtime = Get-Content -Raw -LiteralPath $runtimeStatePath | ConvertFrom-Json -ErrorAction Stop
    $commit = ([string]$runtime.commit).Trim().ToLowerInvariant()
    if ($commit -notmatch '^[0-9a-f]{40}$') { return $null }
    $trustExact = Test-LocalRecoveryTrustExact $commit
    if ($ChildExitCode -eq 0 -and $trustExact) { return $null }

    $bridgeRun = Invoke-NodeJson @(
        $convergenceBridge,
        '--runtime-state',$runtimeStatePath,
        '--preflight',$preflightReportPath,
        '--repository',$expectedRepository,
        '--recovery-trust-exact',([string]([bool]$trustExact)).ToLowerInvariant()
    )
    if ($null -eq $bridgeRun.final) {
        Write-Lines $bridgeRun.lines
        Fail 'Shared convergence bridge did not emit canonical JSON.'
    }
    Write-Lines $bridgeRun.final.prefix
    if ($bridgeRun.exit_code -ne 0) {
        $bridgeRun.final.json | ConvertTo-Json -Depth 12
        Fail "Shared convergence bridge exited with code $($bridgeRun.exit_code)"
    }
    $bridge = $bridgeRun.final.json
    if ([string]$bridge.contract -ne 'mad4b.staging-environment-convergence-bridge.v1') { Fail 'Unexpected shared convergence bridge contract.' }
    if ($bridge.safety.provider_mutation -ne $false -or $bridge.safety.workflow_dispatch -ne $false -or $bridge.safety.production_mutation -ne $false -or $bridge.safety.database_mutation -ne $false) {
        Fail 'Shared convergence bridge violated the observation-only boundary.'
    }
    return $bridge
}

function Write-CorrectedResult([object[]]$Lines, [object]$Bridge, [object]$TrustRefresh) {
    $final = Get-FinalJson $Lines
    if ($null -eq $final) {
        Write-Lines $Lines
        Fail 'Successful dual-mode core did not emit its canonical final JSON contract.'
    }
    Write-Lines $final.prefix
    $result = $final.json
    $classification = if ($null -ne $Bridge) { $Bridge.report.convergence } else { $null }
    $handoff = if ($null -ne $classification) { $classification.next_governed_handoff } else { $null }
    $result | Add-Member -NotePropertyName environment_convergence_status -NotePropertyValue $(if ($null -ne $classification) { [string]$classification.status } else { 'converged_or_not_required' }) -Force
    $result | Add-Member -NotePropertyName environment_convergence_plan_sha256 -NotePropertyValue $(if ($null -ne $Bridge -and $null -ne $Bridge.plan) { [string]$Bridge.plan.plan_sha256 } else { $null }) -Force
    $result | Add-Member -NotePropertyName environment_convergence_next_governed_handoff -NotePropertyValue $handoff -Force
    $result | Add-Member -NotePropertyName activation_recovery_trusted_ingress_ready -NotePropertyValue ([bool]($EnableActivationGateway -and (Test-LocalRecoveryTrustExact ([string]$result.commit)))) -Force
    $result | Add-Member -NotePropertyName activation_recovery_trust_refresh_status -NotePropertyValue $(if ($null -ne $TrustRefresh) { [string]$TrustRefresh.status } else { 'not_attempted' }) -Force
    $result | Add-Member -NotePropertyName local_origin_trust_mutation -NotePropertyValue ([bool]($null -ne $TrustRefresh -and $TrustRefresh.mutated -eq $true)) -Force
    $result | Add-Member -NotePropertyName local_origin_trust_mutation_scope -NotePropertyValue $(if ($null -ne $TrustRefresh -and $TrustRefresh.mutated -eq $true) { 'eight_key_allowlist_after_exact_public_evidence_only' } else { 'none' }) -Force
    $result | Add-Member -NotePropertyName staging_worker_deploy_performed -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName staging_worker_deploy_initiated -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName provider_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName provider_mutation_scope -NotePropertyValue 'none' -Force
    $result | Add-Member -NotePropertyName cloudflare_worker_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName cloudflare_dns_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName cloudflare_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName production_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName production_database_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName secrets_included -NotePropertyValue $false -Force
    $result | ConvertTo-Json -Depth 12
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = [IO.Path]::GetFullPath((Join-Path $root '..')) }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$convergenceBridge = Join-Path $RepositoryPath 'http-generic-api\scripts\staging-environment-convergence-plan.mjs'
$trustInstaller = Join-Path $RepositoryPath 'http-generic-api\scripts\install-staging-activation-trust.mjs'
if (-not (Test-Path -LiteralPath $core -PathType Leaf)) { Fail "Dual-mode core launcher is missing: $core" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { Fail "RepositoryPath is not a Git checkout: $RepositoryPath" }

Invoke-EnvAuthorityGuard
$active = Invoke-Core
$trustRefresh = Invoke-LocalRecoveryTrustRefresh
if ($trustRefresh.installed -eq $true) {
    $active = Invoke-Core
}
$bridge = Invoke-SharedConvergence $active.exit_code
if ($null -eq $bridge) {
    if ($active.exit_code -eq 0) {
        Write-CorrectedResult $active.lines $null $trustRefresh
        exit 0
    }
    Write-Lines $active.lines
    exit $active.exit_code
}

$classification = $bridge.report.convergence
$handoff = $classification.next_governed_handoff
Write-Lines $active.lines
$bridge | ConvertTo-Json -Depth 12
if ($null -eq $handoff) { Fail "Shared convergence did not produce a governed handoff; status=$($classification.status)" }
if ($bridge.convergence_run.status -eq 'approval_required') {
    Fail "Environment convergence approval required; plan_sha256=$($bridge.plan.plan_sha256)"
}
if ($bridge.convergence_run.status -eq 'governed_authority_required' -or $handoff.execution_ready -ne $true) {
    Fail "Server-governed Staging Activation Gateway apply authority is required; reason=$($handoff.apply_block_reason)"
}
Fail 'Top-level AutoPilot must not execute provider or workflow mutation; handoff is ready for the governed server authority.'
