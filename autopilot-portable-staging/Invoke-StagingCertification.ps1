[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedCommit,
    [string]$Ref = "main",
    [switch]$StartTunnel,
    [ValidateSet("disabled", "windows_service", "docker_sidecar")]
    [string]$TunnelMode = "disabled",
    [string]$StatePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($StartTunnel -and $TunnelMode -eq "disabled") { $TunnelMode = "windows_service" }
$TunnelSelected = $TunnelMode -ne "disabled"
$script:CertificationAuthorityMode = "main"

function Fail([string]$Message) {
    throw "STAGING_CERTIFICATION_FAIL_CLOSED: $Message"
}

function Get-StagingComposeArgs([string]$ApiPath, [string]$EnvPath, [string]$Mode) {
    $arguments = @(
        "compose",
        "-f", (Join-Path $ApiPath "docker-compose.yml"),
        "-f", (Join-Path $ApiPath "docker-compose.staging.yml")
    )
    $override = switch ($Mode) {
        "windows_service" { Join-Path $ApiPath "docker-compose.staging.windows-service.yml" }
        "docker_sidecar" { Join-Path $ApiPath "docker-compose.staging.docker-sidecar.yml" }
        default { $null }
    }
    if ($null -ne $override) {
        if (-not (Test-Path -LiteralPath $override -PathType Leaf)) { Fail "Required Staging Compose topology override is missing: $override" }
        $arguments += @("-f", $override)
    }
    return @($arguments + @("--env-file", $EnvPath))
}

function Assert-WindowsHostOriginReachable([string[]]$ComposeArgs, [string]$Mode) {
    if ($Mode -ne "windows_service") { return }
    $origin = "http://127.0.0.1:8080/health"
    $published = (& docker @($ComposeArgs + @("port", "app", "8080")) 2>$null | Out-String).Trim()
    try {
        Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
    } catch {
        $state = Read-State $StatePath
        $state["certification_status"] = "blocked"
        $state["certification_ready"] = $false
        $state["certification_blocking_failures"] = @("origin_probe_runtime_error")
        $state["staging_origin"] = $origin
        $state["staging_origin_tunnel_mode"] = $Mode
        $state["staging_origin_probe_reason"] = "http_client_runtime_unavailable"
        $state["secrets_included"] = $false
        Write-State $StatePath $state
        Write-Host "STAGING_CERTIFICATION_BLOCKED: commit=$ExpectedCommit reasons=origin_probe_runtime_error tunnel_mode=$Mode origin=$origin" -ForegroundColor Red
        exit 1
    }
    $lastError = ""
    if ($LASTEXITCODE -eq 0 -and $published -match '^(?:127\.0\.0\.1|localhost):8080$') {
        $client = $null
        try {
            $client = New-Object System.Net.Http.HttpClient
            $client.Timeout = [TimeSpan]::FromSeconds(10)
            $response = $client.GetAsync($origin).GetAwaiter().GetResult()
            if ($response.IsSuccessStatusCode) {
                Write-Host "STAGING_CERTIFICATION_HOST_ORIGIN_READY: tunnel_mode=$Mode origin=$origin status=$([int]$response.StatusCode)"
                $response.Dispose()
                $client.Dispose()
                return
            }
            $lastError = "http_status_$([int]$response.StatusCode)"
            $response.Dispose()
            $client.Dispose()
        } catch {
            if ($null -ne $client) { $client.Dispose() }
            $lastError = $_.Exception.Message
        }
    } else {
        $lastError = "host_binding_missing observed=$published"
    }
    $state = Read-State $StatePath
    $state["certification_status"] = "blocked"
    $state["certification_ready"] = $false
    $state["certification_blocking_failures"] = @("staging_origin_unreachable")
    $state["staging_origin"] = $origin
    $state["staging_origin_tunnel_mode"] = $Mode
    $state["secrets_included"] = $false
    Write-State $StatePath $state
    Write-Host "STAGING_CERTIFICATION_BLOCKED: commit=$ExpectedCommit reasons=staging_origin_unreachable tunnel_mode=$Mode origin=$origin error=$lastError" -ForegroundColor Red
    exit 1
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

function Assert-CertificationAuthority {
    $mode = ([string]$env:STAGING_CERT_AUTHORITY_MODE).Trim().ToLowerInvariant()
    if ($Ref -eq "main") {
        if (-not [string]::IsNullOrWhiteSpace($mode) -and $mode -ne "main") {
            Fail "main certification cannot use a non-main certification authority mode"
        }
        return
    }

    if ($mode -ne "pull_request_head") {
        Fail "Non-main certification requires STAGING_CERT_AUTHORITY_MODE=pull_request_head"
    }
    if ($Ref -notmatch '^(gpt|cert|fix|feat|chore|docs|release)/[A-Za-z0-9._/-]+$') {
        Fail "Non-main certification ref is not an approved governed work branch"
    }

    $repository = ([string]$env:STAGING_CERT_PR_REPOSITORY).Trim()
    if ($repository -ne "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os") {
        Fail "PR-head certification repository authority is missing or invalid"
    }

    $prNumberText = ([string]$env:STAGING_CERT_PR_NUMBER).Trim()
    $prNumber = 0
    if (-not [int]::TryParse($prNumberText, [ref]$prNumber) -or $prNumber -lt 1) {
        Fail "PR-head certification requires a positive STAGING_CERT_PR_NUMBER"
    }
    if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) {
        Fail "GitHub CLI is required for PR-head certification authority readback"
    }
    if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) {
        Fail "Git is required for PR-head certification authority readback"
    }

    $localHead = ((& git -C $RepositoryPath rev-parse HEAD 2>$null | Out-String).Trim()).ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $localHead -ne $ExpectedCommit.ToLowerInvariant()) {
        Fail "Local repository HEAD is not the exact PR head during certification"
    }

    $raw = & gh api `
        -H "Accept: application/vnd.github+json" `
        -H "X-GitHub-Api-Version: 2022-11-28" `
        "repos/$repository/pulls/$prNumber" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Fail "GitHub pull-request authority readback failed"
    }
    try {
        $pr = ($raw | Out-String) | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Fail "GitHub pull-request authority readback was not valid JSON"
    }

    if ([string]$pr.state -ne "open") { Fail "PR-head certification requires an open pull request" }
    if ([bool]$pr.draft) { Fail "PR-head certification refuses draft pull requests" }
    if ([string]$pr.base.ref -ne "main") { Fail "PR-head certification requires base=main" }
    if ([string]$pr.head.repo.full_name -ne $repository) { Fail "Cross-repository PR-head certification is forbidden" }
    if ([string]$pr.head.ref -ne $Ref) { Fail "Pull-request head ref no longer matches the requested ref" }
    if (([string]$pr.head.sha).ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant()) {
        Fail "Pull-request head SHA no longer matches ExpectedCommit"
    }

    $script:CertificationAuthorityMode = "pull_request_head"
    $state = Read-State $StatePath
    $state["certification_authority_mode"] = "pull_request_head"
    $state["certification_pr_number"] = $prNumber
    $state["certification_pr_repository"] = $repository
    $state["certification_pr_base_ref"] = [string]$pr.base.ref
    $state["certification_pr_head_ref"] = [string]$pr.head.ref
    $state["certification_pr_head_sha"] = ([string]$pr.head.sha).ToLowerInvariant()
    $state["certification_pr_authority_checked_at"] = (Get-Date).ToUniversalTime().ToString("o")
    $state["secrets_included"] = $false
    Write-State $StatePath $state

    Write-Host "STAGING_CERTIFICATION_PR_HEAD_AUTHORITY: pr=$prNumber ref=$Ref commit=$ExpectedCommit status=exact"
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
    $failureClass = if ($repairStatus -eq "connector_tunnel_provisioning_required") {
        "connector_tunnel_provisioning_required"
    } elseif ($repairStatus -eq "cloudflare_1033" -or $repairError -eq "cloudflare_1033") {
        "connector_tunnel_cloudflare_1033"
    } elseif ($repairStatus -eq "cross_runtime_non_interference_failed") {
        "connector_cross_runtime_interference"
    } elseif ($repairStatus -eq "ambiguous_legacy_service_requires_reconciliation") {
        "connector_tunnel_ownership_ambiguous"
    } elseif ($repairStatus -eq "connector_installation_incomplete") {
        "connector_installation_incomplete"
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
    if ($null -ne $repair -and $repair.PSObject.Properties.Name -contains "required_next_action") {
        $state["local_connector_tunnel_required_next_action"] = [string]$repair.required_next_action
    }
    if ($null -ne $repair -and $repair.PSObject.Properties.Name -contains "accepted_provisioning_sources") {
        $state["local_connector_tunnel_accepted_provisioning_sources"] = @($repair.accepted_provisioning_sources)
    }

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
Assert-CertificationAuthority

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

$gatewayConfigured = (Read-EnvValue $envFile "ACTIVATION_STAGING_GATEWAY_ENABLED").ToLowerInvariant() -eq "true"
$gatewayEnabled = $gatewayConfigured -and $script:CertificationAuthorityMode -ne "pull_request_head"
$gatewayCertificationScope = if ($script:CertificationAuthorityMode -eq "pull_request_head") { "excluded_external_gateway" } else { "configured_runtime_scope" }
$expectedTree = Read-EnvValue $envFile "STAGING_BUILD_TREE"
$expectedContextFileSet = Read-EnvValue $envFile "STAGING_BUILD_CONTEXT_FILE_SET_SHA256"
$composeArgs = @(Get-StagingComposeArgs $apiPath $envFile $TunnelMode)
[void](Assert-WindowsHostOriginReachable $composeArgs $TunnelMode)

# Connector recovery is an explicit certification precondition after the local
# host origin is proven. A broken application topology must fail before any
# independent Connector recovery action is attempted.
[void](Invoke-LocalConnectorCertificationGate $connectorRepairScript $connectorRepairStatePath)

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
    "-e", "STAGING_CERT_REQUIRE_GATEWAY_UPSTREAM=$(($gatewayEnabled -and [bool]$TunnelSelected).ToString().ToLowerInvariant())",
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
$state["gateway_configured"] = [bool]$gatewayConfigured
$state["gateway_certification_scope"] = $gatewayCertificationScope
$state["certification_authority_mode"] = $script:CertificationAuthorityMode
$state["tunnel_mode"] = $TunnelMode
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
