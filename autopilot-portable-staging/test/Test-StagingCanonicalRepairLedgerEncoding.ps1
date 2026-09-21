Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'Staging-CanonicalRepairLedger.ps1')
$target = Join-Path ([IO.Path]::GetTempPath()) "canonical-repair-ledger-$PID.json"
try {
    Write-StagingCanonicalRepairJsonAtomic -Path $target -Value ([ordered]@{ contract='mad4b.staging.canonical-semantic-repair-ledger.v2'; state='reserved'; unicode='اختبار' })
    $bytes = [IO.File]::ReadAllBytes($target)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw 'Ledger JSON contains a UTF-8 BOM' }
    $parsed = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    if ($parsed.state -ne 'reserved' -or $parsed.unicode -ne 'اختبار') { throw 'Ledger JSON round-trip failed' }
    Write-Output 'Windows PowerShell UTF-8 no-BOM ledger regression passed'
} finally {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
}
