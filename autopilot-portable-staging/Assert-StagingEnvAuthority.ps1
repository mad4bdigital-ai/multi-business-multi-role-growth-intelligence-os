[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    throw "STAGING_ENV_AUTHORITY_FAIL_CLOSED: $Message"
}

$repo = [IO.Path]::GetFullPath($RepositoryPath)
$envFile = Join-Path $repo 'http-generic-api\.env.staging'

# A first-run bootstrap may not have materialized .env.staging yet. The core
# bootstrap owns creation from the tracked template; validate only once present.
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    exit 0
}

$seen = @{}
$lineNumber = 0

foreach ($rawLine in Get-Content -LiteralPath $envFile) {
    $lineNumber++
    $line = [string]$rawLine
    $trimmed = $line.Trim()

    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) {
        continue
    }

    $equalsIndex = $line.IndexOf('=')
    if ($equalsIndex -lt 0) {
        Fail "Non-comment .env.staging line $lineNumber is not a KEY=VALUE assignment."
    }

    $rawName = $line.Substring(0, $equalsIndex)
    $normalizedName = $rawName.Trim()

    if ($normalizedName.StartsWith('export ')) {
        $normalizedName = $normalizedName.Substring(7).Trim()
    }

    if ($normalizedName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        Fail "Invalid environment key syntax at line $lineNumber."
    }

    # Compose accepts whitespace around names that the PowerShell exact readers
    # do not. Reject that ambiguity instead of allowing two authorities to exist.
    if ($rawName -cne $normalizedName) {
        Fail "Non-canonical environment key syntax is forbidden at line ${lineNumber}: $normalizedName"
    }

    if ($seen.ContainsKey($normalizedName)) {
        Fail "Duplicate environment key is forbidden after normalization: $normalizedName"
    }

    $seen[$normalizedName] = $true
}

[pscustomobject]@{
    contract = 'mad4b.staging-env-authority.v1'
    status = 'passed'
    env_file = $envFile
    canonical_key_count = $seen.Count
    secrets_included = $false
    production_mutation = $false
    database_mutation = $false
    provider_mutation = $false
} | ConvertTo-Json -Depth 4
