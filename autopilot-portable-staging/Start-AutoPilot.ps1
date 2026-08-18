[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$RepositoryUrl = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    [string]$ExpectedRepository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    [string]$Ref = "main",
    [string]$ExpectedCommit = "",
    [switch]$StartTunnel,
    [switch]$ValidateOnly,
    [switch]$Stop,
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart",
    [switch]$SkipBuild,
    [switch]$SkipSelfUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$WindowsPreflightPath = Join-Path $PSScriptRoot "Staging-Windows-Preflight.ps1"
$GitSafetyPath = Join-Path $PSScriptRoot "Staging-GitSafety.ps1"
if (-not (Test-Path -LiteralPath $WindowsPreflightPath)) { throw "Missing shared Windows preflight helper: $WindowsPreflightPath" }
if (-not (Test-Path -LiteralPath $GitSafetyPath)) { throw "Missing shared Git safety helper: $GitSafetyPath" }
. $WindowsPreflightPath
. $GitSafetyPath
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
        Write-StagingLog -Level warning -Component $LogComponent -Stage "health:$Service" -Message "service diagnostics collection failed" -Data @{ service = $Service; error = $_.Exception.Message }
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
function Ensure-EnvDefault([string]$Path, [string]$Name, [string]$Value) {
    $text = Get-Content -LiteralPath $Path -Raw
    $pattern = "(?im)^$([regex]::Escape($Name))=.*$"
    $matches = [regex]::Matches($text, $pattern)
    if ($matches.Count -gt 1) { Fail "Duplicate environment key is forbidden: $Name" }
    if ($matches.Count -eq 0) {
        $text = $text.TrimEnd() + "`r`n$Name=$Value`r`n"
    } elseif ([string]::IsNullOrWhiteSpace(($matches[0].Value -replace "^[^=]+=", ""))) {
        $text = [regex]::Replace($text, $pattern, "$Name=$Value", 1)
    }
    Write-StagingUtf8NoBom $Path $text
}
function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
    if ($Value -match '[\r\n]') { Fail "Invalid newline in environment value: $Name" }
    $text = Get-Content -LiteralPath $Path -Raw
    $pattern = "(?im)^$([regex]::Escape($Name))=.*$"
    $matches = [regex]::Matches($text, $pattern)
    if ($matches.Count -gt 1) { Fail "Duplicate environment key is forbidden: $Name" }
    if ($matches.Count -eq 0) {
        $text = $text.TrimEnd() + "`r`n$Name=$Value`r`n"
    } else {
        $text = [regex]::Replace($text, $pattern, "$Name=$Value", 1)
    }
    Write-StagingUtf8NoBom $Path $text
}
function Invoke-SelfUpdate {
    if ($SkipSelfUpdate) { return }
    $targetCommit = $ExpectedCommit.ToLowerInvariant()
    Push-Location $RepositoryPath
    try {
        Assert-StagingOriginIdentity $RepositoryPath $ExpectedRepository
        Quarantine-KnownBackupFiles $RepositoryPath
        Repair-ManifestLineEndings $RepositoryPath
        $dirty = @(git status --porcelain --untracked-files=all)
        if ($dirty.Count -gt 0) { Fail "Working tree is not clean; refusing bootstrap checkout before Auto Pilot self-update" }
        Invoke-Native "git" @("fetch", "origin", $Ref, "--depth=1")
        $remoteCommit = Get-NativeText "git" @("rev-parse", "origin/$Ref")
        if ($remoteCommit.ToLowerInvariant() -ne $targetCommit) { Fail "Self-update pinned commit mismatch: origin/$Ref resolved to $remoteCommit, expected $ExpectedCommit" }
        $currentCommit = Get-NativeText "git" @("rev-parse", "HEAD")
        if ($currentCommit.ToLowerInvariant() -ne $targetCommit) {
            Invoke-Native "git" @("checkout", "--detach", $ExpectedCommit)
        }
        $checkedOut = Get-NativeText "git" @("rev-parse", "HEAD")
        if ($checkedOut.ToLowerInvariant() -ne $targetCommit) { Fail "Self-update checkout readback mismatch" }
    } finally {
        Pop-Location
    }

    $reloadedScript = Join-Path $RepositoryPath "autopilot-portable-staging\Start-AutoPilot.ps1"
    if (-not (Test-Path -LiteralPath $reloadedScript)) { Fail "Self-update target script is missing: $reloadedScript" }
    $reloadedText = Get-Content -Raw -LiteralPath $reloadedScript
    foreach ($marker in @("prepare-staging-build-context.mjs", "STAGING_BUILD_TREE", "STAGING_BUILD_CONTEXT_FILE_SET_SHA256")) {
        if (-not $reloadedText.Contains($marker)) { Fail "Self-update target script is missing required provenance marker: $marker" }
    }
    Write-StagingOperationBoundary -Component $LogComponent -Stage "bootstrap-sync" -Outcome "success" -Message "reloaded exact-commit Auto Pilot before local execution" -Data @{ sha = $targetCommit; secrets_included = $false }

    $childBuildMode = if ($SkipBuild) { "Smart" } else { $BuildMode }
    $childArgs = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $reloadedScript,
        "-RepositoryPath", $RepositoryPath, "-RepositoryUrl", $RepositoryUrl, "-ExpectedRepository", $ExpectedRepository, "-Ref", $Ref,
        "-ExpectedCommit", $ExpectedCommit, "-BuildMode", $childBuildMode, "-SkipSelfUpdate"
    )
    if ($StartTunnel) { $childArgs += "-StartTunnel" }
    if ($ValidateOnly) { $childArgs += "-ValidateOnly" }
    if ($Stop) { $childArgs += "-Stop" }
    if ($SkipBuild) { $childArgs += "-SkipBuild" }
    & powershell.exe @childArgs
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { Fail "Reloaded Start-AutoPilot.ps1 exited with code $exitCode" }
    exit 0
}

function Test-ExactStagingImage([string]$ImageId, [string]$ExpectedCommit, [string]$ExpectedTree, [string]$ExpectedContextFileSet) {
    if ($ImageId -notmatch '^sha256:[0-9a-fA-F]{64}$') { return $false }
    if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$' -or $ExpectedTree -notmatch '^[0-9a-fA-F]{40}$' -or $ExpectedContextFileSet -notmatch '^[0-9a-fA-F]{64}$') { return $false }
    try {
        $labelsJson = (& docker image inspect --format '{{json .Config.Labels}}' $ImageId 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($labelsJson) -or $labelsJson -eq "null") { return $false }
        $labels = $labelsJson | ConvertFrom-Json
        $inspectedId = (& docker image inspect --format '{{.Id}}' $ImageId 2>$null | Out-String).Trim().ToLowerInvariant()
        if ($LASTEXITCODE -ne 0 -or $inspectedId -ne $ImageId.ToLowerInvariant()) { return $false }
        return ([string]$labels.'org.mad4b.staging.provenance.contract' -eq "mad4b.staging-build-provenance.v1" -and
            [string]$labels.'org.mad4b.staging.build.commit' -eq $ExpectedCommit.ToLowerInvariant() -and
            [string]$labels.'org.mad4b.staging.build.tree' -eq $ExpectedTree.ToLowerInvariant() -and
            [string]$labels.'org.mad4b.staging.build.context_file_set_sha256' -eq $ExpectedContextFileSet.ToLowerInvariant() -and
            [string]$labels.'org.mad4b.staging.build.secrets_included' -eq "false")
    } catch {
        return $false
    }
}
function Find-ExactStagingImageId([string]$ExpectedCommit, [string]$ExpectedTree, [string]$ExpectedContextFileSet, [string]$EnvPath) {
    $candidateIds = @()
    $fromEnvLine = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match '^STAGING_APP_IMAGE_ID=(.*)$' } | Select-Object -First 1
    if ($fromEnvLine) {
        $fromEnv = ($fromEnvLine -replace '^STAGING_APP_IMAGE_ID=', '').Trim().ToLowerInvariant()
        if ($fromEnv -match '^sha256:[0-9a-f]{64}$') { $candidateIds += $fromEnv }
    }
    $labelQuery = (Get-NativeText "docker" @("image", "ls", "--no-trunc", "--filter", "label=org.mad4b.staging.provenance.contract=mad4b.staging-build-provenance.v1", "--format", "{{.ID}}")).Trim()
    $candidateIds += @($labelQuery -split "\s+" | Where-Object { $_ -match '^sha256:[0-9a-fA-F]{64}$' })
    foreach ($candidate in @($candidateIds | Select-Object -Unique)) {
        if (Test-ExactStagingImage ([string]$candidate) $ExpectedCommit $ExpectedTree $ExpectedContextFileSet) { return ([string]$candidate).ToLowerInvariant() }
    }
    return ""
}
function Quarantine-KnownBackupFiles([string]$RepoPath) {
    $backupRoot = Join-Path $env:USERPROFILE "MAD4B-Staging-Backups"
    $backupFiles = @(Get-ChildItem -LiteralPath (Join-Path $RepoPath "autopilot-portable-staging") -Filter "*.backup" -File -ErrorAction SilentlyContinue)
    foreach ($file in $backupFiles) {
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        $destination = Join-Path $backupRoot ("{0}-{1}{2}" -f $file.BaseName, (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss"), $file.Extension)
        Move-Item -LiteralPath $file.FullName -Destination $destination -Force
        Write-StagingLog -Level warning -Component $LogComponent -Stage "working-tree" -Message "quarantined known AutoPilot backup outside repository" -Data @{ source = $file.Name; destination = $destination }
    }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($SkipBuild) {
    if ($BuildMode -ne "Smart") { Fail "-SkipBuild cannot be combined with an explicit BuildMode" }
    $BuildMode = "SkipBuild"
}
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
$CertificationScript = Join-Path $scriptRoot "Invoke-StagingCertification.ps1"
$BuildContextScript = Join-Path $ApiPath "scripts/prepare-staging-build-context.mjs"
$BuildContextPath = Join-Path $RepositoryPath ".staging-build-context"

Require-Command "git"
if (-not (Test-Path $ComposeBase) -or -not (Test-Path $ComposeStage) -or -not (Test-Path $EnvExample)) {
    if ([string]::IsNullOrWhiteSpace($RepositoryUrl)) { Fail "Repository files are missing and RepositoryUrl is empty" }
    New-Item -ItemType Directory -Force -Path $RepositoryPath | Out-Null
    if (-not (Test-Path (Join-Path $RepositoryPath ".git"))) {
        Invoke-Native "git" @("clone", "--filter=blob:none", "--no-checkout", $RepositoryUrl, $RepositoryPath)
    }
}

if (-not (Test-Path (Join-Path $RepositoryPath ".git"))) { Fail "RepositoryPath is not a Git repository: $RepositoryPath" }
Assert-StagingOriginIdentity $RepositoryPath $ExpectedRepository
if (-not (Test-Path -LiteralPath $CertificationScript)) { Fail "Staging certification helper is missing: $CertificationScript" }
Assert-Sha $ExpectedCommit
Invoke-SelfUpdate
Require-Command "docker"
Require-Command "wsl"

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
    Quarantine-KnownBackupFiles $RepositoryPath
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
    if (-not (Test-Path $BuildContextScript)) { Fail "Exact Git build context generator is missing: $BuildContextScript" }
    $buildTree = Get-NativeText "git" @("rev-parse", "$ExpectedCommit^{tree}")
    if ($buildTree -notmatch '^[0-9a-fA-F]{40}$') { Fail "Pinned commit tree readback is not an exact SHA" }
    Invoke-Native "node" @($BuildContextScript, "--repository-path", $RepositoryPath, "--commit", $ExpectedCommit.ToLowerInvariant(), "--output-dir", $BuildContextPath)
    $buildContextMetadataPath = Join-Path $BuildContextPath ".staging-build-context.json"
    if (-not (Test-Path $buildContextMetadataPath)) { Fail "Exact Git build context provenance metadata is missing" }
    try { $buildContextMetadata = Get-Content -Raw -LiteralPath $buildContextMetadataPath | ConvertFrom-Json } catch { Fail "Exact Git build context provenance metadata is invalid" }
    if ([string]$buildContextMetadata.commit_sha -ne $ExpectedCommit.ToLowerInvariant() -or [string]$buildContextMetadata.tree_sha -ne $buildTree.ToLowerInvariant() -or [string]$buildContextMetadata.source -ne "git_archive_exact_commit" -or $buildContextMetadata.local_ignored_files_included -ne $false -or $buildContextMetadata.secrets_included -ne $false) { Fail "Exact Git build context provenance did not converge" }

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
        Write-StagingUtf8NoBom $EnvFile $envText
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
        "TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET" = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
    }
    $envText = Get-Content -Raw $EnvFile
    foreach ($key in $generatedLocalSecrets.Keys) {
        if ($envText -notmatch "(?im)^$([regex]::Escape($key))=") {
            $envText = $envText.TrimEnd() + "`r`n$key=$($generatedLocalSecrets[$key])`r`n"
        } elseif ($envText -match "(?im)^$([regex]::Escape($key))=\s*$" -or $envText -match "(?im)^$([regex]::Escape($key))=local_[^\r\n]*change_me\s*$") {
            $envText = [regex]::Replace($envText, "(?im)^$([regex]::Escape($key))=.*$", "$key=$($generatedLocalSecrets[$key])")
        }
    }
    Write-StagingUtf8NoBom $EnvFile $envText
    Ensure-EnvDefault $EnvFile "TENANT_GPT_STAGING_OAUTH_CLIENT_ID" "mad4b-tenant-gpt-staging"
    Ensure-EnvDefault $EnvFile "TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED" "true"
    Ensure-EnvDefault $EnvFile "ACTIVATION_STAGING_GATEWAY_ENABLED" "false"
    Ensure-EnvDefault $EnvFile "ACTIVATION_HOST_GATEWAY_HOST" "activation-dev.mad4b.com"
    Ensure-EnvDefault $EnvFile "ACTIVATION_STAGING_AUTH_HOST" "activation-dev.mad4b.com"
    # Keep runtime deployment readback bound to the immutable commit selected above.
    Set-EnvValue $EnvFile "DEPLOYMENT_EXPECTED_COMMIT_SHA" $ExpectedCommit
    Set-EnvValue $EnvFile "DEPLOY_COMMIT" $ExpectedCommit
    Set-EnvValue $EnvFile "DEPLOY_BRANCH" $Ref
    Set-EnvValue $EnvFile "STAGING_BUILD_CONTEXT" (([IO.Path]::GetFullPath($BuildContextPath)) -replace '\\','/')
    Set-EnvValue $EnvFile "STAGING_BUILD_TREE" $buildTree.ToLowerInvariant()
    Set-EnvValue $EnvFile "STAGING_BUILD_CONTEXT_FILE_SET_SHA256" ([string]$buildContextMetadata.context_file_set_sha256)
    Assert-UniqueEnvKeys $EnvFile
    $effectiveEnv = Get-Content -Raw $EnvFile
    if ($effectiveEnv -match '(?im)^CLOUDFLARE_TUNNEL_TOKEN=\s*$' -and $StartTunnel) { Fail "StartTunnel requested but CLOUDFLARE_TUNNEL_TOKEN is empty" }
    if ($effectiveEnv -notmatch '(?im)^MIGRATION_APPLIED=false\s*$' -or $effectiveEnv -notmatch '(?im)^DATABASE_MUTATED=false\s*$') { Fail "Mutation safety flags must be present and exactly false" }
    if ($StartTunnel -and (Read-EnvValue $EnvFile "TENANT_GPT_STAGING_ENABLED") -eq "true" -and [string]::IsNullOrWhiteSpace((Read-EnvValue $EnvFile "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET"))) { Fail "StartTunnel requires TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET when Staging GPT is enabled" }
    if ($StartTunnel -and (Read-EnvValue $EnvFile "REMOTE_MCP_ENABLED") -eq "true" -and (Read-EnvValue $EnvFile "REMOTE_MCP_OAUTH_ENABLED") -eq "true" -and [string]::IsNullOrWhiteSpace((Read-EnvValue $EnvFile "REMOTE_MCP_OAUTH_SIGNING_SECRET"))) { Fail "StartTunnel requires REMOTE_MCP_OAUTH_SIGNING_SECRET when Staging MCP OAuth is enabled" }
    $activationGatewayEnabled = (Read-EnvValue $EnvFile "ACTIVATION_STAGING_GATEWAY_ENABLED").ToLowerInvariant() -eq "true"
    if ($activationGatewayEnabled -and [string]::IsNullOrWhiteSpace((Read-EnvValue $EnvFile "TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET"))) { Fail "Activation Staging Gateway requires TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET" }
    if ($effectiveEnv -notmatch '(?im)^TENANT_GPT_SSO_COOKIE_MODE=host_only\s*$') { Fail "Staging SSO cookie mode must be host_only" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp_dev\.mad4b\.com\s*$') { Fail "Staging Tunnel requires exactly dev.mad4b.com and mcp_dev.mad4b.com; Activation uses a separate Worker custom domain" }
    if ($activationGatewayEnabled -and (Read-EnvValue $EnvFile "ACTIVATION_HOST_GATEWAY_HOST") -ne "activation-dev.mad4b.com") { Fail "Activation Staging Gateway must use activation-dev.mad4b.com as its Worker custom domain" }
    if ($activationGatewayEnabled -and (Read-EnvValue $EnvFile "ACTIVATION_STAGING_AUTH_HOST") -ne "activation-dev.mad4b.com") { Fail "Activation Staging OAuth host must be activation-dev.mad4b.com" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_ORIGIN_APP=http://app:8080\s*$') { Fail "Staging tunnel origin must be exactly http://app:8080" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_LOGLEVEL=info\s*$') { Fail "Staging tunnel loglevel must remain info; debug may expose request headers" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_GRACE_PERIOD=30s\s*$') { Fail "Staging tunnel grace period must remain 30s" }
    if ($effectiveEnv -match '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=.*(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com)') { Fail "Forbidden Production hostname found in staging tunnel list" }

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
    $existingImageId = Find-ExactStagingImageId $ExpectedCommit $buildTree $buildContextMetadata.context_file_set_sha256 $EnvFile
    $imageReused = $false
    $buildAction = "built"
    $imageMatchesExactProvenance = $existingImageId -match '^sha256:[0-9a-f]{64}$'
    if ($BuildMode -eq "Smart" -and $imageMatchesExactProvenance) {
        $imageReused = $true
        $buildAction = "reused_exact_provenance"
        Write-StagingOperationBoundary -Component $LogComponent -Stage "compose-build" -Outcome "success" -Message "reused exact Staging image; build skipped" -Data @{ mode = $BuildMode; image_id = $existingImageId; commit = $ExpectedCommit; tree = $buildTree; context_file_set_sha256 = [string]$buildContextMetadata.context_file_set_sha256; secrets_included = $false }
    } elseif ($BuildMode -eq "SkipBuild") {
        Fail "SkipBuild requested but no local app image matches exact commit/tree/context provenance"
    } else {
        if ($BuildMode -eq "ForceBuild") { $buildAction = "forced_build" }
        Write-StagingLog -Level info -Component $LogComponent -Stage "compose-build" -Message "building Staging app from exact Git context" -Data @{ mode = $BuildMode; previous_image_id = $existingImageId; previous_image_exact = [bool]$imageMatchesExactProvenance }
        Invoke-Native "docker" ($composeArgs + @("build", "app"))
    }
    $imageId = Find-ExactStagingImageId $ExpectedCommit $buildTree $buildContextMetadata.context_file_set_sha256 $EnvFile
    if ($imageId -notmatch '^sha256:[0-9a-fA-F]{64}$') { Fail "Staging app image ID is not a content-addressed sha256 digest with exact provenance" }
    Set-EnvValue $EnvFile "STAGING_APP_IMAGE_ID" $imageId.ToLowerInvariant()
    Assert-UniqueEnvKeys $EnvFile
    Invoke-Native "docker" ($composeArgs + @("config", "--quiet"))
    $upArgs = $composeArgs + @("up", "-d")
    Write-StagingLog -Level info -Component $LogComponent -Stage "compose-up" -Message "starting local application topology"
    Invoke-Native "docker" $upArgs
    foreach ($service in @("redis", "runtime-db", "governance-db", "persistence-db", "app")) { Wait-ServiceHealthy $composeArgs $service }
    if ($StartTunnel) {
        Write-StagingLog -Level info -Component $LogComponent -Stage "tunnel" -Message "starting explicitly enabled Staging tunnel"
        Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "up", "-d", "cloudflared"))
        Write-StagingOperationBoundary -Component $LogComponent -Stage "tunnel" -Outcome "success" -Message "Staging tunnel started" -Data @{ hostnames = "dev.mad4b.com,mcp_dev.mad4b.com" }
    }
    Invoke-Native "docker" ($composeArgs + @("ps"))

    $baseState = @{
        commit = $ExpectedCommit
        ref = $Ref
        docker_context = $context
        build_context_source = "git_archive_exact_commit"
        build_tree_sha = $buildTree.ToLowerInvariant()
        build_context_file_set_sha256 = [string]$buildContextMetadata.context_file_set_sha256
        app_image_digest = $imageId.ToLowerInvariant()
        build_mode = $BuildMode
        build_action = $buildAction
        image_reused = [bool]$imageReused
        tunnel_started = [bool]$StartTunnel
        certification_status = "pending"
        certification_ready = $false
        migration_applied = $false
        database_mutated = $false
        production_deploy = $false
        provider_mutation = $false
        ruleset_mutation = $false
        secrets_included = $false
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
    }
    Set-Content -Encoding utf8 $StateFile ($baseState | ConvertTo-Json -Depth 8)

    $certArgs = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $CertificationScript, "-RepositoryPath", $RepositoryPath, "-ExpectedCommit", $ExpectedCommit, "-Ref", $Ref, "-StatePath", $StateFile)
    if ($StartTunnel) { $certArgs += "-StartTunnel" }
    Write-StagingLog -Level info -Component $LogComponent -Stage "certification" -Message "same-cycle Staging certification started" -Data @{ commit = $ExpectedCommit; gateway_enabled = [bool]$activationGatewayEnabled }
    & powershell.exe @certArgs
    if ($LASTEXITCODE -ne 0) { Fail "Staging certification blocked exact commit $ExpectedCommit" }
    try { $certState = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json }
    catch { Fail "Staging certification state could not be read" }
    if ($certState.certification_status -eq "degraded") {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "certification" -Message "Staging is running but not release-ready" -Data @{ commit = $ExpectedCommit; degraded_reasons = @($certState.certification_degraded_reasons); database_readiness = $certState.database_readiness }
    } elseif ($certState.certification_status -eq "ready") {
        Write-StagingOperationBoundary -Component $LogComponent -Stage "certification" -Outcome "success" -Message "Staging exact commit certified ready" -Data @{ commit = $ExpectedCommit; database_readiness = $certState.database_readiness }
    } else {
        Fail "Unsupported Staging certification state: $($certState.certification_status)"
    }

    Write-Host "AUTO_PILOT_STARTED: local staging is running; tunnel=$StartTunnel; commit=$ExpectedCommit certification=$($certState.certification_status)"
    Write-StagingOperationBoundary -Component $LogComponent -Stage "complete" -Outcome "success" -Message "local Staging application operations completed" -Data @{ commit = $ExpectedCommit; tunnel_started = [bool]$StartTunnel; services = "redis,runtime-db,governance-db,persistence-db,app"; certification_status = $certState.certification_status }
    Write-Host "APP_OPERATIONS_LOG: $(Get-StagingLogRoot)"
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $BuildContextPath) { Remove-Item -LiteralPath $BuildContextPath -Recurse -Force -ErrorAction SilentlyContinue }
}