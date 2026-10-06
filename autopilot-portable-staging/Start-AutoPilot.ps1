[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$RepositoryUrl = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    [string]$ExpectedRepository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    [string]$Ref = "main",
    [string]$ExpectedCommit = "",
    [switch]$EnableActivationGateway,
    [switch]$StartTunnel,
    [ValidateSet("disabled", "windows_service", "docker_sidecar")]
    [string]$TunnelMode = "disabled",
    [switch]$RequireSchemaBundle,
    [switch]$ApplySchemaBundle,
    [switch]$ValidateOnly,
    [switch]$Stop,
    [ValidateSet("Smart", "ForceBuild", "SkipBuild")]
    [string]$BuildMode = "Smart",
    [switch]$SkipBuild,
    [switch]$SkipSelfUpdate,
    [switch]$AllowGovernedReleaseCutAncestor,
    [int]$PromotionRequestPr = 0,
    [string]$PromotionRequestHeadSha = "",
    [string]$PromotionCandidateSha = "",
    [string]$PinnedProductionSha = "",
    [string]$GovernedResumeConfirmation = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($StartTunnel -and $TunnelMode -eq "disabled") { $TunnelMode = "windows_service" }
$TunnelSelected = $TunnelMode -ne "disabled"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$WindowsPreflightPath = Join-Path $PSScriptRoot "Staging-Windows-Preflight.ps1"
$GitSafetyPath = Join-Path $PSScriptRoot "Staging-GitSafety.ps1"
if (-not (Test-Path -LiteralPath $WindowsPreflightPath)) { throw "Missing shared Windows preflight helper: $WindowsPreflightPath" }
if (-not (Test-Path -LiteralPath $GitSafetyPath)) { throw "Missing shared Git safety helper: $GitSafetyPath" }
. $WindowsPreflightPath
. $GitSafetyPath
$GitTransportPath = Join-Path $PSScriptRoot "Staging-GitTransport.ps1"
if (-not (Test-Path -LiteralPath $GitTransportPath)) { throw "Missing shared Git transport helper: $GitTransportPath" }
. $GitTransportPath
$StagingCloudflaredPath = Join-Path $PSScriptRoot "Staging-WindowsCloudflared.ps1"
if (-not (Test-Path -LiteralPath $StagingCloudflaredPath)) { throw "Missing Staging Cloudflared helper: $StagingCloudflaredPath" }
. $StagingCloudflaredPath
$StagingEnvironmentPath = Join-Path $PSScriptRoot "Staging-Environment.ps1"
if (-not (Test-Path -LiteralPath $StagingEnvironmentPath)) { throw "Missing Staging environment helper: $StagingEnvironmentPath" }
. $StagingEnvironmentPath
$LogComponent = "app-operations"
Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "application operations process started" -Data @{ validate_only = [bool]$ValidateOnly; stop = [bool]$Stop; tunnel = [bool]$TunnelSelected; tunnel_mode = $TunnelMode; activation_gateway_desired = [bool]$EnableActivationGateway; require_schema_bundle = [bool]$RequireSchemaBundle; apply_schema_bundle = [bool]$ApplySchemaBundle }
trap {
    Write-StagingLog -Level error -Component $LogComponent -Stage "unhandled" -Message $_.Exception.Message -Data @{ error_type = $_.Exception.GetType().FullName }
    Write-Host "APP_OPERATIONS_FAILURE_LOGGED: $(Get-StagingLogRoot)" -ForegroundColor Red
    exit 1
}

function Fail([string]$Message, [hashtable]$Data = @{}) {
    Write-StagingLog -Level error -Component $LogComponent -Stage "fail_closed" -Message $Message -Data $Data
    throw "AUTO_PILOT_FAIL_CLOSED: $Message"
}

function Get-StagingComposeArgs([string]$ApiPath, [string]$EnvPath, [string]$Mode) {
    $arguments = @(
        "compose",
        "-f", (Join-Path $ApiPath "docker-compose.yml"),
        "-f", (Join-Path $ApiPath "docker-compose.staging.yml")
    )
    $override = switch ($Mode) {
        "windows_service" { Join-Path $ApiPath "docker-compose.staging.windows-service.yml" }
        "docker_sidecar" { Join-Path $ApiPath "docker-compose.staging.docker-sidecar.yml" }
        default { $null }
    }
    if ($null -ne $override) {
        if (-not (Test-Path -LiteralPath $override -PathType Leaf)) { Fail "Required Staging Compose topology override is missing: $override" }
        $arguments += @("-f", $override)
    }
    return @($arguments + @("--env-file", $EnvPath))
}

function Assert-WindowsHostOriginReachable([string[]]$ComposeArgs, [string]$Mode) {
    if ($Mode -ne "windows_service") { return }
    $origin = "http://127.0.0.1:8080/health"
    $published = (& docker @($ComposeArgs + @("port", "app", "8080")) 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $published -notmatch '^(?:127\.0\.0\.1|localhost):8080$') {
        Fail "Windows Staging host origin binding is missing from the effective Compose topology" @{ failure_class = "staging_origin_unreachable"; tunnel_mode = $Mode; origin = $origin; reason = "host_binding_missing"; observed_binding = $published }
    }
    try {
        Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
    } catch {
        Fail "Windows Staging host origin probe runtime is unavailable" @{ failure_class = "origin_probe_runtime_error"; tunnel_mode = $Mode; origin = $origin; reason = "http_client_runtime_unavailable"; error = $_.Exception.Message }
    }
    $lastError = ""
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        $client = $null
        try {
            $client = New-Object System.Net.Http.HttpClient
            $client.Timeout = [TimeSpan]::FromSeconds(10)
            $response = $client.GetAsync($origin).GetAwaiter().GetResult()
            if ($response.IsSuccessStatusCode) {
                Write-StagingOperationBoundary -Component $LogComponent -Stage "host-origin" -Outcome "success" -Message "Windows host can reach the loopback-only Staging origin" -Data @{ tunnel_mode = $Mode; origin = $origin; http_status = [int]$response.StatusCode; attempt = $attempt }
                $response.Dispose()
                $client.Dispose()
                return
            }
            $lastError = "http_status_$([int]$response.StatusCode)"
            $response.Dispose()
            $client.Dispose()
        } catch {
            if ($null -ne $client) { $client.Dispose() }
            $lastError = $_.Exception.Message
        }
        if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
    }
    Fail "Windows Staging host cannot reach the loopback-only app origin" @{ failure_class = "staging_origin_unreachable"; tunnel_mode = $Mode; origin = $origin; reason = "host_health_unreachable"; error = $lastError }
}

function Invoke-Native([string]$File, [string[]]$Arguments, [switch]$AllowFailure) {
    Write-Host ("> {0} {1}" -f $File, ($Arguments -join " "))
    Write-StagingOperationBoundary -Component $LogComponent -Stage "native:$File" -Outcome "start" -Message "application command started" -Data @{ command = $File; arguments = ($Arguments -join " ") }
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
        Write-StagingLog -Level error -Component $LogComponent -Stage "native:$File" -Message "application command failed" -Data @{ command = $File; exit_code = $code }
        Fail "$File exited with code $code"
    }
    Write-StagingOperationBoundary -Component $LogComponent -Stage "native:$File" -Outcome "success" -Message "application command completed" -Data @{ command = $File; exit_code = $code }
    return $code
}


function Invoke-StagingDockerBuild([string[]]$Arguments, [int]$MaxAttempts = 2) {
    if ($MaxAttempts -lt 1 -or $MaxAttempts -gt 3) { Fail "Docker build retry bound must remain between 1 and 3 attempts" }
    $transientFrontendPattern = '(?i)(frontend grpc server closed unexpectedly|rpc error: code = Unavailable|failed to receive status: rpc error|error reading from server: EOF)'

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        Write-Host ("> docker {0}" -f ($Arguments -join " "))
        Write-StagingOperationBoundary -Component $LogComponent -Stage "compose-build" -Outcome "start" -Message "Staging Docker build attempt started" -Data @{
            attempt = $attempt
            max_attempts = $MaxAttempts
            transient_retry_only = $true
        }

        $buildOutput = @()
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            # Windows PowerShell 5.1 surfaces native stderr records through the error stream.
            # Keep the script fail-closed globally, but prevent ordinary Docker stderr/progress
            # from terminating this capture window before we can classify the native exit code.
            $ErrorActionPreference = "Continue"
            & docker @Arguments 2>&1 |
                Tee-Object -Variable buildOutput |
                ForEach-Object { Write-Host ([string]$_) }
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $outputText = (($buildOutput | ForEach-Object { [string]$_ }) -join "`n")

        if ($code -eq 0) {
            Write-StagingOperationBoundary -Component $LogComponent -Stage "compose-build" -Outcome "success" -Message "Staging Docker build completed" -Data @{
                attempt = $attempt
                max_attempts = $MaxAttempts
                transient_recovered = [bool]($attempt -gt 1)
            }
            return [pscustomobject]@{
                attempts = $attempt
                transient_recovered = [bool]($attempt -gt 1)
            }
        }

        $transientFrontendFailure = [regex]::IsMatch($outputText, $transientFrontendPattern)
        $failureClass = if ($transientFrontendFailure) { "docker_buildkit_frontend_transient" } else { "docker_build_non_transient" }
        Write-StagingLog -Level ($(if ($transientFrontendFailure) { "warning" } else { "error" })) -Component $LogComponent -Stage "compose-build" -Message "Staging Docker build attempt failed" -Data @{
            attempt = $attempt
            max_attempts = $MaxAttempts
            exit_code = $code
            failure_class = $failureClass
            transient_frontend_failure = [bool]$transientFrontendFailure
        }

        if (-not $transientFrontendFailure) {
            Fail "Docker build failed without a retryable BuildKit frontend transport signature" @{
                failure_class = $failureClass
                attempt = $attempt
                exit_code = $code
            }
        }
        if ($attempt -ge $MaxAttempts) {
            Fail "Docker build failed after bounded BuildKit frontend retry" @{
                failure_class = $failureClass
                attempts = $attempt
                exit_code = $code
            }
        }

        Write-StagingLog -Level warning -Component $LogComponent -Stage "compose-build" -Message "Retrying exact Staging Docker build after transient BuildKit frontend failure" -Data @{
            attempt = $attempt
            next_attempt = ($attempt + 1)
            max_attempts = $MaxAttempts
            cache_pruned = $false
            builder_removed = $false
        }
        Start-Sleep -Seconds 5
    }

    Fail "Docker build retry loop ended unexpectedly"
}


function Invoke-StagingDockerCaptured([string[]]$Arguments, [switch]$Quiet) {
    $captured = @()
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & docker @Arguments 2>&1 |
            Tee-Object -Variable captured |
            ForEach-Object {
                if (-not $Quiet) { Write-Host ([string]$_) }
            }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return [pscustomobject]@{
        exit_code = [int]$code
        output = (($captured | ForEach-Object { [string]$_ }) -join "`n")
        lines = @($captured | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
}

function Test-StagingContainerIdMatch([string]$Left, [string]$Right) {
    $leftId = ([string]$Left).Trim().ToLowerInvariant()
    $rightId = ([string]$Right).Trim().ToLowerInvariant()
    if ($leftId -notmatch '^[0-9a-f]{12,64}$' -or $rightId -notmatch '^[0-9a-f]{12,64}$') { return $false }
    return $leftId.StartsWith($rightId) -or $rightId.StartsWith($leftId)
}

function Wait-StagingDockerEngine([int]$TimeoutSeconds = 120) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $probe = Invoke-StagingDockerCaptured @("info", "--format", "{{.ServerVersion}}") -Quiet
        if ($probe.exit_code -eq 0 -and -not [string]::IsNullOrWhiteSpace($probe.output)) { return $true }
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Invoke-StagingComposeUpWithZombieRecovery([string[]]$ComposeArgs, [int]$MaxAttempts = 2) {
    if ($MaxAttempts -ne 2) { Fail "Staging zombie recovery is fixed to exactly two compose-up attempts" }
    $upArgs = $ComposeArgs + @("up", "-d")
    $zombiePattern = '(?i)cannot stop container:\s+([0-9a-f]{12,64}).*PID\s+\d+\s+is zombie and can not be killed'

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        Write-Host ("> docker {0}" -f ($upArgs -join " "))
        Write-StagingOperationBoundary -Component $LogComponent -Stage "compose-up" -Outcome "start" -Message "Staging compose-up attempt started" -Data @{
            attempt = $attempt
            max_attempts = $MaxAttempts
            zombie_recovery_only = $true
        }

        $result = Invoke-StagingDockerCaptured $upArgs
        if ($result.exit_code -eq 0) {
            Write-StagingOperationBoundary -Component $LogComponent -Stage "compose-up" -Outcome "success" -Message "Staging compose-up completed" -Data @{
                attempt = $attempt
                max_attempts = $MaxAttempts
                docker_desktop_restarted = [bool]($attempt -gt 1)
            }
            return [pscustomobject]@{
                attempts = $attempt
                docker_desktop_restarted = [bool]($attempt -gt 1)
            }
        }

        $match = [regex]::Match([string]$result.output, $zombiePattern)
        if (-not $match.Success) {
            Fail "docker compose up failed without a retryable zombie-container signature" @{
                attempt = $attempt
                exit_code = $result.exit_code
            }
        }
        if ($attempt -ge $MaxAttempts) {
            Fail "docker compose up failed after bounded zombie-container recovery" @{
                attempts = $attempt
                exit_code = $result.exit_code
            }
        }

        $zombieContainerId = $match.Groups[1].Value.ToLowerInvariant()
        $projectIdsResult = Invoke-StagingDockerCaptured ($ComposeArgs + @("ps", "-aq")) -Quiet
        if ($projectIdsResult.exit_code -ne 0) { Fail "Could not enumerate Staging Compose containers before zombie recovery" }
        $projectIds = @($projectIdsResult.lines | Where-Object { $_ -match '^[0-9a-fA-F]{12,64}$' })
        if ($projectIds.Count -eq 0) { Fail "Staging Compose project has no container identities during zombie recovery" }

        $zombieOwnedByProject = $false
        foreach ($projectId in $projectIds) {
            if (Test-StagingContainerIdMatch $zombieContainerId $projectId) {
                $zombieOwnedByProject = $true
                break
            }
        }
        if (-not $zombieOwnedByProject) {
            Fail "Zombie container is not owned by the current Staging Compose project"
        }

        $runningResult = Invoke-StagingDockerCaptured @("ps", "-q") -Quiet
        if ($runningResult.exit_code -ne 0) { Fail "Could not enumerate running Docker containers before zombie recovery" }
        $runningIds = @($runningResult.lines | Where-Object { $_ -match '^[0-9a-fA-F]{12,64}$' })
        $foreignRunningCount = 0
        foreach ($runningId in $runningIds) {
            $owned = $false
            foreach ($projectId in $projectIds) {
                if (Test-StagingContainerIdMatch $runningId $projectId) {
                    $owned = $true
                    break
                }
            }
            if (-not $owned) { $foreignRunningCount++ }
        }
        if ($foreignRunningCount -gt 0) {
            Fail "Refusing Docker Desktop restart while non-Staging containers are running" @{
                foreign_running_container_count = $foreignRunningCount
            }
        }

        $desktopStatus = Invoke-StagingDockerCaptured @("desktop", "status") -Quiet
        if ($desktopStatus.exit_code -ne 0) {
            Fail "Docker Desktop CLI restart is unavailable; automatic zombie recovery cannot proceed safely"
        }

        Write-StagingLog -Level warning -Component $LogComponent -Stage "compose-up" -Message "Restarting isolated Docker Desktop engine to clear Staging zombie container" -Data @{
            attempt = $attempt
            zombie_container_owned_by_staging = $true
            foreign_running_container_count = $foreignRunningCount
            volumes_deleted = $false
            images_deleted = $false
            cache_pruned = $false
        }

        $restart = Invoke-StagingDockerCaptured @("desktop", "restart")
        if ($restart.exit_code -ne 0) {
            Fail "Docker Desktop restart failed during bounded Staging zombie recovery" @{ exit_code = $restart.exit_code }
        }
        if (-not (Wait-StagingDockerEngine -TimeoutSeconds 120)) {
            Fail "Docker engine did not become ready after bounded Staging zombie recovery"
        }
        Start-Sleep -Seconds 5
    }

    Fail "Staging compose-up zombie recovery loop ended unexpectedly"
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

function Assert-PortableManifestIntegrity([string]$RepoPath, [string]$ManifestPath, [string]$Stage) {
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { Fail "Portable manifest is missing: $ManifestPath" }
    try { $manifestObject = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json } catch { Fail "Portable manifest is invalid JSON: $ManifestPath" }
    if ([int]$manifestObject.schema_version -ne 1 -or $null -eq $manifestObject.files) { Fail "Portable manifest schema is unsupported: $ManifestPath" }
    foreach ($entry in $manifestObject.files) {
        $relative = ([string]$entry.path).Replace("\","/")
        if ([string]::IsNullOrWhiteSpace($relative) -or [IO.Path]::IsPathRooted($relative) -or $relative.Contains("..")) {
            Fail "Portable manifest contains an invalid repository-relative path"
        }
        $full = Join-Path $RepoPath $relative
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Fail "Manifest file is missing: $relative" }
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $full).Hash.ToLowerInvariant()
        $expected = ([string]$entry.sha256).ToLowerInvariant()
        if ($expected -notmatch '^[0-9a-f]{64}$' -or $actual -ne $expected) { Fail "Manifest hash mismatch: $relative" }
    }
    Write-StagingLog -Level info -Component $LogComponent -Stage $Stage -Message "portable manifest integrity verified" -Data @{
        manifest = $ManifestPath
        file_count = @($manifestObject.files).Count
    }
}

function New-StagingCertificationCompatibilitySnapshot(
    [string]$RepoPath,
    [string]$AuthorityCommit,
    [string]$DestinationRoot
) {
    $authority = ([string]$AuthorityCommit).Trim().ToLowerInvariant()
    if ($authority -notmatch '^[0-9a-f]{40}$') { Fail "Certification compatibility authority commit must be an exact SHA" }

    $localHead = ((& git -C $RepoPath rev-parse HEAD 2>$null | Out-String).Trim()).ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $localHead -ne $authority) {
        Fail "Certification compatibility snapshot requires local HEAD to equal current control-plane main"
    }

    $relativeFiles = @(
        "http-generic-api/scripts/staging-certification-runtime-integrity-compat.mjs",
        "http-generic-api/scripts/staging-certification-gateway-compat.mjs",
        "http-generic-api/stagingImmutableArtifactIntegrity.js"
    )

    if (Test-Path -LiteralPath $DestinationRoot) {
        Remove-Item -LiteralPath $DestinationRoot -Recurse -Force -ErrorAction Stop
    }
    New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null

    $fileEvidence = @()
    foreach ($relative in $relativeFiles) {
        $source = Join-Path $RepoPath $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            Fail "Certification compatibility source file is missing: $relative"
        }
        $destination = Join-Path $DestinationRoot $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant()
        $destinationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
        if ($sourceHash -ne $destinationHash) {
            Fail "Certification compatibility snapshot hash mismatch: $relative"
        }
        $fileEvidence += [ordered]@{
            path = $relative.Replace("\","/")
            sha256 = $sourceHash
        }
    }

    $metadata = [ordered]@{
        contract = "mad4b.staging-certification-compatibility-snapshot.v1"
        authority_commit = $authority
        files = $fileEvidence
        read_only = $true
        mutation_authority = $false
        secrets_included = $false
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
    }
    $metadataPath = Join-Path $DestinationRoot "authority.json"
    Set-Content -LiteralPath $metadataPath -Encoding utf8 -Value ($metadata | ConvertTo-Json -Depth 6)

    Write-StagingOperationBoundary -Component $LogComponent -Stage "certification-authority" -Outcome "success" -Message "Pinned current control-plane certification compatibility snapshot" -Data @{
        authority_commit = $authority
        file_count = $relativeFiles.Count
        read_only = $true
        secrets_included = $false
    }

    return (Join-Path $DestinationRoot "http-generic-api\scripts\staging-certification-runtime-integrity-compat.mjs")
}

function Read-StagingLastJsonObject([string]$Text) {
    $lines = @($Text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    for ($index = $lines.Count - 1; $index -ge 0; $index--) {
        try { return ($lines[$index] | ConvertFrom-Json) } catch { }
    }
    return $null
}

function Invoke-StagingCertificationCompatibilityVerifier(
    [string]$ScriptPath,
    [string]$AuthorityCommit,
    [string]$ExpectedCommit,
    [string]$ExpectedTree,
    [string]$ExpectedContextFileSet,
    [string]$ExpectedImageDigest
) {
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        Fail "Certification compatibility verifier snapshot is missing"
    }

    $bindings = [ordered]@{
        STAGING_CERT_COMPAT_AUTHORITY_COMMIT = $AuthorityCommit
        STAGING_CERT_EXPECTED_COMMIT = $ExpectedCommit
        STAGING_CERT_EXPECTED_TREE = $ExpectedTree
        STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256 = $ExpectedContextFileSet
        STAGING_CERT_APP_IMAGE_ID = $ExpectedImageDigest
        STAGING_CERT_APP_BASE_URL = "http://127.0.0.1:8080"
    }
    $previous = @{}
    foreach ($name in $bindings.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
        [Environment]::SetEnvironmentVariable($name, [string]$bindings[$name], "Process")
    }

    $output = @()
    $code = 1
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& node $ScriptPath 2>&1)
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        foreach ($name in $bindings.Keys) {
            [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
        }
    }

    $text = (($output | ForEach-Object { [string]$_ }) -join "`n").Trim()
    $report = Read-StagingLastJsonObject $text
    if ($null -eq $report -or [string]$report.contract -ne "mad4b.staging-certification-runtime-integrity-compat.v1") {
        Fail "Certification compatibility verifier did not return the canonical contract"
    }
    if ($code -eq 0 -and $report.verified -ne $true) {
        Fail "Certification compatibility verifier returned inconsistent success"
    }

    Write-StagingOperationBoundary -Component $LogComponent -Stage "certification-compatibility" -Outcome $(if ($report.verified -eq $true) { "success" } else { "failure" }) -Message "Historical runtime integrity compatibility verification completed" -Data @{
        authority_commit = [string]$report.authority_commit
        expected_commit = $ExpectedCommit
        verified = [bool]($report.verified -eq $true)
        verifier_exit_code = $code
        read_only = $true
        mutation_performed = $false
        secrets_included = $false
    }

    return $report
}


function Invoke-StagingGatewayCompatibilityVerifier(
    [string]$ScriptPath,
    [string]$AuthorityCommit,
    [string]$ExpectedCommit,
    [string]$RepositoryPath,
    [string]$EnvFile
) {
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        Fail "Gateway compatibility verifier snapshot is missing"
    }

    $bindings = [ordered]@{
        STAGING_CERT_GATEWAY_COMPAT_AUTHORITY_COMMIT = $AuthorityCommit
        STAGING_CERT_GATEWAY_COMPAT_EXPECTED_COMMIT = $ExpectedCommit
        STAGING_CERT_GATEWAY_COMPAT_REPOSITORY_PATH = $RepositoryPath
        STAGING_CERT_GATEWAY_COMPAT_ENV_FILE = $EnvFile
    }
    $previous = @{}
    foreach ($name in $bindings.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
        [Environment]::SetEnvironmentVariable($name, [string]$bindings[$name], "Process")
    }

    $output = @()
    $code = 1
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& node $ScriptPath 2>&1)
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        foreach ($name in $bindings.Keys) {
            [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
        }
    }

    $text = (($output | ForEach-Object { [string]$_ }) -join "`n").Trim()
    $report = Read-StagingLastJsonObject $text
    if ($null -eq $report -or [string]$report.contract -ne "mad4b.staging-certification-gateway-compatibility.v1") {
        Fail "Gateway compatibility verifier did not return the canonical contract"
    }
    if ($code -eq 0 -and $report.verified -ne $true) {
        Fail "Gateway compatibility verifier returned inconsistent success"
    }

    Write-StagingOperationBoundary -Component $LogComponent -Stage "gateway-certification-compatibility" -Outcome $(if ($report.verified -eq $true) { "success" } else { "failure" }) -Message "Historical Staging Gateway compatibility verification completed" -Data @{
        authority_commit = [string]$report.authority_commit
        expected_commit = $ExpectedCommit
        verified = [bool]($report.verified -eq $true)
        verifier_exit_code = $code
        read_only = $true
        database_mutation_performed = $false
        provider_mutation_performed = $false
        production_mutation_performed = $false
        secrets_included = $false
    }

    return $report
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
function Assert-GovernedReleaseCutResume([string]$RemoteCommit) {
    if (-not $AllowGovernedReleaseCutAncestor) {
        Fail "Pinned commit mismatch: origin/$Ref resolved to $RemoteCommit, expected $ExpectedCommit"
    }
    if ($Ref -ne "main") { Fail "Governed release-cut resume is restricted to the main lineage" }

    foreach ($entry in @(
        @{ name = "ExpectedCommit"; value = $ExpectedCommit },
        @{ name = "PromotionRequestHeadSha"; value = $PromotionRequestHeadSha },
        @{ name = "PromotionCandidateSha"; value = $PromotionCandidateSha },
        @{ name = "PinnedProductionSha"; value = $PinnedProductionSha },
        @{ name = "RemoteCommit"; value = $RemoteCommit }
    )) {
        if ([string]$entry.value -notmatch '^[0-9a-fA-F]{40}$') {
            Fail "Governed release-cut resume requires exact SHA binding for $($entry.name)"
        }
    }
    if ($PromotionRequestPr -lt 1) { Fail "Governed release-cut resume requires an exact promotion request PR" }

    $releaseCut = $ExpectedCommit.ToLowerInvariant()
    $requestHead = $PromotionRequestHeadSha.ToLowerInvariant()
    $candidate = $PromotionCandidateSha.ToLowerInvariant()
    $production = $PinnedProductionSha.ToLowerInvariant()
    $currentMain = $RemoteCommit.ToLowerInvariant()
    $requiredConfirmation = "DEPLOY_STAGING_RELEASE_CUT_{0}" -f $releaseCut.Substring(0, 12).ToUpperInvariant()
    if ($GovernedResumeConfirmation -ne $requiredConfirmation) {
        Fail "Governed release-cut resume confirmation mismatch; expected $requiredConfirmation"
    }

    Require-Command "gh"

    $prRaw = (& gh api "/repos/$ExpectedRepository/pulls/$PromotionRequestPr" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($prRaw)) { Fail "Governed release-cut resume could not read promotion request PR" }
    try { $pr = $prRaw | ConvertFrom-Json } catch { Fail "Governed release-cut resume promotion request response is invalid" }
    if ([string]$pr.state -ne "open" -or [string]$pr.base.ref -ne "main" -or [string]$pr.title -ne "ops: request governed Production synchronization") {
        Fail "Governed release-cut resume promotion request identity is invalid"
    }
    if (([string]$pr.head.sha).ToLowerInvariant() -ne $requestHead) { Fail "Governed release-cut resume request head moved" }

    function ConvertFrom-GovernedStagingResumeMarker([string]$Body) {
        if ([string]::IsNullOrWhiteSpace($Body)) { return $null }
        $tokens = @($Body.Trim() -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if ($tokens.Count -lt 2 -or [string]$tokens[0] -ne "GOVERNED_PRODUCTION_STAGING_RESUME_ARMED") { return $null }

        $fields = @{}
        for ($index = 1; $index -lt $tokens.Count; $index++) {
            $token = [string]$tokens[$index]
            $separator = $token.IndexOf("=")
            if ($separator -le 0 -or $separator -ge ($token.Length - 1)) { return $null }
            $key = $token.Substring(0, $separator)
            $value = $token.Substring($separator + 1)
            if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $fields.ContainsKey($key)) { return $null }
            $fields[$key] = $value
        }
        return $fields
    }

    # Avoid both Windows PowerShell JSON-array materialization quirks and native-argument
    # quoting quirks for string literals inside gh --jq. Emit only primitive TSV fields
    # from gojq, filter the trusted bot identity in PowerShell, then re-read each candidate
    # as one JSON object before applying the exact resume-marker field bindings.
    $commentIndexRaw = (& gh api "/repos/$ExpectedRepository/issues/$PromotionRequestPr/comments?per_page=100" --paginate --jq '.[] | [.id, .user.login] | @tsv' 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "Governed release-cut resume could not enumerate promotion request comments" }

    $trustedResumeMarkerIds = @()
    if (-not [string]::IsNullOrWhiteSpace($commentIndexRaw)) {
        foreach ($line in @($commentIndexRaw -split '\r?\n')) {
            $row = ([string]$line).Trim()
            if ([string]::IsNullOrWhiteSpace($row)) { continue }

            $columns = @($row -split "`t", 2)
            if ($columns.Count -ne 2) {
                Fail "Governed release-cut resume comment index returned an invalid TSV row"
            }

            $commentId = ([string]$columns[0]).Trim()
            $commentLogin = ([string]$columns[1]).Trim()
            if ($commentId -notmatch '^\d+$' -or [string]::IsNullOrWhiteSpace($commentLogin)) {
                Fail "Governed release-cut resume comment index returned invalid fields"
            }

            if ($commentLogin -eq "github-actions[bot]") {
                $trustedResumeMarkerIds += $commentId
            }
        }
    }

    $resumeMarkerIds = @()
    foreach ($commentId in $trustedResumeMarkerIds) {
        $commentRaw = (& gh api "/repos/$ExpectedRepository/issues/comments/$commentId" 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commentRaw)) {
            Fail "Governed release-cut resume could not read trusted promotion request marker comment"
        }
        try { $comment = $commentRaw | ConvertFrom-Json } catch { Fail "Governed release-cut resume trusted marker comment response is invalid" }

        if (([string]$comment.user.login) -ne "github-actions[bot]") {
            Fail "Governed release-cut resume trusted marker author identity changed during verification"
        }

        $commentBody = ([string]$comment.body).Trim()
        if ($commentBody -notmatch '^GOVERNED_PRODUCTION_STAGING_RESUME_ARMED(?:\s|$)') { continue }

        $fields = ConvertFrom-GovernedStagingResumeMarker $commentBody
        if ($null -eq $fields) { continue }
        $matches = (
            $fields.ContainsKey("request_pr") -and [string]$fields["request_pr"] -eq [string]$PromotionRequestPr -and
            $fields.ContainsKey("request_head") -and ([string]$fields["request_head"]).ToLowerInvariant() -eq $requestHead -and
            $fields.ContainsKey("release_cut") -and ([string]$fields["release_cut"]).ToLowerInvariant() -eq $releaseCut -and
            $fields.ContainsKey("Production") -and ([string]$fields["Production"]).ToLowerInvariant() -eq $production -and
            $fields.ContainsKey("candidate") -and ([string]$fields["candidate"]).ToLowerInvariant() -eq $candidate -and
            $fields.ContainsKey("review_mode") -and -not [string]::IsNullOrWhiteSpace([string]$fields["review_mode"]) -and
            $fields.ContainsKey("merge_executed") -and [string]$fields["merge_executed"] -eq "false" -and
            $fields.ContainsKey("deployment_executed") -and [string]$fields["deployment_executed"] -eq "false"
        )
        if ($matches) { $resumeMarkerIds += [string]$commentId }
    }
    if ($resumeMarkerIds.Count -ne 1) {
        Fail "Governed release-cut resume requires exactly one matching WAITING_FOR_STAGING marker" @{
            promotion_request_pr = $PromotionRequestPr
            trusted_marker_candidates = $trustedResumeMarkerIds.Count
            matching_markers = $resumeMarkerIds.Count
        }
    }

    $compareRaw = (& gh api "/repos/$ExpectedRepository/compare/$releaseCut...$currentMain" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($compareRaw)) { Fail "Governed release-cut resume could not verify main ancestry" }
    try { $compare = $compareRaw | ConvertFrom-Json } catch { Fail "Governed release-cut resume ancestry response is invalid" }
    if (([string]$compare.merge_base_commit.sha).ToLowerInvariant() -ne $releaseCut -or [int]$compare.behind_by -ne 0) {
        Fail "Governed release-cut resume release cut is not an ancestor of current main"
    }

    $productionRaw = (& gh api "/repos/$ExpectedRepository/git/ref/heads/Production" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($productionRaw)) { Fail "Governed release-cut resume could not verify Production ref" }
    try { $productionRef = $productionRaw | ConvertFrom-Json } catch { Fail "Governed release-cut resume Production response is invalid" }
    if (([string]$productionRef.object.sha).ToLowerInvariant() -ne $production) { Fail "Governed release-cut resume Production moved" }

    $cutRaw = (& gh api "/repos/$ExpectedRepository/git/commits/$releaseCut" 2>$null | Out-String).Trim()
    $candidateRaw = (& gh api "/repos/$ExpectedRepository/git/commits/$candidate" 2>$null | Out-String).Trim()
    $requestRaw = (& gh api "/repos/$ExpectedRepository/git/commits/$requestHead" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($cutRaw) -or [string]::IsNullOrWhiteSpace($candidateRaw) -or [string]::IsNullOrWhiteSpace($requestRaw)) {
        Fail "Governed release-cut resume could not read exact Git identities"
    }
    try {
        $cutCommit = $cutRaw | ConvertFrom-Json
        $candidateCommit = $candidateRaw | ConvertFrom-Json
        $requestCommit = $requestRaw | ConvertFrom-Json
    } catch { Fail "Governed release-cut resume Git identity response is invalid" }

    if (@($candidateCommit.parents).Count -ne 2) { Fail "Governed release-cut resume candidate parent count changed" }
    if (([string]$candidateCommit.parents[0].sha).ToLowerInvariant() -ne $releaseCut) { Fail "Governed release-cut resume candidate first parent changed" }
    if (([string]$candidateCommit.parents[1].sha).ToLowerInvariant() -ne $production) { Fail "Governed release-cut resume candidate second parent changed" }
    if (([string]$candidateCommit.tree.sha).ToLowerInvariant() -ne ([string]$cutCommit.tree.sha).ToLowerInvariant()) { Fail "Governed release-cut resume candidate tree changed" }

    if (@($requestCommit.parents).Count -ne 1 -or ([string]$requestCommit.parents[0].sha).ToLowerInvariant() -ne $releaseCut) {
        Fail "Governed release-cut resume request marker parent changed"
    }
    if (([string]$requestCommit.tree.sha).ToLowerInvariant() -ne ([string]$cutCommit.tree.sha).ToLowerInvariant()) {
        Fail "Governed release-cut resume request marker tree changed"
    }

    Write-StagingOperationBoundary -Component $LogComponent -Stage "governed-release-cut-resume" -Outcome "success" -Message "authorized Production release cut may be deployed to local Staging" -Data @{
        release_cut = $releaseCut
        current_main = $currentMain
        promotion_request_pr = $PromotionRequestPr
        promotion_request_head = $requestHead
        candidate = $candidate
        pinned_production = $production
        production_mutation = $false
        provider_mutation = $false
        secrets_included = $false
    }
}

function Invoke-SelfUpdate {
    if ($SkipSelfUpdate) { return }
    $deploymentCommit = $ExpectedCommit.ToLowerInvariant()
    Push-Location $RepositoryPath
    try {
        Assert-StagingOriginIdentity $RepositoryPath $ExpectedRepository
        Quarantine-KnownBackupFiles $RepositoryPath
        Repair-ManifestLineEndings $RepositoryPath
        $dirty = @(git status --porcelain --untracked-files=all)
        if ($dirty.Count -gt 0) { Fail "Working tree is not clean; refusing bootstrap checkout before Auto Pilot self-update" }
        Invoke-Native "git" @("fetch", "origin", $Ref, "--depth=2")
        $remoteCommit = (Get-NativeText "git" @("rev-parse", "origin/$Ref")).ToLowerInvariant()
        $driverCommit = $deploymentCommit
        if ($remoteCommit -ne $deploymentCommit) {
            Assert-GovernedReleaseCutResume $remoteCommit
            $driverCommit = $remoteCommit
        }
        $currentCommit = (Get-NativeText "git" @("rev-parse", "HEAD")).ToLowerInvariant()
        if ($currentCommit -ne $driverCommit) {
            Invoke-Native "git" @("checkout", "--detach", $driverCommit)
        }
        $checkedOut = (Get-NativeText "git" @("rev-parse", "HEAD")).ToLowerInvariant()
        if ($checkedOut -ne $driverCommit) { Fail "Self-update checkout readback mismatch" }
    } finally {
        Pop-Location
    }

    $reloadedScript = Join-Path $RepositoryPath "autopilot-portable-staging\Start-AutoPilot.ps1"
    if (-not (Test-Path -LiteralPath $reloadedScript)) { Fail "Self-update target script is missing: $reloadedScript" }
    $reloadedText = Get-Content -Raw -LiteralPath $reloadedScript
    foreach ($marker in @("prepare-staging-build-context.mjs", "STAGING_BUILD_TREE", "STAGING_BUILD_CONTEXT_FILE_SET_SHA256")) {
        if (-not $reloadedText.Contains($marker)) { Fail "Self-update target script is missing required provenance marker: $marker" }
    }
    Write-StagingOperationBoundary -Component $LogComponent -Stage "bootstrap-sync" -Outcome "success" -Message "reloaded exact-commit Auto Pilot before local execution" -Data @{ driver_sha = $driverCommit; deployment_sha = $deploymentCommit; governed_release_cut_resume = [bool]$AllowGovernedReleaseCutAncestor; secrets_included = $false }

    $childBuildMode = if ($SkipBuild) { "Smart" } else { $BuildMode }
    $childArgs = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $reloadedScript,
        "-RepositoryPath", $RepositoryPath, "-RepositoryUrl", $RepositoryUrl, "-ExpectedRepository", $ExpectedRepository, "-Ref", $Ref,
        "-ExpectedCommit", $ExpectedCommit, "-BuildMode", $childBuildMode, "-SkipSelfUpdate"
    )
    $childArgs += @("-TunnelMode", $TunnelMode)
    if ($EnableActivationGateway) { $childArgs += "-EnableActivationGateway" }
    if ($RequireSchemaBundle) { $childArgs += "-RequireSchemaBundle" }
    if ($ApplySchemaBundle) { $childArgs += "-ApplySchemaBundle" }
    if ($ValidateOnly) { $childArgs += "-ValidateOnly" }
    if ($Stop) { $childArgs += "-Stop" }
    if ($SkipBuild) { $childArgs += "-SkipBuild" }
    if ($AllowGovernedReleaseCutAncestor) {
        $childArgs += @(
            "-AllowGovernedReleaseCutAncestor",
            "-PromotionRequestPr", [string]$PromotionRequestPr,
            "-PromotionRequestHeadSha", $PromotionRequestHeadSha,
            "-PromotionCandidateSha", $PromotionCandidateSha,
            "-PinnedProductionSha", $PinnedProductionSha,
            "-GovernedResumeConfirmation", $GovernedResumeConfirmation
        )
    }
    & powershell.exe @childArgs
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "bootstrap-child-failure" -Message "Reloaded Auto Pilot failed; preserving the child process root failure" -Data @{ parent_error = "RELOADED_AUTO_PILOT_FAILED"; expected_commit = $ExpectedCommit; child_exit_code = $exitCode }
        exit $exitCode
    }
    exit 0
}

function Get-StagingImageLabelValue([object]$Labels, [string]$Name) {
    if ($null -eq $Labels -or [string]::IsNullOrWhiteSpace($Name)) { return "" }
    $property = $Labels.PSObject.Properties[$Name]
    if ($null -eq $property) { return "" }
    return ([string]$property.Value).Trim()
}

function Test-ExactStagingImage([string]$ImageId, [string]$ExpectedCommit, [string]$ExpectedTree, [string]$ExpectedContextFileSet) {
    if ($ImageId -notmatch '^sha256:[0-9a-fA-F]{64}$') { return $false }
    if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$' -or $ExpectedTree -notmatch '^[0-9a-fA-F]{40}$' -or $ExpectedContextFileSet -notmatch '^[0-9a-fA-F]{64}$') { return $false }
    try {
        # Docker image inspect returns a top-level JSON array. Windows PowerShell 5.1
        # preserves that array as a single pipeline object in ConvertFrom-Json, so parse
        # via -InputObject and normalize cardinality explicitly before reading fields.
        $inspectJson = (& docker image inspect $ImageId 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($inspectJson)) { return $false }
        $parsed = ConvertFrom-Json -InputObject $inspectJson
        if ($null -eq $parsed) { return $false }
        if ($parsed -is [System.Array]) {
            if ($parsed.Count -ne 1) { return $false }
            $inspect = $parsed[0]
        } else {
            $inspect = $parsed
        }
        if ($null -eq $inspect -or $null -eq $inspect.Config -or $null -eq $inspect.Config.Labels) { return $false }

        $labels = $inspect.Config.Labels
        $inspectedId = ([string]$inspect.Id).Trim().ToLowerInvariant()
        if ($inspectedId -ne $ImageId.ToLowerInvariant()) { return $false }

        $contract = Get-StagingImageLabelValue $labels "org.mad4b.staging.provenance.contract"
        $commit = (Get-StagingImageLabelValue $labels "org.mad4b.staging.build.commit").ToLowerInvariant()
        $tree = (Get-StagingImageLabelValue $labels "org.mad4b.staging.build.tree").ToLowerInvariant()
        $contextFileSet = (Get-StagingImageLabelValue $labels "org.mad4b.staging.build.context_file_set_sha256").ToLowerInvariant()
        $secretsIncluded = (Get-StagingImageLabelValue $labels "org.mad4b.staging.build.secrets_included").ToLowerInvariant()

        return ($contract -eq "mad4b.staging-build-provenance.v1" -and
            $commit -eq $ExpectedCommit.ToLowerInvariant() -and
            $tree -eq $ExpectedTree.ToLowerInvariant() -and
            $contextFileSet -eq $ExpectedContextFileSet.ToLowerInvariant() -and
            $secretsIncluded -eq "false")
    } catch {
        return $false
    }
}
function Resolve-ExactStagingImageCandidate([string]$CandidateId, [string]$Source, [string]$ExpectedCommit, [string]$ExpectedTree, [string]$ExpectedContextFileSet) {
    if ([string]::IsNullOrWhiteSpace($CandidateId)) { return "" }
    $candidate = $CandidateId.Trim().ToLowerInvariant()
    if ($candidate -notmatch '^sha256:[0-9a-f]{64}$') { return "" }
    if (Test-ExactStagingImage $candidate $ExpectedCommit $ExpectedTree $ExpectedContextFileSet) {
        Write-StagingOperationBoundary -Component $LogComponent -Stage "image-provenance" -Outcome "success" -Message "accepted exact Staging image candidate" -Data @{
            source = $Source
            image_id = $candidate
            commit = $ExpectedCommit.ToLowerInvariant()
            tree = $ExpectedTree.ToLowerInvariant()
            context_file_set_sha256 = $ExpectedContextFileSet.ToLowerInvariant()
            secrets_included = $false
        }
        return $candidate
    }
    Write-StagingLog -Level warning -Component $LogComponent -Stage "image-provenance" -Message "Staging image candidate rejected after exact provenance validation" -Data @{
        source = $Source
        image_id = $candidate
        expected_commit = $ExpectedCommit.ToLowerInvariant()
        expected_tree = $ExpectedTree.ToLowerInvariant()
        expected_context_file_set_sha256 = $ExpectedContextFileSet.ToLowerInvariant()
        secrets_included = $false
    }
    return ""
}

function Find-ExactStagingImageId([string]$ExpectedCommit, [string]$ExpectedTree, [string]$ExpectedContextFileSet, [string]$EnvPath, [object[]]$ComposeArgs) {
    # Prefer authoritative local pins and short-circuit as soon as one exact
    # content-addressed image is proven. A failure in a later discovery source
    # must never invalidate an already verified exact image.
    try {
        $fromEnvLine = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match '^STAGING_APP_IMAGE_ID=(.*)$' } | Select-Object -First 1
        if ($fromEnvLine) {
            $fromEnv = ($fromEnvLine -replace '^STAGING_APP_IMAGE_ID=', '').Trim().ToLowerInvariant()
            $resolved = Resolve-ExactStagingImageCandidate $fromEnv "env_pin" $ExpectedCommit $ExpectedTree $ExpectedContextFileSet
            if (-not [string]::IsNullOrWhiteSpace($resolved)) { return $resolved }
        }
    } catch {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "image-provenance" -Message "Staging env image pin discovery was unavailable" -Data @{
            source = "env_pin"
            error = $_.Exception.Message
            secrets_included = $false
        }
    }

    # If the Staging app is already running, Docker's container .Image field is
    # the exact immutable image content ID. Verify it before consulting tags or
    # repository-wide label indexes.
    if ($null -ne $ComposeArgs -and $ComposeArgs.Count -gt 0) {
        try {
            $runningContainerId = (& docker @($ComposeArgs + @("ps", "-q", "app")) 2>$null | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($runningContainerId)) {
                $runningImageId = (& docker inspect --format "{{.Image}}" $runningContainerId 2>$null | Out-String).Trim()
                if ($LASTEXITCODE -eq 0) {
                    $resolved = Resolve-ExactStagingImageCandidate $runningImageId "running_container" $ExpectedCommit $ExpectedTree $ExpectedContextFileSet
                    if (-not [string]::IsNullOrWhiteSpace($resolved)) { return $resolved }
                }
            }
        } catch {
            Write-StagingLog -Level warning -Component $LogComponent -Stage "image-provenance" -Message "running Staging container image discovery was unavailable" -Data @{
                source = "running_container"
                error = $_.Exception.Message
                secrets_included = $false
            }
        }

        # Compose owns the effective app image name. Resolve it from the
        # interpolated model and verify the resulting immutable content ID.
        try {
            $composeModelJson = (& docker @($ComposeArgs + @("config", "--format", "json")) 2>$null | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($composeModelJson)) {
                $composeModel = $composeModelJson | ConvertFrom-Json
                $effectiveImageRef = [string]$composeModel.services.app.image
                if ([string]::IsNullOrWhiteSpace($effectiveImageRef) -and -not [string]::IsNullOrWhiteSpace([string]$composeModel.name)) {
                    $effectiveImageRef = "{0}-app:latest" -f [string]$composeModel.name
                }
                if (-not [string]::IsNullOrWhiteSpace($effectiveImageRef)) {
                    $effectiveImageId = (& docker image inspect --format "{{.Id}}" $effectiveImageRef 2>$null | Out-String).Trim()
                    if ($LASTEXITCODE -eq 0) {
                        $resolved = Resolve-ExactStagingImageCandidate $effectiveImageId "compose_image_ref" $ExpectedCommit $ExpectedTree $ExpectedContextFileSet
                        if (-not [string]::IsNullOrWhiteSpace($resolved)) { return $resolved }
                    }
                }
            }
        } catch {
            Write-StagingLog -Level warning -Component $LogComponent -Stage "image-provenance" -Message "effective Compose image discovery was unavailable" -Data @{
                source = "compose_image_ref"
                error = $_.Exception.Message
                secrets_included = $false
            }
        }
    }

    # Final fallback: search locally indexed provenance labels. Failure of this
    # optional discovery source remains fail-closed by returning no candidate.
    try {
        $labelQuery = (& docker image ls --no-trunc --filter "label=org.mad4b.staging.provenance.contract=mad4b.staging-build-provenance.v1" --format "{{.ID}}" 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($labelQuery)) {
            foreach ($candidate in @($labelQuery -split "\s+" | Where-Object { $_ -match '^sha256:[0-9a-fA-F]{64}$' } | Select-Object -Unique)) {
                $resolved = Resolve-ExactStagingImageCandidate ([string]$candidate) "label_index" $ExpectedCommit $ExpectedTree $ExpectedContextFileSet
                if (-not [string]::IsNullOrWhiteSpace($resolved)) { return $resolved }
            }
        }
    } catch {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "image-provenance" -Message "local Staging image label index discovery was unavailable" -Data @{
            source = "label_index"
            error = $_.Exception.Message
            secrets_included = $false
        }
    }

    Write-StagingLog -Level warning -Component $LogComponent -Stage "image-provenance" -Message "no local Staging image matched exact provenance" -Data @{
        expected_commit = $ExpectedCommit.ToLowerInvariant()
        expected_tree = $ExpectedTree.ToLowerInvariant()
        expected_context_file_set_sha256 = $ExpectedContextFileSet.ToLowerInvariant()
        sources = @("env_pin", "running_container", "compose_image_ref", "label_index")
        secrets_included = $false
    }
    return ""
}

function Seed-SchemaBundle([string]$RepoPath, [string]$Sha) {
    $dumpDir = Join-Path $RepoPath "autopilot-portable-staging\staging-db-dumps"
    $required = @("runtime.schema.sql.gz", "governance.schema.sql.gz", "persistence.schema.sql.gz")
    $bundleManifestPath = Join-Path $dumpDir "staging-schema-bundle-manifest.json"
    $missingRequired = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $dumpDir $_)) })
    $missingArtifacts = @($missingRequired)
    if (-not (Test-Path -LiteralPath $bundleManifestPath -PathType Leaf)) { $missingArtifacts += "staging-schema-bundle-manifest.json" }
    $available = (Test-Path -LiteralPath $dumpDir -PathType Container) -and ($missingArtifacts.Count -eq 0)
    if (-not $available) {
        if ($RequireSchemaBundle -or $ApplySchemaBundle) { Fail "Schema bundle is required but missing from $dumpDir" }
        Write-StagingLog -Level info -Component $LogComponent -Stage "schema-bundle" -Message "no complete local schema-only bundle found; leaving recovered Staging databases unchanged" -Data @{ missing_artifacts = @($missingArtifacts) }
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

    $clone = Join-Path $RepoPath "autopilot-portable-staging\Clone-StagingDatabases.ps1"
    if (-not (Test-Path -LiteralPath $clone)) { Fail "Clone-StagingDatabases.ps1 is missing: $clone" }
    $cloneArgs = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $clone, "-DumpDirectory", $dumpDir, "-ExpectedCommit", $Sha, "-Mode", "schema_only")
    if ($ApplySchemaBundle) {
        $cloneArgs += "-Apply"
        Invoke-Native "powershell.exe" $cloneArgs
        Write-StagingOperationBoundary -Component $LogComponent -Stage "schema-bundle" -Outcome "success" -Message "explicit local Staging schema-only bundle applied" -Data @{ commit = $Sha; mode = "schema_only"; production_accessed = $false; provider_accessed = $false }
        return "schema_only_applied"
    }
    Invoke-Native "powershell.exe" $cloneArgs
    Write-StagingOperationBoundary -Component $LogComponent -Stage "schema-bundle" -Outcome "success" -Message "local Staging schema-only bundle validated in dry-run mode" -Data @{ commit = $Sha; mode = "schema_only"; production_accessed = $false; provider_accessed = $false }
    return "schema_only_dry_run"
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
$CertificationCompatibilityRoot = Join-Path ([IO.Path]::GetTempPath()) ("mad4b-staging-cert-compat-" + [Guid]::NewGuid().ToString("N"))
$CertificationCompatibilityScript = ""
$CertificationGatewayCompatibilityScript = ""
$CertificationCompatibilityAuthorityCommit = ""

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

    # The portable manifest belongs to the live control-plane driver. Verify it before
    # switching the worktree to a historical release cut; a historical generated manifest
    # may legitimately be stale relative to canonical Git bytes and is not payload authority.
    Assert-PortableManifestIntegrity $RepositoryPath $Manifest "driver-manifest"

    Invoke-Native "git" @("fetch", "origin", $Ref, "--depth=2")
    $remoteCommit = (Get-NativeText "git" @("rev-parse", "origin/$Ref")).ToLowerInvariant()
    $governedHistoricalResume = $false
    if ($remoteCommit -ne $ExpectedCommit.ToLowerInvariant()) {
        Assert-GovernedReleaseCutResume $remoteCommit
        $governedHistoricalResume = $true
        $CertificationCompatibilityAuthorityCommit = $remoteCommit
        $CertificationCompatibilityScript = New-StagingCertificationCompatibilitySnapshot `
            -RepoPath $RepositoryPath `
            -AuthorityCommit $remoteCommit `
            -DestinationRoot $CertificationCompatibilityRoot
        $CertificationGatewayCompatibilityScript = Join-Path $CertificationCompatibilityRoot "http-generic-api\scripts\staging-certification-gateway-compat.mjs"
        Invoke-Native "git" @("fetch", "origin", $ExpectedCommit, "--depth=2")
    }
    Invoke-Native "git" @("checkout", "--detach", $ExpectedCommit)
    $checkedOut = Get-NativeText "git" @("rev-parse", "HEAD")
    if ($checkedOut.ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant()) { Fail "Checked-out commit readback mismatch" }

    $trackedDirtyAfterCheckout = @(git status --porcelain --untracked-files=no)
    if ($trackedDirtyAfterCheckout.Count -gt 0) {
        Fail "Tracked working tree changed after exact release checkout"
    }

    if (-not $governedHistoricalResume) {
        Assert-PortableManifestIntegrity $RepositoryPath $Manifest "payload-manifest"
    } else {
        Write-StagingLog -Level info -Component $LogComponent -Stage "payload-integrity" -Message "historical release payload uses exact Git commit/tree authority instead of historical generated manifest hashes" -Data @{
            expected_commit = $ExpectedCommit.ToLowerInvariant()
            current_main = $remoteCommit
            historical_manifest_trusted = $false
            tracked_worktree_clean = $true
        }
    }
    if (-not (Test-Path $BuildContextScript)) { Fail "Exact Git build context generator is missing: $BuildContextScript" }
    $buildTree = Get-NativeText "git" @("rev-parse", "$ExpectedCommit^{tree}")
    if ($buildTree -notmatch '^[0-9a-fA-F]{40}$') { Fail "Pinned commit tree readback is not an exact SHA" }
    Invoke-Native "node" @($BuildContextScript, "--repository-path", $RepositoryPath, "--commit", $ExpectedCommit.ToLowerInvariant(), "--output-dir", $BuildContextPath)
    $buildContextMetadataPath = Join-Path $BuildContextPath ".staging-build-context.json"
    if (-not (Test-Path $buildContextMetadataPath)) { Fail "Exact Git build context provenance metadata is missing" }
    try { $buildContextMetadata = Get-Content -Raw -LiteralPath $buildContextMetadataPath | ConvertFrom-Json } catch { Fail "Exact Git build context provenance metadata is invalid" }
    if ([string]$buildContextMetadata.commit_sha -ne $ExpectedCommit.ToLowerInvariant() -or [string]$buildContextMetadata.tree_sha -ne $buildTree.ToLowerInvariant() -or [string]$buildContextMetadata.source -ne "git_archive_exact_commit" -or $buildContextMetadata.local_ignored_files_included -ne $false -or $buildContextMetadata.secrets_included -ne $false) { Fail "Exact Git build context provenance did not converge" }

    $envState = Initialize-StagingEnvironment `
        -RepositoryPath $RepositoryPath `
        -TunnelMode $TunnelMode `
        -EnableActivationGateway:$EnableActivationGateway `
        -RequireTunnelToken:($TunnelMode -eq "docker_sidecar")

    $resolvedEnvFile = [IO.Path]::GetFullPath([string]$envState.env_file)
    if ($resolvedEnvFile -ne [IO.Path]::GetFullPath($EnvFile)) {
        Fail "Canonical Staging environment helper returned an unexpected env path"
    }

    Ensure-EnvDefault $EnvFile "TENANT_GPT_STAGING_OAUTH_CLIENT_ID" "mad4b-tenant-gpt-staging"
    Ensure-EnvDefault $EnvFile "TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED" "true"

    Set-EnvValue $EnvFile "DEPLOYMENT_EXPECTED_COMMIT_SHA" $ExpectedCommit
    Set-EnvValue $EnvFile "DEPLOY_COMMIT" $ExpectedCommit
    Set-EnvValue $EnvFile "DEPLOY_BRANCH" $Ref
    Set-EnvValue $EnvFile "STAGING_BUILD_CONTEXT" (([IO.Path]::GetFullPath($BuildContextPath)) -replace '\\','/')
    Set-EnvValue $EnvFile "STAGING_BUILD_TREE" $buildTree.ToLowerInvariant()
    Set-EnvValue $EnvFile "STAGING_BUILD_CONTEXT_FILE_SET_SHA256" ([string]$buildContextMetadata.context_file_set_sha256)

    Write-StagingOperationBoundary -Component $LogComponent -Stage "environment-bootstrap" -Outcome "success" -Message "canonical Staging environment bootstrap reconciled" -Data @{
        contract = [string]$envState.contract
        tunnel_mode = [string]$envState.tunnel_mode
        tunnel_origin = [string]$envState.tunnel_origin
        generated_key_count = @($envState.generated_keys).Count
        mcp_app_id_present = [bool]$envState.mcp_app_id_present
        mcp_app_secret_present = [bool]$envState.mcp_app_secret_present
        production_mutation = [bool]$envState.production_mutation
        provider_mutation = [bool]$envState.provider_mutation
        secrets_included = [bool]$envState.secrets_included
    }
    Assert-UniqueEnvKeys $EnvFile
    $effectiveEnv = Get-Content -Raw $EnvFile
    if ($effectiveEnv -match '(?im)^CLOUDFLARE_TUNNEL_TOKEN=\s*$' -and $TunnelMode -eq "docker_sidecar") { Fail "docker_sidecar requested but CLOUDFLARE_TUNNEL_TOKEN is empty" }
    if ($effectiveEnv -notmatch '(?im)^MIGRATION_APPLIED=false\s*$' -or $effectiveEnv -notmatch '(?im)^DATABASE_MUTATED=false\s*$') { Fail "Mutation safety flags must be present and exactly false" }
    if ($TunnelSelected -and (Read-EnvValue $EnvFile "TENANT_GPT_STAGING_ENABLED") -eq "true" -and [string]::IsNullOrWhiteSpace((Read-EnvValue $EnvFile "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET"))) { Fail "TunnelMode requires TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET when Staging GPT is enabled" }
    if ($TunnelSelected -and (Read-EnvValue $EnvFile "REMOTE_MCP_ENABLED") -eq "true" -and (Read-EnvValue $EnvFile "REMOTE_MCP_OAUTH_ENABLED") -eq "true" -and [string]::IsNullOrWhiteSpace((Read-EnvValue $EnvFile "REMOTE_MCP_OAUTH_SIGNING_SECRET"))) { Fail "TunnelMode requires REMOTE_MCP_OAUTH_SIGNING_SECRET when Staging MCP OAuth is enabled" }
    $activationGatewayEnabled = (Read-EnvValue $EnvFile "ACTIVATION_STAGING_GATEWAY_ENABLED").ToLowerInvariant() -eq "true"
    if ($activationGatewayEnabled -and [string]::IsNullOrWhiteSpace((Read-EnvValue $EnvFile "TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET"))) { Fail "Activation Staging Gateway requires TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET" }
    if ($effectiveEnv -notmatch '(?im)^TENANT_GPT_SSO_COOKIE_MODE=host_only\s*$') { Fail "Staging SSO cookie mode must be host_only" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp-dev\.mad4b\.com\s*$') { Fail "Staging Tunnel requires exactly dev.mad4b.com and mcp-dev.mad4b.com; Activation uses a separate Worker custom domain" }
    if ($activationGatewayEnabled -and (Read-EnvValue $EnvFile "ACTIVATION_HOST_GATEWAY_HOST") -ne "activation-dev.mad4b.com") { Fail "Activation Staging Gateway must use activation-dev.mad4b.com as its Worker custom domain" }
    if ($activationGatewayEnabled -and (Read-EnvValue $EnvFile "ACTIVATION_STAGING_AUTH_HOST") -ne "activation-dev.mad4b.com") { Fail "Activation Staging OAuth host must be activation-dev.mad4b.com" }
    if ($TunnelSelected -and $effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_ORIGIN_APP=http://127\.0\.0\.1:8080\s*$') { Fail "Staging tunnel origin must be exactly http://127.0.0.1:8080 when a tunnel transport is selected" }
    if (-not $TunnelSelected -and (Read-EnvValue $EnvFile "CLOUDFLARE_TUNNEL_ORIGIN_APP") -ne "") { Fail "Disabled Staging tunnel mode must not retain a tunnel origin" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_LOGLEVEL=info\s*$') { Fail "Staging tunnel loglevel must remain info; debug may expose request headers" }
    if ($effectiveEnv -notmatch '(?im)^CLOUDFLARE_TUNNEL_GRACE_PERIOD=30s\s*$') { Fail "Staging tunnel grace period must remain 30s" }
    if ($effectiveEnv -match '(?im)^CLOUDFLARE_TUNNEL_HOSTNAMES=.*(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com)') { Fail "Forbidden Production hostname found in staging tunnel list" }

    $composeArgs = @(Get-StagingComposeArgs $ApiPath $EnvFile $TunnelMode)
    Invoke-Native "docker" ($composeArgs + @("config", "--quiet"))
    if ($ValidateOnly) {
        Write-Host "AUTO_PILOT_VALIDATED: commit=$ExpectedCommit context=$context tunnel_mode=$TunnelMode"
        return
    }
    if ($Stop) {
        Write-StagingLog -Level info -Component $LogComponent -Stage "stop" -Message "stopping local Staging services"
        Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "stop"))
        $stagingService = Get-Service -Name "Mad4B-Staging-Cloudflared" -ErrorAction SilentlyContinue
        if ($null -ne $stagingService -and $stagingService.Status -ne "Stopped") { Stop-Service -Name "Mad4B-Staging-Cloudflared" -Force -ErrorAction Stop }
        Write-StagingOperationBoundary -Component $LogComponent -Stage "stop" -Outcome "success" -Message "local Staging services and Staging-owned tunnel runtimes stopped"
        return
    }
    $existingImageId = Find-ExactStagingImageId $ExpectedCommit $buildTree $buildContextMetadata.context_file_set_sha256 $EnvFile $composeArgs
    $imageReused = $false
    $buildAction = "built"
    $imageMatchesExactProvenance = $existingImageId -match '^sha256:[0-9a-f]{64}$'
    $reuseRequested = $BuildMode -in @("Smart", "SkipBuild")
    if ($reuseRequested -and $imageMatchesExactProvenance) {
        $imageReused = $true
        $buildAction = if ($BuildMode -eq "SkipBuild") { "skipbuild_reused_exact_provenance" } else { "reused_exact_provenance" }
        Write-StagingOperationBoundary -Component $LogComponent -Stage "compose-build" -Outcome "success" -Message "reused exact Staging image; build skipped" -Data @{ mode = $BuildMode; image_id = $existingImageId; commit = $ExpectedCommit; tree = $buildTree; context_file_set_sha256 = [string]$buildContextMetadata.context_file_set_sha256; secrets_included = $false }
    } elseif ($BuildMode -eq "SkipBuild") {
        Fail "SkipBuild requested but no local app image matches exact commit/tree/context provenance"
    } else {
        if ($BuildMode -eq "ForceBuild") { $buildAction = "forced_build" }
        Write-StagingLog -Level info -Component $LogComponent -Stage "compose-build" -Message "building Staging app from exact Git context" -Data @{ mode = $BuildMode; previous_image_id = $existingImageId; previous_image_exact = [bool]$imageMatchesExactProvenance }
        $buildResult = Invoke-StagingDockerBuild ($composeArgs + @("build", "app")) -MaxAttempts 2
        if ($buildResult.transient_recovered) {
            $buildAction = if ($BuildMode -eq "ForceBuild") { "forced_build_after_transient_retry" } else { "built_after_transient_retry" }
        }
    }
    $imageId = Find-ExactStagingImageId $ExpectedCommit $buildTree $buildContextMetadata.context_file_set_sha256 $EnvFile $composeArgs
    if ($imageId -notmatch '^sha256:[0-9a-fA-F]{64}$') { Fail "Staging app image ID is not a content-addressed sha256 digest with exact provenance" }
    Set-EnvValue $EnvFile "STAGING_APP_IMAGE_ID" $imageId.ToLowerInvariant()
    Assert-UniqueEnvKeys $EnvFile
    Invoke-Native "docker" ($composeArgs + @("config", "--quiet"))
    Write-StagingLog -Level info -Component $LogComponent -Stage "compose-up" -Message "starting local application topology"
    $composeUpResult = Invoke-StagingComposeUpWithZombieRecovery $composeArgs -MaxAttempts 2
    if ($composeUpResult.docker_desktop_restarted) {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "compose-up" -Message "Staging topology recovered after isolated Docker Desktop restart" -Data @{
            attempts = $composeUpResult.attempts
            docker_desktop_restarted = $true
        }
    }
    foreach ($service in @("redis", "runtime-db", "governance-db", "persistence-db", "app")) { Wait-ServiceHealthy $composeArgs $service }
    Assert-WindowsHostOriginReachable $composeArgs $TunnelMode
    if ($TunnelMode -eq "windows_service") {
        Write-StagingLog -Level info -Component $LogComponent -Stage "tunnel" -Message "reconciling Staging tunnel in windows_service mode"
        Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "stop", "cloudflared"))
        $service = Get-Service -Name "Mad4B-Staging-Cloudflared" -ErrorAction SilentlyContinue
        if ($null -eq $service -or $service.Status -ne "Running") { [void](Ensure-StagingCloudflaredWindowsService $EnvFile) }
        $serviceReadback = Get-CimInstance Win32_Service -Filter "Name='Mad4B-Staging-Cloudflared'" -ErrorAction Stop
        if ($serviceReadback.State -ne "Running" -or [int]$serviceReadback.ProcessId -le 0) { Fail "windows_service tunnel did not reach Running" }
        $dockerTunnelId = (& docker @($composeArgs + @("ps", "-q", "cloudflared")) 2>$null | Out-String).Trim()
        if (-not [string]::IsNullOrWhiteSpace($dockerTunnelId)) {
            $dockerTunnelRunning = (& docker inspect --format "{{.State.Running}}" $dockerTunnelId 2>$null | Out-String).Trim().ToLowerInvariant()
            if ($dockerTunnelRunning -eq "true") { Fail "windows_service mode refuses concurrent Docker cloudflared sidecar" }
        }
        Write-StagingOperationBoundary -Component $LogComponent -Stage "tunnel" -Outcome "success" -Message "Staging Windows service tunnel is the sole runtime" -Data @{ tunnel_mode = $TunnelMode; service = "Mad4B-Staging-Cloudflared"; pid = [int]$serviceReadback.ProcessId }
    } elseif ($TunnelMode -eq "docker_sidecar") {
        Write-StagingLog -Level info -Component $LogComponent -Stage "tunnel" -Message "reconciling Staging tunnel in docker_sidecar mode"
        $service = Get-Service -Name "Mad4B-Staging-Cloudflared" -ErrorAction SilentlyContinue
        if ($null -ne $service -and $service.Status -ne "Stopped") {
            Stop-Service -Name "Mad4B-Staging-Cloudflared" -Force -ErrorAction Stop
            $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(20))
        }
        Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "up", "-d", "cloudflared"))
        Write-StagingOperationBoundary -Component $LogComponent -Stage "tunnel" -Outcome "success" -Message "Staging Docker sidecar tunnel is the sole runtime" -Data @{ tunnel_mode = $TunnelMode; hostnames = "dev.mad4b.com,mcp-dev.mad4b.com" }
    } else {
        Invoke-Native "docker" ($composeArgs + @("--profile", "tunnel", "stop", "cloudflared"))
        $service = Get-Service -Name "Mad4B-Staging-Cloudflared" -ErrorAction SilentlyContinue
        if ($null -ne $service -and $service.Status -ne "Stopped") { Stop-Service -Name "Mad4B-Staging-Cloudflared" -Force -ErrorAction Stop }
        Write-StagingOperationBoundary -Component $LogComponent -Stage "tunnel" -Outcome "success" -Message "Staging tunnel disabled; no Staging-owned tunnel runtime is running" -Data @{ tunnel_mode = $TunnelMode }
    }
    Invoke-Native "docker" ($composeArgs + @("ps"))

    $schemaSeedStatus = Seed-SchemaBundle $RepositoryPath $ExpectedCommit
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
        tunnel_started = [bool]$TunnelSelected
        tunnel_mode = $TunnelMode
        schema_bundle_required = [bool]$RequireSchemaBundle
        schema_bundle_apply_requested = [bool]$ApplySchemaBundle
        schema_seed_status = $schemaSeedStatus
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
    $certArgs += @("-TunnelMode", $TunnelMode)
    Write-StagingLog -Level info -Component $LogComponent -Stage "certification" -Message "same-cycle Staging certification started" -Data @{ commit = $ExpectedCommit; gateway_enabled = [bool]$activationGatewayEnabled }
    & powershell.exe @certArgs
    if ($LASTEXITCODE -ne 0) {
        $certificationBlockingFailures = @()
        $certificationDegradedReasons = @()
        $failedCertificationState = $null
        try {
            $failedCertificationState = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
            $blockingProperty = $failedCertificationState.PSObject.Properties["certification_blocking_failures"]
            $degradedProperty = $failedCertificationState.PSObject.Properties["certification_degraded_reasons"]
            if ($null -ne $blockingProperty) {
                $certificationBlockingFailures = @($blockingProperty.Value | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
            }
            if ($null -ne $degradedProperty) {
                $certificationDegradedReasons = @($degradedProperty.Value | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
            }
        } catch { }

        $compatibilityRecovered = $false
        $runtimeIntegrityOnlyBlocker = (
            $governedHistoricalResume -and
            @($certificationBlockingFailures).Count -eq 1 -and
            [string]$certificationBlockingFailures[0] -eq "runtime_integrity_verified"
        )

        if ($runtimeIntegrityOnlyBlocker) {
            if ([string]::IsNullOrWhiteSpace($CertificationCompatibilityScript) -or
                [string]::IsNullOrWhiteSpace($CertificationCompatibilityAuthorityCommit)) {
                Fail "Historical certification compatibility authority was not pinned before checkout"
            }

            $compatibility = Invoke-StagingCertificationCompatibilityVerifier `
                -ScriptPath $CertificationCompatibilityScript `
                -AuthorityCommit $CertificationCompatibilityAuthorityCommit `
                -ExpectedCommit $ExpectedCommit.ToLowerInvariant() `
                -ExpectedTree $buildTree.ToLowerInvariant() `
                -ExpectedContextFileSet ([string]$buildContextMetadata.context_file_set_sha256).ToLowerInvariant() `
                -ExpectedImageDigest $imageId.ToLowerInvariant()

            if ($compatibility.verified -eq $true -and $null -ne $failedCertificationState) {
                $recoveredStatus = if (@($certificationDegradedReasons).Count -gt 0) { "degraded" } else { "ready" }
                $failedCertificationState.certification_blocking_failures = @()
                $failedCertificationState.certification_status = $recoveredStatus
                $failedCertificationState.certification_ready = ($recoveredStatus -eq "ready")
                $failedCertificationState.secrets_included = $false

                foreach ($entry in @(
                    @{ Name = "certification_compatibility_applied"; Value = $true },
                    @{ Name = "certification_compatibility_contract"; Value = [string]$compatibility.contract },
                    @{ Name = "certification_compatibility_authority_commit"; Value = [string]$compatibility.authority_commit },
                    @{ Name = "certification_compatibility_mode"; Value = "runtime_integrity_immutable_artifact" },
                    @{ Name = "certification_compatibility_checks"; Value = $compatibility.checks },
                    @{ Name = "certification_compatibility_immutable_artifact_checks"; Value = $compatibility.immutable_artifact_checks }
                )) {
                    $existing = $failedCertificationState.PSObject.Properties[$entry.Name]
                    if ($null -ne $existing) {
                        $existing.Value = $entry.Value
                    } else {
                        $failedCertificationState | Add-Member -NotePropertyName $entry.Name -NotePropertyValue $entry.Value
                    }
                }

                Set-Content -LiteralPath $StateFile -Encoding utf8 -Value ($failedCertificationState | ConvertTo-Json -Depth 12)
                $compatibilityRecovered = $true
                Write-StagingOperationBoundary -Component $LogComponent -Stage "certification-compatibility" -Outcome "success" -Message "Historical runtime-integrity blocker satisfied by pinned current control-plane immutable-artifact proof" -Data @{
                    commit = $ExpectedCommit
                    authority_commit = $CertificationCompatibilityAuthorityCommit
                    recovered_status = $recoveredStatus
                    remaining_degraded_reasons = $certificationDegradedReasons
                    mutation_performed = $false
                    secrets_included = $false
                }
            }
        }

        if (-not $compatibilityRecovered) {
            $reasonSuffix = if (@($certificationBlockingFailures).Count -gt 0) { " reasons=$($certificationBlockingFailures -join ',')" } else { " reasons=unavailable" }
            $failureMessage = "Staging certification blocked exact commit $ExpectedCommit$reasonSuffix"
            Write-StagingOperationBoundary -Component $LogComponent -Stage "certification" -Outcome "failure" -Message $failureMessage -Data @{ commit = $ExpectedCommit; blocking_failures = $certificationBlockingFailures; degraded_reasons = $certificationDegradedReasons }
            Fail $failureMessage
        }
    }
    try { $certState = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json }
    catch { Fail "Staging certification state could not be read" }

    if ($governedHistoricalResume -and [string]$certState.certification_status -eq "degraded") {
        $gatewayCompatibilityReasonSet = @(
            "gateway_recovery_trusted_ingress",
            "gateway_exact_commit",
            "gateway_upstream_ready"
        )
        $currentDegradedReasons = @($certState.certification_degraded_reasons | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $gatewayCompatibilityCandidates = @($currentDegradedReasons | Where-Object { $_ -in $gatewayCompatibilityReasonSet })

        if ($gatewayCompatibilityCandidates.Count -gt 0) {
            $gatewayCompatibility = Invoke-StagingGatewayCompatibilityVerifier `
                -ScriptPath $CertificationGatewayCompatibilityScript `
                -AuthorityCommit $CertificationCompatibilityAuthorityCommit `
                -ExpectedCommit $ExpectedCommit.ToLowerInvariant() `
                -RepositoryPath $RepositoryPath `
                -EnvFile $EnvFile

            if ($gatewayCompatibility.verified -eq $true) {
                $compatibleReasons = @($gatewayCompatibility.compatible_degraded_reasons | ForEach-Object { [string]$_ })
                $remainingReasons = @($currentDegradedReasons | Where-Object { $_ -notin $compatibleReasons })
                $recoveredStatus = if ($remainingReasons.Count -gt 0) { "degraded" } else { "ready" }
                $certState.certification_degraded_reasons = $remainingReasons
                $certState.certification_status = $recoveredStatus
                $certState.certification_ready = ($recoveredStatus -eq "ready")
                $certState.secrets_included = $false

                foreach ($entry in @(
                    @{ Name = "gateway_compatibility_applied"; Value = $true },
                    @{ Name = "gateway_compatibility_contract"; Value = [string]$gatewayCompatibility.contract },
                    @{ Name = "gateway_compatibility_authority_commit"; Value = [string]$gatewayCompatibility.authority_commit },
                    @{ Name = "gateway_compatibility_mode"; Value = "historical_app_current_worker" },
                    @{ Name = "gateway_compatibility_recovered_reasons"; Value = $compatibleReasons },
                    @{ Name = "gateway_compatibility_checks"; Value = $gatewayCompatibility.checks },
                    @{ Name = "gateway_compatibility_bundle_blob_checks"; Value = $gatewayCompatibility.bundle_blob_checks }
                )) {
                    $existing = $certState.PSObject.Properties[$entry.Name]
                    if ($null -ne $existing) {
                        $existing.Value = $entry.Value
                    } else {
                        $certState | Add-Member -NotePropertyName $entry.Name -NotePropertyValue $entry.Value
                    }
                }

                Set-Content -LiteralPath $StateFile -Encoding utf8 -Value ($certState | ConvertTo-Json -Depth 14)
                Write-StagingOperationBoundary -Component $LogComponent -Stage "gateway-certification-compatibility" -Outcome "success" -Message "Historical app/current Worker Gateway compatibility proof satisfied only the proven Gateway degraded reasons" -Data @{
                    commit = $ExpectedCommit
                    authority_commit = $CertificationCompatibilityAuthorityCommit
                    recovered_reasons = $compatibleReasons
                    remaining_degraded_reasons = $remainingReasons
                    recovered_status = $recoveredStatus
                    database_readiness = $certState.database_readiness
                    mutation_performed = $false
                    provider_mutation_performed = $false
                    production_mutation_performed = $false
                    secrets_included = $false
                }
            }
        }
    }

    if ($certState.certification_status -eq "degraded") {
        Write-StagingLog -Level warning -Component $LogComponent -Stage "certification" -Message "Staging is running but not release-ready" -Data @{ commit = $ExpectedCommit; degraded_reasons = @($certState.certification_degraded_reasons); database_readiness = $certState.database_readiness }
    } elseif ($certState.certification_status -eq "ready") {
        Write-StagingOperationBoundary -Component $LogComponent -Stage "certification" -Outcome "success" -Message "Staging exact commit certified ready" -Data @{ commit = $ExpectedCommit; database_readiness = $certState.database_readiness }
    } else {
        Fail "Unsupported Staging certification state: $($certState.certification_status)"
    }

    Write-Host "AUTO_PILOT_STARTED: local staging is running; tunnel_mode=$TunnelMode; commit=$ExpectedCommit certification=$($certState.certification_status)"
    Write-StagingOperationBoundary -Component $LogComponent -Stage "complete" -Outcome "success" -Message "local Staging application operations completed" -Data @{ commit = $ExpectedCommit; tunnel_started = [bool]$TunnelSelected; tunnel_mode = $TunnelMode; services = "redis,runtime-db,governance-db,persistence-db,app"; certification_status = $certState.certification_status }
    Write-Host "APP_OPERATIONS_LOG: $(Get-StagingLogRoot)"
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $BuildContextPath) { Remove-Item -LiteralPath $BuildContextPath -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $CertificationCompatibilityRoot) { Remove-Item -LiteralPath $CertificationCompatibilityRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
