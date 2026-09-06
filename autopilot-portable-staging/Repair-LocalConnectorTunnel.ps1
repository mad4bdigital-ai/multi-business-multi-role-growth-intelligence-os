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
$EnvPath = Join-Path $ConnectorRoot ".env"
$InstallerPath = Join-Path $ConnectorRoot "install-service.ps1"
if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path $PSScriptRoot "logs\local-connector-tunnel-state.json"
}

function Write-State([hashtable]$State) {
    $State["generated_at"] = [DateTime]::UtcNow.ToString("o")
    $State["secrets_included"] = $false
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StatePath) | Out-Null
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($StatePath, ($State | ConvertTo-Json -Depth 8), $encoding)
}

function Set-DotEnvValue([string]$Name, [string]$Value) {
    $lines = @()
    if (Test-Path -LiteralPath $EnvPath -PathType Leaf) {
        $lines = @(Get-Content -LiteralPath $EnvPath -ErrorAction Stop)
    }
    $prefix = "$Name="
    $updated = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ([string]$lines[$i] -like "$prefix*") {
            $lines[$i] = "$Name=$Value"
            $updated = $true
        }
    }
    if (-not $updated) { $lines += "$Name=$Value" }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($EnvPath, [string[]]$lines, $encoding)
}

function Bind-StagingConnectorEnvironment {
    if ($ConnectorEnvironment -ne "staging") { throw "Only Staging environment binding is authorized by this repair tool." }
    $base = "https://dev.mad4b.com"
    Set-DotEnvValue "CONNECTOR_ENVIRONMENT" "staging"
    Set-DotEnvValue "CONNECTOR_CONTROL_PLANE_BASE_URL" $base
    Set-DotEnvValue "CONNECTOR_POLICY_URL" "$base/connector-agent/policy"
    Set-DotEnvValue "CONNECTOR_HEARTBEAT_URL" "$base/connector-agent/heartbeat"
    Set-DotEnvValue "CONNECTOR_CLOUDFLARED_SERVICE" $CanonicalTunnelRuntime
    Set-DotEnvValue "CONNECTOR_CLOUDFLARED_TASK" $CanonicalTunnelRuntime
    Set-DotEnvValue "CONNECTOR_SCHEDULED_TASK" $ConnectorTask
}

function Get-ServiceSnapshot([string]$Name) {
    try {
        $svc = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
        return [pscustomobject]@{
            exists = $true
            state = [string]$svc.State
            process_id = [int]$svc.ProcessId
            start_mode = [string]$svc.StartMode
            path_name = [string]$svc.PathName
        }
    } catch {
        return [pscustomobject]@{ exists = $false; state = "missing"; process_id = 0; start_mode = $null; path_name = $null }
    }
}

function Get-TaskState([string]$Name) {
    try {
        $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
        if ($null -eq $task) { return "missing" }
        return [string]$task.State
    } catch { return "unknown" }
}

function Ensure-TaskRunning([string]$Name) {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($null -eq $task) { return $false }
    if ([string]$task.State -ne "Running") {
        Start-ScheduledTask -TaskName $Name -ErrorAction Stop
        Start-Sleep -Seconds 2
        $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    }
    return ([string]$task.State -eq "Running")
}

function Restart-LocalTunnelRuntime {
    $service = Get-Service -Name $CanonicalTunnelRuntime -ErrorAction SilentlyContinue
    if ($null -ne $service) {
        Restart-Service -Name $CanonicalTunnelRuntime -Force -ErrorAction Stop
        $service = Get-Service -Name $CanonicalTunnelRuntime -ErrorAction Stop
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(20))
        return $true
    }
    $task = Get-ScheduledTask -TaskName $CanonicalTunnelRuntime -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Stop-ScheduledTask -TaskName $CanonicalTunnelRuntime -ErrorAction SilentlyContinue
        Start-ScheduledTask -TaskName $CanonicalTunnelRuntime -ErrorAction Stop
        Start-Sleep -Seconds 2
        return ((Get-TaskState $CanonicalTunnelRuntime) -eq "Running")
    }
    return $false
}

function Test-LocalConnectorHealth {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:7070/health" -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        return ([int]$response.StatusCode -eq 200)
    } catch { return $false }
}

function Get-WebFailureText($ErrorRecord) {
    $text = [string]$ErrorRecord.Exception.Message
    try {
        $response = $ErrorRecord.Exception.Response
        if ($null -ne $response) {
            $stream = $response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                $body = $reader.ReadToEnd()
                if ($body) { $text += " $body" }
            }
        }
    } catch { }
    return $text
}

function Get-PublicConnectorHealth {
    try {
        $response = Invoke-WebRequest -Uri "https://connector.mad4b.com/health" -UseBasicParsing -TimeoutSec 12 -ErrorAction Stop
        return [pscustomobject]@{ healthy = ([int]$response.StatusCode -eq 200); http_status = [int]$response.StatusCode; error = $null }
    } catch {
        $status = $null
        try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch { }
        $text = Get-WebFailureText $_
        $errorCode = if ($status -eq 530 -or $text -match '(?i)\b1033\b') { "cloudflare_1033" } else { "remote_unavailable" }
        return [pscustomobject]@{ healthy = $false; http_status = $status; error = $errorCode }
    }
}

function Wait-PublicHealth([int]$Seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    $last = Get-PublicConnectorHealth
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($last.healthy) { return $last }
        Start-Sleep -Seconds 3
        $last = Get-PublicConnectorHealth
    }
    return $last
}

if (-not (Test-Path -LiteralPath $ConnectorRoot -PathType Container)) {
    throw "Local Connector root is missing: $ConnectorRoot"
}

$stagingBefore = Get-ServiceSnapshot $StagingTunnelRuntime
$legacyGenericService = Get-ServiceSnapshot "cloudflared"
$legacyTaskState = Get-TaskState $LegacyTunnelTask

# Repair the callback authority before starting or restarting any Local Connector
# process. This guarantees that Staging recovery never falls back to Production.
Bind-StagingConnectorEnvironment

# Scheduled-task installations are migrated by the repository-owned installer.
# An ambiguous generic Windows service is never stopped or deleted by this Staging
# repair tool because ownership cannot be proven from the service name alone.
$canonicalService = Get-ServiceSnapshot $CanonicalTunnelRuntime
$canonicalTaskState = Get-TaskState $CanonicalTunnelRuntime
if (-not $canonicalService.exists -and $canonicalTaskState -eq "missing" -and $legacyTaskState -ne "missing") {
    if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        throw "Legacy Local Connector tunnel task exists but install-service.ps1 is unavailable for bounded migration."
    }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $InstallerPath
    if ($LASTEXITCODE -ne 0) { throw "Local Connector scheduled-task ownership migration failed." }
    $canonicalTaskState = Get-TaskState $CanonicalTunnelRuntime
}

$state = @{
    contract = "mad4b.staging-local-connector-1033-recovery.v1"
    connector_environment = "staging"
    control_plane_host = "dev.mad4b.com"
    canonical_tunnel_runtime = $CanonicalTunnelRuntime
    staging_tunnel_runtime = $StagingTunnelRuntime
    legacy_generic_service_detected = [bool]$legacyGenericService.exists
    legacy_task_detected = ($legacyTaskState -ne "missing")
    ownership_migration_blocked = $false
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

$canonicalService = Get-ServiceSnapshot $CanonicalTunnelRuntime
$canonicalTaskState = Get-TaskState $CanonicalTunnelRuntime
if (-not $canonicalService.exists -and $canonicalTaskState -eq "missing") {
    $state.ownership_migration_blocked = [bool]$legacyGenericService.exists
    $state.status = if ($state.ownership_migration_blocked) { "ambiguous_legacy_service_requires_reconciliation" } else { "canonical_tunnel_runtime_missing" }
    $stagingAfter = Get-ServiceSnapshot $StagingTunnelRuntime
    $state.staging_state_after = $stagingAfter.state
    $state.staging_pid_after = $stagingAfter.process_id
    $state.staging_runtime_unchanged = ($stagingAfter.state -eq $stagingBefore.state -and $stagingAfter.process_id -eq $stagingBefore.process_id)
    Write-State $state
    Write-Host "LOCAL_CONNECTOR_RECOVERY_BLOCKED: status=$($state.status)"
    exit 2
}

[void](Ensure-TaskRunning $ConnectorTask)
$state.local_health = Test-LocalConnectorHealth
$public = Get-PublicConnectorHealth

if ($state.local_health -and -not $public.healthy) {
    $state.tunnel_restart_attempted = $true
    [void](Restart-LocalTunnelRuntime)
    $public = Wait-PublicHealth $RecoveryWaitSeconds
}

$state.public_health = [bool]$public.healthy
$state.public_http_status = $public.http_status
$state.public_error = $public.error
$state.status = if ($state.local_health -and $state.public_health) { "healthy" } elseif ($state.local_health -and $state.public_error -eq "cloudflare_1033") { "cloudflare_1033" } elseif ($state.local_health) { "tunnel_unhealthy" } else { "connector_unhealthy" }

$stagingAfter = Get-ServiceSnapshot $StagingTunnelRuntime
$state.staging_state_after = $stagingAfter.state
$state.staging_pid_after = $stagingAfter.process_id
$state.staging_runtime_unchanged = ($stagingAfter.state -eq $stagingBefore.state -and $stagingAfter.process_id -eq $stagingBefore.process_id)
if (-not $state.staging_runtime_unchanged) {
    $state.status = "cross_runtime_non_interference_failed"
}
Write-State $state

if ($state.status -eq "healthy") {
    Write-Host "LOCAL_CONNECTOR_RECOVERY_READY: environment=staging tunnel=$CanonicalTunnelRuntime staging_unchanged=true"
    exit 0
}

Write-Host "LOCAL_CONNECTOR_RECOVERY_DEGRADED: status=$($state.status) error=$($state.public_error) http_status=$($state.public_http_status)"
exit 1