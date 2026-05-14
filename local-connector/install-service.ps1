# install-service.ps1
# Installs the local connector (Node.js) and cloudflared tunnel as
# at-logon Scheduled Tasks for the current user. No admin required.

$ErrorActionPreference = "Stop"

$ConnectorDir   = $PSScriptRoot
$ConfigPath     = Join-Path $ConnectorDir "cloudflared-config.yml"
$NodeExe        = (Get-Command node    -ErrorAction Stop).Source
$CfExe          = (Get-Command cloudflared -ErrorAction Stop).Source

$NodeTask  = "GrowthIntelligence-LocalConnector"
$TunnelTask = "GrowthIntelligence-CloudflaredTunnel"

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

# -- 2. Node connector Scheduled Task ----------------------------------------
Write-Host ""
Write-Host "[2] Registering Node connector task: $NodeTask"

Unregister-ScheduledTask -TaskName $NodeTask -Confirm:$false -ErrorAction SilentlyContinue

$nodeAction   = New-ScheduledTaskAction -Execute $NodeExe -Argument "server.mjs" -WorkingDirectory $ConnectorDir
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings     = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

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

# -- 4. Health check ---------------------------------------------------------
Write-Host ""
Write-Host "[4] End-to-end health check..."
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
    Write-Host "  Wait 10 seconds and retry: Invoke-RestMethod https://connector.mad4b.com/health"
}

Write-Host ""
Write-Host "=== Install complete ==="
Write-Host "  $NodeTask   -- runs at logon, auto-restarts on failure"
Write-Host "  $TunnelTask -- runs at logon, auto-restarts on failure"
Write-Host ""
Write-Host "To check status:"
Write-Host "  Get-ScheduledTask -TaskName '$NodeTask' | Select-Object TaskName, State"
Write-Host "  Get-ScheduledTask -TaskName '$TunnelTask' | Select-Object TaskName, State"
