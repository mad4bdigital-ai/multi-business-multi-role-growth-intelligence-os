[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-StagingWsl2DistributionText {
    return (& wsl.exe --list --verbose 2>$null | Out-String)
}

function Test-StagingWsl2DistributionReady([string]$WslList = "") {
    if ([string]::IsNullOrWhiteSpace($WslList)) { return $false }
    $normalized = $WslList -replace "\x00", ""
    return $normalized -match '(?im)^\s*\*?\s*\S+\s+\S+\s+2\s*$'
}

function Test-StagingWsl2Ready {
    return Test-StagingWsl2DistributionReady (Get-StagingWsl2DistributionText)
}

function Wait-StagingWsl2Distribution([int]$Attempts = 12, [int]$DelaySeconds = 5) {
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        if (Test-StagingWsl2Ready) { return $true }
        if ($attempt -lt ($Attempts - 1)) { Start-Sleep -Seconds $DelaySeconds }
    }
    return $false
}

function Get-StagingDockerDesktopExecutable {
    $candidates = @(
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe' } else { $null }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe' } else { $null })
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
    }
    return ""
}

function Test-StagingDockerEngineReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { return $false }
    $context = (& docker context show 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $context -notin @('default', 'desktop-linux')) { return $false }
    $server = (& docker info --format '{{.ServerVersion}}' 2>$null | Out-String).Trim()
    return ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($server))
}

function Ensure-StagingDockerDesktopReady(
    [ValidateRange(30, 600)][int]$TimeoutSeconds = 180,
    [ValidateRange(1, 15)][int]$PollSeconds = 3
) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'STAGING_BOOTSTRAP_BLOCKED: reason=docker_command_missing'
    }
    if ($env:DOCKER_HOST) {
        throw 'STAGING_BOOTSTRAP_BLOCKED: reason=remote_docker_host_forbidden'
    }
    if ($env:DOCKER_CONTEXT) {
        throw 'STAGING_BOOTSTRAP_BLOCKED: reason=remote_docker_context_env_forbidden'
    }

    $context = (& docker context show 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $context -notin @('default', 'desktop-linux')) {
        throw "STAGING_BOOTSTRAP_BLOCKED: reason=docker_context_not_local observed=$context"
    }

    if (Test-StagingDockerEngineReady) {
        return [pscustomobject]@{
            ready = $true
            desktop_started = $false
            context = $context
            timeout_seconds = $TimeoutSeconds
            attempts = 1
        }
    }

    $desktop = Get-StagingDockerDesktopExecutable
    if ([string]::IsNullOrWhiteSpace($desktop)) {
        throw 'STAGING_BOOTSTRAP_BLOCKED: reason=docker_desktop_executable_missing'
    }

    $desktopStarted = $false
    $runningDesktop = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $runningDesktop) {
        try {
            Start-Process -FilePath $desktop -WindowStyle Minimized | Out-Null
            $desktopStarted = $true
        } catch {
            throw "STAGING_BOOTSTRAP_BLOCKED: reason=docker_desktop_start_failed detail=$($_.Exception.Message)"
        }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $attempts = 0
    while ([DateTime]::UtcNow -lt $deadline) {
        $attempts++
        if (Test-StagingDockerEngineReady) {
            return [pscustomobject]@{
                ready = $true
                desktop_started = [bool]$desktopStarted
                context = ((& docker context show 2>$null | Out-String).Trim())
                timeout_seconds = $TimeoutSeconds
                attempts = $attempts
            }
        }
        Start-Sleep -Seconds $PollSeconds
    }

    throw "STAGING_BOOTSTRAP_BLOCKED: reason=docker_engine_start_timeout timeout_seconds=$TimeoutSeconds poll_seconds=$PollSeconds"
}
