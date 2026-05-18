# Mad4B Local Connector Watchdog
# Runs independently from server.mjs. Keeps cloudflared and local-connector alive,
# and rolls back server.mjs if a bad upgrade prevents local health from returning.

param(
  [string]$Root = "C:\mad4b-connector\local-connector",
  [string]$ConnectorService = "local-connector",
  [string]$CloudflaredService = "cloudflared",
  [int]$Port = 7070,
  [int]$HealthTimeoutSeconds = 8
)

$ErrorActionPreference = "Continue"
$LogPath = Join-Path $Root "watchdog.log"
$ServerPath = Join-Path $Root "server.mjs"
$StablePath = Join-Path $Root "server.mjs.stable"
$LastGoodPath = Join-Path $Root "server.mjs.lastgood"

function Write-WatchdogLog($Message) {
  $line = "{0} {1}" -f (Get-Date).ToString("s"), $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Test-LocalHealth {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec $HealthTimeoutSeconds
    return ($res.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Restart-ServiceSafe($Name) {
  try {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { Write-WatchdogLog "service_missing name=$Name"; return $false }
    if ($svc.Status -eq 'Running') {
      Restart-Service -Name $Name -Force -ErrorAction SilentlyContinue
    } else {
      Start-Service -Name $Name -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 5
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    return ($svc -and $svc.Status -eq 'Running')
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

  Restart-ServiceSafe $CloudflaredService | Out-Null

  if (Test-LocalHealth) {
    Write-WatchdogLog "health_ok initial=true"
    if (Test-Path $ServerPath) { Copy-Item -LiteralPath $ServerPath -Destination $LastGoodPath -Force -ErrorAction SilentlyContinue }
    exit 0
  }

  Write-WatchdogLog "health_failed action=restart_connector"
  Restart-ServiceSafe $ConnectorService | Out-Null
  if (Test-LocalHealth) {
    Write-WatchdogLog "health_ok after_restart=true"
    if (Test-Path $ServerPath) { Copy-Item -LiteralPath $ServerPath -Destination $LastGoodPath -Force -ErrorAction SilentlyContinue }
    exit 0
  }

  Write-WatchdogLog "health_failed action=rollback"
  if (Restore-StableServer) {
    Restart-ServiceSafe $ConnectorService | Out-Null
    if (Test-LocalHealth) {
      Write-WatchdogLog "health_ok after_rollback=true"
      exit 0
    }
  }

  Write-WatchdogLog "manual_required health_still_down=true"
  exit 2
} catch {
  Write-WatchdogLog "watchdog_exception error=$($_.Exception.Message)"
  exit 1
}
