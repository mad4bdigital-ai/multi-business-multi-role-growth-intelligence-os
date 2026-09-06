[CmdletBinding()]
param(
    [string]$ConnectorRoot = "C:\mad4b-connector\local-connector",
    [ValidateSet("staging")]
    [string]$ConnectorEnvironment = "staging",
    [ValidateRange(5, 120)]
    [int]$RecoveryWaitSeconds = 30,
    [string]$StatePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$CanonicalTunnelRuntime = "Mad4B-LocalConnector-Cloudflared"
$StagingTunnelRuntime = "Mad4B-Staging-Cloudflared"
$LegacyTunnelTask = "GrowthIntelligence-CloudflaredTunnel"
$ConnectorTask = "GrowthIntelligence-LocalConnector"
$WatchdogTask = "GrowthIntelligence-ConnectorWatchdog"
$LegacyWatchdogTask = "Mad4B-LocalConnector-Watchdog"
$EnvPath = Join-Path $ConnectorRoot ".env"
$PackageSource = Join-Path (Split-Path -Parent $PSScriptRoot) "local-connector"
$InstallerPath = Join-Path $ConnectorRoot "install-service.ps1"
$DefaultTunnelTokenFile = Join-Path $ConnectorRoot "secrets\cloudflared-token.txt"
$RequiredAssets = @("server.mjs", "browser4-adapter.mjs", "local-agent-runtime.mjs", "install-service.ps1", "connector-watchdog.ps1")
if ([string]::IsNullOrWhiteSpace($StatePath)) { $StatePath = Join-Path $PSScriptRoot "logs\local-connector-tunnel-state.json" }

function Write-State([hashtable]$State) {
    $State["generated_at"] = [DateTime]::UtcNow.ToString("o")
    $State["secrets_included"] = $false
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StatePath) | Out-Null
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($StatePath, ($State | ConvertTo-Json -Depth 10), $encoding)
}
function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { return "" }
    $prefix = "$Name="
    foreach ($line in Get-Content -LiteralPath $EnvPath -ErrorAction Stop) {
        $text = [string]$line
        if ($text.StartsWith($prefix, [System.StringComparison]::Ordinal)) { return $text.Substring($prefix.Length).Trim() }
    }
    return ""
}
function Set-DotEnvValue([string]$Name, [string]$Value) {
    $lines = if (Test-Path -LiteralPath $EnvPath -PathType Leaf) { @(Get-Content -LiteralPath $EnvPath -ErrorAction Stop) } else { @() }
    $prefix = "$Name="
    $updated = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ([string]$lines[$i] -like "$prefix*") { $lines[$i] = "$Name=$Value"; $updated = $true }
    }
    if (-not $updated) { $lines += "$Name=$Value" }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($EnvPath, [string[]]$lines, $encoding)
}
function Bind-StagingConnectorEnvironment {
    if ($ConnectorEnvironment -ne "staging") { throw "Only Staging environment binding is authorized by this repair tool." }
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { throw "Existing Local Connector .env is required; repair will not invent or replace connector secrets." }
    $base = "https://dev.mad4b.com"
    Set-DotEnvValue "CONNECTOR_ENVIRONMENT" "staging"
    Set-DotEnvValue "CONNECTOR_CONTROL_PLANE_BASE_URL" $base
    Set-DotEnvValue "CONNECTOR_POLICY_URL" "$base/connector-agent/policy"
    Set-DotEnvValue "CONNECTOR_HEARTBEAT_URL" "$base/connector-agent/heartbeat"
    Set-DotEnvValue "CONNECTOR_MANIFEST_URL" "$base/connector-agent/manifest"
    Set-DotEnvValue "CONNECTOR_CLOUDFLARED_SERVICE" $CanonicalTunnelRuntime
    Set-DotEnvValue "CONNECTOR_CLOUDFLARED_TASK" $CanonicalTunnelRuntime
    Set-DotEnvValue "CONNECTOR_SCHEDULED_TASK" $ConnectorTask
    foreach ($name in @("CONNECTOR_CONTROL_PLANE_BASE_URL", "CONNECTOR_POLICY_URL", "CONNECTOR_HEARTBEAT_URL", "CONNECTOR_MANIFEST_URL")) {
        $value = Get-DotEnvValue $name
        if ($value -match '(?i)://auth\.mad4b\.com(?:/|$)') { throw "Staging Connector callback binding rejected Production host for $name." }
        if ($value -notmatch '^https://dev\.mad4b\.com(?:/|$)') { throw "Staging Connector callback binding is outside dev.mad4b.com for $name." }
    }
}
function Resolve-ConnectorTunnelTokenFile {
    $configured = (Get-DotEnvValue "CONNECTOR_CLOUDFLARED_TOKEN_FILE").Trim()
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        try { return [IO.Path]::GetFullPath($configured) } catch { return $configured }
    }
    return $DefaultTunnelTokenFile
}
function Test-ConnectorTunnelTokenFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $value = [IO.File]::ReadAllText($Path).Trim()
        return ($value.Length -gt 20)
    } catch { return $false }
}
function Test-CanonicalTunnelTaskUsesTokenFile([string]$ExpectedTokenFile) {
    try {
        $task = Get-ScheduledTask -TaskName $CanonicalTunnelRuntime -ErrorAction SilentlyContinue
        if ($null -eq $task) { return $false }
        $arguments = [string]$task.Actions.Arguments
        if ($arguments -notmatch '(?i)--token-file') { return $false }
        if (-not [string]::IsNullOrWhiteSpace($ExpectedTokenFile) -and $arguments -notlike "*$ExpectedTokenFile*") { return $false }
        return $true
    } catch { return $false }
}
function Get-ServiceSnapshot([string]$Name) {
    try {
        $svc = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
        return [pscustomobject]@{ exists = $true; state = [string]$svc.State; process_id = [int]$svc.ProcessId; start_mode = [string]$svc.StartMode; path_name = [string]$svc.PathName }
    } catch { return [pscustomobject]@{ exists = $false; state = "missing"; process_id = 0; start_mode = ""; path_name = "" } }
}
function Get-TaskState([string]$Name) {
    try { $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue; if ($null -eq $task) { return "missing" }; return [string]$task.State } catch { return "unknown" }
}
function Get-LegacyServiceClass([object]$Snapshot) {
    if (-not $Snapshot.exists) { return "absent" }
    $path = [string]$Snapshot.path_name
    $stagingEvidence = $path -match '(?i)(staging-cloudflared\.log|Mad4B\\Staging|staging[^\"]*tunnel-token)'
    if ($Snapshot.state -eq "Stopped" -and $Snapshot.start_mode -eq "Disabled" -and $stagingEvidence) { return "quarantined_staging_alias" }
    return "ambiguous_connector_ownership"
}
function Copy-StagingConnectorPackage {
    $missingSource = @($RequiredAssets | Where-Object { -not (Test-Path -LiteralPath (Join-Path $PackageSource $_) -PathType Leaf) })
    if ($missingSource.Count -gt 0) { return [pscustomobject]@{ copied = $false; missing = $missingSource; reason = "package_source_incomplete" } }
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { return [pscustomobject]@{ copied = $false; missing = @(".env"); reason = "existing_env_missing" } }
    foreach ($asset in $RequiredAssets) { Copy-Item -LiteralPath (Join-Path $PackageSource $asset) -Destination (Join-Path $ConnectorRoot $asset) -Force }
    return [pscustomobject]@{ copied = $true; missing = @(); reason = "repository_package_copied" }
}
function Ensure-TaskRunning([string]$Name) {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($null -eq $task) { return $false }
    if ([string]$task.State -ne "Running") { Start-ScheduledTask -TaskName $Name -ErrorAction Stop; Start-Sleep -Seconds 2; $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop }
    return ([string]$task.State -eq "Running")
}
function Ensure-ConnectorRuntimeRunning {
    $service = Get-Service -Name "local-connector" -ErrorAction SilentlyContinue
    if ($null -ne $service) {
        if ($service.Status -ne "Running") { Start-Service -Name "local-connector" -ErrorAction Stop; $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(20)) }
        return $true
    }
    return Ensure-TaskRunning $ConnectorTask
}
function Restart-ConnectorRuntime {
    $service = Get-Service -Name "local-connector" -ErrorAction SilentlyContinue
    if ($null -ne $service) { Restart-Service -Name "local-connector" -Force -ErrorAction Stop; return $true }
    $task = Get-ScheduledTask -TaskName $ConnectorTask -ErrorAction SilentlyContinue
    if ($null -ne $task) { Stop-ScheduledTask -TaskName $ConnectorTask -ErrorAction SilentlyContinue; Start-ScheduledTask -TaskName $ConnectorTask -ErrorAction Stop; Start-Sleep -Seconds 2; return ((Get-TaskState $ConnectorTask) -eq "Running") }
    return $false
}
function Restart-LocalTunnelRuntime {
    $task = Get-ScheduledTask -TaskName $CanonicalTunnelRuntime -ErrorAction SilentlyContinue
    if ($null -ne $task) { Stop-ScheduledTask -TaskName $CanonicalTunnelRuntime -ErrorAction SilentlyContinue; Start-ScheduledTask -TaskName $CanonicalTunnelRuntime -ErrorAction Stop; Start-Sleep -Seconds 2; return ((Get-TaskState $CanonicalTunnelRuntime) -eq "Running") }
    return $false
}
function Test-LocalConnectorHealth { try { $response = Invoke-WebRequest -Uri "http://127.0.0.1:7070/health" -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop; return ([int]$response.StatusCode -eq 200) } catch { return $false } }
function Wait-LocalConnectorHealth([int]$Seconds) { $deadline = [DateTime]::UtcNow.AddSeconds($Seconds); do { if (Test-LocalConnectorHealth) { return $true }; Start-Sleep -Seconds 2 } while ([DateTime]::UtcNow -lt $deadline); return $false }
function Get-PublicConnectorHealth {
    try { $response = Invoke-WebRequest -Uri "https://connector.mad4b.com/health" -UseBasicParsing -TimeoutSec 12 -ErrorAction Stop; return [pscustomobject]@{ healthy = ([int]$response.StatusCode -eq 200); http_status = [int]$response.StatusCode; error = $null } }
    catch { $status = $null; try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch { }; $text = [string]$_.Exception.Message; $errorCode = if ($status -eq 530 -or $text -match '(?i)\b1033\b') { "cloudflare_1033" } else { "remote_unavailable" }; return [pscustomobject]@{ healthy = $false; http_status = $status; error = $errorCode } }
}
function Wait-PublicHealth([int]$Seconds) { $deadline = [DateTime]::UtcNow.AddSeconds($Seconds); $last = Get-PublicConnectorHealth; while ([DateTime]::UtcNow -lt $deadline) { if ($last.healthy) { return $last }; Start-Sleep -Seconds 3; $last = Get-PublicConnectorHealth }; return $last }
function Complete-StagingReadback([hashtable]$State, [object]$Before) {
    $after = Get-ServiceSnapshot $StagingTunnelRuntime
    $State.staging_state_after = $after.state
    $State.staging_pid_after = $after.process_id
    $State.staging_runtime_unchanged = ($after.state -eq $Before.state -and $after.process_id -eq $Before.process_id)
}

if (-not (Test-Path -LiteralPath $ConnectorRoot -PathType Container)) { throw "Local Connector root is missing: $ConnectorRoot" }
$stagingBefore = Get-ServiceSnapshot $StagingTunnelRuntime
$legacyGenericService = Get-ServiceSnapshot "cloudflared"
$legacyServiceClass = Get-LegacyServiceClass $legacyGenericService
$legacyTaskState = Get-TaskState $LegacyTunnelTask
$state = @{
    contract = "mad4b.staging-local-connector-1033-recovery.v3"
    connector_environment = "staging"
    control_plane_host = "dev.mad4b.com"
    canonical_tunnel_runtime = $CanonicalTunnelRuntime
    staging_tunnel_runtime = $StagingTunnelRuntime
    credential_mode = "token_file"
    token_file_configured = $false
    token_file_present = $false
    required_next_action = $null
    accepted_provisioning_sources = @()
    legacy_generic_service_detected = [bool]$legacyGenericService.exists
    legacy_service_class = $legacyServiceClass
    legacy_service_mutated = $false
    legacy_task_detected = ($legacyTaskState -ne "missing")
    legacy_watchdog_task_detected = ((Get-TaskState $LegacyWatchdogTask) -ne "missing")
    ownership_migration_blocked = ($legacyServiceClass -eq "ambiguous_connector_ownership")
    package_bootstrap_attempted = $false
    package_bootstrap_source = "repository_exact_checkout"
    missing_assets = @()
    connector_runtime_ensure_attempted = $false
    connector_runtime_restart_attempted = $false
    local_health = $false
    public_health = $false
    public_http_status = $null
    public_error = $null
    tunnel_restart_attempted = $false
    staging_state_before = $stagingBefore.state
    staging_pid_before = $stagingBefore.process_id
    staging_state_after = $null
    staging_pid_after = $null
    staging_runtime_unchanged = $false
    production_callback_fallback = $false
    production_mutation = $false
    provider_mutation = $false
    dns_mutation = $false
    status = "checking"
}
if ($state.ownership_migration_blocked) {
    $state.status = "ambiguous_legacy_service_requires_reconciliation"
    Complete-StagingReadback $state $stagingBefore
    Write-State $state
    Write-Host "LOCAL_CONNECTOR_RECOVERY_BLOCKED: status=$($state.status)"
    exit 2
}

$missingRuntimeAssets = @($RequiredAssets | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ConnectorRoot $_) -PathType Leaf) })
if ($missingRuntimeAssets.Count -gt 0) {
    $state.package_bootstrap_attempted = $true
    $copyResult = Copy-StagingConnectorPackage
    if (-not $copyResult.copied) {
        $state.missing_assets = @($copyResult.missing)
        $state.status = "connector_installation_incomplete"
        Complete-StagingReadback $state $stagingBefore
        Write-State $state
        Write-Host "LOCAL_CONNECTOR_RECOVERY_BLOCKED: status=$($state.status) missing_assets=$($state.missing_assets -join ',')"
        exit 2
    }
}

Bind-StagingConnectorEnvironment
$tokenFile = Resolve-ConnectorTunnelTokenFile
$state.token_file_configured = -not [string]::IsNullOrWhiteSpace((Get-DotEnvValue "CONNECTOR_CLOUDFLARED_TOKEN_FILE"))
$state.token_file_present = Test-ConnectorTunnelTokenFile $tokenFile
if ($state.token_file_present -and -not $state.token_file_configured) {
    Set-DotEnvValue "CONNECTOR_CLOUDFLARED_TOKEN_FILE" $tokenFile
    $state.token_file_configured = $true
}
if (-not $state.token_file_present) {
    $state.status = "connector_tunnel_provisioning_required"
    $state.required_next_action = "provision_tunnel_token"
    $state.accepted_provisioning_sources = @("CONNECTOR_CLOUDFLARED_TOKEN_FILE", "governed_provider_recovery")
    $state.missing_assets = @("connector_tunnel_token_file")
    Complete-StagingReadback $state $stagingBefore
    Write-State $state
    Write-Host "LOCAL_CONNECTOR_RECOVERY_BLOCKED: status=$($state.status) required_next_action=$($state.required_next_action)"
    exit 2
}

$canonicalTaskState = Get-TaskState $CanonicalTunnelRuntime
$connectorTaskState = Get-TaskState $ConnectorTask
$watchdogTaskState = Get-TaskState $WatchdogTask
$canonicalBindingReady = Test-CanonicalTunnelTaskUsesTokenFile $tokenFile
if ($canonicalTaskState -eq "missing" -or $connectorTaskState -eq "missing" -or $watchdogTaskState -eq "missing" -or -not $canonicalBindingReady) {
    try {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $InstallerPath
        if ($LASTEXITCODE -ne 0) { throw "installer_exit_code_$LASTEXITCODE" }
    } catch {
        $state.status = "connector_installation_incomplete"
        $state.missing_assets = @("canonical_runtime_installation")
        $state["install_error"] = $_.Exception.Message
        Complete-StagingReadback $state $stagingBefore
        Write-State $state
        Write-Host "LOCAL_CONNECTOR_RECOVERY_BLOCKED: status=$($state.status)"
        exit 2
    }
}

$canonicalTaskState = Get-TaskState $CanonicalTunnelRuntime
if ($canonicalTaskState -eq "missing" -or -not (Test-CanonicalTunnelTaskUsesTokenFile $tokenFile)) {
    $state.status = "connector_installation_incomplete"
    $state.missing_assets = @($CanonicalTunnelRuntime)
    Complete-StagingReadback $state $stagingBefore
    Write-State $state
    exit 2
}

$state.connector_runtime_ensure_attempted = $true
[void](Ensure-ConnectorRuntimeRunning)
$state.local_health = Wait-LocalConnectorHealth ([Math]::Min(10, $RecoveryWaitSeconds))
if (-not $state.local_health) { $state.connector_runtime_restart_attempted = $true; [void](Restart-ConnectorRuntime); $state.local_health = Wait-LocalConnectorHealth ([Math]::Min(15, $RecoveryWaitSeconds)) }
$public = Get-PublicConnectorHealth
if ($state.local_health -and -not $public.healthy) { $state.tunnel_restart_attempted = $true; [void](Restart-LocalTunnelRuntime); $public = Wait-PublicHealth $RecoveryWaitSeconds }
$state.public_health = [bool]$public.healthy
$state.public_http_status = $public.http_status
$state.public_error = $public.error
$state.status = if ($state.local_health -and $state.public_health) { "healthy" } elseif ($state.local_health -and $state.public_error -eq "cloudflare_1033") { "cloudflare_1033" } elseif ($state.local_health) { "tunnel_unhealthy" } else { "connector_unhealthy" }
Complete-StagingReadback $state $stagingBefore
if (-not $state.staging_runtime_unchanged) { $state.status = "cross_runtime_non_interference_failed" }
Write-State $state
if ($state.status -eq "healthy") { Write-Host "LOCAL_CONNECTOR_RECOVERY_READY: environment=staging tunnel=$CanonicalTunnelRuntime staging_unchanged=true"; exit 0 }
Write-Host "LOCAL_CONNECTOR_RECOVERY_DEGRADED: status=$($state.status) error=$($state.public_error) http_status=$($state.public_http_status)"
exit 1
