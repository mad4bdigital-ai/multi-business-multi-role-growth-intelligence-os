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
$convergenceBridge = Join-Path $RepositoryPath 'http-generic-api\scripts\staging-environment-convergence-plan.mjs'
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

    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = $null
    $lines = @()
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& node @(
            $convergenceBridge,
            '--runtime-state',$runtimeStatePath,
            '--preflight',$preflightReportPath,
            '--repository',$expectedRepository,
            '--recovery-trust-exact',([string]([bool]$trustExact)).ToLowerInvariant()
        ) 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = [int]$LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($null -eq $exitCode) { Fail 'Shared convergence bridge did not expose a native exit code.' }
    $final = Get-FinalJson $lines
    if ($null -eq $final) {
        Write-Lines $lines
        Fail 'Shared convergence bridge did not emit canonical JSON.'
    }
    Write-Lines $final.prefix
    if ($exitCode -ne 0) {
        $final.json | ConvertTo-Json -Depth 12
        Fail "Shared convergence bridge exited with code $exitCode"
    }
    $bridge = $final.json
    if ([string]$bridge.contract -ne 'mad4b.staging-environment-convergence-bridge.v1') { Fail 'Unexpected shared convergence bridge contract.' }
    if ($bridge.safety.provider_mutation -ne $false -or $bridge.safety.workflow_dispatch -ne $false -or $bridge.safety.production_mutation -ne $false -or $bridge.safety.database_mutation -ne $false) {
        Fail 'Shared convergence bridge violated the observation-only boundary.'
    }
    return $bridge
}

function Write-CorrectedResult([object[]]$Lines, [object]$Bridge) {
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
if (-not (Test-Path -LiteralPath $core -PathType Leaf)) { Fail "Dual-mode core launcher is missing: $core" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { Fail "RepositoryPath is not a Git checkout: $RepositoryPath" }

Invoke-EnvAuthorityGuard
$first = Invoke-Core
$bridge = Invoke-SharedConvergence $first.exit_code
if ($null -eq $bridge) {
    if ($first.exit_code -eq 0) {
        Write-CorrectedResult $first.lines $null
        exit 0
    }
    Write-Lines $first.lines
    exit $first.exit_code
}

$classification = $bridge.report.convergence
$handoff = $classification.next_governed_handoff
Write-Lines $first.lines
$bridge | ConvertTo-Json -Depth 12
if ($null -eq $handoff) { Fail "Shared convergence did not produce a governed handoff; status=$($classification.status)" }
if ($bridge.convergence_run.status -eq 'approval_required') {
    Fail "Environment convergence approval required; plan_sha256=$($bridge.plan.plan_sha256)"
}
if ($bridge.convergence_run.status -eq 'governed_authority_required' -or $handoff.execution_ready -ne $true) {
    Fail "Server-governed Staging Activation Gateway apply authority is required; reason=$($handoff.apply_block_reason)"
}
Fail 'Top-level AutoPilot must not execute provider or workflow mutation; handoff is ready for the governed server authority.'
