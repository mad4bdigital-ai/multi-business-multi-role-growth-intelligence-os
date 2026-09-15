[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedCommit,

    [string]$RepositoryPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Compatibility shim for the recovery entrypoint introduced while repairing the
# schema-only authority seed gap. Canonical role-aware replay lives in
# Replay-StagingGatewayAuthoritySeeds.ps1 because the authority metadata spans
# Runtime and Governance ownership domains.
$CanonicalReplay = Join-Path $PSScriptRoot "Replay-StagingGatewayAuthoritySeeds.ps1"
if (-not (Test-Path -LiteralPath $CanonicalReplay -PathType Leaf)) {
    throw "STAGING_GATEWAY_AUTHORITY_SEED_FAIL_CLOSED: Canonical role-aware replay helper is missing."
}

$arguments = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $CanonicalReplay,
    "-ExpectedCommit", $ExpectedCommit
)
if (-not [string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $arguments += @("-RepositoryPath", $RepositoryPath)
}

& powershell.exe @arguments
if ($LASTEXITCODE -ne 0) {
    throw "STAGING_GATEWAY_AUTHORITY_SEED_FAIL_CLOSED: Canonical role-aware Gateway authority seed replay failed."
}
