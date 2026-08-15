Set-StrictMode -Version Latest
$script:StagingLogSchemaVersion = 1

function Get-StagingRunId {
    if ([string]::IsNullOrWhiteSpace([string]$global:Mad4bStagingRunId)) {
        $global:Mad4bStagingRunId = [guid]::NewGuid().ToString("N")
    }
    return [string]$global:Mad4bStagingRunId
}

function Get-StagingLogRoot {
    if (-not [string]::IsNullOrWhiteSpace($env:MAD4B_STAGING_LOG_ROOT)) {
        $root = [IO.Path]::GetFullPath($env:MAD4B_STAGING_LOG_ROOT)
    } else {
        $root = Join-Path $PSScriptRoot "logs"
    }
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    return $root
}

function Get-StagingLogFile([string]$Name = "operations.jsonl") {
    return Join-Path (Get-StagingLogRoot) $Name
}

function Rotate-StagingOperationsLog {
    $active = Get-StagingLogFile
    if (-not (Test-Path $active)) { return }
    $maxBytes = 10MB
    if ((Get-Item -LiteralPath $active).Length -le $maxBytes) { return }
    for ($index = 4; $index -ge 1; $index--) {
        $source = Get-StagingLogFile ("operations.{0}.jsonl" -f $index)
        $target = Get-StagingLogFile ("operations.{0}.jsonl" -f ($index + 1))
        if (Test-Path $source) { Move-Item -LiteralPath $source -Destination $target -Force }
    }
    Move-Item -LiteralPath $active -Destination (Get-StagingLogFile "operations.1.jsonl") -Force
}

function ConvertTo-StagingSafeText([AllowNull()][object]$Value) {
    if ($null -eq $Value) { return "" }
    $text = if ($Value -is [string]) { $Value } else { $Value | ConvertTo-Json -Depth 8 -Compress }
    $text = [string]$text
    $text = $text -replace '(?i)(CLOUDFLARE_TUNNEL_TOKEN|[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|CLIENT_SECRET))\s*[=:]\s*[^,;\s}\r\n]+', '$1=REDACTED'
    $text = $text -replace '(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+', '$1REDACTED'
    $text = $text -replace '(?i)(ghp_|github_pat_|sk-[A-Za-z0-9_-]{8,})[A-Za-z0-9._~+/=-]*', '$1REDACTED'
    if ($text.Length -gt 4000) { $text = $text.Substring(0, 4000) + "...TRUNCATED" }
    return $text
}

function Write-StagingLog {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("info", "warning", "error")][string]$Level,
        [Parameter(Mandatory = $true)][string]$Component,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Message,
        [hashtable]$Data = @{}
    )
    try {
        $safeData = @{}
        foreach ($key in $Data.Keys) { $safeData[$key] = ConvertTo-StagingSafeText $Data[$key] }
        $record = [ordered]@{
            schema_version = $script:StagingLogSchemaVersion
            run_id = Get-StagingRunId
            timestamp = (Get-Date).ToUniversalTime().ToString("o")
            level = $Level
            component = $Component
            stage = $Stage
            message = ConvertTo-StagingSafeText $Message
            data = $safeData
            pid = $PID
            computer = $env:COMPUTERNAME
        }
        $line = $record | ConvertTo-Json -Depth 8 -Compress
        Add-Content -LiteralPath (Get-StagingLogFile) -Encoding utf8 -Value $line
        Rotate-StagingOperationsLog
        $latest = Join-Path (Get-StagingLogRoot) "latest-status.json"
        $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $latest -Encoding utf8
        if ($Level -eq "error") {
            $failure = Join-Path (Get-StagingLogRoot) "last-failure.json"
            $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $failure -Encoding utf8
        }
    } catch {
        # Logging must never turn a fail-closed decision into a fail-open decision.
        Write-Host "STAGING_LOG_WRITE_FAILED: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

function Write-StagingHeartbeat {
    param(
        [Parameter(Mandatory = $true)][string]$Component,
        [Parameter(Mandatory = $true)][string]$Stage,
        [hashtable]$Data = @{}
    )
    $now = (Get-Date).ToUniversalTime().ToString("o")
    $heartbeat = [ordered]@{
        schema_version = $script:StagingLogSchemaVersion
        run_id = Get-StagingRunId
        component = $Component
        stage = $Stage
        timestamp = $now
        data = $Data
    }
    $heartbeat | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Get-StagingLogFile ("{0}-heartbeat.json" -f $Component)) -Encoding utf8
    Write-StagingLog -Level info -Component $Component -Stage "heartbeat" -Message "component heartbeat" -Data ($Data + @{ heartbeat_at = $now })
}

function Write-StagingOperationBoundary {
    param(
        [Parameter(Mandatory = $true)][string]$Component,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][ValidateSet("start", "success", "failure")][string]$Outcome,
        [string]$Message = "",
        [hashtable]$Data = @{}
    )
    $level = if ($Outcome -eq "failure") { "error" } elseif ($Outcome -eq "success") { "info" } else { "info" }
    $effectiveMessage = if ([string]::IsNullOrWhiteSpace($Message)) { "operation_$Outcome" } else { $Message }
    $effectiveData = @{}
    foreach ($key in $Data.Keys) { $effectiveData[$key] = $Data[$key] }
    $effectiveData["outcome"] = $Outcome
    Write-StagingLog -Level $level -Component $Component -Stage $Stage -Message $effectiveMessage -Data $effectiveData
}
