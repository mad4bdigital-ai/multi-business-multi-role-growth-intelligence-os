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
    [int]$EligibilityNoRunGraceSeconds = 600,
    [switch]$NoTunnel,
    [switch]$EnableActivationGateway,
    [switch]$NoAutoDeploy,
    [switch]$RequireSchemaBundle,
    [switch]$ApplySchemaBundle,
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart",
    [switch]$SkipBuild,
    [switch]$SkipBootstrap,
    [switch]$InheritedRunLock
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($SkipBuild) {
    if ($BuildMode -ne "Smart") { throw "-SkipBuild cannot be combined with an explicit BuildMode" }
    $BuildMode = "SkipBuild"
}
$OneClickScriptPath = $PSCommandPath
$BootstrapScriptRoot = Split-Path -Parent $OneClickScriptPath
$BootstrapLogRoot = Join-Path $BootstrapScriptRoot "logs"
$BootstrapFallbackLog = Join-Path $BootstrapLogRoot "bootstrap-console.log"
$GitSafetyPath = Join-Path $BootstrapScriptRoot "Staging-GitSafety.ps1"
if (-not (Test-Path -LiteralPath $GitSafetyPath)) { throw "Missing shared Git safety helper: $GitSafetyPath" }
. $GitSafetyPath
$GitTransportPath = Join-Path $BootstrapScriptRoot "Staging-GitTransport.ps1"
if (-not (Test-Path -LiteralPath $GitTransportPath)) { throw "Missing shared Git transport helper: $GitTransportPath" }
. $GitTransportPath
$WindowsPreflightPath = Join-Path $BootstrapScriptRoot "Staging-Windows-Preflight.ps1"
try { . $WindowsPreflightPath } catch {
    Write-Host "STAGING_WINDOWS_PREFLIGHT_IMPORT_FAILED: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
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
$script:AutoPilotRunMutex = $null
function Acquire-AutoPilotRunLock {
    if ($InheritedRunLock) {
        Write-EarlyBootstrapLog "inherited global Auto Pilot run lock"
        return
    }
    try {
        $script:AutoPilotRunMutex = New-Object System.Threading.Mutex($false, "Global\Mad4bPortableStagingAutoPilot")
        if (-not $script:AutoPilotRunMutex.WaitOne(0)) { Fail "Another Auto Pilot instance is already running; refusing overlapping execution" }
        Write-StagingLog -Level info -Component $LogComponent -Stage "run-lock" -Message "exclusive Auto Pilot run lock acquired"
    } catch [System.Threading.AbandonedMutexException] {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "run-lock" -Message "recovered abandoned Auto Pilot run lock"
    } catch {
        Fail "Unable to acquire Auto Pilot run lock: $($_.Exception.Message)"
    }
}
function Release-AutoPilotRunLock {
    if ($null -ne $script:AutoPilotRunMutex) {
        try { $script:AutoPilotRunMutex.ReleaseMutex() } catch { }
        try { $script:AutoPilotRunMutex.Dispose() } catch { }
        $script:AutoPilotRunMutex = $null
    }
}
Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "one-click process started" -Data @{ mode = $Mode; repository_path = $RepositoryPath }
trap {
    $errorMessage = $_.Exception.Message
    try { Write-StagingLog -Level error -Component $LogComponent -Stage "unhandled" -Message $errorMessage -Data @{ error_type = $_.Exception.GetType().FullName } } catch { }
    Write-EarlyBootstrapLog "unhandled failure: $errorMessage"
    Write-Host "AUTO_PILOT_FAILURE_LOGGED: $(Join-Path $BootstrapLogRoot 'operations.jsonl')" -ForegroundColor Red
    Write-Host "AUTO_PILOT_EARLY_DIAGNOSTIC: $BootstrapFallbackLog" -ForegroundColor Yellow
    Release-AutoPilotRunLock
    exit 1
}

function Fail([string]$Message) {
    Write-StagingLog -Level error -Component $LogComponent -Stage "fail_closed" -Message $Message
    throw "AUTO_PILOT_ONE_CLICK_FAIL_CLOSED: $Message"
}

function Invoke-Native([string]$File, [string[]]$Arguments, [switch]$AllowFailure) {
    Write-Host ("> {0} {1}" -f $File, ($Arguments -join " "))
    Write-StagingOperationBoundary -Component $LogComponent -Stage "native:$File" -Outcome "start" -Message "native command started" -Data @{ command = $File; arguments = ($Arguments -join " ") }
    if ($File -ieq "git") {
        try {
            $gitResult = Invoke-StagingGit $Arguments
            Write-StagingOperationBoundary -Component $LogComponent -Stage "native:git" -Outcome "success" -Message "Git command completed with bounded retry" -Data @{ command = $File; arguments = ($Arguments -join " "); attempts = $gitResult.attempts; transport = $gitResult.transport }
            return 0
        } catch {
            Write-StagingLog -Level error -Component $LogComponent -Stage "native:git" -Message $_.Exception.Message -Data @{ command = $File; arguments = ($Arguments -join " ") }
            if ($AllowFailure) { return 1 }
            Fail $_.Exception.Message
        }
    }
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
    if ($File -ieq "git") {
        try {
            $gitTextResult = Invoke-StagingGit $Arguments
            Write-StagingOperationBoundary -Component $LogComponent -Stage "native:git-read" -Outcome "success" -Message "Git read completed with bounded retry" -Data @{ command = $File; arguments = ($Arguments -join " "); attempts = $gitTextResult.attempts; transport = $gitTextResult.transport }
            return (($gitTextResult.output | Out-String).Trim())
        } catch {
            Fail $_.Exception.Message
        }
    }
    $text = & $File @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "$File failed while reading local state" }
    return (($text | Out-String).Trim())
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Fail "Required command is missing: $Name" }
}

function Is-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Reinvoke-Elevated {
    if (Is-Administrator) { return $false }
    $scriptPath = $OneClickScriptPath
    $argList = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`"", "-Mode", $Mode, "-RepositoryUrl", "`"$RepositoryUrl`"", "-Ref", $Ref, "-ExpectedRepository", $ExpectedRepository, "-PollSeconds", "$PollSeconds", "-EligibilityWaitSeconds", "$EligibilityWaitSeconds", "-EligibilityNoRunGraceSeconds", "$EligibilityNoRunGraceSeconds")
    if (-not [string]::IsNullOrWhiteSpace($RepositoryPath)) { $argList += @("-RepositoryPath", "`"$RepositoryPath`"") }
    if ($NoTunnel) { $argList += "-NoTunnel" }
    if ($EnableActivationGateway) { $argList += "-EnableActivationGateway" }
    if ($NoAutoDeploy) { $argList += "-NoAutoDeploy" }
    if ($RequireSchemaBundle) { $argList += "-RequireSchemaBundle" }
    if ($ApplySchemaBundle) { $argList += "-ApplySchemaBundle" }
    if ($SkipBootstrap) { $argList += "-SkipBootstrap" }
    if ($InheritedRunLock) { $argList += "-InheritedRunLock" }
    if ($SkipBuild) { $argList += "-SkipBuild" }
    $argList += @("-BuildMode", $(if ($SkipBuild) { "Smart" } else { $BuildMode }))
    $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList ($argList -join " ") -Wait -PassThru
    exit $process.ExitCode
}

if (Reinvoke-Elevated) { return }
Acquire-AutoPilotRunLock

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

    if (-not (Wait-StagingWsl2Distribution -Attempts 3 -DelaySeconds 5)) {
        Write-Host "WSL2 distribution is missing or still starting; requesting the standard Windows installation now."
        & wsl.exe --install -d Ubuntu --no-launch 2>$null
        $installExitCode = $LASTEXITCODE
        if ($installExitCode -ne 0 -and -not (Wait-StagingWsl2Distribution -Attempts 12 -DelaySeconds 5)) { Fail "WSL2 is not ready. Windows may require one reboot; rerun this same launcher after reboot." }
        if (-not (Wait-StagingWsl2Distribution -Attempts 24 -DelaySeconds 5)) { Fail "WSL2 installation completed but no version-2 distribution became ready after waiting; rerun after the requested Windows reboot." }
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

function Invoke-BootstrapSync([string]$RepoPath) {
    if ($SkipBootstrap) { return }
    $bootstrap = Join-Path $scriptRoot "Bootstrap-Staging-One-Click.ps1"
    if (-not (Test-Path -LiteralPath $bootstrap)) { Fail "Bootstrap-Staging-One-Click.ps1 is missing: $bootstrap" }
    $bootstrapBuildMode = if ($SkipBuild) { "Smart" } else { $BuildMode }
    $bootstrapArgs = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $bootstrap,
        "-RepositoryPath", $RepoPath, "-RepositoryUrl", $RepositoryUrl, "-Ref", $Ref,
        "-ExpectedRepository", $ExpectedRepository, "-PollSeconds", "$PollSeconds",
        "-EligibilityWaitSeconds", "$EligibilityWaitSeconds", "-EligibilityNoRunGraceSeconds", "$EligibilityNoRunGraceSeconds",
        "-BuildMode", $bootstrapBuildMode, "-InheritedRunLock"
    )
    if ($NoTunnel) { $bootstrapArgs += "-NoTunnel" }
    if ($EnableActivationGateway) { $bootstrapArgs += "-EnableActivationGateway" }
    if ($NoAutoDeploy) { $bootstrapArgs += "-NoAutoDeploy" }
    if ($RequireSchemaBundle) { $bootstrapArgs += "-RequireSchemaBundle" }
    if ($ApplySchemaBundle) { $bootstrapArgs += "-ApplySchemaBundle" }
    if ($SkipBuild) { $bootstrapArgs += "-SkipBuild" }
    & powershell.exe @bootstrapArgs
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { Fail "Bootstrap-Staging-One-Click.ps1 exited with code $exitCode" }
    exit 0
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
    Write-StagingUtf8NoBom $Path ($result -join "`r`n")
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
        "TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET" = New-Secret
        "REMOTE_MCP_OAUTH_SIGNING_SECRET" = New-Secret
        "REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS" = "https://chatgpt.com,https://www.chatgpt.com,https://claude.ai,https://www.claude.ai"
    }
    foreach ($key in $generated.Keys) {
        $current = Get-EnvValue $envFile $key
        if ([string]::IsNullOrWhiteSpace($current) -or $current -match "change_me") { Set-EnvValue $envFile $key $generated[$key] }
    }

    if ($EnableActivationGateway) {
        Set-EnvValue $envFile "ACTIVATION_STAGING_GATEWAY_ENABLED" "true"
        Set-EnvValue $envFile "ACTIVATION_HOST_GATEWAY_HOST" "activation-dev.mad4b.com"
        Set-EnvValue $envFile "ACTIVATION_STAGING_AUTH_HOST" "activation-dev.mad4b.com"
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
    if ($effective -match '(?im)^(CLOUDFLARE_TUNNEL_HOSTNAMES|PUBLIC_BASE_URL|AUTH_BASE_URL|PLATFORM_JWT_ISSUER)=.*(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com)') { Fail "Production hostname leaked into Staging environment" }
    $activationGatewayEnabled = (Get-EnvValue $envFile "ACTIVATION_STAGING_GATEWAY_ENABLED").ToLowerInvariant() -eq "true"
    if ($effective -notmatch '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp_dev\.mad4b\.com\s*$') { Fail "Staging Tunnel requires exactly dev.mad4b.com and mcp_dev.mad4b.com; Activation uses a separate Worker custom domain" }
    if ($activationGatewayEnabled) {
        if ((Get-EnvValue $envFile "ACTIVATION_HOST_GATEWAY_HOST") -ne "activation-dev.mad4b.com") { Fail "Activation Gateway must use activation-dev.mad4b.com as its Worker custom domain" }
        if ((Get-EnvValue $envFile "ACTIVATION_STAGING_AUTH_HOST") -ne "activation-dev.mad4b.com") { Fail "Activation OAuth host must be activation-dev.mad4b.com" }
        if ([string]::IsNullOrWhiteSpace((Get-EnvValue $envFile "TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET"))) { Fail "Enabled Activation Gateway requires its separate OAuth client secret" }
    }
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

function Get-EligibilityWorkflowRuns([string]$Sha) {
    $raw = & gh run list --repo $ExpectedRepository --workflow "staging-main-deploy-eligibility.yml" --commit $Sha --limit 20 --json status,conclusion,headSha,databaseId,updatedAt 2>$null
    if ($LASTEXITCODE -ne 0) { return @() }
    try {
        return @((($raw | Out-String) | ConvertFrom-Json) | Where-Object { $_.headSha -eq $Sha })
    } catch { return @() }
}
function Wait-Eligibility([string]$Sha) {
    $now = (Get-Date).ToUniversalTime()
    $deadline = $now.AddSeconds($EligibilityWaitSeconds)
    $noRunDeadline = $now.AddSeconds($EligibilityNoRunGraceSeconds)
    while ($true) {
        $runs = @(Get-EligibilityWorkflowRuns $Sha)
        if ($runs.Count -gt 0) {
            $run = $runs | Sort-Object updatedAt -Descending | Select-Object -First 1
            Write-StagingLog -Level info -Component $LogComponent -Stage "eligibility-poll" -Message "workflow eligibility observed" -Data @{ sha = $Sha; status = $run.status; conclusion = $run.conclusion; run_id = $run.databaseId }
            if ($run.status -eq "completed" -and $run.conclusion -eq "success") { return }
            if ($run.status -eq "completed" -and $run.conclusion -notin @("success", "neutral")) { Fail "main commit $Sha is blocked by CI eligibility: $($run.conclusion)" }
        } elseif ((Get-Date).ToUniversalTime() -gt $noRunDeadline) {
            Fail "No Staging Main Deploy Eligibility workflow run was found for exact SHA $Sha after $EligibilityNoRunGraceSeconds seconds; refusing silent polling. Dispatch staging-main-deploy-eligibility.yml for this SHA and retry."
        }
        if ((Get-Date).ToUniversalTime() -gt $deadline) { Fail "Timed out waiting for Staging Main Deploy Eligibility workflow for exact SHA $Sha" }
        Write-Host "Waiting for Staging Main Deploy Eligibility workflow: sha=$Sha"
        Start-Sleep -Seconds 15
    }
}

function Start-LocalStaging([string]$RepoPath, [string]$Sha, [string]$EnvFile) {
    $start = Join-Path $RepoPath "autopilot-portable-staging\Start-AutoPilot.ps1"
    if (-not (Test-Path $start)) { Fail "Start-AutoPilot.ps1 is missing" }
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $start, "-RepositoryPath", $RepoPath, "-RepositoryUrl", $RepositoryUrl, "-ExpectedRepository", $ExpectedRepository, "-Ref", $Ref, "-ExpectedCommit", $Sha, "-BuildMode", $BuildMode)
    if (-not $NoTunnel) { $args += "-StartTunnel" }
    Invoke-Native "powershell.exe" $args
}

function Seed-SchemaIfAvailable([string]$RepoPath, [string]$ScriptRoot, [string]$Sha) {
    $dumpDir = Join-Path $ScriptRoot "staging-db-dumps"
    $required = @("runtime.schema.sql.gz", "governance.schema.sql.gz", "persistence.schema.sql.gz")
    $missing = @($required | Where-Object { -not (Test-Path (Join-Path $dumpDir $_)) })
    $available = (Test-Path $dumpDir) -and ($missing.Count -eq 0)
    if (-not $available) {
        if ($RequireSchemaBundle -or $ApplySchemaBundle) { Fail "Schema bundle is required but missing from $dumpDir" }
        Write-Host "No local schema-only bundle found; databases remain fresh and no migration or database mutation is performed."
        return "skipped_no_schema_bundle"
    }

    $bundleManifestPath = Join-Path $dumpDir "staging-schema-bundle-manifest.json"
    if (-not (Test-Path -LiteralPath $bundleManifestPath -PathType Leaf)) {
        if ($RequireSchemaBundle -or $ApplySchemaBundle) { Fail "Schema bundle is required but missing from $dumpDir" }
        Write-StagingLog -Level info -Component $LogComponent -Stage "schema-bundle" -Message "no complete local schema-only bundle found; leaving recovered Staging databases unchanged" -Data @{ missing_artifacts = @("staging-schema-bundle-manifest.json") }
        return "skipped_no_schema_bundle"
    }
    try { $bundleManifest = Get-Content -Raw -LiteralPath $bundleManifestPath | ConvertFrom-Json }
    catch {
        if ($RequireSchemaBundle -or $ApplySchemaBundle) { Fail "Schema bundle manifest is invalid JSON: $bundleManifestPath" }
        Write-StagingLog -Level warning -Component $LogComponent -Stage "schema-bundle" -Message "local schema-only bundle manifest is invalid; skipping optional bundle validation" -Data @{ expected_commit = $Sha; manifest = $bundleManifestPath }
        return "skipped_invalid_schema_bundle"
    }
    $bundleContract = if ($bundleManifest.PSObject.Properties.Name -contains "contract") { [string]$bundleManifest.contract } else { "" }
    $bundleSourceCommit = if ($bundleManifest.PSObject.Properties.Name -contains "source_commit") { ([string]$bundleManifest.source_commit).Trim().ToLowerInvariant() } else { "" }
    $expectedSha = $Sha.ToLowerInvariant()
    if ($bundleContract -ne "mad4b.staging.schema-bundle-output.v1") {
        if ($RequireSchemaBundle -or $ApplySchemaBundle) { Fail "Schema bundle manifest contract is unsupported: $bundleContract" }
        Write-StagingLog -Level warning -Component $LogComponent -Stage "schema-bundle" -Message "local schema-only bundle contract is unsupported; skipping optional bundle validation" -Data @{ expected_commit = $expectedSha; observed_commit = $bundleSourceCommit; contract = $bundleContract }
        return "skipped_incompatible_schema_bundle"
    }
    if ($bundleSourceCommit -ne $expectedSha) {
        if ($RequireSchemaBundle -or $ApplySchemaBundle) { Fail "Schema bundle manifest is not bound to ExpectedCommit: expected=$expectedSha observed=$bundleSourceCommit" }
        Write-StagingLog -Level warning -Component $LogComponent -Stage "schema-bundle" -Message "local schema-only bundle is stale for the exact commit; skipping optional bundle validation" -Data @{ expected_commit = $expectedSha; observed_commit = $bundleSourceCommit; contract = $bundleContract }
        return "skipped_stale_schema_bundle"
    }

    $clone = Join-Path $ScriptRoot "Clone-StagingDatabases.ps1"
    $cloneArgs = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $clone, "-DumpDirectory", $dumpDir, "-ExpectedCommit", $Sha, "-Mode", "schema_only")
    if ($ApplySchemaBundle) {
        $cloneArgs += "-Apply"
        Invoke-Native "powershell.exe" $cloneArgs
        return "schema_only_applied"
    }
    Invoke-Native "powershell.exe" $cloneArgs
    Write-Host "Schema bundle found and validated in dry-run mode. Use -ApplySchemaBundle for explicit local Staging database mutation."
    return "schema_only_dry_run"
}

function Read-SchemaImportState([string]$ScriptRoot, [string]$Sha) {
    $statePath = Join-Path $ScriptRoot "staging-db-dumps\schema-import-state.json"
    if (-not (Test-Path -LiteralPath $statePath)) { Fail "Schema import state is missing after explicit apply: $statePath" }
    try { $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } catch { Fail "Schema import state is invalid: $statePath" }
    if ([string]$state.status -ne "completed") { Fail "Schema import did not complete: $($state.status)" }
    if ([string]$state.source_commit -ne $Sha.ToLowerInvariant()) { Fail "Schema import source commit mismatch" }
    if ([string]$state.mode -ne "schema_only" -or $state.post_import_role_table_verification -ne $true) { Fail "Schema import verification evidence is incomplete" }
    if ([string]$state.canonical_seed_status -ne "completed" -or [string]$state.canonical_seed_readback.status -ne "passed") { Fail "Canonical seed/readback evidence is incomplete" }
    if ($state.production_accessed -ne $false -or $state.provider_accessed -ne $false) { Fail "Schema import safety evidence is not fail-closed" }
    return $state
}

function Invoke-StagingRecertification([string]$RepoPath, [string]$Sha) {
    $certification = Join-Path $RepoPath "autopilot-portable-staging\Invoke-StagingCertification.ps1"
    $runtimeState = Join-Path $RepoPath "autopilot-portable-staging\autopilot-state.json"
    if (-not (Test-Path -LiteralPath $certification)) { Fail "Invoke-StagingCertification.ps1 is missing" }
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $certification, "-RepositoryPath", $RepoPath, "-ExpectedCommit", $Sha, "-Ref", $Ref, "-StatePath", $runtimeState)
    if (-not $NoTunnel) { $args += "-StartTunnel" }
    Invoke-Native "powershell.exe" $args
}

function Read-RuntimeCertificationState([string]$RepoPath, [string]$Sha) {
    $statePath = Join-Path $RepoPath "autopilot-portable-staging\autopilot-state.json"
    if (-not (Test-Path -LiteralPath $statePath)) { Fail "Auto Pilot runtime state is missing: $statePath" }
    try { $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json }
    catch { Fail "Auto Pilot runtime state is invalid" }
    if ([string]$state.commit -ne $Sha) { Fail "Auto Pilot runtime state commit mismatch" }
    if ([string]$state.certified_commit -and ([string]$state.certified_commit).ToLowerInvariant() -ne $Sha) { Fail "Auto Pilot certified commit mismatch" }
    if ([string]$state.certification_status -notin @("ready", "degraded")) { Fail "Auto Pilot runtime certification status is invalid" }
    return $state
}

function Install-AutoDeploy([string]$RepoPath) {
    $installer = Join-Path $RepoPath "autopilot-portable-staging\Install-AutoDeployTask.ps1"
    if (-not (Test-Path $installer)) { Fail "Install-AutoDeployTask.ps1 is missing" }
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installer, "-RepositoryPath", $RepoPath, "-PollSeconds", "$PollSeconds", "-BuildMode", $BuildMode)
    if (-not $NoTunnel) { $args += "-StartTunnel" }
    Invoke-Native "powershell.exe" $args
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Ref -ne "main") { Fail "One-click Auto Pilot is main-only" }
if ($PollSeconds -lt 60) { Fail "PollSeconds must be at least 60" }
if ($EligibilityWaitSeconds -lt 60) { Fail "EligibilityWaitSeconds must be at least 60" }
if ($EligibilityNoRunGraceSeconds -lt 60) { Fail "EligibilityNoRunGraceSeconds must be at least 60" }
if ($EligibilityNoRunGraceSeconds -gt $EligibilityWaitSeconds) { Fail "EligibilityNoRunGraceSeconds cannot exceed EligibilityWaitSeconds" }
$repo = Resolve-Repository $scriptRoot
$envFile = $null
# On an existing checkout, create the ignored Staging env before prerequisite checks so a missing gh/docker/WSL dependency never hides the env boundary.
if (Test-Path (Join-Path $repo ".git")) {
    try { Assert-StagingOriginIdentity $repo $ExpectedRepository }
    catch { Fail $_.Exception.Message }
    $envFile = Initialize-Environment $repo $scriptRoot
    Write-EarlyBootstrapLog "staging environment initialized before prerequisite checks"
}
Ensure-Prerequisites
Ensure-Repository $repo
try { Assert-StagingOriginIdentity $repo $ExpectedRepository }
catch { Fail $_.Exception.Message }
if (-not $SkipBootstrap) { Invoke-BootstrapSync $repo }
if ([string]::IsNullOrWhiteSpace([string]$envFile)) { $envFile = Initialize-Environment $repo $scriptRoot }

if ($Mode -eq "Stop") {
    $start = Join-Path $repo "autopilot-portable-staging\Start-AutoPilot.ps1"
    Invoke-Native "powershell.exe" @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $start, "-RepositoryPath", $repo, "-RepositoryUrl", $RepositoryUrl, "-ExpectedRepository", $ExpectedRepository, "-Ref", $Ref, "-ExpectedCommit", (Get-MainSha $repo), "-Stop")
    Write-Host "AUTO_PILOT_STOPPED: local Staging stopped; no Production or provider mutation performed."
    return
}

$sha = Get-MainSha $repo
Write-StagingLog -Level info -Component $LogComponent -Stage "eligibility" -Message "resolved main commit; waiting for eligibility" -Data @{ sha = $sha }
Wait-Eligibility $sha
Write-StagingOperationBoundary -Component $LogComponent -Stage "eligibility" -Outcome "success" -Message "Staging Main Deploy Eligibility passed" -Data @{ sha = $sha }
if ($Mode -eq "Validate") {
    $start = Join-Path $repo "autopilot-portable-staging\Start-AutoPilot.ps1"
    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $start, "-RepositoryPath", $repo, "-RepositoryUrl", $RepositoryUrl, "-ExpectedRepository", $ExpectedRepository, "-Ref", $Ref, "-ExpectedCommit", $sha, "-BuildMode", $BuildMode, "-ValidateOnly")
    if (-not $NoTunnel) { $args += "-StartTunnel" }
    Invoke-Native "powershell.exe" $args
    Write-Host "AUTO_PILOT_VALIDATED: commit=$sha tunnel=$(-not $NoTunnel)"
    return
}

Start-LocalStaging $repo $sha $envFile
$databaseState = Seed-SchemaIfAvailable $repo $scriptRoot $sha
$schemaImportState = $null
if ($databaseState -eq "schema_only_applied") {
    $schemaImportState = Read-SchemaImportState $scriptRoot $sha
    Write-StagingLog -Level info -Component $LogComponent -Stage "database-seed" -Message "explicit Staging schema seed completed; re-certifying same exact commit" -Data @{ sha = $sha }
    Invoke-StagingRecertification $repo $sha
}
$runtimeState = Read-RuntimeCertificationState $repo $sha
if ($EnableActivationGateway) {
    $activationBlockers = @($runtimeState.certification_degraded_reasons | ForEach-Object { [string]$_ }) | Where-Object { $_ -in @("gateway_policy_not_stale", "gateway_policy_hash_current", "gateway_exact_commit", "mcp_catalog_schema_ready", "combined_database_readiness", "governance_db_privilege_ready") }
    if ($activationBlockers.Count -gt 0 -or [string]$runtimeState.certification_status -ne "ready") {
        Fail "Activation Gateway cannot be enabled until schema/catalog/gateway readback is ready: $($activationBlockers -join ',')"
    }
}
if (-not $NoAutoDeploy) { Install-AutoDeploy $repo }
$statePath = Join-Path $scriptRoot "one-click-state.json"
$schemaSeedApplied = $databaseState -eq "schema_only_applied"
@{
    commit = $sha
    repository = $ExpectedRepository
    repository_path = $repo
    tunnel_started = (-not $NoTunnel)
    auto_deploy_installed = (-not $NoAutoDeploy)
    database_seed = $databaseState
    staging_schema_seed_applied = $schemaSeedApplied
    certification_contract = [string]$runtimeState.certification_contract
    certification_status = [string]$runtimeState.certification_status
    certification_ready = ($runtimeState.certification_ready -eq $true)
    certified_commit = [string]$runtimeState.certified_commit
    certified_branch = [string]$runtimeState.certified_branch
    certification_degraded_reasons = @($runtimeState.certification_degraded_reasons)
    database_readiness = [string]$runtimeState.database_readiness
    schema_import_contract = if ($null -ne $schemaImportState) { [string]$schemaImportState.contract } else { "not_applied" }
    schema_import_status = if ($null -ne $schemaImportState) { [string]$schemaImportState.status } else { "not_applied" }
    schema_import_source_commit = if ($null -ne $schemaImportState) { [string]$schemaImportState.source_commit } else { "not_applied" }
    schema_import_role_table_verification = if ($null -ne $schemaImportState) { ($schemaImportState.post_import_role_table_verification -eq $true) } else { $false }
    canonical_seed_status = if ($null -ne $schemaImportState) { [string]$schemaImportState.canonical_seed_status } else { "not_applied" }
    canonical_seed_files = if ($null -ne $schemaImportState) { @($schemaImportState.canonical_seed_files) } else { @() }
    canonical_seed_readback = if ($null -ne $schemaImportState) { $schemaImportState.canonical_seed_readback } else { @{ status = "not_applied" } }
    migration_applied = $false
    database_mutated = $schemaSeedApplied
    production_deploy = $false
    cloudflare_dns_mutation = $false
    hostinger_mutation = $false
    provider_mutation = $false
    ruleset_mutation = $false
    secrets_included = $false
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -LiteralPath $statePath
if ($runtimeState.certification_status -eq "degraded") {
    Write-StagingLog -Level warning -Component $LogComponent -Stage "complete" -Message "one-click Staging is running but not release-ready" -Data @{ sha = $sha; degraded_reasons = @($runtimeState.certification_degraded_reasons); database_seed = $databaseState }
    Write-Host "AUTO_PILOT_ONE_CLICK_DEGRADED: staging=$repo commit=$sha reasons=$(@($runtimeState.certification_degraded_reasons) -join ',')" -ForegroundColor Yellow
} else {
    Write-Host "AUTO_PILOT_ONE_CLICK_READY: staging=$repo commit=$sha tunnel=$(-not $NoTunnel) activation_gateway=$EnableActivationGateway auto_deploy=$(-not $NoAutoDeploy) database_seed=$databaseState" -ForegroundColor Green
}
Write-Host "URLs: https://dev.mad4b.com | https://mcp_dev.mad4b.com"
Write-Host "OpenAPI: Tenant/Admin on dev.mad4b.com; Remote MCP on mcp_dev.mad4b.com"
Write-StagingOperationBoundary -Component $LogComponent -Stage "complete" -Outcome "success" -Message "one-click staging completed" -Data @{ sha = $sha; repository_path = $repo; database_seed = $databaseState; activation_gateway = [bool]$EnableActivationGateway; certification_status = $runtimeState.certification_status }
Write-Host "AUTO_PILOT_LOG: $(Get-StagingLogRoot)"
