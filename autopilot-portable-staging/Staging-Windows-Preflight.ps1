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
