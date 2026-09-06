# install-service.ps1
# Installs the local connector (Node.js), its dedicated cloudflared tunnel, and an
# independent watchdog as Scheduled Tasks for the current user. No admin required.
# The Local Connector transport never stops or reconfigures the Staging-owned
# Mad4B-Staging-Cloudflared runtime.

$ErrorActionPreference = "Stop"

$ConnectorDir   = $PSScriptRoot
$WatchdogPath   = Join-Path $ConnectorDir "connector-watchdog.ps1"
$EnvPath        = Join-Path $ConnectorDir ".env"
$NodeExe        = (Get-Command node -ErrorAction Stop).Source
$CfExe          = (Get-Command cloudflared -ErrorAction Stop).Source
$PowerShellExe  = (Get-Command powershell.exe -ErrorAction Stop).Source

$NodeTask         = "GrowthIntelligence-LocalConnector"
$TunnelTask       = "Mad4B-LocalConnector-Cloudflared"
$LegacyTunnelTask = "GrowthIntelligence-CloudflaredTunnel"
$WatchdogTask     = "GrowthIntelligence-ConnectorWatchdog"
$StagingTunnel    = "Mad4B-Staging-Cloudflared"

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { return "" }
    $prefix = "$Name="
    foreach ($line in Get-Content -LiteralPath $EnvPath -ErrorAction Stop) {
        $text = [string]$line
        if ($text.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            return $text.Substring($prefix.Length).Trim()
        }
    }
    return ""
}

function Assert-ConnectorEnvironmentBinding {
    $environment = (Get-DotEnvValue "CONNECTOR_ENVIRONMENT").ToLowerInvariant()
    $expectedHost = switch ($environment) {
        "staging" { "dev.mad4b.com" }
        "production" { "auth.mad4b.com" }
        default { throw "CONNECTOR_ENVIRONMENT must be staging or production before Local Connector installation." }
    }
    $expectedBase = "https://$expectedHost"
    $expected = @{
        CONNECTOR_CONTROL_PLANE_BASE_URL = $expectedBase
        CONNECTOR_POLICY_URL = "$expectedBase/connector-agent/policy"
        CONNECTOR_HEARTBEAT_URL = "$expectedBase/connector-agent/heartbeat"
    }
    foreach ($name in $expected.Keys) {
        $actual = Get-DotEnvValue $name
        if ($actual -ne $expected[$name]) {
            throw "$name is not bound to $environment. expected=$($expected[$name])"
        }
    }
    foreach ($name in @("CONNECTOR_CLOUDFLARED_SERVICE", "CONNECTOR_CLOUDFLARED_TASK")) {
        $actual = Get-DotEnvValue $name
        if ($actual -and $actual -ne $TunnelTask) {
            throw "$name must equal $TunnelTask."
        }
    }
    return [pscustomobject]@{ environment = $environment; control_plane_host = $expectedHost }
}

function Resolve-ConnectorTunnelTokenFile {
    $configured = (Get-DotEnvValue "CONNECTOR_CLOUDFLARED_TOKEN_FILE").Trim()
    if ([string]::IsNullOrWhiteSpace($configured)) {
        throw "CONNECTOR_CLOUDFLARED_TOKEN_FILE must point to the dedicated Local Connector tunnel token file."
    }
    try { $path = [IO.Path]::GetFullPath($configured) }
    catch { throw "CONNECTOR_CLOUDFLARED_TOKEN_FILE is not a valid filesystem path." }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Local Connector tunnel token file is missing: $path"
    }
    $value = [IO.File]::ReadAllText($path).Trim()
    if ($value.Length -le 20) { throw "Local Connector tunnel token file is empty or invalid." }
    return $path
}

Write-Host ""
Write-Host "=== Growth Intelligence Platform - Local Connector Install ==="
$environmentBinding = Assert-ConnectorEnvironmentBinding
$tunnelTokenFile = Resolve-ConnectorTunnelTokenFile
Write-Host "  Environment binding: $($environmentBinding.environment) -> $($environmentBinding.control_plane_host) [OK]"
Write-Host "  Tunnel credential mode: token_file [OK]"

# -- 1. Stop only Local Connector-owned legacy/current runtimes ---------------
Write-Host ""
Write-Host "[1] Reconciling Local Connector-owned runtimes..."

# Never terminate cloudflared by process name: another cloudflared process may be
# the independently owned Staging transport. Only known Local Connector tasks are
# eligible for migration or replacement.
foreach ($taskName in @($LegacyTunnelTask, $TunnelTask)) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($taskName -eq $LegacyTunnelTask) {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
            Write-Host "  Migrated legacy Local Connector tunnel task: $taskName"
        }
    }
}

$stagingService = Get-Service -Name $StagingTunnel -ErrorAction SilentlyContinue
$stagingStateBefore = if ($null -eq $stagingService) { "missing" } else { $stagingService.Status.ToString() }

$holder = (netstat -ano | Select-String "127.0.0.1:7070\s" |
    ForEach-Object { ($_ -split "\s+")[-1] } | Select-Object -First 1)
if ($holder -and [int]$holder -gt 0) {
    Stop-Process -Id ([int]$holder) -Force -ErrorAction SilentlyContinue
    Write-Host "  Freed Local Connector port 7070 (PID $holder)"
}

Start-Sleep -Milliseconds 800

# -- Shared task settings -----------------------------------------------------
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$logonTrigger.Delay = "PT10S"
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

# -- 2. Node connector Scheduled Task ----------------------------------------
Write-Host ""
Write-Host "[2] Registering Node connector task: $NodeTask"

Unregister-ScheduledTask -TaskName $NodeTask -Confirm:$false -ErrorAction SilentlyContinue

$nodeAction = New-ScheduledTaskAction -Execute $NodeExe -Argument "server.mjs" -WorkingDirectory $ConnectorDir
Register-ScheduledTask `
    -TaskName $NodeTask `
    -Action $nodeAction `
    -Trigger $logonTrigger `
    -Settings $settings `
    -Description "Growth Intelligence Platform local connector server (port 7070)" `
    -RunLevel Limited `
    -Force | Out-Null

Write-Host "  Registered [OK]"
Start-ScheduledTask -TaskName $NodeTask
Start-Sleep -Seconds 2

$portCheck = netstat -ano | Select-String "127.0.0.1:7070"
if ($portCheck) {
    Write-Host "  Port 7070 LISTENING [OK]"
} else {
    Write-Host "  WARNING: port 7070 not yet listening"
}

# -- 3. Local Connector-owned Cloudflared Scheduled Task ----------------------
Write-Host ""
Write-Host "[3] Registering Local Connector Cloudflared task: $TunnelTask"

Unregister-ScheduledTask -TaskName $TunnelTask -Confirm:$false -ErrorAction SilentlyContinue

# The token is read by cloudflared from a protected local file. It is never
# embedded in Scheduled Task arguments, process command lines, logs, or repo files.
$cfAction = New-ScheduledTaskAction `
    -Execute $CfExe `
    -Argument "tunnel --protocol http2 --no-autoupdate run --token-file `"$tunnelTokenFile`""

Register-ScheduledTask `
    -TaskName $TunnelTask `
    -Action $cfAction `
    -Trigger $logonTrigger `
    -Settings $settings `
    -Description "Mad4B Local Connector Cloudflare Tunnel (connector.mad4b.com -> localhost:7070)" `
    -RunLevel Limited `
    -Force | Out-Null

Write-Host "  Registered [OK]"
Start-ScheduledTask -TaskName $TunnelTask
Start-Sleep -Seconds 5

# Prove that Local Connector migration did not change the independent Staging
# service state. This is a readback only; no Staging service mutation is allowed.
$stagingServiceAfter = Get-Service -Name $StagingTunnel -ErrorAction SilentlyContinue
$stagingStateAfter = if ($null -eq $stagingServiceAfter) { "missing" } else { $stagingServiceAfter.Status.ToString() }
if ($stagingStateAfter -ne $stagingStateBefore) {
    throw "Cross-runtime non-interference failed: $StagingTunnel changed state from $stagingStateBefore to $stagingStateAfter."
}

# -- 4. Independent recurring watchdog --------------------------------------
Write-Host ""
Write-Host "[4] Registering Connector watchdog task: $WatchdogTask"
if (-not (Test-Path -LiteralPath $WatchdogPath -PathType Leaf)) {
    throw "connector-watchdog.ps1 is missing: $WatchdogPath"
}
Unregister-ScheduledTask -TaskName $WatchdogTask -Confirm:$false -ErrorAction SilentlyContinue
$watchdogAction = New-ScheduledTaskAction `
    -Execute $PowerShellExe `
    -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$WatchdogPath`" -Root `"$ConnectorDir`" -ConnectorTask `"$NodeTask`" -CloudflaredTask `"$TunnelTask`"" `
    -WorkingDirectory $ConnectorDir
$watchdogTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask `
    -TaskName $WatchdogTask `
    -Action $watchdogAction `
    -Trigger $watchdogTrigger `
    -Settings $settings `
    -Description "Growth Intelligence Platform connector and connector.mad4b.com self-heal watchdog" `
    -RunLevel Limited `
    -Force | Out-Null
Write-Host "  Registered [OK]"
Start-ScheduledTask -TaskName $WatchdogTask

# -- 5. Health check ---------------------------------------------------------
Write-Host ""
Write-Host "[5] End-to-end health check..."
Start-Sleep -Seconds 3

try {
    $health = Invoke-RestMethod -Uri "https://connector.mad4b.com/health" -TimeoutSec 15
    if ($health.service -eq "local-connector") {
        Write-Host "  connector.mad4b.com -> service=$($health.service) hostname=$($health.hostname) [OK]"
    } else {
        Write-Host "  WARNING: got service=$($health.service) -- tunnel may still be connecting"
    }
} catch {
    Write-Host "  Health check failed: $($_.Exception.Message)"
    Write-Host "  Watchdog will retry the Local Connector-owned transport every minute."
}

Write-Host ""
Write-Host "=== Install complete ==="
Write-Host "  $NodeTask     -- runs at logon, auto-restarts on failure"
Write-Host "  $TunnelTask   -- Local Connector-only tunnel ownership via token file"
Write-Host "  $WatchdogTask -- runs every minute, repairs only Local Connector-owned runtime"
Write-Host ""
Write-Host "To check status:"
Write-Host "  Get-ScheduledTask -TaskName '$NodeTask','$TunnelTask','$WatchdogTask' | Select-Object TaskName, State"