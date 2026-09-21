Set-StrictMode -Version Latest

function Write-StagingCanonicalRepairJsonAtomic {
    param([Parameter(Mandatory = $true)][string]$Path,[Parameter(Mandatory = $true)][object]$Value)
    $tmp = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $json = ($Value | ConvertTo-Json -Depth 40) + [Environment]::NewLine
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($tmp, $json, $utf8NoBom)
        Move-Item -LiteralPath $tmp -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
}
