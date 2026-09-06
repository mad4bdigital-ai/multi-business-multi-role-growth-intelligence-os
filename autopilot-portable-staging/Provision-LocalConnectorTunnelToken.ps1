[CmdletBinding()]
param(
    [string]$ConnectorRoot = "C:\mad4b-connector\local-connector",
    [string]$SourceTokenPath = "",
    [string]$TunnelId = "",
    [switch]$RecoverExistingTunnelToken,
    [string]$CloudflareAccountId = $env:CLOUDFLARE_ACCOUNT_ID,
    [string]$CloudflareApiToken = $env:CLOUDFLARE_API_TOKEN,
    [switch]$InstallRuntime,
    [string]$StatePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$EnvPath = Join-Path $ConnectorRoot ".env"
$SecretsRoot = Join-Path $ConnectorRoot "secrets"
$TokenFile = Join-Path $SecretsRoot "cloudflared-token.txt"
$InstallerPath = Join-Path $ConnectorRoot "install-service.ps1"
if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path (Split-Path -Parent $PSCommandPath) "logs\local-connector-tunnel-provisioning.json"
}

function Write-State([hashtable]$State) {
    $State["generated_at"] = [DateTime]::UtcNow.ToString("o")
    $State["secrets_included"] = $false
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StatePath) | Out-Null
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($StatePath, ($State | ConvertTo-Json -Depth 10), $encoding)
}

function Set-DotEnvValue([string]$Name, [string]$Value) {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        throw "Existing Local Connector .env is required; provisioning will not invent unrelated connector secrets."
    }
    $lines = @(Get-Content -LiteralPath $EnvPath -ErrorAction Stop)
    $prefix = "$Name="
    $updated = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ([string]$lines[$i] -like "$prefix*") {
            $lines[$i] = "$Name=$Value"
            $updated = $true
        }
    }
    if (-not $updated) { $lines += "$Name=$Value" }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($EnvPath, [string[]]$lines, $encoding)
}

function Protect-TokenFile([string]$Path) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $Path /inheritance:r /grant:r "${identity}:(R,W)" /grant:r "SYSTEM:F" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to restrict Local Connector tunnel token file ACL."
    }
}

function Write-TokenFile([string]$Token) {
    $value = ([string]$Token).Trim()
    if ($value.Length -le 20) { throw "Local Connector tunnel token is empty or invalid." }
    New-Item -ItemType Directory -Force -Path $SecretsRoot | Out-Null
    $temporary = "$TokenFile.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    $encoding = New-Object System.Text.UTF8Encoding($false)
    try {
        [IO.File]::WriteAllText($temporary, $value, $encoding)
        Move-Item -LiteralPath $temporary -Destination $TokenFile -Force
        Protect-TokenFile $TokenFile
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    }
    return [IO.Path]::GetFullPath($TokenFile)
}

function Read-TokenFromFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Source token file does not exist: $resolved"
    }
    return [IO.File]::ReadAllText($resolved).Trim()
}

function Get-ExistingTunnelToken([string]$AccountId, [string]$ApiToken, [string]$Id) {
    if ([string]::IsNullOrWhiteSpace($AccountId) -or [string]::IsNullOrWhiteSpace($ApiToken)) {
        throw "connector_tunnel_provisioning_required: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for provider recovery."
    }
    if ($Id -notmatch '^[0-9a-fA-F-]{36}$') {
        throw "connector_tunnel_provisioning_required: an exact existing TunnelId is required for provider recovery."
    }

    $headers = @{ Authorization = "Bearer $ApiToken"; "Content-Type" = "application/json" }
    $base = "https://api.cloudflare.com/client/v4/accounts/$AccountId/cfd_tunnel/$Id"
    try {
        $tunnel = Invoke-RestMethod -Method Get -Uri $base -Headers $headers -TimeoutSec 15 -ErrorAction Stop
    } catch {
        throw "connector_tunnel_provisioning_required: existing Cloudflare tunnel lookup failed."
    }
    if ($tunnel.success -ne $true -or $null -eq $tunnel.result) {
        throw "connector_tunnel_provisioning_required: existing Cloudflare tunnel was not resolved."
    }

    try {
        $tokenResult = Invoke-RestMethod -Method Get -Uri "$base/token" -Headers $headers -TimeoutSec 15 -ErrorAction Stop
    } catch {
        throw "connector_tunnel_provisioning_required: existing Cloudflare tunnel token could not be retrieved."
    }
    $token = [string]$tokenResult.result
    if ($tokenResult.success -ne $true -or $token.Trim().Length -le 20) {
        throw "connector_tunnel_provisioning_required: Cloudflare returned no usable tunnel token."
    }
    return $token.Trim()
}

$state = @{
    contract = "mad4b.staging-local-connector-token-provisioning.v1"
    connector_root = [IO.Path]::GetFullPath($ConnectorRoot)
    credential_mode = "token_file"
    source = "none"
    tunnel_id = if ([string]::IsNullOrWhiteSpace($TunnelId)) { $null } else { $TunnelId }
    token_file_written = $false
    token_file_acl_restricted = $false
    provider_lookup_attempted = $false
    provider_mutation = $false
    dns_mutation = $false
    production_mutation = $false
    runtime_install_attempted = $false
    status = "checking"
}

try {
    if (-not (Test-Path -LiteralPath $ConnectorRoot -PathType Container)) {
        throw "Local Connector root is missing: $ConnectorRoot"
    }
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        throw "Existing Local Connector .env is required."
    }

    $token = ""
    if (-not [string]::IsNullOrWhiteSpace($SourceTokenPath)) {
        $token = Read-TokenFromFile $SourceTokenPath
        $state.source = "operator_token_file"
    } elseif (-not [string]::IsNullOrWhiteSpace($env:CONNECTOR_CLOUDFLARED_TUNNEL_TOKEN)) {
        $token = [string]$env:CONNECTOR_CLOUDFLARED_TUNNEL_TOKEN
        $state.source = "connector_specific_process_env"
    } elseif ($RecoverExistingTunnelToken) {
        $state.provider_lookup_attempted = $true
        $token = Get-ExistingTunnelToken $CloudflareAccountId $CloudflareApiToken $TunnelId
        $state.source = "cloudflare_existing_tunnel_read_only"
    } else {
        throw "connector_tunnel_provisioning_required: provide SourceTokenPath, CONNECTOR_CLOUDFLARED_TUNNEL_TOKEN, or RecoverExistingTunnelToken with provider authority."
    }

    $writtenPath = Write-TokenFile $token
    Remove-Variable token -ErrorAction SilentlyContinue
    $env:CONNECTOR_CLOUDFLARED_TUNNEL_TOKEN = $null
    Set-DotEnvValue "CONNECTOR_CLOUDFLARED_TOKEN_FILE" $writtenPath
    if (-not [string]::IsNullOrWhiteSpace($TunnelId)) {
        Set-DotEnvValue "CONNECTOR_CLOUDFLARED_TUNNEL_ID" $TunnelId
    }
    $state.token_file_written = $true
    $state.token_file_acl_restricted = $true

    if ($InstallRuntime) {
        $state.runtime_install_attempted = $true
        if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
            throw "Local Connector installer is missing: $InstallerPath"
        }
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $InstallerPath
        if ($LASTEXITCODE -ne 0) { throw "Local Connector installer failed after token provisioning." }
    }

    $state.status = "provisioned"
    Write-State $state
    Write-Host "LOCAL_CONNECTOR_TUNNEL_TOKEN_PROVISIONED: mode=token_file source=$($state.source) provider_mutation=false dns_mutation=false"
    exit 0
} catch {
    $message = [string]$_.Exception.Message
    $state.status = if ($message -match '^connector_tunnel_provisioning_required:') { "connector_tunnel_provisioning_required" } else { "provisioning_failed" }
    $state["error_class"] = $state.status
    Write-State $state
    Write-Host "LOCAL_CONNECTOR_TUNNEL_PROVISIONING_BLOCKED: status=$($state.status)" -ForegroundColor Red
    exit 2
}
