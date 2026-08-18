param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-StagingRepositoryIdentity([string]$Value) {
    $normalized = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($normalized)) { return "" }

    if ($normalized -match '^(?:https?://github\.com/|ssh://git@github\.com/)(?<path>[^?#]+)$') {
        $normalized = $Matches.path
    } elseif ($normalized -match '^git@github\.com:(?<path>.+)$') {
        $normalized = $Matches.path
    }

    $normalized = $normalized.Trim().Trim('/') -replace '\.git$', ''
    if ($normalized -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$') { return "" }
    return $normalized.ToLowerInvariant()
}

function Get-StagingOriginIdentity([string]$RepositoryPath) {
    Push-Location $RepositoryPath
    try {
        $origin = (& git remote get-url origin 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($origin)) { return "" }
        return ConvertTo-StagingRepositoryIdentity $origin
    } finally {
        Pop-Location
    }
}

function Assert-StagingOriginIdentity([string]$RepositoryPath, [string]$ExpectedRepository) {
    $expected = ConvertTo-StagingRepositoryIdentity $ExpectedRepository
    if ([string]::IsNullOrWhiteSpace($expected)) { throw "STAGING_REPOSITORY_AUTHORITY_INVALID: expected repository identity is not canonical" }
    $actual = Get-StagingOriginIdentity $RepositoryPath
    if ([string]::IsNullOrWhiteSpace($actual)) { throw "STAGING_REPOSITORY_ORIGIN_UNAVAILABLE: origin is missing or not a canonical GitHub repository" }
    if ($actual -ne $expected) { throw "STAGING_REPOSITORY_ORIGIN_MISMATCH: expected=$expected observed=$actual" }
}

function Write-StagingUtf8NoBom([string]$Path, [string]$Text) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, [string]$Text, $utf8NoBom)
}
