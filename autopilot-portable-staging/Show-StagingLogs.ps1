[CmdletBinding()]
param(
    [ValidateSet("all", "auto-pilot", "auto-deploy", "app-operations")]
    [string]$Component = "all",
    [int]$Tail = 80,
    [switch]$FailuresOnly,
    [switch]$OpenFolder
)

Set-StrictMode -Version Latest
$root = Join-Path $PSScriptRoot "logs"
if ($OpenFolder) {
    if (Test-Path $root) { Start-Process explorer.exe $root } else { Write-Host "No Staging logs exist yet: $root" }
    return
}
if (-not (Test-Path (Join-Path $root "operations.jsonl"))) {
    Write-Host "No Staging logs exist yet: $root"
    return
}
$records = @(Get-Content -LiteralPath (Join-Path $root "operations.jsonl") | ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
} | Where-Object { $null -ne $_ })
if ($Component -ne "all") { $records = @($records | Where-Object { $_.component -eq $Component }) }
if ($FailuresOnly) { $records = @($records | Where-Object { $_.level -eq "error" }) }
$records | Select-Object -Last ([Math]::Max(1, $Tail)) | ForEach-Object {
    $data = if ($_.data) { ($_.data | ConvertTo-Json -Compress -Depth 6) } else { "{}" }
    "[{0}] {1} {2}/{3}: {4} {5}" -f $_.timestamp, $_.level.ToUpperInvariant(), $_.component, $_.stage, $_.message, $data
}
Write-Host "Log root: $root"
Write-Host "Last failure snapshot: $(Join-Path $root 'last-failure.json')"
