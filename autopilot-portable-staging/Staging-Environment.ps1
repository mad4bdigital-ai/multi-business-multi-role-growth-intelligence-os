[CmdletBinding()]
param()

Set-StrictMode -Version Latest

function ConvertTo-StagingBase64Url([byte[]]$Bytes) {
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function New-StagingRandomValue([int]$ByteCount = 32, [string]$Prefix = '') {
    if ($ByteCount -lt 16) { throw 'Staging generated secrets require at least 16 random bytes.' }
    $bytes = New-Object byte[] $ByteCount
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return $Prefix + (ConvertTo-StagingBase64Url $bytes)
}

function New-StagingMcpAppId {
    return New-StagingRandomValue -ByteCount 18 -Prefix 'mcp_stg_'
}

function New-StagingMcpAppSecret {
    return New-StagingRandomValue -ByteCount 32 -Prefix 'm4b_rmcp_'
}

function Get-StagingEnvValue([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $matches = @(Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" })
    if ($matches.Count -gt 1) { throw "Duplicate environment key is forbidden: $Name" }
    if ($matches.Count -eq 0) { return '' }
    return ($matches[0] -replace "^$([regex]::Escape($Name))=", '')
}

function Set-StagingEnvValue([string]$Path, [string]$Name, [string]$Value) {
    if ($Value -match '[\r\n]') { throw "Invalid newline in environment value: $Name" }
    $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
    $pattern = "^$([regex]::Escape($Name))="
    $found = $false
    $out = @()
    foreach ($line in $lines) {
        if ($line -match $pattern) {
            if ($found) { throw "Duplicate environment key is forbidden: $Name" }
            $out += "$Name=$Value"
            $found = $true
        } else {
            $out += $line
        }
    }
    if (-not $found) { $out += "$Name=$Value" }
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, (($out -join "`r`n").TrimEnd() + "`r`n"), $encoding)
}

function Test-StagingPlaceholder([string]$Value) {
    return [string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)change_me|replace_me|placeholder'
}

function Ensure-StagingGeneratedValue([string]$Path, [string]$Name, [scriptblock]$Factory) {
    $current = Get-StagingEnvValue $Path $Name
    if (Test-StagingPlaceholder $current) {
        $generated = & $Factory
        Set-StagingEnvValue $Path $Name $generated
        return $true
    }
    return $false
}

function Assert-StagingEnvironmentSafety([string]$Path) {
    $text = Get-Content -Raw -LiteralPath $Path
    if ($text -match '(?im)^(CLOUDFLARE_TUNNEL_HOSTNAMES|PUBLIC_BASE_URL|AUTH_BASE_URL|PLATFORM_JWT_ISSUER|REMOTE_MCP_RESOURCE_URL)=.*(?:auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com)') {
        throw 'Production hostname leaked into Staging environment.'
    }
    if ($text -notmatch '(?im)^TENANT_GPT_SSO_COOKIE_MODE=host_only\s*$') { throw 'Staging SSO cookie mode must be host_only.' }
    foreach ($key in @('MIGRATION_APPLIED','PRODUCTION_MUTATION_AUTHORIZED','RULESET_MUTATION_AUTHORIZED')) {
        if ((Get-StagingEnvValue $Path $key).ToLowerInvariant() -ne 'false') { throw "$key must remain false in Staging bootstrap." }
    }
    $appId = Get-StagingEnvValue $Path 'REMOTE_MCP_APP_ID'
    if ($appId -and $appId -notmatch '^mcp_stg_[A-Za-z0-9_-]{16,128}$') { throw 'REMOTE_MCP_APP_ID is not a Staging-scoped MCP client identity.' }
    $appSecret = Get-StagingEnvValue $Path 'REMOTE_MCP_APP_SECRET'
    if ($appSecret -and $appSecret.Length -lt 32) { throw 'REMOTE_MCP_APP_SECRET must be at least 32 characters.' }
    if ((Get-StagingEnvValue $Path 'REMOTE_MCP_OAUTH_SIGNING_SECRET') -eq (Get-StagingEnvValue $Path 'JWT_SECRET')) {
        throw 'Remote MCP signing authority must be isolated from the platform JWT secret.'
    }
}

function Initialize-StagingEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryPath,
        [ValidateSet('disabled','windows_service','docker_sidecar')][string]$TunnelMode = 'windows_service',
        [switch]$EnableActivationGateway,
        [switch]$RequireTunnelToken
    )

    $repo = [IO.Path]::GetFullPath($RepositoryPath)
    $apiPath = Join-Path $repo 'http-generic-api'
    $example = Join-Path $apiPath '.env.staging.example'
    $envFile = Join-Path $apiPath '.env.staging'
    if (-not (Test-Path -LiteralPath $example)) { throw "Staging env template is missing: $example" }
    if (-not (Test-Path -LiteralPath $envFile)) { Copy-Item -LiteralPath $example -Destination $envFile }

    $generatedFactories = [ordered]@{
        'DB_PASSWORD' = { New-StagingRandomValue 32 }
        'RUNTIME_DB_ROOT_PASSWORD' = { New-StagingRandomValue 32 }
        'GOVERNANCE_DB_PASSWORD' = { New-StagingRandomValue 32 }
        'GOVERNANCE_DB_ROOT_PASSWORD' = { New-StagingRandomValue 32 }
        'RUNTIME_PERSISTENCE_DB_PASSWORD' = { New-StagingRandomValue 32 }
        'RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD' = { New-StagingRandomValue 32 }
        'BACKEND_API_KEY' = { New-StagingRandomValue 32 -Prefix 'stg_bak_' }
        'JWT_SECRET' = { New-StagingRandomValue 48 }
        'TENANT_GPT_SSO_SIGNING_SECRET' = { New-StagingRandomValue 48 }
        'TOKEN_ENCRYPTION_KEY' = { New-StagingRandomValue 48 }
        'TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET' = { New-StagingRandomValue 32 -Prefix 'stg_tenant_' }
        'TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET' = { New-StagingRandomValue 32 -Prefix 'stg_activation_' }
        'REMOTE_MCP_OAUTH_SIGNING_SECRET' = { New-StagingRandomValue 48 -Prefix 'stg_rmcp_sign_' }
        'REMOTE_MCP_APP_ID' = { New-StagingMcpAppId }
        'REMOTE_MCP_APP_SECRET' = { New-StagingMcpAppSecret }
    }
    $generatedNames = @()
    foreach ($entry in $generatedFactories.GetEnumerator()) {
        if (Ensure-StagingGeneratedValue $envFile $entry.Key $entry.Value) { $generatedNames += $entry.Key }
    }

    Set-StagingEnvValue $envFile 'STAGING_TUNNEL_MODE' $TunnelMode
    Set-StagingEnvValue $envFile 'REMOTE_MCP_ENVIRONMENT' 'staging'
    Set-StagingEnvValue $envFile 'REMOTE_MCP_ENABLED' 'true'
    Set-StagingEnvValue $envFile 'REMOTE_MCP_OAUTH_ENABLED' 'true'
    Set-StagingEnvValue $envFile 'REMOTE_MCP_OAUTH_DCR_ENABLED' 'false'
    Set-StagingEnvValue $envFile 'REMOTE_MCP_CLIENT_PROFILE_KEY' 'openai_chatgpt'
    Set-StagingEnvValue $envFile 'REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS' 'https://chatgpt.com,https://www.chatgpt.com,https://claude.ai,https://www.claude.ai'
    Set-StagingEnvValue $envFile 'REMOTE_MCP_RESOURCE_URL' 'https://mcp_dev.mad4b.com'
    Set-StagingEnvValue $envFile 'REMOTE_MCP_AUTHORIZATION_SERVER_URL' 'https://dev.mad4b.com/auth/mcp'
    Set-StagingEnvValue $envFile 'REMOTE_MCP_RESOURCE_DOCUMENTATION_URL' 'https://mcp_dev.mad4b.com/docs'
    Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_HOSTNAMES' 'dev.mad4b.com,mcp_dev.mad4b.com'

    switch ($TunnelMode) {
        'windows_service' {
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ENABLED' 'true'
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_RUNTIME' 'windows_service'
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP' 'http://127.0.0.1:8080'
            Set-StagingEnvValue $envFile 'STAGING_APP_HOST_BIND' '127.0.0.1:8080:8080'
            Set-StagingEnvValue $envFile 'STAGING_DOCKER_TUNNEL_ENABLED' 'false'
        }
        'docker_sidecar' {
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ENABLED' 'true'
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_RUNTIME' 'docker_sidecar'
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP' 'http://app:8080'
            Set-StagingEnvValue $envFile 'STAGING_APP_HOST_BIND' ''
            Set-StagingEnvValue $envFile 'STAGING_DOCKER_TUNNEL_ENABLED' 'true'
        }
        default {
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ENABLED' 'false'
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_RUNTIME' 'disabled'
            Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP' ''
            Set-StagingEnvValue $envFile 'STAGING_APP_HOST_BIND' ''
            Set-StagingEnvValue $envFile 'STAGING_DOCKER_TUNNEL_ENABLED' 'false'
        }
    }

    Set-StagingEnvValue $envFile 'ACTIVATION_STAGING_GATEWAY_ENABLED' ($(if ($EnableActivationGateway) { 'true' } else { 'false' }))
    Set-StagingEnvValue $envFile 'ACTIVATION_HOST_GATEWAY_HOST' 'activation-dev.mad4b.com'
    Set-StagingEnvValue $envFile 'ACTIVATION_STAGING_UPSTREAM_HOST' 'dev.mad4b.com'
    Set-StagingEnvValue $envFile 'ACTIVATION_STAGING_AUTH_HOST' 'activation-dev.mad4b.com'
    Set-StagingEnvValue $envFile 'TENANT_GPT_STAGING_ACTIVATION_AUTHORIZATION_SERVER_URL' 'https://activation-dev.mad4b.com'
    Set-StagingEnvValue $envFile 'TENANT_GPT_STAGING_ACTIVATION_RESOURCE_URL' 'https://activation-dev.mad4b.com'

    Set-StagingEnvValue $envFile 'MIGRATION_APPLIED' 'false'
    Set-StagingEnvValue $envFile 'DATABASE_MUTATED' 'false'
    Set-StagingEnvValue $envFile 'PRODUCTION_MUTATION_AUTHORIZED' 'false'
    Set-StagingEnvValue $envFile 'RULESET_MUTATION_AUTHORIZED' 'false'

    if ($RequireTunnelToken -and $TunnelMode -ne 'disabled' -and [string]::IsNullOrWhiteSpace((Get-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_TOKEN'))) {
        throw 'Selected Staging tunnel mode requires CLOUDFLARE_TUNNEL_TOKEN in ignored .env.staging.'
    }

    Assert-StagingEnvironmentSafety $envFile
    return [pscustomobject]@{
        contract = 'mad4b.staging-environment-bootstrap.v1'
        env_file = $envFile
        tunnel_mode = $TunnelMode
        tunnel_origin = Get-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP'
        generated_keys = @($generatedNames)
        mcp_app_id_present = -not [string]::IsNullOrWhiteSpace((Get-StagingEnvValue $envFile 'REMOTE_MCP_APP_ID'))
        mcp_app_secret_present = -not [string]::IsNullOrWhiteSpace((Get-StagingEnvValue $envFile 'REMOTE_MCP_APP_SECRET'))
        mcp_access_tokens_persisted_to_env = $false
        production_mutation = $false
        provider_mutation = $false
        secrets_included = $false
    }
}
