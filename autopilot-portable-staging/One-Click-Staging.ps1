[CmdletBinding()]
param(
    [ValidateSet("Install", "Validate", "Stop")]
    [string]$Mode = "Install",
    [string]$RepositoryPath = "",
    [string]$RepositoryUrl = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    [string]$Ref = "main",
    [string]$ExpectedRepository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    [int]$PollSeconds = 300,
    [int]$EligibilityWaitSeconds = 1800,
    [switch]$NoTunnel,
    [switch]$NoAutoDeploy,
    [switch]$RequireSchemaBundle,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OneClickScriptPath = $PSCommandPath
$BootstrapScriptRoot = Split-Path -Parent $OneClickScriptPath
$BootstrapLogRoot = Join-Path $BootstrapScriptRoot "logs"
$BootstrapFallbackLog = Join-Path $BootstrapLogRoot "bootstrap-console.log"
function Write-EarlyBootstrapLog([string]$Message) {
    try {
        New-Item -ItemType Directory -Force -Path $BootstrapLogRoot | Out-Null
        $safe = [string]$Message -replace '(?i)(TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*[^\s,;]+', '$1=REDACTED'
        Add-Content -LiteralPath $BootstrapFallbackLog -Encoding utf8 -Value ((Get-Date).ToUniversalTime().ToString("o") + " " + $safe)
    } catch {
        Write-Host "STAGING_EARLY_LOG_WRITE_FAILED: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}
Write-EarlyBootstrapLog "bootstrap entered mode=$Mode repository_path=$RepositoryPath"
$loggerPath = Join-Path $BootstrapScriptRoot "Staging-Operations-Log.ps1"
try { . $loggerPath } catch {
    Write-EarlyBootstrapLog "logger import failed: $($_.Exception.Message)"
    throw
}
$LogComponent = "auto-pilot"
Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "one-click process started" -Data @{ mode = $Mode; repository_path = $RepositoryPath }
trap {
    $errorMessage = $_.Exception.Message
    try { Write-StagingLog -Level error -Component $LogComponent -Stage "unhandled" -Message $errorMessage -Data @{ error_type = $_.Exception.GetType().FullName } } catch { }
    Write-EarlyBootstrapLog "unhandled failure: $errorMessage"
    Write-Host "AUTO_PILOT_FAILURE_LOGGED: $(Join-Path $BootstrapLogRoot 'operations.jsonl')" -ForegroundColor Red
    Write-Host "AUTO_PILOT_EARLY_DIAGNOSTIC: $BootstrapFallbackLog" -ForegroundColor Yellow
    exit 1
}

function Fail([string]$Message) {
    Write-StagingLog -Level error -Component $LogComponent -Stage "fail_closed" -Message $Message
    throw "AUTO_PILOT_ONE_CLICK_FAIL_CLOSED: $Message"
}

function Invoke-Native([string]$File, [string[]]$Arguments, [switch]$AllowFailure) {
    Write-Host ("> {0} {1}" -f $File, ($Arguments -join " "))
    Write-StagingOperationBoundary -Component $LogComponent -Stage "native:$File" -Outcome "start" -Message "native command started" -Data @{ command = $File; arguments = ($Arguments -join " ") }
    & $File @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        Write-StagingLog -Level error -Component $LogComponent -Stage "native:$File" -Message "native command failed" -Data @{ exit_code = $code; command = $File }
        Fail "$File exited with code $code"
    }
    Write-StagingOperationBoundary -Component $LogComponent -Stage "native:$File" -Outcome "success" -Message "native command completed" -Data @{ exit_code = $code; command = $File }
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

function Is-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Reinvoke-Elevated {
    if (Is-Administrator) { return $false }
    $scriptPath = $OneClickScriptPath
    $argList = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`"", "-Mode", $Mode, "-RepositoryUrl", "`"$RepositoryUrl`"", "-Ref", $Ref, "-ExpectedRepository", $ExpectedRepository, "-PollSeconds", "$PollSeconds", "-EligibilityWaitSeconds", "$EligibilityWaitSeconds")
    if (-not [string]::IsNullOrWhiteSpace($RepositoryPath)) { $argList += @("-RepositoryPath", "`"$RepositoryPath`"") }
    if ($NoTunnel) { $argList += "-NoTunnel" }
    if ($NoAutoDeploy) { $argList += "-NoAutoDeploy" }
    if ($RequireSchemaBundle) { $argList += "-RequireSchemaBundle" }
    if ($SkipBuild) { $argList += "-SkipBuild" }
    $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList ($argList -join " ") -Wait -PassThru
    exit $process.ExitCode
}

if (Reinvoke-Elevated) { return }

function Refresh-Path {
    $paths = @(
        "C:\Program Files\Git\cmd",
        "C:\Program Files\GitHub CLI",
        "C:\Program Files\Docker\Docker\resources\bin",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links"
    )
    foreach ($item in $paths) {
        if ((Test-Path $item) -and ($env:Path -notlike "*$item*")) { $env:Path += ";$item" }
    }
}

function Install-WingetPackage([string]$Id) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail "winget is unavailable; install App Installer from Microsoft Store or use a supported Windows 10 image" }
    Invoke-Native "winget" @("install", "--id", $Id, "--exact", "--accept-source-agreements", "--accept-package-agreements", "--silent")
    Refresh-Path
}

function Test-Wsl2DistributionReady([string]$WslList) {
    if ([string]::IsNullOrWhiteSpace($WslList)) { return $false }
    $normalized = $WslList -replace "\x00", ""
    return $normalized -match '(?im)^\s*\*?\s*\S+\s+\S+\s+2\s*$'
}

function Wait-Wsl2Distribution([int]$Attempts = 12, [int]$DelaySeconds = 5) {
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $wslList = (& wsl.exe --list --verbose 2>$null | Out-String)
        # Some WSL startup states return a transient nonzero code or NUL-padded text;
        # the normalized distribution/version row is the readiness authority.
        if (Test-Wsl2DistributionReady $wslList) { return $true }
        if ($attempt -lt ($Attempts - 1)) { Start-Sleep -Seconds $DelaySeconds }
    }
    return $false
}

function Ensure-Prerequisites {
    Refresh-Path
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Install-WingetPackage "Git.Git" }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Install-WingetPackage "GitHub.cli" }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Install-WingetPackage "Docker.DockerDesktop" }
    Refresh-Path
    Require-Command "git"
    Require-Command "gh"
    Require-Command "docker"
    Require-Command "wsl"

    if (-not (Wait-Wsl2Distribution -Attempts 3 -DelaySeconds 5)) {
        Write-Host "WSL2 distribution is missing or still starting; requesting the standard Windows installation now."
        & wsl.exe --install -d Ubuntu --no-launch 2>$null
        $installExitCode = $LASTEXITCODE
        if ($installExitCode -ne 0 -and -not (Wait-Wsl2Distribution -Attempts 12 -DelaySeconds 5)) { Fail "WSL2 is not ready. Windows may require one reboot; rerun this same launcher after reboot." }
        if (-not (Wait-Wsl2Distribution -Attempts 24 -DelaySeconds 5)) { Fail "WSL2 installation completed but no version-2 distribution became ready after waiting; rerun after the requested Windows reboot." }
    }

    $dockerContext = Get-NativeText "docker" @("context", "show")
    Write-StagingLog -Level info -Component $LogComponent -Stage "prerequisites" -Message "local prerequisite checks started"
    if ($dockerContext -notin @("default", "desktop-linux")) { Fail "Docker context '$dockerContext' is not a local Docker Desktop context" }
    $dockerReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $info = & docker info --format "{{.ServerVersion}}" 2>$null
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace((($info | Out-String).Trim()))) { $dockerReady = $true; break }
        if ($attempt -eq 0) {
            $desktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
            if (Test-Path $desktop) { Start-Process -FilePath $desktop -WindowStyle Minimized }
        }
        Start-Sleep -Seconds 2
    }
    if (-not $dockerReady) { Fail "Docker Desktop did not become ready within 120 seconds" }

    $auth = & gh auth status 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Host "GitHub CLI login is required once; the standard browser/device flow will open now."
        Invoke-Native "gh" @("auth", "login", "--hostname", "github.com", "--web", "--git-protocol", "https")
    }
    $auth = & gh auth status 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Fail "GitHub CLI authentication is unavailable; Auto Deploy cannot fail open without CI eligibility" }
    Write-StagingOperationBoundary -Component $LogComponent -Stage "prerequisites" -Outcome "success" -Message "local prerequisites are ready"
}

function Resolve-Repository([string]$ScriptRoot) {
    if (-not [string]::IsNullOrWhiteSpace($RepositoryPath)) { return [IO.Path]::GetFullPath($RepositoryPath) }
    $scriptParent = Split-Path -Parent $ScriptRoot
    $candidates = @($scriptParent, (Join-Path $scriptParent "multi-business-multi-role-growth-intelligence-os"))
    foreach ($candidate in $candidates) {
        if ((Test-Path (Join-Path $candidate ".git")) -and (Test-Path (Join-Path $candidate "http-generic-api"))) { return [IO.Path]::GetFullPath($candidate) }
    }
    return [IO.Path]::GetFullPath((Join-Path $scriptParent "multi-business-multi-role-growth-intelligence-os"))
}

function Ensure-Repository([string]$RepoPath) {
    if (Test-Path (Join-Path $RepoPath ".git")) { return }
    if (Test-Path $RepoPath) {
        $entries = @(Get-ChildItem -LiteralPath $RepoPath -Force)
        if ($entries.Count -gt 0) { Fail "Repository target exists and is not an empty Git directory: $RepoPath" }
    } else {
        New-Item -ItemType Directory -Force -Path $RepoPath | Out-Null
    }
    Invoke-Native "git" @("clone", "--branch", $Ref, "--single-branch", $RepositoryUrl, $RepoPath)
}

function New-Secret {
    return ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
}

function Convert-SecureStringToPlain([Security.SecureString]$Value) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Read-EnvLines([string]$Path) { return @(Get-Content -LiteralPath $Path) }

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
    $lines = Read-EnvLines $Path
    $pattern = "^$([regex]::Escape($Name))="
    $found = $false
    $result = @()
    foreach ($line in $lines) {
        if ($line -match $pattern) {
            if ($found) { Fail "Duplicate environment key is forbidden: $Name" }
            $result += "$Name=$Value"
            $found = $true
        } else { $result += $line }
    }
    if (-not $found) { $result += "$Name=$Value" }
    Set-Content -LiteralPath $Path -Encoding utf8 -Value ($result -join "`r`n")
}

function Get-EnvValue([string]$Path, [string]$Name) {
    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -replace "^$([regex]::Escape($Name))=", "")
}

function Initialize-Environment([string]$RepoPath, [string]$ScriptRoot) {
    $apiPath = Join-Path $RepoPath "http-generic-api"
    $example = Join-Path $apiPath ".env.staging.example"
    $envFile = Join-Path $apiPath ".env.staging"
    if (-not (Test-Path $example)) { Fail "Staging env template is missing: $example" }
    if (-not (Test-Path $envFile)) { Copy-Item -LiteralPath $example -Destination $envFile }

    $generated = @{
        "DB_PASSWORD" = New-Secret
        "RUNTIME_DB_ROOT_PASSWORD" = New-Secret
        "GOVERNANCE_DB_PASSWORD" = New-Secret
        "GOVERNANCE_DB_ROOT_PASSWORD" = New-Secret
        "RUNTIME_PERSISTENCE_DB_PASSWORD" = New-Secret
        "RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD" = New-Secret
        "BACKEND_API_KEY" = New-Secret
        "JWT_SECRET" = New-Secret
        "TENANT_GPT_SSO_SIGNING_SECRET" = New-Secret
        "TOKEN_ENCRYPTION_KEY" = New-Secret
        "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET" = New-Secret
        "REMOTE_MCP_OAUTH_SIGNING_SECRET" = New-Secret
        "REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS" = "https://chatgpt.com,https://www.chatgpt.com,https://claude.ai,https://www.claude.ai"
    }
    foreach ($key in $generated.Keys) {
        $current = Get-EnvValue $envFile $key
        if ([string]::IsNullOrWhiteSpace($current) -or $current -match "change_me") { Set-EnvValue $envFile $key $generated[$key] }
    }

    if ($NoTunnel) {
        Set-EnvValue $envFile "CLOUDFLARE_TUNNEL_ENABLED" "false"
    } else {
        $token = Get-EnvValue $envFile "CLOUDFLARE_TUNNEL_TOKEN"
        if ([string]::IsNullOrWhiteSpace($token)) {
            Write-Host "One-time secure input: paste the dedicated Staging Cloudflare Tunnel token. It is stored only in ignored .env.staging."
            $secureToken = Read-Host "Staging Tunnel token" -AsSecureString
            $token = Convert-SecureStringToPlain $secureToken
            if ([string]::IsNullOrWhiteSpace($token)) { Fail "A Staging Tunnel token is required unless -NoTunnel is used" }
            Set-EnvValue $envFile "CLOUDFLARE_TUNNEL_TOKEN" $token
        }
        Set-EnvValue $envFile "CLOUDFLARE_TUNNEL_ENABLED" "true"
    }
    Set-EnvValue $envFile "MIGRATION_APPLIED" "false"
    Set-EnvValue $envFile "DATABASE_MUTATED" "false"
    Set-EnvValue $envFile "PRODUCTION_MUTATION_AUTHORIZED" "false"
    Set-EnvValue $envFile "RULESET_MUTATION_AUTHORIZED" "false"
    $effective = Get-Content -Raw -LiteralPath $envFile
    if ($effective -match '(?im)^(CLOUDFLARE_TUNNEL_HOSTNAMES|PUBLIC_BASE_URL|AUTH_BASE_URL|PLATFORM_JWT_ISSUER)=.*(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com|activation_dev\.mad4b\.com)') { Fail "Production or reserved hostname leaked into Staging environment" }
    if ($effective -notmatch '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp_dev\.mad4b\.com\s*$') { Fail "Staging hostname allowlist drifted" }
    if ($effective -notmatch '(?im)^TENANT_GPT_SSO_COOKIE_MODE=host_only\s*$') { Fail "Staging cookie boundary drifted" }
    return $envFile
}

function Get-MainSha([string]$RepoPath) {
    Push-Location $RepoPath
    try {
        $line = Get-NativeText "git" @("ls-remote", "origin", "refs/heads/$Ref")
        $sha = ($line -split "\s+")[0]
        if ($sha -notmatch '^[0-9a-fA-F]{40}$') { Fail "origin/$Ref did not resolve to an exact SHA" }
        return $sha.ToLowerInvariant()
    } finally { Pop-Location }
}

function Wait-Eligibility([string]$Sha) {
    $deadline = (Get-Date).ToUniversalTime().AddSeconds($EligibilityWaitSeconds)
    while ($true) {
        $raw = & gh api "repos/$ExpectedRepository/commits/$Sha/check-runs?per_page=100" 2>$null
        if ($LASTEXITCODE -ne 0) { Fail "GitHub eligibility lookup failed; refusing deployment" }
        $payload = (($raw | Out-String) | ConvertFrom-Json)
        $checks = @($payload.check_runs | Where-Object { $_.name -eq "Staging Main Deploy Eligibility" } | Sort-Object completed_at -Descending)
        if ($checks.Count -gt 0) {
            $check = $checks[0]
            if ($check.status -eq "completed" -and $check.conclusion -eq "success") { return }
            if ($check.status -eq "completed" -and $check.conclusion -notin @("success", "neutral")) { Fail "main commit $Sha is blocked by CI eligibility: $($check.conclusion)" }
        }
        if ((Get-Date).ToUniversalTime() -gt $deadline) { Fail "Timed out waiting for Staging Main Deploy Eligibility for $Sha" }
        Write-Host "Waiting for Staging Main Deploy Eligibility: sha=$Sha"
        Start-Sleep -Seconds 15
    }
}

function Start-LocalStaging([string]$RepoPath, [string]$Sha, [string]$EnvFile) {
    $start = Join-Path $RepoPath "autopilot-portable-staging\Start-AutoPilot.ps1"
    if (-not (Test-Path $start)) { Fail "Start-AutoPilot.ps1 is missing" }
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $start, "-RepositoryPath", $RepoPath, "-Ref", $Ref, "-ExpectedCommit", $Sha)
    if (-not $NoTunnel) { $args += "-StartTunnel" }
    if ($SkipBuild) { $args += "-SkipBuild" }
    Invoke-Native "powershell.exe" $args
}

function Seed-SchemaIfAvailable([string]$RepoPath, [string]$ScriptRoot) {
    $dumpDir = Join-Path $ScriptRoot "staging-db-dumps"
    $required = @("runtime.schema.sql.gz", "governance.schema.sql.gz", "persistence.schema.sql.gz")
    $available = (Test-Path $dumpDir) -and (($required | Where-Object { -not (Test-Path (Join-Path $dumpDir $_)) }).Count -eq 0)
    if (-not $available) {
        if ($RequireSchemaBundle) { Fail "Schema bundle is required but missing from $dumpDir" }
        Write-Host "No local schema-only bundle found; databases remain fresh and no migration or database mutation is performed."
        return "skipped_no_schema_bundle"
    }
    $clone = Join-Path $ScriptRoot "Clone-StagingDatabases.ps1"
    Invoke-Native "powershell.exe" @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $clone, "-DumpDirectory", $dumpDir, "-Mode", "schema_only", "-Apply")
    return "schema_only_applied"
}

function Install-AutoDeploy([string]$RepoPath) {
    $installer = Join-Path $RepoPath "autopilot-portable-staging\Install-AutoDeployTask.ps1"
    if (-not (Test-Path $installer)) { Fail "Install-AutoDeployTask.ps1 is missing" }
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installer, "-RepositoryPath", $RepoPath, "-PollSeconds", "$PollSeconds")
    if (-not $NoTunnel) { $args += "-StartTunnel" }
    if ($SkipBuild) { $args += "-SkipBuild" }
    Invoke-Native "powershell.exe" $args
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Ref -ne "main") { Fail "One-click Auto Pilot is main-only" }
if ($PollSeconds -lt 60) { Fail "PollSeconds must be at least 60" }
$repo = Resolve-Repository $scriptRoot
$envFile = $null
# On an existing checkout, create the ignored Staging env before prerequisite checks so a missing gh/docker/WSL dependency never hides the env boundary.
if (Test-Path (Join-Path $repo ".git")) {
    $envFile = Initialize-Environment $repo $scriptRoot
    Write-EarlyBootstrapLog "staging environment initialized before prerequisite checks"
}
Ensure-Prerequisites
Ensure-Repository $repo
if ([string]::IsNullOrWhiteSpace([string]$envFile)) { $envFile = Initialize-Environment $repo $scriptRoot }

if ($Mode -eq "Stop") {
    $start = Join-Path $repo "autopilot-portable-staging\Start-AutoPilot.ps1"
    Invoke-Native "powershell.exe" @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $start, "-RepositoryPath", $repo, "-Ref", $Ref, "-ExpectedCommit", (Get-MainSha $repo), "-Stop")
    Write-Host "AUTO_PILOT_STOPPED: local Staging stopped; no Production or provider mutation performed."
    return
}

    $sha = Get-MainSha $repo
Write-StagingLog -Level info -Component $LogComponent -Stage "eligibility" -Message "resolved main commit; waiting for eligibility" -Data @{ sha = $sha }
Wait-Eligibility $sha
Write-StagingOperationBoundary -Component $LogComponent -Stage "eligibility" -Outcome "success" -Message "Staging Main Deploy Eligibility passed" -Data @{ sha = $sha }
if ($Mode -eq "Validate") {
    $start = Join-Path $repo "autopilot-portable-staging\Start-AutoPilot.ps1"
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $start, "-RepositoryPath", $repo, "-Ref", $Ref, "-ExpectedCommit", $sha, "-ValidateOnly")
    if (-not $NoTunnel) { $args += "-StartTunnel" }
    Invoke-Native "powershell.exe" $args
    Write-Host "AUTO_PILOT_VALIDATED: commit=$sha tunnel=$(-not $NoTunnel)"
    return
}

Start-LocalStaging $repo $sha $envFile
$databaseState = Seed-SchemaIfAvailable $repo $scriptRoot
if (-not $NoAutoDeploy) { Install-AutoDeploy $repo }
$statePath = Join-Path $scriptRoot "one-click-state.json"
@{
    commit = $sha
    repository = $ExpectedRepository
    repository_path = $repo
    tunnel_started = (-not $NoTunnel)
    auto_deploy_installed = (-not $NoAutoDeploy)
    database_seed = $databaseState
    migration_applied = $false
    database_mutated = $false
    production_deploy = $false
    cloudflare_dns_mutation = $false
    hostinger_mutation = $false
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -LiteralPath $statePath
Write-Host "AUTO_PILOT_ONE_CLICK_COMPLETE: staging=$repo commit=$sha tunnel=$(-not $NoTunnel) auto_deploy=$(-not $NoAutoDeploy) database_seed=$databaseState"
Write-Host "URLs: https://dev.mad4b.com | https://mcp_dev.mad4b.com"
Write-Host "OpenAPI: Tenant/Admin on dev.mad4b.com; Remote MCP on mcp_dev.mad4b.com"
Write-StagingOperationBoundary -Component $LogComponent -Stage "complete" -Outcome "success" -Message "one-click staging completed" -Data @{ sha = $sha; repository_path = $repo; database_seed = $databaseState }
Write-Host "AUTO_PILOT_LOG: $(Get-StagingLogRoot)"
