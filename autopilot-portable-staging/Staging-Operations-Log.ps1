$script:StagingLogSchemaVersion = 2
$script:StagingLogWriteFailureAt = $null
# A PowerShell host may invoke Auto Deploy repeatedly in the same process. A
# global run id that is only initialized once collapses separate invocations into
# one evidence stream. Dot-sourcing this helper starts a fresh invocation scope;
# child processes receive their own run id and never inherit stale parent state.
$script:StagingLogInvocationRunId = [guid]::NewGuid().ToString("N")
$global:Mad4bStagingRunId = $script:StagingLogInvocationRunId

function Get-StagingRunId {
    $current = Get-Variable -Name Mad4bStagingRunId -Scope Global -ValueOnly -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace([string]$current)) {
        $global:Mad4bStagingRunId = [guid]::NewGuid().ToString("N")
        $current = $global:Mad4bStagingRunId
    }
    return [string]$current
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

function Invoke-StagingLogLocked([scriptblock]$Action) {
    $mutex = $null
    $acquired = $false
    try {
        $mutex = New-Object System.Threading.Mutex($false, "Global\Mad4bStagingOperationsLog")
        try {
            $acquired = $mutex.WaitOne(15000)
        } catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) { throw "shared Staging log lock timeout after 15 seconds" }
        & $Action
    } finally {
        if ($acquired -and $null -ne $mutex) { try { $mutex.ReleaseMutex() } catch { } }
        if ($null -ne $mutex) { try { $mutex.Dispose() } catch { } }
    }
}

function Write-StagingUtf8Atomic([string]$Path, [string]$Text) {
    $temporary = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    $encoding = New-Object System.Text.UTF8Encoding($false)
    try {
        [IO.File]::WriteAllText($temporary, $Text, $encoding)
        $completed = $false
        for ($attempt = 0; $attempt -lt 6 -and -not $completed; $attempt++) {
            try {
                Move-Item -LiteralPath $temporary -Destination $Path -Force -ErrorAction Stop
                $completed = $true
            } catch {
                if ($attempt -eq 5) { throw }
                Start-Sleep -Milliseconds ([int](50 * [math]::Pow(2, $attempt)))
            }
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    }
}

function Write-StagingAtomicJson([string]$Path, [object]$Value, [int]$Depth = 10) {
    $json = $Value | ConvertTo-Json -Depth $Depth
    Invoke-StagingLogLocked { Write-StagingUtf8Atomic $Path $json }
}

function Repair-StagingLegacyAutoDeployState {
    # Runtime state is intentionally untracked and can outlive schema evolution.
    # Add only optional compatibility fields; never infer deployment/certification
    # success and never replace an invalid JSON file that Auto Deploy should reject.
    $path = Join-Path $PSScriptRoot "auto-deploy-state.json"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
    try { $state = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -ErrorAction Stop }
    catch { return }
    if ($null -eq $state) { return }

    $defaults = [ordered]@{
        deployed_commit = ""
        certification_status = ""
        certified_commit = ""
        certified_branch = ""
        certification_degraded_reasons = @()
        certification_blocking_failures = @()
    }
    $changed = $false
    foreach ($name in $defaults.Keys) {
        if ($null -eq $state.PSObject.Properties[$name]) {
            $state | Add-Member -NotePropertyName $name -NotePropertyValue $defaults[$name]
            $changed = $true
        }
    }
    if ($changed) { Write-StagingAtomicJson $path $state 12 }
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

function Test-StagingPreserveFreshChildFailure([string]$FailurePath, [object]$Record, [hashtable]$SafeData) {
    if ([string]$Record.component -ne "auto-deploy") { return $false }
    if (-not $SafeData.ContainsKey("parent_error") -or [string]$SafeData.parent_error -ne "AUTO_DEPLOY_FAIL_CLOSED") { return $false }
    if (-not (Test-Path -LiteralPath $FailurePath -PathType Leaf)) { return $false }
    try { $existing = Get-Content -Raw -LiteralPath $FailurePath | ConvertFrom-Json -ErrorAction Stop }
    catch { return $false }
    if ($null -eq $existing -or [string]$existing.level -ne "error" -or [string]$existing.component -eq "auto-deploy") { return $false }
    try {
        $existingAt = [DateTime]::Parse([string]$existing.timestamp).ToUniversalTime()
        $recordAt = [DateTime]::Parse([string]$Record.timestamp).ToUniversalTime()
        $age = ($recordAt - $existingAt).TotalSeconds
        if ($age -lt 0 -or $age -gt 180) { return $false }
    } catch { return $false }

    $currentExpected = if ($SafeData.ContainsKey("expected_commit")) { [string]$SafeData.expected_commit } else { "" }
    $existingExpected = if ($existing.PSObject.Properties.Name -contains "expected_commit") { [string]$existing.expected_commit } else { "" }
    if ($currentExpected -and $existingExpected -and $currentExpected -ne $existingExpected) { return $false }
    return $true
}

function Write-StagingLog {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("info", "warning", "error")][string]$Level,
        [Parameter(Mandatory = $true)][string]$Component,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Message,
        [hashtable]$Data = @{}
    )
    $record = $null
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
        # Promote the bounded root-cause keys needed by recovery automation so
        # last-failure.json does not collapse a precise child failure into a
        # generic parent launcher error. Values remain redacted by the same
        # serializer as ordinary log data.
        foreach ($rootKey in @("failure_class", "expected_commit", "observed_commit", "parent_error", "blocking_reason")) {
            if ($safeData.ContainsKey($rootKey) -and -not [string]::IsNullOrWhiteSpace([string]$safeData[$rootKey])) {
                $record[$rootKey] = [string]$safeData[$rootKey]
            }
        }
        $line = ($record | ConvertTo-Json -Depth 8 -Compress) + [Environment]::NewLine
        Invoke-StagingLogLocked {
            $encoding = New-Object System.Text.UTF8Encoding($false)
            $written = $false
            for ($attempt = 0; $attempt -lt 6 -and -not $written; $attempt++) {
                try {
                    [IO.File]::AppendAllText((Get-StagingLogFile), $line, $encoding)
                    $written = $true
                } catch {
                    if ($attempt -eq 5) { throw }
                    Start-Sleep -Milliseconds ([int](50 * [math]::Pow(2, $attempt)))
                }
            }
            Rotate-StagingOperationsLog
            $latest = Join-Path (Get-StagingLogRoot) "latest-status.json"
            Write-StagingUtf8Atomic $latest ($record | ConvertTo-Json -Depth 8)
            if ($Level -eq "error") {
                $failure = Join-Path (Get-StagingLogRoot) "last-failure.json"
                if (-not (Test-StagingPreserveFreshChildFailure $failure $record $safeData)) {
                    Write-StagingUtf8Atomic $failure ($record | ConvertTo-Json -Depth 8)
                }
            }
        }
    } catch {
        $now = (Get-Date).ToUniversalTime()
        $shouldReport = $null -eq $script:StagingLogWriteFailureAt -or (($now - $script:StagingLogWriteFailureAt).TotalSeconds -ge 60)
        if ($shouldReport) {
            $script:StagingLogWriteFailureAt = $now
            Write-Host "STAGING_LOG_WRITE_FAILED: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
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
    Write-StagingAtomicJson (Get-StagingLogFile ("{0}-heartbeat.json" -f $Component)) $heartbeat 10
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

Repair-StagingLegacyAutoDeployState
