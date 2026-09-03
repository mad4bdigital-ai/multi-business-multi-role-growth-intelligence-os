[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string]$ExpectedCommit,

    [Parameter(Mandatory = $true)]
    [string]$CertificationPrivateKeyPath,

    [Parameter(Mandatory = $true)]
    [string]$RegistrationEvidencePath,

    [Parameter(Mandatory = $true)]
    [string]$OAuthEvidencePath,

    [Parameter(Mandatory = $true)]
    [ValidateSet('RUN_STAGING_RECOVERY_CERTIFICATION')]
    [string]$Confirmation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$ApiRoot = Join-Path $RepositoryPath 'http-generic-api'
$EnvFile = Join-Path $ApiRoot '.env.staging'
$BaseCompose = Join-Path $ApiRoot 'docker-compose.yml'
$StagingCompose = Join-Path $ApiRoot 'docker-compose.staging.yml'
$NodeScript = Join-Path $ApiRoot 'scripts\run-staging-recovery-certification.mjs'

foreach ($requiredPath in @($EnvFile, $BaseCompose, $StagingCompose, $NodeScript, $CertificationPrivateKeyPath, $RegistrationEvidencePath, $OAuthEvidencePath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required file is missing: $requiredPath"
    }
}

function Read-StagingEnvValue {
    param([Parameter(Mandatory = $true)][string]$Name)
    $line = Get-Content -LiteralPath $EnvFile |
        Where-Object { $_ -match ('^' + [Regex]::Escape($Name) + '=') } |
        Select-Object -Last 1
    if (-not $line) { return $null }
    return ($line -split '=', 2)[1].Trim()
}

Push-Location $RepositoryPath
try {
    git fetch --no-tags origin main | Out-Null
    $head = (git rev-parse HEAD).Trim().ToLowerInvariant()
    $main = (git rev-parse origin/main).Trim().ToLowerInvariant()
    if ($head -ne $ExpectedCommit -or $main -ne $ExpectedCommit) {
        throw "Exact-main certification requires HEAD=origin/main=ExpectedCommit. head=$head main=$main expected=$ExpectedCommit"
    }
    if (git status --porcelain --untracked-files=no) {
        throw 'Tracked worktree changes are forbidden during Staging Recovery certification.'
    }

    $runtimeEnvironment = Read-StagingEnvValue -Name 'DEPLOYMENT_ENVIRONMENT'
    if ($runtimeEnvironment -ne 'staging_local_windows_docker') {
        throw "DEPLOYMENT_ENVIRONMENT must be staging_local_windows_docker, got '$runtimeEnvironment'"
    }
    $publicKey = Read-StagingEnvValue -Name 'RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY_PEM_ESCAPED'
    $keyId = Read-StagingEnvValue -Name 'RECOVERY_STAGING_CERTIFICATION_KEY_ID'
    $issuer = Read-StagingEnvValue -Name 'RECOVERY_STAGING_CERTIFICATION_ISSUER'
    if ([string]::IsNullOrWhiteSpace($publicKey) -or [string]::IsNullOrWhiteSpace($keyId) -or [string]::IsNullOrWhiteSpace($issuer)) {
        throw 'Staging certification public trust is not provisioned in .env.staging. Configure public key, key-id and issuer before certification.'
    }

    $dataRootValue = Read-StagingEnvValue -Name 'STAGING_DATA_ROOT'
    if ([string]::IsNullOrWhiteSpace($dataRootValue)) { $dataRootValue = '.\.staging-data' }
    $dataRoot = if ([IO.Path]::IsPathRooted($dataRootValue)) {
        [IO.Path]::GetFullPath($dataRootValue)
    } else {
        [IO.Path]::GetFullPath((Join-Path $ApiRoot $dataRootValue))
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dataRoot 'app') -PathType Container)) {
        throw "Staging app durable bind root is unavailable: $(Join-Path $dataRoot 'app')"
    }

    $compose = @('compose', '--env-file', $EnvFile, '-f', $BaseCompose, '-f', $StagingCompose)
    $running = (& docker @compose ps --status running --services) -join "`n"
    if ($running -notmatch '(?m)^app$') {
        throw 'The Staging app container is not running.'
    }

    # The private certification key must never enter the app container. Only the
    # public trust anchor is present in the Staging runtime environment.
    $privateKeyPresence = (& docker @compose exec -T app sh -lc 'if [ -n "${RECOVERY_STAGING_CERTIFICATION_PRIVATE_KEY_PEM:-}" ]; then echo present; else echo absent; fi').Trim()
    if ($privateKeyPresence -ne 'absent') {
        throw 'Certification private key material is present inside the app container; refusing to continue.'
    }

    $manifestFile = Join-Path ([IO.Path]::GetTempPath()) ("mad4b-staging-recovery-manifest-{0}.json" -f [Guid]::NewGuid().ToString('N'))
    try {
        $manifest = (& docker @compose exec -T app sh -lc 'cat /app/deployment-manifest.json') -join "`n"
        if ([string]::IsNullOrWhiteSpace($manifest)) { throw 'The deployed Staging manifest is unavailable.' }
        [IO.File]::WriteAllText($manifestFile, $manifest + "`n", [Text.UTF8Encoding]::new($false))

        $nodeArgs = @(
            "--env-file=$EnvFile",
            $NodeScript,
            "--expected-sha=$ExpectedCommit",
            "--deployment-manifest-file=$manifestFile",
            "--data-root=$dataRoot",
            "--private-key-file=$([IO.Path]::GetFullPath($CertificationPrivateKeyPath))",
            "--registration-evidence=$([IO.Path]::GetFullPath($RegistrationEvidencePath))",
            "--oauth-evidence=$([IO.Path]::GetFullPath($OAuthEvidencePath))",
            "--confirmation=$Confirmation"
        )
        & node @nodeArgs
        if ($LASTEXITCODE -ne 0) { throw "Staging Recovery certification runner failed with exit code $LASTEXITCODE" }
    }
    finally {
        Remove-Item -LiteralPath $manifestFile -Force -ErrorAction SilentlyContinue
    }
}
finally {
    Pop-Location
}
