[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [int]$IntervalSeconds = 60,
    [switch]$Once
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$LogComponent = "health-monitor"
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$apiPath = Join-Path $RepositoryPath "http-generic-api"
$envFile = Join-Path $apiPath ".env.staging"
$composeBase = Join-Path $apiPath "docker-compose.yml"
$composeStage = Join-Path $apiPath "docker-compose.staging.yml"

function Write-HealthFailure([string]$Message, [hashtable]$Data = @{}) {
    Write-StagingLog -Level error -Component $LogComponent -Stage "health-check" -Message $Message -Data $Data
    Write-Host "STAGING_HEALTH_FAILURE_LOGGED: $(Get-StagingLogRoot)" -ForegroundColor Red
}

function Get-Env([string]$Name) {
    if (-not (Test-Path $envFile)) { return "" }
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -replace "^$([regex]::Escape($Name))=", "")
}

function Invoke-HealthCheck {
    $required = @("redis", "runtime-db", "governance-db", "persistence-db", "app")
    $snapshot = [ordered]@{
        schema_version = 1
        run_id = Get-StagingRunId
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        repository_path = $RepositoryPath
        docker_context = "unknown"
        services = @()
        tunnel_expected = ((Get-Env "CLOUDFLARE_TUNNEL_ENABLED") -eq "true")
        ok = $false
    }
    try {
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "docker command is missing" }
        if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { throw "remote Docker environment is forbidden" }
        $context = (& docker context show 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $context -notin @("default", "desktop-linux")) { throw "Docker context is not local: $context" }
        $snapshot.docker_context = $context
        $compose = @("compose", "-f", $composeBase, "-f", $composeStage, "--env-file", $envFile)
        & docker @compose config --quiet 2>$null
        if ($LASTEXITCODE -ne 0) { throw "Staging Compose model is invalid" }
        foreach ($service in $required) {
            $id = (& docker @compose ps -q $service 2>$null | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($id)) { throw "service container is missing: $service" }
            $health = (& docker inspect --format "{{.State.Health.Status}}" $id 2>$null | Out-String).Trim()
            $state = (& docker inspect --format "{{.State.Status}}" $id 2>$null | Out-String).Trim()
            $snapshot.services += [ordered]@{ service = $service; state = $state; health = $health }
            if ($health -ne "healthy" -or $state -ne "running") { throw "service is not healthy: $service state=$state health=$health" }
        }
        $snapshot.ok = $true
        Write-StagingHeartbeat -Component $LogComponent -Stage "health-check" -Data @{ services = ($required -join ","); docker_context = $context }
        Write-StagingLog -Level info -Component $LogComponent -Stage "health-check" -Message "all required Staging services are healthy" -Data @{ services = ($required -join ","); docker_context = $context }
    } catch {
        $snapshot.ok = $false
        Write-HealthFailure $_.Exception.Message -Data @{ docker_context = $snapshot.docker_context }
    }
    $snapshot | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Get-StagingLogFile "health-snapshot.json") -Encoding utf8
    return [bool]$snapshot.ok
}

Write-StagingOperationBoundary -Component $LogComponent -Stage "process" -Outcome "start" -Message "health monitor started" -Data @{ interval_seconds = $IntervalSeconds; once = [bool]$Once }
if ($IntervalSeconds -lt 30) { Write-HealthFailure "health interval must be at least 30 seconds"; exit 1 }
while ($true) {
    $ok = Invoke-HealthCheck
    if ($Once) { if (-not $ok) { exit 1 }; exit 0 }
    Start-Sleep -Seconds $IntervalSeconds
}
