# Mad4B Local Connector Watchdog
# Runs independently from server.mjs. Keeps cloudflared and local-connector alive,
# publishes authenticated runtime health to the canonical platform readback,
# and rolls back server.mjs if a bad upgrade prevents local health from returning.
# A healthy running service is never restarted during a normal watchdog tick.

param(
  [string]$Root = "C:\mad4b-connector\local-connector",
  [string]$ConnectorService = "local-connector",
  [string]$CloudflaredService = "cloudflared",
  [int]$Port = 7070,
  [int]$HealthTimeoutSeconds = 8
)

$ErrorActionPreference = "Continue"
$WatchdogVersion = "2026.07.31.1"
$AgentVersion = "2026.05.28.1"
$LogPath = Join-Path $Root "watchdog.log"
$StatePath = Join-Path $Root "connector-runtime-state.json"
$EnvPath = Join-Path $Root ".env"
$ServerPath = Join-Path $Root "server.mjs"
$StablePath = Join-Path $Root "server.mjs.stable"
$LastGoodPath = Join-Path $Root "server.mjs.lastgood"

function Write-WatchdogLog($Message) {
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Get-ServiceState($Name) {
  try {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { return "missing" }
    return $svc.Status.ToString().ToLowerInvariant()
  } catch {
    return "unknown"
  }
}

function Get-DotEnvValue([string]$Name) {
  try {
    if (-not (Test-Path $EnvPath)) { return "" }
    $prefix = "$Name="
    foreach ($line in Get-Content -LiteralPath $EnvPath -ErrorAction Stop) {
      $text = [string]$line
      if ($text.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
        return $text.Substring($prefix.Length).Trim()
      }
    }
  } catch {
    Write-WatchdogLog "env_read_failed name=$Name"
  }
  return ""
}

function Write-RuntimeState($Stage, [bool]$LocalHealth, $Details = "", [bool]$HeartbeatSent = $false) {
  try {
    $state = [ordered]@{
      timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
      stage = $Stage
      local_health = $LocalHealth
      heartbeat_sent = $HeartbeatSent
      watchdog_version = $WatchdogVersion
      agent_version = $AgentVersion
      cloudflared_status = Get-ServiceState $CloudflaredService
      connector_status = Get-ServiceState $ConnectorService
      details = [string]$Details
      secrets_included = $false
    }
    $state | ConvertTo-Json -Depth 4 | Set-Content -Path $StatePath -Encoding UTF8
  } catch {
    Write-WatchdogLog "state_write_failed"
  }
}

function Publish-Heartbeat(
  [string]$Status,
  [string]$EventType,
  [bool]$LocalHealth,
  [string]$ErrorCode = "",
  [string]$ErrorMessage = ""
) {
  try {
    $secret = Get-DotEnvValue "CONNECTOR_SECRET"
    $heartbeatUrl = Get-DotEnvValue "CONNECTOR_HEARTBEAT_URL"
    if (-not $heartbeatUrl) { $heartbeatUrl = "https://auth.mad4b.com/connector-agent/heartbeat" }
    if (-not $secret) {
      Write-WatchdogLog "heartbeat_skipped reason=connector_secret_missing"
      return $false
    }

    $payload = [ordered]@{
      device_id = [Environment]::MachineName
      event_type = $EventType
      status = $Status
      source = "watchdog"
      agent_version = $AgentVersion
      watchdog_version = $WatchdogVersion
      watchdog_installed = $true
      active_slot = "legacy"
      metadata = [ordered]@{
        local_health = $LocalHealth
        connector_status = Get-ServiceState $ConnectorService
        cloudflared_status = Get-ServiceState $CloudflaredService
        secrets_included = $false
      }
    }
    if ($ErrorCode) { $payload.error_code = $ErrorCode.Substring(0, [Math]::Min(128, $ErrorCode.Length)) }
    if ($ErrorMessage) { $payload.error_message = $ErrorMessage.Substring(0, [Math]::Min(1000, $ErrorMessage.Length)) }

    $headers = @{ Authorization = "Bearer $secret" }
    $body = $payload | ConvertTo-Json -Depth 5 -Compress
    $response = Invoke-RestMethod -Uri $heartbeatUrl -Method Post -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 20
    $eventId = [string]$response.heartbeat.event_id
    Write-WatchdogLog "heartbeat_sent event_type=$EventType status=$Status event_id=$eventId"
    return $true
  } catch {
    $statusCode = "unknown"
    try { $statusCode = [string][int]$_.Exception.Response.StatusCode.value__ } catch {}
    Write-WatchdogLog "heartbeat_failed event_type=$EventType status=$Status http_status=$statusCode"
    return $false
  }
}

function Test-LocalHealth {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec $HealthTimeoutSeconds
    return ($res.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Ensure-ServiceRunning($Name) {
  try {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { Write-WatchdogLog "service_missing name=$Name"; return $false }
    if ($svc.Status -eq 'Running') { return $true }
    Start-Service -Name $Name -ErrorAction SilentlyContinue
    $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    $svc.Refresh()
    $ready = ($svc.Status -eq 'Running')
    Write-WatchdogLog "service_ensure name=$Name running=$ready"
    return $ready
  } catch {
    Write-WatchdogLog "service_ensure_failed name=$Name"
    return $false
  }
}

function Restart-ServiceSafe($Name) {
  try {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { Write-WatchdogLog "service_missing name=$Name"; return $false }
    Restart-Service -Name $Name -Force -ErrorAction SilentlyContinue
    $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    $svc.Refresh()
    return ($svc.Status -eq 'Running')
  } catch {
    Write-WatchdogLog "service_restart_failed name=$Name"
    return $false
  }
}

function Restore-StableServer {
  try {
    $candidate = $null
    if (Test-Path $StablePath) { $candidate = $StablePath }
    elseif (Test-Path $LastGoodPath) { $candidate = $LastGoodPath }
    else {
      $latestBackup = Get-ChildItem -Path $Root -Filter "server.mjs.bak-*" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($latestBackup) { $candidate = $latestBackup.FullName }
    }
    if (-not $candidate) { Write-WatchdogLog "rollback_skipped no_stable_candidate"; return $false }

    Copy-Item -LiteralPath $ServerPath -Destination (Join-Path $Root ("server.mjs.failed-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))) -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $candidate -Destination $ServerPath -Force
    Write-WatchdogLog "rollback_applied candidate=$candidate"
    return $true
  } catch {
    Write-WatchdogLog "rollback_failed"
    return $false
  }
}

try {
  if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
  Write-WatchdogLog "watchdog_tick root=$Root port=$Port"

  $cloudflaredReady = Ensure-ServiceRunning $CloudflaredService
  $connectorReady = Ensure-ServiceRunning $ConnectorService
  $initialHealth = Test-LocalHealth

  if ($initialHealth) {
    if (Test-Path $ServerPath) { Copy-Item -LiteralPath $ServerPath -Destination $LastGoodPath -Force -ErrorAction SilentlyContinue }
    if ($cloudflaredReady) {
      $heartbeatSent = Publish-Heartbeat "ok" "health_ok" $true
      Write-WatchdogLog "health_ok initial=true tunnel_service=true heartbeat_sent=$heartbeatSent"
      Write-RuntimeState "healthy" $true "tunnel_service=true" $heartbeatSent
      if ($heartbeatSent) { exit 0 }
      exit 4
    }
    $heartbeatSent = Publish-Heartbeat "failed" "health_failed" $true "cloudflared_unavailable" "Cloudflared service is not running."
    Write-WatchdogLog "health_ok tunnel_service=false heartbeat_sent=$heartbeatSent"
    Write-RuntimeState "tunnel_service_unavailable" $true "cloudflared service is not running" $heartbeatSent
    exit 3
  }

  Write-WatchdogLog "health_failed action=restart_connector"
  Restart-ServiceSafe $ConnectorService | Out-Null
  $healthAfterRestart = Test-LocalHealth
  if ($healthAfterRestart) {
    if (Test-Path $ServerPath) { Copy-Item -LiteralPath $ServerPath -Destination $LastGoodPath -Force -ErrorAction SilentlyContinue }
    $status = if ($cloudflaredReady) { "ok" } else { "failed" }
    $errorCode = if ($cloudflaredReady) { "" } else { "cloudflared_unavailable" }
    $errorMessage = if ($cloudflaredReady) { "" } else { "Cloudflared service is not running." }
    $heartbeatSent = Publish-Heartbeat $status "service_restart" $true $errorCode $errorMessage
    Write-WatchdogLog "health_ok after_restart=true tunnel_service=$cloudflaredReady heartbeat_sent=$heartbeatSent"
    Write-RuntimeState "healthy_after_restart" $true "tunnel_service=$cloudflaredReady" $heartbeatSent
    if ($cloudflaredReady -and $heartbeatSent) { exit 0 }
    if (-not $cloudflaredReady) { exit 3 }
    exit 4
  }

  Write-WatchdogLog "health_failed action=rollback"
  if (Restore-StableServer) {
    Restart-ServiceSafe $ConnectorService | Out-Null
    $healthAfterRollback = Test-LocalHealth
    if ($healthAfterRollback) {
      $status = if ($cloudflaredReady) { "ok" } else { "failed" }
      $errorCode = if ($cloudflaredReady) { "" } else { "cloudflared_unavailable" }
      $errorMessage = if ($cloudflaredReady) { "" } else { "Cloudflared service is not running." }
      $heartbeatSent = Publish-Heartbeat $status "rollback" $true $errorCode $errorMessage
      Write-WatchdogLog "health_ok after_rollback=true tunnel_service=$cloudflaredReady heartbeat_sent=$heartbeatSent"
      Write-RuntimeState "healthy_after_rollback" $true "tunnel_service=$cloudflaredReady" $heartbeatSent
      if ($cloudflaredReady -and $heartbeatSent) { exit 0 }
      if (-not $cloudflaredReady) { exit 3 }
      exit 4
    }
  }

  $heartbeatSent = Publish-Heartbeat "failed" "health_failed" $false "local_health_unavailable" "Local health remained unavailable after restart and rollback."
  Write-WatchdogLog "manual_required health_still_down=true heartbeat_sent=$heartbeatSent"
  Write-RuntimeState "manual_required" $false "local health remained unavailable after restart and rollback" $heartbeatSent
  exit 2
} catch {
  $message = [string]$_.Exception.Message
  $heartbeatSent = Publish-Heartbeat "failed" "health_failed" $false "watchdog_exception" $message
  Write-WatchdogLog "watchdog_exception heartbeat_sent=$heartbeatSent"
  Write-RuntimeState "watchdog_exception" $false $message $heartbeatSent
  exit 1
}
