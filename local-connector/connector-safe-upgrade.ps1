# Mad4B Local Connector Safe Upgrade
# Manifest-driven upgrade. Never replaces active server.mjs without hash check,
# node syntax check, backup, service restart, local health validation, and rollback.

param(
  [string]$Root = "C:\mad4b-connector\local-connector",
  [string]$Source = "",
  [string]$ManifestUrl = "https://auth.mad4b.com/connector-agent/manifest.json",
  [string]$ConnectorService = "local-connector",
  [int]$Port = 7070,
  [int]$HealthTimeoutSeconds = 10,
  [switch]$SkipCompanionFiles
)

$ErrorActionPreference = "Stop"
$ServerPath = Join-Path $Root "server.mjs"
$NextPath = Join-Path $Root "server.mjs.next"
$StablePath = Join-Path $Root "server.mjs.stable"
$WatchdogPath = Join-Path $Root "connector-watchdog.ps1"
$SafeUpgradePath = Join-Path $Root "connector-safe-upgrade.ps1"
$LogPath = Join-Path $Root "safe-upgrade.log"
$ManifestPath = Join-Path $Root "connector-agent-manifest.json"

function Log($Message) {
  if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
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

function Assert-Hash($Path, $ExpectedSha256, $Label) {
  if (-not $ExpectedSha256) { throw "missing expected sha256 for $Label" }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedSha256.ToLowerInvariant()) {
    throw "sha256 mismatch for $Label expected=$ExpectedSha256 actual=$actual"
  }
  Log "hash_ok label=$Label sha256=$($actual.Substring(0,12))"
}

function Download-FileFromManifest($Manifest, $Name, $Destination) {
  $entry = $Manifest.files.$Name
  if (-not $entry -or -not $entry.url) { throw "manifest missing file entry: $Name" }
  Invoke-WebRequest -Uri $entry.url -OutFile $Destination -UseBasicParsing -TimeoutSec 90
  Assert-Hash -Path $Destination -ExpectedSha256 $entry.sha256 -Label $Name
}

function Install-CompanionFile($Manifest, $Name, $Destination) {
  $next = "$Destination.next"
  Download-FileFromManifest -Manifest $Manifest -Name $Name -Destination $next
  if (Test-Path $Destination) {
    Copy-Item -LiteralPath $Destination -Destination ("$Destination.bak-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")) -Force -ErrorAction SilentlyContinue
  }
  Copy-Item -LiteralPath $next -Destination $Destination -Force
  Remove-Item -LiteralPath $next -Force -ErrorAction SilentlyContinue
  Log "companion_installed name=$Name destination=$Destination"
}

try {
  if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
  Log "upgrade_started source=$Source manifest=$ManifestUrl"

  $manifest = $null
  if ($Source -and (Test-Path $Source)) {
    Copy-Item -LiteralPath $Source -Destination $NextPath -Force
    Log "server_source_local path=$Source"
  } else {
    Invoke-WebRequest -Uri $ManifestUrl -OutFile $ManifestPath -UseBasicParsing -TimeoutSec 60
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $manifest.ok -or -not $manifest.files) { throw "invalid connector agent manifest" }
    Log "manifest_loaded version=$($manifest.version)"
    Download-FileFromManifest -Manifest $manifest -Name "server.mjs" -Destination $NextPath
  }

  $node = (Get-Command node -ErrorAction Stop).Source
  $check = & $node --check $NextPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw "node --check failed: $check" }
  Log "node_check_ok path=$NextPath"

  if (Test-Path $ServerPath) {
    Copy-Item -LiteralPath $ServerPath -Destination (Join-Path $Root ("server.mjs.bak-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))) -Force
    Copy-Item -LiteralPath $ServerPath -Destination $StablePath -Force
  }

  if ($manifest -and -not $SkipCompanionFiles) {
    Install-CompanionFile -Manifest $manifest -Name "connector-watchdog.ps1" -Destination $WatchdogPath
    # Install this script last. The current process keeps running from memory.
    Install-CompanionFile -Manifest $manifest -Name "connector-safe-upgrade.ps1" -Destination $SafeUpgradePath
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
