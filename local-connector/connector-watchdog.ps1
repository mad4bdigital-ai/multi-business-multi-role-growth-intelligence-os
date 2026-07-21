# Mad4B Local Connector Watchdog
# Runs independently from server.mjs. Keeps cloudflared and local-connector alive,
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
$LogPath = Join-Path $Root "watchdog.log"
$StatePath = Join-Path $Root "connector-runtime-state.json"
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

function Write-RuntimeState($Stage, [bool]$LocalHealth, $Details = "") {
  try {
    $state = [ordered]@{
      timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
      stage = $Stage
      local_health = $LocalHealth
      cloudflared_status = Get-ServiceState $CloudflaredService
      connector_status = Get-ServiceState $ConnectorService
      details = [string]$Details
      secrets_included = $false
    }
    $state | ConvertTo-Json -Depth 3 | Set-Content -Path $StatePath -Encoding UTF8
  } catch {
    Write-WatchdogLog "state_write_failed error=$($_.Exception.Message)"
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
    Write-WatchdogLog "service_ensure_failed name=$Name error=$($_.Exception.Message)"
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
    Write-WatchdogLog "service_restart_failed name=$Name error=$($_.Exception.Message)"
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
    Write-WatchdogLog "rollback_failed error=$($_.Exception.Message)"
    return $false
  }
}

try {
  if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
  Write-WatchdogLog "watchdog_tick root=$Root port=$Port"

  $cloudflaredReady = Ensure-ServiceRunning $CloudflaredService
  $connectorReady = Ensure-ServiceRunning $ConnectorService
  $initialHealth = Test-LocalHealth
  Write-RuntimeState "initial_probe" $initialHealth "cloudflared_ready=$cloudflaredReady connector_ready=$connectorReady"

  if ($initialHealth) {
    if (Test-Path $ServerPath) { Copy-Item -LiteralPath $ServerPath -Destination $LastGoodPath -Force -ErrorAction SilentlyContinue }
    if ($cloudflaredReady) {
      Write-WatchdogLog "health_ok initial=true tunnel_service=true"
      Write-RuntimeState "healthy" $true "tunnel_service=true"
      exit 0
    }
    Write-WatchdogLog "health_ok tunnel_service=false"
    Write-RuntimeState "tunnel_service_unavailable" $true "cloudflared service is not running"
    exit 3
  }

  Write-WatchdogLog "health_failed action=restart_connector"
  Restart-ServiceSafe $ConnectorService | Out-Null
  $healthAfterRestart = Test-LocalHealth
  if ($healthAfterRestart) {
    if (Test-Path $ServerPath) { Copy-Item -LiteralPath $ServerPath -Destination $LastGoodPath -Force -ErrorAction SilentlyContinue }
    Write-WatchdogLog "health_ok after_restart=true tunnel_service=$cloudflaredReady"
    Write-RuntimeState "healthy_after_restart" $true "tunnel_service=$cloudflaredReady"
    if ($cloudflaredReady) { exit 0 }
    exit 3
  }

  Write-WatchdogLog "health_failed action=rollback"
  if (Restore-StableServer) {
    Restart-ServiceSafe $ConnectorService | Out-Null
    $healthAfterRollback = Test-LocalHealth
    if ($healthAfterRollback) {
      Write-WatchdogLog "health_ok after_rollback=true tunnel_service=$cloudflaredReady"
      Write-RuntimeState "healthy_after_rollback" $true "tunnel_service=$cloudflaredReady"
      if ($cloudflaredReady) { exit 0 }
      exit 3
    }
  }

  Write-WatchdogLog "manual_required health_still_down=true"
  Write-RuntimeState "manual_required" $false "local health remained unavailable after restart and rollback"
  exit 2
} catch {
  Write-WatchdogLog "watchdog_exception error=$($_.Exception.Message)"
  Write-RuntimeState "watchdog_exception" $false $_.Exception.Message
  exit 1
}
