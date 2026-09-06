# install-service.ps1
# Installs the local connector (Node.js), cloudflared tunnel, and an independent
# watchdog as Scheduled Tasks for the current user. No admin required.

$ErrorActionPreference = "Stop"

$ConnectorDir   = $PSScriptRoot
$ConfigPath     = Join-Path $ConnectorDir "cloudflared-config.yml"
$WatchdogPath   = Join-Path $ConnectorDir "connector-watchdog.ps1"
$NodeExe        = (Get-Command node -ErrorAction Stop).Source
$CfExe          = (Get-Command cloudflared -ErrorAction Stop).Source
$PowerShellExe  = (Get-Command powershell.exe -ErrorAction Stop).Source

$NodeTask       = "GrowthIntelligence-LocalConnector"
$TunnelTask     = "GrowthIntelligence-CloudflaredTunnel"
$WatchdogTask   = "GrowthIntelligence-ConnectorWatchdog"

Write-Host ""
Write-Host "=== Growth Intelligence Platform - Local Connector Install ==="

# -- 1. Stop any running instances -------------------------------------------
Write-Host ""
Write-Host "[1] Stopping running instances..."

Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Host "  Stopped cloudflared PID $($_.Id)"
}

$holder = (netstat -ano | Select-String "127.0.0.1:7070\s" |
    ForEach-Object { ($_ -split "\s+")[-1] } | Select-Object -First 1)
if ($holder -and [int]$holder -gt 0) {
    Stop-Process -Id ([int]$holder) -Force -ErrorAction SilentlyContinue
    Write-Host "  Freed port 7070 (PID $holder)"
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

# -- 3. Cloudflared tunnel Scheduled Task ------------------------------------
Write-Host ""
Write-Host "[3] Registering Cloudflared tunnel task: $TunnelTask"

Unregister-ScheduledTask -TaskName $TunnelTask -Confirm:$false -ErrorAction SilentlyContinue

$cfAction = New-ScheduledTaskAction `
    -Execute $CfExe `
    -Argument "tunnel --config `"$ConfigPath`" run"

Register-ScheduledTask `
    -TaskName $TunnelTask `
    -Action $cfAction `
    -Trigger $logonTrigger `
    -Settings $settings `
    -Description "Growth Intelligence Platform Cloudflare Tunnel (connector.mad4b.com -> localhost:7070)" `
    -RunLevel Limited `
    -Force | Out-Null

Write-Host "  Registered [OK]"
Start-ScheduledTask -TaskName $TunnelTask
Start-Sleep -Seconds 5

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
    Write-Host "  Watchdog will retry the connector and tunnel every minute."
}

Write-Host ""
Write-Host "=== Install complete ==="
Write-Host "  $NodeTask     -- runs at logon, auto-restarts on failure"
Write-Host "  $TunnelTask   -- runs at logon, auto-restarts on failure"
Write-Host "  $WatchdogTask -- runs every minute, repairs task/service and public tunnel health"
Write-Host ""
Write-Host "To check status:"
Write-Host "  Get-ScheduledTask -TaskName '$NodeTask','$TunnelTask','$WatchdogTask' | Select-Object TaskName, State"
