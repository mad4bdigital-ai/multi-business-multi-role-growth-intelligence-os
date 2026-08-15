[CmdletBinding()]
param(
    [ValidateSet("Status", "Repair", "Logs")]
    [string]$Mode = "Status",
    [string]$RepositoryPath = "",
    [switch]$RepairTasks,
    [switch]$OpenLogFolder,
    [int]$Tail = 80
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Staging-Operations-Log.ps1")
$LogComponent = "maintenance-doctor"
$policyPath = Join-Path $PSScriptRoot "staging-maintenance-policy.json"
if (-not (Test-Path $policyPath)) { throw "STAGING_DOCTOR_FAIL_CLOSED: maintenance policy is missing" }
$Policy = Get-Content -Raw -LiteralPath $policyPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$apiPath = Join-Path $RepositoryPath "http-generic-api"
$envFile = Join-Path $apiPath ".env.staging"
$logRoot = Get-StagingLogRoot

function Fail([string]$Message) {
    Write-StagingLog -Level error -Component $LogComponent -Stage "fail_closed" -Message $Message
    throw "STAGING_DOCTOR_FAIL_CLOSED: $Message"
}

function Get-EnvValue([string]$Name) {
    if (-not (Test-Path $envFile)) { return "" }
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -replace "^$([regex]::Escape($Name))=", "")
}

function Test-UniqueEnvKeys {
    if (-not (Test-Path $envFile)) { return @{ ok = $false; detail = "missing .env.staging" } }
    $seen = @{}
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=') {
            $key = $Matches[1]
            if ($seen.ContainsKey($key)) { return @{ ok = $false; detail = "duplicate env key: $key" } }
            $seen[$key] = $true
        }
    }
    return @{ ok = $true; detail = "unique env keys" }
}

function Add-Check([System.Collections.Generic.List[object]]$Checks, [string]$Name, [bool]$Ok, [string]$Detail, [bool]$Repairable = $false) {
    $Checks.Add([ordered]@{ name = $Name; ok = $Ok; detail = $Detail; repairable = $Repairable })
}

function Test-CommandCheck([System.Collections.Generic.List[object]]$Checks, [string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    $detail = if ($command) { $command.Source } else { "missing" }
    Add-Check $Checks "command:$Name" ($null -ne $command) $detail $false
}

function Get-TaskCheck([System.Collections.Generic.List[object]]$Checks, [string]$Name) {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    $detail = if ($task) { [string]$task.State } else { "missing" }
    Add-Check $Checks "scheduled-task:$Name" ($null -ne $task) $detail $true
}

function Invoke-Status {
    $checks = [System.Collections.Generic.List[object]]::new()
    Test-CommandCheck $checks "git"
    Test-CommandCheck $checks "docker"
    Test-CommandCheck $checks "gh"
    Test-CommandCheck $checks "wsl"
    Add-Check $checks "repository:path" (Test-Path (Join-Path $RepositoryPath ".git")) $RepositoryPath $false
    $branch = "unknown"
    if (Get-Command git -ErrorAction SilentlyContinue -and (Test-Path (Join-Path $RepositoryPath ".git"))) {
        $branch = ((& git -C $RepositoryPath branch --show-current 2>$null | Out-String).Trim())
    }
    Add-Check $checks "repository:branch" ($branch -eq "main") $branch $false
    $dirty = @()
    if (Test-Path (Join-Path $RepositoryPath ".git")) { $dirty = @(git -C $RepositoryPath status --porcelain --untracked-files=all) }
    $cleanDetail = if ($dirty.Count -eq 0) { "clean" } else { "dirty_files=$($dirty.Count)" }
    Add-Check $checks "repository:clean" ($dirty.Count -eq 0) $cleanDetail $false
    $envKeys = Test-UniqueEnvKeys
    Add-Check $checks "env:unique_keys" $envKeys.ok $envKeys.detail $false
    foreach ($key in $Policy.required_env.PSObject.Properties.Name) {
        $actual = Get-EnvValue $key
        $expected = [string]$Policy.required_env.$key
        $envDetail = if ($actual -eq $expected) { $expected } else { "drift_or_missing" }
        Add-Check $checks "env:$key" ($actual -eq $expected) $envDetail $false
    }
    foreach ($host in $Policy.forbidden_hosts) {
        $found = $false
        if (Test-Path $envFile) { $found = (Get-Content -Raw $envFile) -match [regex]::Escape($host) }
        $hostDetail = if ($found) { "found" } else { "absent" }
        Add-Check $checks "forbidden-host:$host" (-not $found) $hostDetail $false
    }
    Add-Check $checks "logs:directory" (Test-Path $logRoot) $logRoot $true
    Add-Check $checks "logs:latest-status" (Test-Path (Join-Path $logRoot "latest-status.json")) "latest-status.json" $false
    Add-Check $checks "logs:health-snapshot" (Test-Path (Join-Path $logRoot "health-snapshot.json")) "health-snapshot.json" $false
    Get-TaskCheck $checks ([string]$Policy.tasks.auto_deploy)
    Get-TaskCheck $checks ([string]$Policy.tasks.health_monitor)
    $healthScript = Join-Path $PSScriptRoot "Staging-HealthMonitor.ps1"
    if (Test-Path $healthScript) {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $healthScript -RepositoryPath $RepositoryPath -Once
        $healthDetail = if ($LASTEXITCODE -eq 0) { "healthy" } else { "failed; see health-snapshot.json" }
        Add-Check $checks "health:once" ($LASTEXITCODE -eq 0) $healthDetail $false
    } else { Add-Check $checks "health:once" $false "health monitor script missing" $false }
    $ok = @($checks | Where-Object { -not $_.ok }).Count -eq 0
    $report = [ordered]@{ schema_version = 1; contract = [string]$Policy.contract; run_id = Get-StagingRunId; timestamp = (Get-Date).ToUniversalTime().ToString("o"); mode = "status"; ok = $ok; checks = $checks }
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $logRoot "maintenance-status.json") -Encoding utf8
    $statusLevel = if ($ok) { "info" } else { "warning" }
    Write-StagingLog -Level $statusLevel -Component $LogComponent -Stage "status" -Message "maintenance status completed" -Data @{ ok = $ok; failed_checks = @($checks | Where-Object { -not $_.ok }).Count }
    $report | ConvertTo-Json -Depth 12
    if (-not $ok) { exit 1 }
}

function Invoke-Repair {
    Write-StagingOperationBoundary -Component $LogComponent -Stage "repair" -Outcome "start" -Message "safe maintenance repair started"
    New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
    Rotate-StagingOperationsLog
    if ($RepairTasks) {
        $installer = Join-Path $PSScriptRoot "Install-AutoDeployTask.ps1"
        if (-not (Test-Path $installer)) { Fail "task installer is missing" }
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installer -RepositoryPath $RepositoryPath
        if ($LASTEXITCODE -ne 0) { Fail "scheduled task repair failed" }
    }
    $healthScript = Join-Path $PSScriptRoot "Staging-HealthMonitor.ps1"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $healthScript -RepositoryPath $RepositoryPath -Once
    if ($LASTEXITCODE -ne 0) { Fail "health check failed during repair; no data or migration action was attempted" }
    Write-StagingOperationBoundary -Component $LogComponent -Stage "repair" -Outcome "success" -Message "safe maintenance repair completed" -Data @{ tasks_repaired = [bool]$RepairTasks }
    Write-Host "STAGING_DOCTOR_REPAIR_COMPLETE: logs=$logRoot"
}

if ($Mode -eq "Logs") {
    & (Join-Path $PSScriptRoot "Show-StagingLogs.ps1") -Tail $Tail -FailuresOnly:$false -OpenFolder:$OpenLogFolder
    exit $LASTEXITCODE
}
if ($Mode -eq "Repair") { Invoke-Repair; exit 0 }
Invoke-Status
