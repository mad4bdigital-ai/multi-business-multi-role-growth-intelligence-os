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
$converger = Join-Path $root 'Converge-StagingActivationGateway.ps1'
$convergenceReportPath = Join-Path $root 'logs\staging-activation-gateway-convergence.json'
$preflightReportPath = Join-Path $root 'logs\staging-schema-governance-preflight.json'
$runtimeStatePath = Join-Path $root 'autopilot-state.json'
$expectedRepository = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os'

function Fail([string]$Message) { throw "STAGING_DUAL_MODE_SMART_ONE_CLICK_FAIL_CLOSED: $Message" }

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
        # powershell.exe surfaces native child stderr (for example Docker build progress)
        # as ErrorRecord objects. The smart wrapper must collect that diagnostic stream
        # without allowing the wrapper's global Stop policy to terminate before the
        # child's real exit code can be evaluated for bounded gateway convergence.
        $ErrorActionPreference = 'Continue'
        $lines = @(& powershell.exe @(New-CoreArguments) 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = [int]$LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($null -eq $exitCode) { Fail 'Dual-mode core did not expose a native exit code.' }
    return [pscustomobject]@{ exit_code = $exitCode; lines = $lines }
}

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

function Read-TypedState([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "$Label is missing: $Path" }
    try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -ErrorAction Stop }
    catch { Fail "$Label is invalid JSON: $Path" }
}

function Get-GatewayDriftRecovery([int]$ChildExitCode) {
    if ($ChildExitCode -eq 0 -or -not $EnableActivationGateway) { return $null }
    if ($RequireSchemaBundle -or $ApplySchemaBundle) { return $null }

    $runtime = Read-TypedState $runtimeStatePath 'Auto Pilot runtime state'
    $preflight = Read-TypedState $preflightReportPath 'Staging schema/governance preflight report'
    $commit = ([string]$runtime.commit).Trim().ToLowerInvariant()
    if ($commit -notmatch '^[0-9a-f]{40}$') { return $null }
    if ([string]$preflight.status -ne 'passed') { return $null }
    if (([string]$preflight.expected_commit).Trim().ToLowerInvariant() -ne $commit) { return $null }
    if (([string]$preflight.observed_commit).Trim().ToLowerInvariant() -ne $commit) { return $null }
    if ($preflight.safety.production_access -ne $false -or $preflight.safety.provider_access -ne $false) { return $null }
    if ($preflight.safety.database_mutation -ne $false -or $preflight.safety.migration_apply -ne $false) { return $null }

    $blocking = @($runtime.certification_blocking_failures | ForEach-Object { [string]$_ } | Where-Object { $_ })
    $degraded = @($runtime.certification_degraded_reasons | ForEach-Object { [string]$_ } | Where-Object { $_ })
    $reasons = @($blocking + $degraded | Select-Object -Unique)
    $gatewayDriftKeys = @('gateway_exact_commit','gateway_policy_not_stale','gateway_policy_hash_current','gateway_policy_key_current')
    if ($reasons.Count -eq 0) { return $null }
    $nonGateway = @($reasons | Where-Object { $_ -notin $gatewayDriftKeys })
    if ($nonGateway.Count -gt 0) { return $null }
    if (@($reasons | Where-Object { $_ -in $gatewayDriftKeys }).Count -eq 0) { return $null }

    return [pscustomobject]@{
        commit = $commit
        blocking = $blocking
        degraded = $degraded
        reasons = $reasons
    }
}

function Invoke-GatewayConvergence([object]$Recovery) {
    if (-not (Test-Path -LiteralPath $converger -PathType Leaf)) { Fail "Activation Gateway convergence helper is missing: $converger" }
    if (Test-Path -LiteralPath $convergenceReportPath) { Remove-Item -LiteralPath $convergenceReportPath -Force }
    Write-Host "STAGING_GATEWAY_DRIFT_DETECTED: commit=$($Recovery.commit) reasons=$($Recovery.reasons -join ',')" -ForegroundColor Yellow
    & powershell.exe @(
        '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$converger,
        '-RepositoryPath',$RepositoryPath,
        '-ExpectedCommit',$Recovery.commit,
        '-ExpectedRepository',$expectedRepository,
        '-ReportPath',$convergenceReportPath
    )
    if ($LASTEXITCODE -ne 0) { Fail "Activation Gateway smart convergence exited with code $LASTEXITCODE" }
    $report = Read-TypedState $convergenceReportPath 'Activation Gateway convergence report'
    if ([string]$report.contract -ne 'mad4b.staging.activation-gateway-convergence.v1' -or $report.ready -ne $true) {
        Fail 'Activation Gateway smart convergence did not produce ready exact-SHA evidence.'
    }
    if (([string]$report.expected_commit).Trim().ToLowerInvariant() -ne $Recovery.commit) { Fail 'Activation Gateway convergence report commit mismatch.' }
    if ($report.production_mutation -ne $false -or $report.production_deploy -ne $false -or $report.cloudflare_dns_mutation -ne $false) {
        Fail 'Activation Gateway convergence violated the Staging-only mutation boundary.'
    }
    if ($report.database_mutation -ne $false -or $report.migration_apply -ne $false -or $report.ruleset_mutation -ne $false -or $report.secrets_included -ne $false) {
        Fail 'Activation Gateway convergence violated a non-Worker safety boundary.'
    }
    return $report
}

function Write-CorrectedResult([object[]]$Lines, [object]$Convergence) {
    $final = Get-FinalJson $Lines
    if ($null -eq $final) {
        Write-Lines $Lines
        Fail 'Successful dual-mode core did not emit its canonical final JSON contract.'
    }
    Write-Lines $final.prefix
    $result = $final.json
    $mutated = $false
    $initiated = $false
    $scope = 'none'
    $action = if ($EnableActivationGateway) { 'already_current_or_core_ready' } else { 'not_requested' }
    $runId = $null
    if ($null -ne $Convergence) {
        $mutated = [bool]$Convergence.provider_mutation
        $initiated = [bool]$Convergence.provider_mutation_initiated
        $scope = [string]$Convergence.provider_mutation_scope
        $action = [string]$Convergence.action
        $runId = $Convergence.workflow_run_id
    }
    $result | Add-Member -NotePropertyName activation_gateway_smart_convergence -NotePropertyValue ([bool]$EnableActivationGateway) -Force
    $result | Add-Member -NotePropertyName activation_gateway_convergence_action -NotePropertyValue $action -Force
    $result | Add-Member -NotePropertyName activation_gateway_deploy_run_id -NotePropertyValue $runId -Force
    $result | Add-Member -NotePropertyName staging_worker_deploy_performed -NotePropertyValue $mutated -Force
    $result | Add-Member -NotePropertyName staging_worker_deploy_initiated -NotePropertyValue $initiated -Force
    $result | Add-Member -NotePropertyName provider_mutation -NotePropertyValue $mutated -Force
    $result | Add-Member -NotePropertyName provider_mutation_scope -NotePropertyValue $scope -Force
    $result | Add-Member -NotePropertyName cloudflare_worker_mutation -NotePropertyValue $mutated -Force
    $result | Add-Member -NotePropertyName cloudflare_dns_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName cloudflare_mutation -NotePropertyValue $mutated -Force
    $result | Add-Member -NotePropertyName production_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName production_database_mutation -NotePropertyValue $false -Force
    $result | Add-Member -NotePropertyName secrets_included -NotePropertyValue $false -Force
    $result | ConvertTo-Json -Depth 8
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = [IO.Path]::GetFullPath((Join-Path $root '..')) }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
if (-not (Test-Path -LiteralPath $core -PathType Leaf)) { Fail "Dual-mode core launcher is missing: $core" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { Fail "RepositoryPath is not a Git checkout: $RepositoryPath" }
if (Test-Path -LiteralPath $convergenceReportPath) { Remove-Item -LiteralPath $convergenceReportPath -Force }

$first = Invoke-Core
if ($first.exit_code -eq 0) {
    Write-CorrectedResult $first.lines $null
    exit 0
}

$recovery = Get-GatewayDriftRecovery $first.exit_code
if ($null -eq $recovery) {
    Write-Lines $first.lines
    exit $first.exit_code
}

$convergence = Invoke-GatewayConvergence $recovery
Write-Host "STAGING_GATEWAY_CONVERGENCE_RECERTIFY: commit=$($recovery.commit) action=$($convergence.action)" -ForegroundColor Cyan
$second = Invoke-Core
if ($second.exit_code -ne 0) {
    Write-Lines $second.lines
    Fail "Dual-mode core remained blocked after exact-SHA Activation Gateway convergence; exit=$($second.exit_code)"
}
Write-CorrectedResult $second.lines $convergence
