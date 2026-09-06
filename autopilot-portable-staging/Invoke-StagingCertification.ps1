[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedCommit,
    [string]$Ref = "main",
    [switch]$StartTunnel,
    [string]$StatePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "STAGING_CERTIFICATION_FAIL_CLOSED: $Message"
}

function Read-EnvValue([string]$Path, [string]$Name) {
    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if (-not $line) { return "" }
    return $line -replace "^$([regex]::Escape($Name))=", ""
}

function Read-LastJsonObject([string]$Text) {
    $lines = @($Text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    for ($index = $lines.Count - 1; $index -ge 0; $index--) {
        try { return ($lines[$index] | ConvertFrom-Json) } catch { }
    }
    return $null
}

function Read-State([string]$Path) {
    $state = @{}
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return $state }
    try {
        $parsed = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
        foreach ($property in $parsed.PSObject.Properties) { $state[$property.Name] = $property.Value }
        return $state
    } catch {
        Fail "Existing state file is invalid: $Path"
    }
}

function Write-State([string]$Path, [hashtable]$State) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    Set-Content -LiteralPath $Path -Encoding utf8 -Value ($State | ConvertTo-Json -Depth 8)
}

function Invoke-LocalConnectorCertificationGate([string]$RepairScript, [string]$RepairStatePath) {
    if (-not (Test-Path -LiteralPath $RepairScript -PathType Leaf)) {
        Fail "Local Connector recovery helper is missing: $RepairScript"
    }
    if (Test-Path -LiteralPath $RepairStatePath) {
        Remove-Item -LiteralPath $RepairStatePath -Force -ErrorAction SilentlyContinue
    }

    Write-Host "STAGING_CERTIFICATION_CONNECTOR_GATE: status=checking hostname=connector.mad4b.com"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $RepairScript `
        -ConnectorEnvironment staging `
        -StatePath $RepairStatePath
    $repairExitCode = [int]$LASTEXITCODE

    $repair = $null
    if (Test-Path -LiteralPath $RepairStatePath -PathType Leaf) {
        try { $repair = Get-Content -Raw -LiteralPath $RepairStatePath | ConvertFrom-Json -ErrorAction Stop } catch { }
    }
    $repairStatus = if ($null -ne $repair) { [string]$repair.status } else { "missing_evidence" }
    $repairError = if ($null -ne $repair -and $repair.PSObject.Properties.Name -contains "public_error") { [string]$repair.public_error } else { "" }
    $failureClass = if ($repairStatus -eq "cloudflare_1033" -or $repairError -eq "cloudflare_1033") {
        "connector_tunnel_cloudflare_1033"
    } elseif ($repairStatus -eq "cross_runtime_non_interference_failed") {
        "connector_cross_runtime_interference"
    } elseif ($repairStatus -eq "ambiguous_legacy_service_requires_reconciliation") {
        "connector_tunnel_ownership_ambiguous"
    } else {
        "connector_tunnel_unhealthy"
    }

    $state = Read-State $StatePath
    $state["local_connector_tunnel_required"] = $true
    $state["local_connector_tunnel_status"] = $repairStatus
    $state["local_connector_tunnel_failure_class"] = if ($repairStatus -eq "healthy") { "" } else { $failureClass }
    $state["local_connector_tunnel_checked_at"] = (Get-Date).ToUniversalTime().ToString("o")
    $state["local_connector_tunnel_hostname"] = "connector.mad4b.com"
    $state["local_connector_tunnel_secrets_included"] = $false

    if ($repairExitCode -ne 0 -or $repairStatus -ne "healthy") {
        $state["certification_status"] = "blocked"
        $state["certification_ready"] = $false
        $state["certification_blocking_failures"] = @($failureClass)
        $state["secrets_included"] = $false
        Write-State $StatePath $state
        Write-Host "STAGING_CERTIFICATION_BLOCKED: commit=$ExpectedCommit reasons=$failureClass" -ForegroundColor Red
        exit 1
    }

    Write-State $StatePath $state
    Write-Host "STAGING_CERTIFICATION_CONNECTOR_GATE: status=healthy hostname=connector.mad4b.com"
    return $repair
}

$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') { Fail "ExpectedCommit must be an exact 40-character SHA" }
if ($Ref -ne "main") { Fail "Portable Staging certification is main-only" }

$scriptRoot = Split-Path -Parent $PSCommandPath
$apiPath = Join-Path $RepositoryPath "http-generic-api"
$composeBase = Join-Path $apiPath "docker-compose.yml"
$composeStage = Join-Path $apiPath "docker-compose.staging.yml"
$envFile = Join-Path $apiPath ".env.staging"
$connectorRepairScript = Join-Path $scriptRoot "Repair-LocalConnectorTunnel.ps1"
$connectorRepairStatePath = Join-Path $scriptRoot "logs\local-connector-tunnel-state.json"
foreach ($required in @($composeBase, $composeStage, $envFile, $connectorRepairScript)) {
    if (-not (Test-Path -LiteralPath $required)) { Fail "Required Staging certification input is missing: $required" }
}

# Connector recovery is an explicit certification precondition. It is kept
# independent from the Staging dev/mcp tunnel and may only repair the dedicated
# Mad4B Local Connector runtime. Persistent 1033 therefore blocks certification
# with a connector-specific root cause instead of being hidden by Gateway state.
[void](Invoke-LocalConnectorCertificationGate $connectorRepairScript $connectorRepairStatePath)

$gatewayEnabled = (Read-EnvValue $envFile "ACTIVATION_STAGING_GATEWAY_ENABLED").ToLowerInvariant() -eq "true"
$expectedTree = Read-EnvValue $envFile "STAGING_BUILD_TREE"
$expectedContextFileSet = Read-EnvValue $envFile "STAGING_BUILD_CONTEXT_FILE_SET_SHA256"
$composeArgs = @("compose", "-f", $composeBase, "-f", $composeStage, "--env-file", $envFile)
$appContainerId = ((& docker @composeArgs ps -q app 2>$null | Out-String).Trim()).ToLowerInvariant()
if ($appContainerId -notmatch '^[0-9a-fA-F]{64}$') { Fail "Staging app container is not running with a full container ID" }
$imageId = ((& docker inspect --format '{{.Image}}' $appContainerId 2>$null | Out-String).Trim()).ToLowerInvariant()
if ($imageId -notmatch '^sha256:[0-9a-fA-F]{64}$') { Fail "Staging app image ID is not a content-addressed sha256 digest" }
$certArgs = $composeArgs + @(
    "exec", "-T",
    "-e", "STAGING_CERT_EXPECTED_COMMIT=$($ExpectedCommit.ToLowerInvariant())",
    "-e", "STAGING_CERT_EXPECTED_BRANCH=$Ref",
    "-e", "STAGING_CERT_EXPECTED_TREE=$expectedTree",
    "-e", "STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256=$expectedContextFileSet",
    "-e", "STAGING_CERT_APP_IMAGE_ID=$imageId",
    "-e", "STAGING_CERT_APP_BASE_URL=http://127.0.0.1:8080",
    "-e", "STAGING_CERT_REQUIRE_GATEWAY=$($gatewayEnabled.ToString().ToLowerInvariant())",
    "-e", "STAGING_CERT_REQUIRE_GATEWAY_UPSTREAM=$(($gatewayEnabled -and [bool]$StartTunnel).ToString().ToLowerInvariant())",
    "-e", "STAGING_CERT_REQUIRE_READY=false",
    "-e", "STAGING_CERT_GATEWAY_POLICY_PATH=/app/staging-route-policy.json",
    "app", "node", "scripts/staging-live-certification.mjs"
)

$output = & docker @certArgs 2>&1
$exitCode = $LASTEXITCODE
$text = (($output | Out-String).Trim())
$certification = Read-LastJsonObject $text
if ($null -eq $certification -or $certification.contract -ne "mad4b.staging-live-certification.v1") {
    Fail "Staging certification did not return the canonical contract"
}

$state = Read-State $StatePath
$state["certification_contract"] = [string]$certification.contract
$state["certification_status"] = [string]$certification.outcome
$state["certification_ready"] = ($certification.ready -eq $true)
$state["certified_commit"] = [string]$certification.observed.commit_sha
$state["certified_branch"] = [string]$certification.observed.branch
$state["certification_blocking_failures"] = @($certification.blocking_failures)
$state["certification_degraded_reasons"] = @($certification.degraded_reasons)
$state["gateway_required"] = [bool]$gatewayEnabled
$state["artifact_set_complete"] = ($certification.artifact_set.complete -eq $true)
$state["app_image_digest"] = [string]$certification.artifact_set.app.image_digest
$state["app_tree_sha"] = [string]$certification.artifact_set.app.tree_sha
$state["app_context_file_set_sha256"] = [string]$certification.artifact_set.app.context_file_set_sha256
$state["database_readiness"] = [string]$certification.observed.combined_database_status
$state["certification_checked_at"] = [string]$certification.generated_at
$state["secrets_included"] = $false
Write-State $StatePath $state

if ($exitCode -ne 0 -or $certification.outcome -eq "blocked") {
    Write-Host "STAGING_CERTIFICATION_BLOCKED: commit=$ExpectedCommit reasons=$(@($certification.blocking_failures) -join ',')" -ForegroundColor Red
    exit 1
}
if ($certification.outcome -eq "degraded") {
    Write-Host "STAGING_CERTIFICATION_DEGRADED: commit=$ExpectedCommit reasons=$(@($certification.degraded_reasons) -join ',')" -ForegroundColor Yellow
    exit 0
}
if ($certification.outcome -ne "ready") { Fail "Unsupported certification outcome: $($certification.outcome)" }
Write-Host "STAGING_CERTIFICATION_READY: commit=$ExpectedCommit gateway=$gatewayEnabled connector=healthy" -ForegroundColor Green
