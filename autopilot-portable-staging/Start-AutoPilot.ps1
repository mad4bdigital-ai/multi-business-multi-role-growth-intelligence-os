[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$RepositoryUrl = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    [string]$Ref = "main",
    [string]$ExpectedCommit = "",
    [switch]$StartTunnel,
    [switch]$ValidateOnly,
    [switch]$Stop,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$WindowsPreflightPath = Join-Path $PSScriptRoot "Staging-Windows-Preflight.ps1"
if (-not (Test-Path -LiteralPath $WindowsPreflightPath)) { throw "Missing shared Windows preflight helper: $WindowsPreflightPath" }
. $WindowsPreflightPath
$LogComponent = "app-operations"
Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "application operations process started" -Data @{ validate_only = [bool]$ValidateOnly; stop = [bool]$Stop; tunnel = [bool]$StartTunnel }
trap {
    Write-StagingLog -Level error -Component $LogComponent -Stage "unhandled" -Message $_.Exception.Message -Data @{ error_type = $_.Exception.GetType().FullName }
    Write-Host "APP_OPERATIONS_FAILURE_LOGGED: $(Get-StagingLogRoot)" -ForegroundColor Red
    exit 1
}

function Fail([string]$Message) {
    Write-StagingLog -Level error -Component $LogComponent -Stage "fail_closed" -Message $Message
    throw "AUTO_PILOT_FAIL_CLOSED: $Message"
}

function Invoke-Native([string]$File, [string[]]$Arguments, [switch]$AllowFailure) {
    Write-Host ("> {0} {1}" -f $File, ($Arguments -join " "))
    Write-StagingOperationBoundary -Component $LogComponent -Stage "native:$File" -Outcome "start" -Message "application command started" -Data @{ command = $File; arguments = ($Arguments -join " ") }
    & $File @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        Write-StagingLog -Level error -Component $LogComponent -Stage "native:$File" -Message "application command failed" -Data @{ command = $File; exit_code = $code }
        Fail "$File exited with code $code"
    }
    Write-StagingOperationBoundary -Component $LogComponent -Stage "native:$File" -Outcome "success" -Message "application command completed" -Data @{ command = $File; exit_code = $code }
    return $code
}

function Get-NativeText([string]$File, [string[]]$Arguments) {
    $text = & $File @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "$File failed while reading local state" }
    return (($text | Out-String).Trim())
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Fail "Required command is missing: $Name" }
}
function Normalize-TextFileToLf([string]$Path) {
    $text = [System.IO.File]::ReadAllText($Path)
    $text = $text -replace "`r`n", "`n"
    $text = $text -replace "`r", "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
}
function Repair-ManifestLineEndings([string]$RepoPath) {
    if (-not (Test-Path $Manifest)) { return }
    $manifestObject = Get-Content -Raw $Manifest | ConvertFrom-Json
    git config core.autocrlf false | Out-Null
    git config core.eol lf | Out-Null
    $trackedDirty = @(git diff --name-only)
    foreach ($relative in $trackedDirty) {
        $entry = $manifestObject.files | Where-Object { $_.path -eq ($relative -replace '\\','/') } | Select-Object -First 1
        if ($null -eq $entry) { continue }
        git diff --ignore-space-at-eol --quiet -- $relative
        if ($LASTEXITCODE -ne 0) { Fail "Protected file has content changes, not only line-ending drift: $relative" }
        Normalize-TextFileToLf (Join-Path $RepoPath $relative)
        Write-StagingLog -Level info -Component $LogComponent -Stage "line-endings" -Message "normalized protected file to LF" -Data @{ path = $relative }
    }
    git update-index --really-refresh 2>$null | Out-Null
}

function Write-ServiceFailureDiagnostics([string]$Service, [string]$ContainerId) {
    try {
        $state = (& docker inspect --format '{{json .State}}' $ContainerId 2>$null | Out-String).Trim()
        $logs = (& docker logs --tail 120 $ContainerId 2>&1 | Out-String).Trim()
        Write-StagingLog -Level error -Component $LogComponent -Stage "health:$Service" -Message "service health diagnostics" -Data @{ service = $Service; container_id = $ContainerId; state = $state; logs = $logs }
        Write-Host "SERVICE_HEALTH_DIAGNOSTICS: service=$Service container=$ContainerId" -ForegroundColor Red
        if (-not [string]::IsNullOrWhiteSpace($logs)) { Write-Host $logs -ForegroundColor DarkRed }
    } catch {
        Write-StagingLog -Level warn -Component $LogComponent -Stage "health:$Service" -Message "service diagnostics collection failed" -Data @{ service = $Service; error = $_.Exception.Message }
    }
}
function Wait-ServiceHealthy([string[]]$ComposeArgs, [string]$Service) {
    $containerId = Get-NativeText "docker" ($ComposeArgs + @("ps", "-q", $Service))
    if ([string]::IsNullOrWhiteSpace($containerId)) { Fail "Compose did not create the expected service container: $Service" }
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $health = Get-NativeText "docker" @("inspect", "--format", "{{.State.Health.Status}}", $containerId)
        if ($health -eq "healthy") {
            Write-StagingLog -Level info -Component $LogComponent -Stage "health:$Service" -Message "service became healthy" -Data @{ service = $Service }
            return
        }
        if ($health -eq "unhealthy") {
            Write-ServiceFailureDiagnostics $Service $containerId
            Fail "Service healthcheck failed: $Service"
        }
        Start-Sleep -Seconds 2
    }
    Write-ServiceFailureDiagnostics $Service $containerId
    Fail "Service did not become healthy within 120 seconds: $Service"
}

function Assert-Sha([string]$Value) {
    if ($Value -notmatch '^[0-9a-fA-F]{40}$') { Fail "ExpectedCommit must be an exact 40-character SHA; ref-only execution is forbidden" }
}

function Assert-UniqueEnvKeys([string]$Path) {
    $seen = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=') {
            $key = $Matches[1]
            if ($seen.ContainsKey($key)) { Fail "Duplicate environment key is forbidden: $key" }
            $seen[$key] = $true
        }
    }
}

function Read-EnvValue([string]$Path, [string]$Name) {
    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if (-not $line) { Fail "Missing $Name in .env.staging" }
    return $line -replace "^$([regex]::Escape($Name))=", ""
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = (Resolve-Path (Join-Path $scriptRoot "..")).Path
}
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$ApiPath = Join-Path $RepositoryPath "http-generic-api"
$ComposeBase = Join-Path $ApiPath "docker-compose.yml"
$ComposeStage = Join-Path $ApiPath "docker-compose.staging.yml"
$EnvExample = Join-Path $ApiPath ".env.staging.example"
$EnvFile = Join-Path $ApiPath ".env.staging"
$Manifest = Join-Path $scriptRoot "manifest.json"
$StateFile = Join-Path $scriptRoot "autopilot-state.json"

Require-Command "git"
Require-Command "docker"
Require-Command "wsl"
if (-not (Test-Path $ComposeBase) -or -not (Test-Path $ComposeStage) -or -not (Test-Path $EnvExample)) {
    if ([string]::IsNullOrWhiteSpace($RepositoryUrl)) { Fail "Repository files are missing and RepositoryUrl is empty" }
    New-Item -ItemType Directory -Force -Path $RepositoryPath | Out-Null
    if (-not (Test-Path (Join-Path $RepositoryPath ".git"))) {
        Invoke-Native "git" @("clone", "--filter=blob:none", "--no-checkout", $RepositoryUrl, $RepositoryPath)
    }
}

if (-not (Test-Path (Join-Path $RepositoryPath ".git"))) { Fail "RepositoryPath is not a Git repository: $RepositoryPath" }
Assert-Sha $ExpectedCommit

if ($env:DOCKER_HOST) { Fail "DOCKER_HOST is set; refusing a remote Docker daemon" }
if ($env:DOCKER_CONTEXT) { Fail "DOCKER_CONTEXT is set; unset it and select a local Docker Desktop context explicitly" }
$context = Get-NativeText "docker" @("context", "show")
if ($context -notin @("default", "desktop-linux")) { Fail "Docker context '$context' is not an accepted local context" }
$dockerServer = Get-NativeText "docker" @("info", "--format", "{{.ServerVersion}}")
if ([string]::IsNullOrWhiteSpace($dockerServer)) { Fail "Docker daemon is not reachable" }
    $wslStatus = (& wsl.exe --status 2>$null | Out-String)
    if ([string]::IsNullOrWhiteSpace($wslStatus)) { Fail "WSL2 status could not be read" }
    if (-not (Test-StagingWsl2Ready)) { Fail "No WSL2 distribution is available; Docker Desktop must be configured for WSL2" }

    Push-Location $RepositoryPath
try {
    Repair-ManifestLineEndings $RepositoryPath
    $dirty = @(git status --porcelain --untracked-files=all)
    if ($dirty.Count -gt 0) { Fail "Working tree is not clean after protected line-ending normalization; Auto Pilot will not overwrite local work" }
    Invoke-Native "git" @("fetch", "origin", $Ref, "--depth=1")
    $remoteCommit = Get-NativeText "git" @("rev-parse", "origin/$Ref")
    if ($remoteCommit.ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant()) {
        Fail "Pinned commit mismatch: origin/$Ref resolved to $remoteCommit, expected $ExpectedCommit"
    }
    Invoke-Native "git" @("checkout", "--detach", $ExpectedCommit)
    $checkedOut = Get-NativeText "git" @("rev-parse", "HEAD")
    if ($checkedOut.ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant()) { Fail "Checked-out commit readback mismatch" }

    if (-not (Test-Path $Manifest)) { Fail "Portable manifest is missing: $Manifest" }
    $manifestObject = Get-Content -Raw $Manifest | ConvertFrom-Json
    foreach ($entry in $manifestObject.files) {
        $full = Join-Path $RepositoryPath $entry.path
        if (-not (Test-Path $full)) { Fail "Manifest file is missing: $($entry.path)" }
        $actual = (Get-FileHash -Algorithm SHA256 $full).Hash.ToLowerInvariant()
        if ($actual -ne $entry.sha256.ToLowerInvariant()) { Fail "Manifest hash mismatch: $($entry.path)" }
    }

    if (-not (Test-Path $EnvFile)) {
        Copy-Item $EnvExample $EnvFile
        $localSecrets = @{
            "DB_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
            "RUNTIME_DB_ROOT_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
            "GOVERNANCE_DB_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
            "RUNTIME_PERSISTENCE_DB_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
            "RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
            "BACKEND_API_KEY" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
            "JWT_SECRET" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
            "TENANT_GPT_SSO_SIGNING_SECRET" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
            "TOKEN_ENCRYPTION_KEY" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        }
        $envText = Get-Content -Raw $EnvFile
        foreach ($key in $localSecrets.Keys) { $envText = [regex]::Replace($envText, "(?m)^$key=.*$", "$key=$($localSecrets[$key])") }
        Set-Content -Encoding utf8 $EnvFile $envText
    }

    $generatedLocalSecrets = @{
        "DB_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "RUNTIME_DB_ROOT_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "GOVERNANCE_DB_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "GOVERNANCE_DB_ROOT_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "RUNTIME_PERSISTENCE_DB_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "BACKEND_API_KEY" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "JWT_SECRET" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "TENANT_GPT_SSO_SIGNING_SECRET" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "TOKEN_ENCRYPTION_KEY" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
        "REMOTE_MCP_OAUTH_SIGNING_SECRET" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
    }
    $envText = Get-Content -Raw $EnvFile
    foreach ($key in $generatedLocalSecrets.Keys) {
        if ($envText -notmatch "(?im)^$([regex]::Escape($key))=") {
            $envText = $envText.TrimEnd() + "`r`n$key=$($generatedLocalSecrets[$key])`r`n"
        } elseif ($envText -match "(?im)^$([regex]::Escape($key))=local_[^\r\n]*change_me\s*$") {
            $envText = [regex]::Replace($envText, "(?im)^$([regex]::Escape($key))=.*$", "$key=$($generatedLocalSecrets[$key])")
        }
    }
    Set-Content -Encoding utf8 $EnvFile $envText

    Assert-UniqueEnvKeys $EnvFile
    $effectiveEnv = Get-Content -Raw $EnvFile
    if ($effectiveEnv -match '(?im)^CLOUDFLARE_TUNNEL_TOKEN=\s*$' -and $StartTunnel) { Fail "StartTunnel requested but CLOUDFLARE_TUNNEL_TOKEN is empty" }
    if ($effectiveEnv -notmatch '(?im)^MIGRATION_APPLIED=false\s*$' -or $effectiveEnv -notmatch '(?im)^DATABASE_MUTATED=false\s*$') { Fail "Mutation safety flags must be present and exactly false" }
    if ($StartTunnel -and (Read-EnvValue $EnvFile "TENANT_GPT_STAGING_ENABLED") -eq "true" -and [string]::IsNullOrWhiteSpace((Read-EnvValue $EnvFile "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET"))) { Fail "StartTunnel requires TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET when Staging GPT is enabled" }
    if ($StartTunnel -and (Read-EnvValue $EnvFile "REMOTE_MCP_ENABLED") -eq "true" -and (Read-EnvValue $EnvFile "REMOTE_MCP_OAUTH_ENABLED") -eq "true" -and [string]::IsNullOrWhiteSpace((Read-EnvValue $EnvFile "REMOTE_MCP_OAUTH_SIGNING_SECRET"))) { Fail "StartTunnel requires REMOTE_MCP_OAUTH_SIGNING_SECRET when Staging MCP OAuth is enabled" }
    if ($effectiveEnv -notmatch '(?im)^TENANT_GPT_SSO_COOKIE_MODE=host_only\s*$') { Fail "Staging SSO cookie mode must be host_only" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp_dev\.mad4b\.com\s*$') { Fail "Staging tunnel must expose exactly dev.mad4b.com and mcp_dev.mad4b.com" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_ORIGIN_APP=http://app:8080\s*$') { Fail "Staging tunnel origin must be exactly http://app:8080" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_LOGLEVEL=info\s*$') { Fail "Staging tunnel loglevel must remain info; debug may expose request headers" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_GRACE_PERIOD=30s\s*$') { Fail "Staging tunnel grace period must remain 30s" }
    if ($effectiveEnv -match '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=.*(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com|activation_dev\.mad4b\.com)') { Fail "Forbidden Production or reserved-disabled hostname found in staging tunnel list" }

    $composeArgs = @("compose", "-f", $ComposeBase, "-f", $ComposeStage, "--env-file", $EnvFile)
    Invoke-Native "docker" ($composeArgs + @("config", "--quiet"))
    if ($ValidateOnly) {
        Write-Host "AUTO_PILOT_VALIDATED: commit=$ExpectedCommit context=$context tunnel=$StartTunnel"
        return
    }
    if ($Stop) {
        Write-StagingLog -Level info -Component $LogComponent -Stage "stop" -Message "stopping local Staging services"
        Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "stop"))
        Write-StagingOperationBoundary -Component $LogComponent -Stage "stop" -Outcome "success" -Message "local Staging services stopped"
        return
    }
    $upArgs = $composeArgs + @("up", "-d")
    if (-not $SkipBuild) { $upArgs += "--build" }
    Write-StagingLog -Level info -Component $LogComponent -Stage "compose-up" -Message "starting local application topology"
    Invoke-Native "docker" $upArgs
    foreach ($service in @("redis", "runtime-db", "governance-db", "persistence-db", "app")) { Wait-ServiceHealthy $composeArgs $service }
    if ($StartTunnel) {
        Write-StagingLog -Level info -Component $LogComponent -Stage "tunnel" -Message "starting explicitly enabled Staging tunnel"
        Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "up", "-d", "cloudflared"))
        Write-StagingOperationBoundary -Component $LogComponent -Stage "tunnel" -Outcome "success" -Message "Staging tunnel started" -Data @{ hostnames = "dev.mad4b.com,mcp_dev.mad4b.com" }
    }
    Invoke-Native "docker" ($composeArgs + @("ps"))
    Set-Content -Encoding utf8 $StateFile (@{ commit=$ExpectedCommit; ref=$Ref; docker_context=$context; tunnel_started=[bool]$StartTunnel; migration_applied=$false; database_mutated=$false; generated_at=(Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json)
    Write-Host "AUTO_PILOT_STARTED: local staging is running; tunnel=$StartTunnel; commit=$ExpectedCommit"
    Write-StagingOperationBoundary -Component $LogComponent -Stage "complete" -Outcome "success" -Message "local Staging application operations completed" -Data @{ commit = $ExpectedCommit; tunnel_started = [bool]$StartTunnel; services = "redis,runtime-db,governance-db,persistence-db,app" }
    Write-Host "APP_OPERATIONS_LOG: $(Get-StagingLogRoot)"
} finally {
    Pop-Location
}
