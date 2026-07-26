# install-local-connector.ps1
# Sets up the full local connector stack as Windows services:
#   1. cloudflared  — Cloudflare tunnel (exposes connector.mad4b.com)
#   2. local-connector — Node.js HTTP server on port 7070
# Both services auto-restart on failure and on system reboot.
# Run as Administrator.

param(
    [string]$TunnelToken     = $env:CLOUDFLARE_TUNNEL_TOKEN,
    [string]$ConnectorSecret = $env:CONNECTOR_SECRET,
    [string]$BackendKey      = $env:BACKEND_API_KEY, # legacy fallback for older devices only
    [string]$ConnectorDir    = (Split-Path -Parent $MyInvocation.MyCommand.Definition),
    [switch]$Uninstall,
    [switch]$SkipNode      # skip Node service setup (cloudflared only)
)

$ErrorActionPreference = "Stop"
$NodeServiceName = "local-connector"
$CfServiceName   = "cloudflared"
$ConnectorSrvDir = Join-Path $ConnectorDir "local-connector"

function Write-Step($msg) { Write-Host "`n[install-local-connector] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARN: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  FAIL: $msg" -ForegroundColor Red }

# ─── Uninstall path ───────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Step "Stopping and removing services..."
    try { Stop-Service $NodeServiceName -Force -ErrorAction SilentlyContinue } catch {}
    try { & nssm remove $NodeServiceName confirm 2>$null } catch {}
    try { Stop-Service $CfServiceName -Force -ErrorAction SilentlyContinue } catch {}
    try { & cloudflared service uninstall 2>$null } catch {}
    Write-OK "Services removed."
    exit 0
}

# ─── Check admin ──────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if (-not $isAdmin) {
    Write-Fail "Run this script as Administrator (right-click → Run as administrator)."
    exit 1
}

# ═══════════════════════════════════════════════════════════════════════════════
# PART 1 — cloudflared tunnel service
# ═══════════════════════════════════════════════════════════════════════════════
Write-Step "Part 1: Cloudflare tunnel service"

# Check binary
$cfPath = (Get-Command cloudflared -ErrorAction SilentlyContinue)?.Source
if (-not $cfPath) {
    Write-Step "cloudflared not found — installing via winget..."
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "winget install failed. Download manually: https://github.com/cloudflare/cloudflared/releases"
        exit 1
    }
    $cfPath = (Get-Command cloudflared -ErrorAction SilentlyContinue)?.Source
    if (-not $cfPath) {
        Write-Warn "PATH not updated yet. Restart your terminal and re-run this installer."
        exit 1
    }
}
Write-OK "cloudflared at $cfPath"

if (-not $TunnelToken) {
    Write-Fail "CLOUDFLARE_TUNNEL_TOKEN not set. Pass -TunnelToken or set the env var."
    Write-Host "  Get it from: Cloudflare Zero Trust → Networks → Tunnels → Configure"
    exit 1
}

$cfSvc = Get-Service -Name $CfServiceName -ErrorAction SilentlyContinue
if ($cfSvc -and $cfSvc.Status -eq "Running") {
    Write-OK "cloudflared service already running."
} else {
    if ($cfSvc) {
        Write-Step "Starting existing cloudflared service..."
        Start-Service $CfServiceName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $cfSvc.Refresh()
    }
    if (-not $cfSvc -or $cfSvc.Status -ne "Running") {
        if ($cfSvc) {
            Write-Warn "Service exists but failed to start. Reinstalling..."
            try { & cloudflared service uninstall 2>$null } catch {}
            Start-Sleep -Seconds 1
        }
        Write-Step "Installing cloudflared service..."
        & cloudflared service install $TunnelToken
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "cloudflared service install failed (exit $LASTEXITCODE)."
            exit 1
        }
        Start-Service $CfServiceName
        Start-Sleep -Seconds 3
        $cfSvc = Get-Service -Name $CfServiceName -ErrorAction SilentlyContinue
        if (-not $cfSvc -or $cfSvc.Status -ne "Running") {
            Write-Fail "cloudflared service did not start. Check: Get-EventLog -LogName System -Source cloudflared -Newest 10"
            exit 1
        }
    }
    Write-OK "cloudflared service running. connector.mad4b.com tunnel active in ~30s."
}

# ═══════════════════════════════════════════════════════════════════════════════
# PART 2 — Node.js local connector service (via NSSM)
# ═══════════════════════════════════════════════════════════════════════════════
if ($SkipNode) {
    Write-Step "Skipping Node service setup (-SkipNode)."
} else {
    Write-Step "Part 2: Node.js connector service (NSSM)"

    # Check NSSM
    $nssmPath = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source
    if (-not $nssmPath) {
        Write-Warn "NSSM not found on PATH. Attempting winget install..."
        try {
            winget install --id NSSM.NSSM -e --accept-source-agreements --accept-package-agreements 2>$null
            $nssmPath = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source
        } catch {}
    }

    if (-not $nssmPath) {
        Write-Warn "NSSM not available. Node service will not be installed."
        Write-Host "  Install NSSM from https://nssm.cc/ or: winget install NSSM.NSSM"
        Write-Host "  Then re-run this script, or start manually:"
        Write-Host "  cd `"$ConnectorSrvDir`" && node server.mjs"
    } else {
        Write-OK "NSSM at $nssmPath"

        # Check node
        $nodePath = (Get-Command node -ErrorAction SilentlyContinue)?.Source
        if (-not $nodePath) {
            Write-Fail "node not found on PATH. Install Node.js first."
            exit 1
        }
        Write-OK "node at $nodePath"

        # Ensure server.mjs exists
        $serverScript = Join-Path $ConnectorSrvDir "server.mjs"
        if (-not (Test-Path $serverScript)) {
            Write-Warn "server.mjs not found at $serverScript — skipping Node service."
        } else {
            # Write .env if a connector credential is supplied and .env is missing.
            $envFile = Join-Path $ConnectorSrvDir ".env"
            $effectiveConnectorSecret = if ($ConnectorSecret) { $ConnectorSecret } else { $BackendKey }
            if ($effectiveConnectorSecret -and -not (Test-Path $envFile)) {
                Write-Step "Writing .env..."
                @"
CONNECTOR_SECRET=$effectiveConnectorSecret
CONNECTOR_PORT=7070
CONNECTOR_SHELL_ENABLED=true
"@ | Out-File -FilePath $envFile -Encoding utf8
                Write-OK ".env written."
            }

            $nodeSvc = Get-Service -Name $NodeServiceName -ErrorAction SilentlyContinue
            if ($nodeSvc -and $nodeSvc.Status -eq "Running") {
                Write-OK "local-connector service already running."
            } else {
                if ($nodeSvc) {
                    Write-Step "Restarting existing local-connector service..."
                    Restart-Service $NodeServiceName -ErrorAction SilentlyContinue
                } else {
                    Write-Step "Installing local-connector service with NSSM..."
                    & nssm install $NodeServiceName $nodePath "`"$serverScript`""
                    & nssm set $NodeServiceName AppDirectory $ConnectorSrvDir
                    & nssm set $NodeServiceName AppStdout (Join-Path $ConnectorSrvDir "connector.log")
                    & nssm set $NodeServiceName AppStderr (Join-Path $ConnectorSrvDir "connector-error.log")
                    & nssm set $NodeServiceName AppRotateFiles 1
                    & nssm set $NodeServiceName AppRotateBytes 5242880
                    & nssm set $NodeServiceName Start SERVICE_AUTO_START
                    & nssm set $NodeServiceName ObjectName LocalSystem
                    Start-Service $NodeServiceName
                }
                Start-Sleep -Seconds 3
                $nodeSvc = Get-Service -Name $NodeServiceName -ErrorAction SilentlyContinue
                if ($nodeSvc -and $nodeSvc.Status -eq "Running") {
                    Write-OK "local-connector service running on port 7070."
                } else {
                    Write-Warn "local-connector service did not start. Check: $ConnectorSrvDir\connector-error.log"
                }
            }
        }
    }
}

# ─── Final check ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Status:" -ForegroundColor White
$cfFinal   = Get-Service $CfServiceName -ErrorAction SilentlyContinue
$nodeFinal = Get-Service $NodeServiceName -ErrorAction SilentlyContinue
Write-Host "  cloudflared:     $($cfFinal?.Status ?? 'not installed')"
Write-Host "  local-connector: $($nodeFinal?.Status ?? 'not installed')"
Write-Host ""
Write-Host "  connector.mad4b.com → localhost:7070" -ForegroundColor Green
Write-Host ""
Write-Host "[install-local-connector] Done." -ForegroundColor Green
