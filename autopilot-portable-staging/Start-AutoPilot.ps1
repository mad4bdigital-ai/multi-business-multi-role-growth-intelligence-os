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

function Fail([string]$Message) {
    throw "AUTO_PILOT_FAIL_CLOSED: $Message"
}

function Invoke-Native([string]$File, [string[]]$Arguments, [switch]$AllowFailure) {
    Write-Host ("> {0} {1}" -f $File, ($Arguments -join " "))
    & $File @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) { Fail "$File exited with code $code" }
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
$wslStatus = Get-NativeText "wsl.exe" @("--status")
if ([string]::IsNullOrWhiteSpace($wslStatus)) { Fail "WSL2 status could not be read" }

Push-Location $RepositoryPath
try {
    $dirty = @(git status --porcelain --untracked-files=all)
    if ($dirty.Count -gt 0) { Fail "Working tree is not clean; Auto Pilot will not overwrite local work" }
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
    if ($effectiveEnv -match '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=.*(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com|activation_dev\.mad4b\.com)') { Fail "Forbidden Production or reserved-disabled hostname found in staging tunnel list" }

    $composeArgs = @("compose", "-f", $ComposeBase, "-f", $ComposeStage, "--env-file", $EnvFile)
    Invoke-Native "docker" ($composeArgs + @("config", "--quiet"))
    if ($ValidateOnly) {
        Write-Host "AUTO_PILOT_VALIDATED: commit=$ExpectedCommit context=$context tunnel=$StartTunnel"
        return
    }
    if ($Stop) {
        Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "stop"))
        return
    }
    $upArgs = $composeArgs + @("up", "-d")
    if (-not $SkipBuild) { $upArgs += "--build" }
    Invoke-Native "docker" $upArgs
    if ($StartTunnel) { Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "up", "-d", "cloudflared")) }
    Invoke-Native "docker" ($composeArgs + @("ps"))
    Set-Content -Encoding utf8 $StateFile (@{ commit=$ExpectedCommit; ref=$Ref; docker_context=$context; tunnel_started=[bool]$StartTunnel; migration_applied=$false; database_mutated=$false; generated_at=(Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json)
    Write-Host "AUTO_PILOT_STARTED: local staging is running; tunnel=$StartTunnel; commit=$ExpectedCommit"
} finally {
    Pop-Location
}
