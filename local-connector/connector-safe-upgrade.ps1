# Mad4B Local Connector Safe Upgrade
# Manifest-driven upgrade. Replaces the runtime package only after hash checks,
# node syntax validation, backups, service restart, local health validation, and rollback.

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
$WatchdogPath = Join-Path $Root "connector-watchdog.ps1"
$SafeUpgradePath = Join-Path $Root "connector-safe-upgrade.ps1"
$Browser4Path = Join-Path $Root "browser4-adapter.mjs"
$LocalAgentRuntimePath = Join-Path $Root "local-agent-runtime.mjs"
$LogPath = Join-Path $Root "safe-upgrade.log"
$ManifestPath = Join-Path $Root "connector-agent-manifest.json"
$RuntimePackage = @(
  @{ Name = "server.mjs"; Destination = $ServerPath },
  @{ Name = "browser4-adapter.mjs"; Destination = $Browser4Path },
  @{ Name = "local-agent-runtime.mjs"; Destination = $LocalAgentRuntimePath }
)
$RuntimePackageApplied = $false

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
  if (-not $svc) { throw "connector service not found: $ConnectorService" }
  if ($svc.Status -eq 'Running') { Restart-Service -Name $ConnectorService -Force -ErrorAction Stop }
  else { Start-Service -Name $ConnectorService -ErrorAction Stop }
  Start-Sleep -Seconds 5
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
  if (-not $entry -or -not $entry.url -or -not $entry.sha256) { throw "manifest missing file entry: $Name" }
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

function Stage-RuntimePackage($Manifest) {
  foreach ($file in $RuntimePackage) {
    Download-FileFromManifest -Manifest $Manifest -Name $file.Name -Destination ("$($file.Destination).next")
  }
}

function Backup-RuntimePackage {
  foreach ($file in $RuntimePackage) {
    $destination = $file.Destination
    $stable = "$destination.stable"
    $file.HadOriginal = Test-Path $destination
    if ($file.HadOriginal) {
      Copy-Item -LiteralPath $destination -Destination ("$destination.bak-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")) -Force
      Copy-Item -LiteralPath $destination -Destination $stable -Force
    } else {
      Remove-Item -LiteralPath $stable -Force -ErrorAction SilentlyContinue
    }
  }
}

function Apply-RuntimePackage {
  foreach ($file in $RuntimePackage) {
    $next = "$($file.Destination).next"
    if (-not (Test-Path $next)) { throw "staged runtime file missing: $($file.Name)" }
    Copy-Item -LiteralPath $next -Destination $file.Destination -Force
  }
  $script:RuntimePackageApplied = $true
}

function Save-StableRuntimePackage {
  foreach ($file in $RuntimePackage) {
    Copy-Item -LiteralPath $file.Destination -Destination ("$($file.Destination).stable") -Force
    Remove-Item -LiteralPath ("$($file.Destination).next") -Force -ErrorAction SilentlyContinue
  }
}

function Restore-RuntimePackage {
  foreach ($file in $RuntimePackage) {
    $stable = "$($file.Destination).stable"
    if ($file.HadOriginal -and (Test-Path $stable)) {
      Copy-Item -LiteralPath $stable -Destination $file.Destination -Force
    } elseif (-not $file.HadOriginal) {
      Remove-Item -LiteralPath $file.Destination -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath ("$($file.Destination).next") -Force -ErrorAction SilentlyContinue
  }
}

try {
  if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
  Log "upgrade_started source=$Source manifest=$ManifestUrl"

  $manifest = $null
  if ($Source -and (Test-Path $Source)) {
    Copy-Item -LiteralPath $Source -Destination "$ServerPath.next" -Force
    Log "server_source_local path=$Source"
  } else {
    Invoke-WebRequest -Uri $ManifestUrl -OutFile $ManifestPath -UseBasicParsing -TimeoutSec 60
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $manifest.ok -or -not $manifest.files) { throw "invalid connector agent manifest" }
    Log "manifest_loaded version=$($manifest.version)"
    Stage-RuntimePackage -Manifest $manifest
  }

  $node = (Get-Command node -ErrorAction Stop).Source
  $check = & $node --check "$ServerPath.next" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "node --check failed: $check" }
  Log "node_check_ok path=$ServerPath.next"

  if ($manifest -and -not $SkipCompanionFiles) {
    Install-CompanionFile -Manifest $manifest -Name "connector-watchdog.ps1" -Destination $WatchdogPath
    # Install this script last. The current process keeps running from memory.
    Install-CompanionFile -Manifest $manifest -Name "connector-safe-upgrade.ps1" -Destination $SafeUpgradePath
  }

  if ($manifest) {
    Backup-RuntimePackage
    Apply-RuntimePackage
  } else {
    if (Test-Path $ServerPath) {
      Copy-Item -LiteralPath $ServerPath -Destination "$ServerPath.stable" -Force
    }
    Copy-Item -LiteralPath "$ServerPath.next" -Destination $ServerPath -Force
    $RuntimePackage[0].HadOriginal = Test-Path "$ServerPath.stable"
    $script:RuntimePackageApplied = $true
  }

  Restart-Connector

  if (Test-Health) {
    Log "upgrade_ok health=true"
    if ($manifest) { Save-StableRuntimePackage }
    else {
      Copy-Item -LiteralPath $ServerPath -Destination "$ServerPath.stable" -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath "$ServerPath.next" -Force -ErrorAction SilentlyContinue
    }
    exit 0
  }

  Log "upgrade_failed health=false rollback=true"
  Restore-RuntimePackage
  Restart-Connector

  if (Test-Health) {
    Log "rollback_ok health=true"
    exit 3
  }

  Log "rollback_failed manual_required=true"
  exit 2
} catch {
  Log "upgrade_exception error=$($_.Exception.Message) rollback=$RuntimePackageApplied"
  if ($RuntimePackageApplied) {
    try {
      Restore-RuntimePackage
      Restart-Connector
      Log "exception_rollback health=$(Test-Health)"
    } catch {
      Log "exception_rollback_failed error=$($_.Exception.Message)"
    }
  }
  exit 1
}
