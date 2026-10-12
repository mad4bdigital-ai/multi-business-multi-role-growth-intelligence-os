[CmdletBinding()]
param(
    [string]$RepositoryPath = "",
    [string]$TokenFile = "C:\ProgramData\Mad4B\Staging\ProviderSecrets\cloudflare-api-token.txt",
    [Parameter(Mandatory = $true)]
    [string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Confirmation -ne "ENABLE_STAGING_ACTIVATION_GATEWAY_PROVIDER_AUTHORITY") {
    throw "Typed confirmation mismatch. Expected ENABLE_STAGING_ACTIVATION_GATEWAY_PROVIDER_AUTHORITY."
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
$EnvFile = Join-Path $RepositoryPath "http-generic-api\.env.staging"
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Staging environment file is missing: $EnvFile"
}

. (Join-Path $PSScriptRoot "Staging-Environment.ps1")

$directory = Split-Path -Parent $TokenFile
New-Item -ItemType Directory -Force -Path $directory | Out-Null

$existing = ""
if (Test-Path -LiteralPath $TokenFile -PathType Leaf) {
    $existing = Get-Content -Raw -LiteralPath $TokenFile -ErrorAction SilentlyContinue
}

if ([string]::IsNullOrWhiteSpace($existing)) {
    Write-Host "Secure input required: dedicated Staging Cloudflare API token."
    $secure = Read-Host "Cloudflare API token" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        if ([string]::IsNullOrWhiteSpace($plain) -or $plain.Trim().Length -lt 20) {
            throw "Cloudflare API token is empty or unexpectedly short."
        }
        $encoding = New-Object Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($TokenFile, $plain.Trim(), $encoding)
    }
    finally {
        if ($null -ne $ptr -and $ptr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        }
        $plain = $null
        $secure = $null
    }
}

& icacls.exe $TokenFile "/inheritance:r" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Unable to disable inherited ACLs for provider secret file." }
& icacls.exe $TokenFile "/grant:r" "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Unable to apply SYSTEM/Administrators ACLs for provider secret file." }

$hostPath = $TokenFile.Replace("\", "/")
Set-StagingEnvValue $EnvFile "STAGING_CLOUDFLARE_API_TOKEN_HOST_FILE" $hostPath
Set-StagingEnvValue $EnvFile "STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED" "true"

Assert-StagingEnvironmentSafety $EnvFile

[pscustomobject]@{
    contract = "mad4b.staging-activation-gateway-provider-authority.v1"
    status = "configured"
    environment = "staging"
    provider = "cloudflare"
    secret_transport = "docker_secret_file"
    secret_file_present = (Test-Path -LiteralPath $TokenFile -PathType Leaf)
    feature_gate_enabled = $true
    provider_mutation_performed = $false
    database_mutation_performed = $false
    production_mutation_performed = $false
    secrets_included = $false
}
