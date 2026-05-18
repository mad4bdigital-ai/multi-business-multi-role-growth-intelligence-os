# Mad4B Local Connector Safe Upgrade
# Never replaces active server.mjs without syntax check, backup, service restart,
# and local health validation. Rolls back automatically on failed health.

param(
  [string]$Root = "C:\mad4b-connector\local-connector",
  [string]$Source = "",
  [string]$DownloadUrl = "https://auth.mad4b.com/connector-agent/server.mjs",
  [string]$ConnectorService = "local-connector",
  [int]$Port = 7070,
  [int]$HealthTimeoutSeconds = 10
)

$ErrorActionPreference = "Stop"
$ServerPath = Join-Path $Root "server.mjs"
$NextPath = Join-Path $Root "server.mjs.next"
$StablePath = Join-Path $Root "server.mjs.stable"
$LogPath = Join-Path $Root "safe-upgrade.log"

function Log($Message) {
  Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date).ToString("s"), $Message) -Encoding UTF8
}

function Test-Health {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec $HealthTimeoutSeconds
    return ($res.StatusCode -eq 200)
  } catch { return $false }
}

function Restart-Connector {
  $svc = Get-Service -Name $ConnectorService -ErrorAction SilentlyContinue
  if ($svc) {
    if ($svc.Status -eq 'Running') { Restart-Service -Name $ConnectorService -Force -ErrorAction SilentlyContinue }
    else { Start-Service -Name $ConnectorService -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 5
  }
}

try {
  if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
  Log "upgrade_started source=$Source download=$DownloadUrl"

  if ($Source -and (Test-Path $Source)) {
    Copy-Item -LiteralPath $Source -Destination $NextPath -Force
  } else {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $NextPath -UseBasicParsing -TimeoutSec 60
  }

  $node = (Get-Command node -ErrorAction Stop).Source
  $check = & $node --check $NextPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw "node --check failed: $check" }

  if (Test-Path $ServerPath) {
    Copy-Item -LiteralPath $ServerPath -Destination (Join-Path $Root ("server.mjs.bak-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))) -Force
    Copy-Item -LiteralPath $ServerPath -Destination $StablePath -Force
  }

  Copy-Item -LiteralPath $NextPath -Destination $ServerPath -Force
  Restart-Connector

  if (Test-Health) {
    Log "upgrade_ok health=true"
    Copy-Item -LiteralPath $ServerPath -Destination $StablePath -Force -ErrorAction SilentlyContinue
    exit 0
  }

  Log "upgrade_failed health=false rollback=true"
  if (Test-Path $StablePath) {
    Copy-Item -LiteralPath $StablePath -Destination $ServerPath -Force
    Restart-Connector
  }

  if (Test-Health) {
    Log "rollback_ok health=true"
    exit 3
  }

  Log "rollback_failed manual_required=true"
  exit 2
} catch {
  Log "upgrade_exception error=$($_.Exception.Message)"
  exit 1
}
