param(
    [string]$RepositoryPath = "",
    [string]$RepositoryUrl = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    [ValidateSet("main")]
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
    [switch]$InheritedRunLock
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bootstrapLogRoot = Join-Path $scriptRoot "logs"
$bootstrapFallbackLog = Join-Path $bootstrapLogRoot "bootstrap-console.log"
$oneClickScript = Join-Path $scriptRoot "One-Click-Staging.ps1"
$gitSafetyPath = Join-Path $scriptRoot "Staging-GitSafety.ps1"
if (-not (Test-Path -LiteralPath $gitSafetyPath)) { Fail "Staging-GitSafety.ps1 is missing: $gitSafetyPath" }
. $gitSafetyPath
$gitTransportPath = Join-Path $scriptRoot "Staging-GitTransport.ps1"
if (-not (Test-Path -LiteralPath $gitTransportPath)) { throw "Staging-GitTransport.ps1 is missing: $gitTransportPath" }
. $gitTransportPath

function Fail([string]$Message) {
    try {
        New-Item -ItemType Directory -Force -Path $bootstrapLogRoot | Out-Null
        $safe = $Message -replace '(?i)(TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*[^\s,;]+', '$1=REDACTED'
        Add-Content -LiteralPath $bootstrapFallbackLog -Encoding utf8 -Value ((Get-Date).ToUniversalTime().ToString("o") + " bootstrap fail-closed: " + $safe)
    } catch { }
    throw "AUTO_PILOT_BOOTSTRAP_FAIL_CLOSED: $Message"
}

$script:AutoPilotRunMutex = $null
function Acquire-AutoPilotRunLock {
    if ($InheritedRunLock) {
        Add-Content -LiteralPath $bootstrapFallbackLog -Encoding utf8 -Value ((Get-Date).ToUniversalTime().ToString("o") + " bootstrap inherited global Auto Pilot run lock")
        return
    }
    try {
        $script:AutoPilotRunMutex = New-Object System.Threading.Mutex($false, "Global\Mad4bPortableStagingAutoPilot")
        if (-not $script:AutoPilotRunMutex.WaitOne(0)) { Fail "Another Staging operation is already running; refusing overlapping bootstrap" }
    } catch [System.Threading.AbandonedMutexException] {
        Add-Content -LiteralPath $bootstrapFallbackLog -Encoding utf8 -Value ((Get-Date).ToUniversalTime().ToString("o") + " bootstrap recovered abandoned global Auto Pilot run lock")
    } catch {
        Fail "Unable to acquire global Auto Pilot run lock: $($_.Exception.Message)"
    }
}
function Release-AutoPilotRunLock {
    if ($null -ne $script:AutoPilotRunMutex) {
        try { $script:AutoPilotRunMutex.ReleaseMutex() } catch { }
        try { $script:AutoPilotRunMutex.Dispose() } catch { }
        $script:AutoPilotRunMutex = $null
    }
}

function Invoke-Git([string[]]$Arguments) {
    try {
        $result = Invoke-StagingGit $Arguments
        Add-Content -LiteralPath $bootstrapFallbackLog -Encoding utf8 -Value ((Get-Date).ToUniversalTime().ToString("o") + " bootstrap Git command completed attempts=" + $result.attempts)
    } catch {
        Fail $_.Exception.Message
    }
}

function Get-GitText([string[]]$Arguments) {
    try {
        $result = Invoke-StagingGit $Arguments
        Add-Content -LiteralPath $bootstrapFallbackLog -Encoding utf8 -Value ((Get-Date).ToUniversalTime().ToString("o") + " bootstrap Git read completed attempts=" + $result.attempts)
        return (($result.output | Out-String).Trim())
    } catch {
        Fail $_.Exception.Message
    }
}

trap {
    Release-AutoPilotRunLock
    throw
}

function Normalize-TextFileToLf([string]$Path) {
    $text = [System.IO.File]::ReadAllText($Path)
    $text = $text -replace "`r`n", "`n"
    $text = $text -replace "`r", "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
}

function Quarantine-KnownBackupFiles([string]$RepoPath) {
    $backupRoot = Join-Path $env:USERPROFILE "MAD4B-Staging-Backups"
    $backupFiles = @(Get-ChildItem -LiteralPath (Join-Path $RepoPath "autopilot-portable-staging") -Filter "*.backup" -File -ErrorAction SilentlyContinue)
    foreach ($file in $backupFiles) {
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        $destination = Join-Path $backupRoot ("{0}-{1}{2}" -f $file.BaseName, (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmssfff"), $file.Extension)
        Move-Item -LiteralPath $file.FullName -Destination $destination -Force
        Add-Content -LiteralPath $bootstrapFallbackLog -Encoding utf8 -Value ((Get-Date).ToUniversalTime().ToString("o") + " bootstrap quarantined known backup file: " + $file.Name)
    }
}

function Repair-ManifestLineEndings([string]$RepoPath) {
    $manifestPath = Join-Path $scriptRoot "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) { return }
    $manifestObject = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $trackedDirty = @(git diff --name-only)
    foreach ($relative in $trackedDirty) {
        $entry = $manifestObject.files | Where-Object { $_.path -eq ($relative -replace '\\','/') } | Select-Object -First 1
        if ($null -eq $entry) { continue }
        git diff --ignore-space-at-eol --quiet -- $relative
        if ($LASTEXITCODE -ne 0) { Fail "Protected file has content changes, not only line-ending drift: $relative" }
        Normalize-TextFileToLf (Join-Path $RepoPath $relative)
    }
    git update-index --really-refresh 2>$null | Out-Null
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Required command is missing: git" }
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $scriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git"))) { Fail "RepositoryPath is not a Git repository: $RepositoryPath" }
if (-not (Test-Path -LiteralPath $oneClickScript)) { Fail "One-Click-Staging.ps1 is missing: $oneClickScript" }
if ($SkipBuild -and $BuildMode -ne "Smart") { Fail "-SkipBuild cannot be combined with an explicit BuildMode" }
Acquire-AutoPilotRunLock

Push-Location $RepositoryPath
try {
    try { Assert-StagingOriginIdentity $RepositoryPath $ExpectedRepository }
    catch { Fail $_.Exception.Message }
    Quarantine-KnownBackupFiles $RepositoryPath
    Repair-ManifestLineEndings $RepositoryPath
    $dirty = @(git status --porcelain --untracked-files=all)
    if ($dirty.Count -gt 0) {
        Fail "Working tree is not clean; refusing bootstrap checkout. Review local changes before running Staging Auto Pilot."
    }
    Invoke-Git @("fetch", "origin", $Ref, "--depth=1")
    $remoteCommit = Get-GitText @("rev-parse", "origin/$Ref")
    if ($remoteCommit -notmatch '^[0-9a-fA-F]{40}$') { Fail "origin/$Ref did not resolve to an exact commit SHA" }
    Invoke-Git @("checkout", "--detach", $remoteCommit)
    $checkedOut = Get-GitText @("rev-parse", "HEAD")
    if ($checkedOut.ToLowerInvariant() -ne $remoteCommit.ToLowerInvariant()) { Fail "Bootstrap checkout readback mismatch" }
} finally {
    Pop-Location
}

$updatedOneClick = Get-Content -Raw -LiteralPath $oneClickScript
foreach ($marker in @("Start-AutoPilot.ps1", "BuildMode", "Staging Main Deploy Eligibility")) {
    if (-not $updatedOneClick.Contains($marker)) { Fail "Checked-out One-Click script is missing required contract marker: $marker" }
}
$updatedStart = Get-Content -Raw -LiteralPath (Join-Path $scriptRoot "Start-AutoPilot.ps1")
foreach ($marker in @("prepare-staging-build-context.mjs", "STAGING_BUILD_TREE", "STAGING_BUILD_CONTEXT_FILE_SET_SHA256")) {
    if (-not $updatedStart.Contains($marker)) { Fail "Checked-out Auto Pilot script is missing required provenance marker: $marker" }
}

$childArgs = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $oneClickScript,
    "-RepositoryPath", $RepositoryPath, "-RepositoryUrl", $RepositoryUrl, "-Ref", $Ref,
    "-ExpectedRepository", $ExpectedRepository, "-PollSeconds", "$PollSeconds",
    "-EligibilityWaitSeconds", "$EligibilityWaitSeconds", "-EligibilityNoRunGraceSeconds", "$EligibilityNoRunGraceSeconds",
    "-BuildMode", $BuildMode, "-SkipBootstrap", "-InheritedRunLock"
)
if ($NoTunnel) { $childArgs += "-NoTunnel" }
if ($EnableActivationGateway) { $childArgs += "-EnableActivationGateway" }
if ($NoAutoDeploy) { $childArgs += "-NoAutoDeploy" }
if ($RequireSchemaBundle) { $childArgs += "-RequireSchemaBundle" }
if ($ApplySchemaBundle) { $childArgs += "-ApplySchemaBundle" }
if ($SkipBuild) { $childArgs += "-SkipBuild" }

& powershell.exe @childArgs
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) { Fail "One-Click-Staging.ps1 exited with code $exitCode" }
Release-AutoPilotRunLock
exit 0
