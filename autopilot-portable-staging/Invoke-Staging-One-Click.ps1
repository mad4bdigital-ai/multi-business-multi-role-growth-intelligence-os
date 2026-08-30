[CmdletBinding()]
param(
    [string]$RepositoryPath = '',
    [ValidateSet('disabled','windows_service','docker_sidecar')]
    [string]$TunnelMode = 'windows_service',
    [switch]$EnableActivationGateway,
    [switch]$NoAutoDeploy,
    [switch]$RequireSchemaBundle,
    [switch]$ApplySchemaBundle,
    [switch]$ProvisionMcpApp,
    [string]$McpRedirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect',
    [ValidateSet('Smart','ForceBuild','SkipBuild')]
    [string]$BuildMode = 'Smart'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
. (Join-Path $root 'Staging-Environment.ps1')

function Fail([string]$Message) { throw "STAGING_DUAL_MODE_ONE_CLICK_FAIL_CLOSED: $Message" }

function Invoke-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "$File exited with code $LASTEXITCODE" }
}

function Get-StagingComposeArgs([string]$RepositoryPath, [string]$EnvFile, [switch]$WindowsOverride) {
    $api = Join-Path $RepositoryPath 'http-generic-api'
    $args = @('compose','-f',(Join-Path $api 'docker-compose.yml'),'-f',(Join-Path $api 'docker-compose.staging.yml'))
    if ($WindowsOverride) {
        $override = Join-Path $api 'docker-compose.staging.windows-service.yml'
        if (-not (Test-Path -LiteralPath $override)) { Fail 'Windows service Compose override is missing.' }
        $args += @('-f',$override)
    }
    $args += @('--env-file',$EnvFile)
    return $args
}

function Stop-WindowsTunnelRuntime {
    $service = Get-Service Cloudflared -ErrorAction SilentlyContinue
    if ($null -eq $service -or $service.Status -eq 'Stopped') { return }
    Stop-Service Cloudflared -ErrorAction Stop
    $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(15))
    $service.Refresh()
    if ($service.Status -ne 'Stopped') { Fail 'Cloudflared Windows service could not be stopped for tunnel-mode mutual exclusion.' }
}

function Stop-DockerTunnelRuntime([string]$RepositoryPath, [string]$EnvFile) {
    # Do not invoke `docker compose` here: on a first install the exact build
    # provenance variables have not been materialized yet and Compose would
    # reject interpolation before it could stop an old sidecar. Inspect only
    # running cloudflared service containers and stop those bound to Staging.
    $idsText = (& docker ps -q --filter 'label=com.docker.compose.service=cloudflared' 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($idsText)) { return }
    foreach ($id in @($idsText -split '\s+' | Where-Object { $_ })) {
        $envJson = (& docker inspect --format '{{json .Config.Env}}' $id 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { continue }
        if ($envJson -notmatch 'TUNNEL_ENVIRONMENT=staging') { continue }
        if ($envJson -notmatch 'TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp_dev\.mad4b\.com') { continue }
        & docker stop $id 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'Docker cloudflared sidecar could not be stopped for tunnel-mode mutual exclusion.' }
    }
}

function Enforce-TunnelRuntimeExclusion([string]$RepositoryPath, [string]$EnvFile, [string]$Mode) {
    switch ($Mode) {
        'windows_service' { Stop-DockerTunnelRuntime $RepositoryPath $EnvFile }
        'docker_sidecar' { Stop-WindowsTunnelRuntime }
        default {
            Stop-WindowsTunnelRuntime
            Stop-DockerTunnelRuntime $RepositoryPath $EnvFile
        }
    }
}

function Invoke-HttpProbe([string]$Uri, [hashtable]$Headers = @{}, [int[]]$AllowedStatus = @(200)) {
    try {
        $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 20 -Headers $Headers -MaximumRedirection 0
        if ($AllowedStatus -notcontains [int]$response.StatusCode) { Fail "Remote probe returned unexpected HTTP $($response.StatusCode): $Uri" }
        return [pscustomobject]@{ uri = $Uri; status = [int]$response.StatusCode; ok = $true }
    } catch {
        $status = $null
        try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch { }
        if ($null -ne $status -and $AllowedStatus -contains $status) {
            return [pscustomobject]@{ uri = $Uri; status = $status; ok = $true }
        }
        Fail "Remote probe failed for $Uri: $($_.Exception.Message)"
    }
}

function Ensure-WindowsLoopbackPublication([string]$RepositoryPath, [string]$EnvFile) {
    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile -WindowsOverride
    Invoke-Checked 'docker' ($composeArgs + @('config','--quiet'))
    # Recreate only the app service from the exact-provenance image already built by
    # the local bootstrap. Never rebuild from an unbound working tree here.
    Invoke-Checked 'docker' ($composeArgs + @('up','-d','--no-build','app'))

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $tcp = Test-NetConnection 127.0.0.1 -Port 8080 -WarningAction SilentlyContinue
        if ($tcp.TcpTestSucceeded -eq $true) {
            try {
                $health = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 10
                if ([int]$health.StatusCode -eq 200) { return }
            } catch { }
        }
        Start-Sleep -Seconds 2
    }
    Fail 'Windows service mode could not establish healthy loopback-only 127.0.0.1:8080 publication.'
}

function Assert-WindowsTunnelRuntime([string]$RepositoryPath, [string]$EnvFile) {
    $origin = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP'
    if ($origin -ne 'http://127.0.0.1:8080') { Fail 'windows_service mode requires loopback origin http://127.0.0.1:8080' }
    Ensure-WindowsLoopbackPublication $RepositoryPath $EnvFile

    $service = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction SilentlyContinue
    if ($null -eq $service) { Fail 'Cloudflared Windows service is not installed.' }
    $pathName = [string]$service.PathName
    if ($pathName -match '(?i)(?:^|\s)--token(?:\s|=)') { Fail 'Cloudflared Windows service must not embed the tunnel token in its command line; use --token-file.' }
    if ($pathName -notmatch '(?i)--token-file') { Fail 'Cloudflared Windows service must use --token-file for Staging.' }
    if ($service.State -ne 'Running') {
        Start-Service Cloudflared
        Start-Sleep -Seconds 2
        $service = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'"
        if ($service.State -ne 'Running') { Fail 'Cloudflared Windows service did not reach Running state.' }
    }
    return [pscustomobject]@{ mode = 'windows_service'; runtime = 'Cloudflared'; origin = $origin; ready = $true }
}

function Assert-DockerTunnelRuntime([string]$RepositoryPath, [string]$EnvFile) {
    $origin = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP'
    if ($origin -ne 'http://app:8080') { Fail 'docker_sidecar mode requires Compose origin http://app:8080' }
    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile
    $id = (& docker @($composeArgs + @('--profile','tunnel','ps','-q','cloudflared')) 2>$null | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($id)) { Fail 'docker_sidecar mode requires the cloudflared Compose service.' }
    $running = (& docker inspect --format '{{.State.Running}}' $id 2>$null | Out-String).Trim().ToLowerInvariant()
    if ($running -ne 'true') { Fail 'cloudflared Compose sidecar is not running.' }
    return [pscustomobject]@{ mode = 'docker_sidecar'; runtime = 'docker'; origin = $origin; ready = $true }
}

function Invoke-StagingPublicReadiness([string]$EnvFile, [string]$Mode, [bool]$ActivationGateway) {
    if ($Mode -eq 'disabled') {
        return [pscustomobject]@{
            public_ingress_ready = $false
            custom_gpt_ready = $false
            tenant_oauth_metadata_ready = $false
            tenant_auth_enforcement_ready = $false
            remote_mcp_ready = $false
            reason = 'tunnel_disabled'
            secrets_included = $false
        }
    }

    $probes = @()
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/health'
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/openapi.tenant-gpt.auth.staging.yaml'
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/openapi.custom-gpt.auth-dispatcher.staging.yaml'
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/.well-known/oauth-authorization-server'
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/.well-known/oauth-protected-resource'
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/connect/status' @{} @(401,403)
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/.well-known/oauth-authorization-server/auth/mcp'
    $probes += Invoke-HttpProbe 'https://mcp_dev.mad4b.com/.well-known/oauth-protected-resource'
    $probes += Invoke-HttpProbe 'https://mcp_dev.mad4b.com/openapi.remote-mcp.staging.yaml'

    $backendKey = Get-StagingEnvValue $EnvFile 'BACKEND_API_KEY'
    if ([string]::IsNullOrWhiteSpace($backendKey)) { Fail 'BACKEND_API_KEY is required for the bounded Admin GPT remote probe.' }
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/system/tools' @{ 'x-api-key' = $backendKey }

    if ($ActivationGateway) {
        $probes += Invoke-HttpProbe 'https://activation-dev.mad4b.com/health'
        $probes += Invoke-HttpProbe 'https://activation-dev.mad4b.com/openapi.tenant-gpt.activation.staging.yaml'
        $probes += Invoke-HttpProbe 'https://activation-dev.mad4b.com/openapi.custom-gpt.activation-admin.staging.yaml'
        $probes += Invoke-HttpProbe 'https://activation-dev.mad4b.com/.well-known/oauth-authorization-server'
        $probes += Invoke-HttpProbe 'https://activation-dev.mad4b.com/tenant/activation/session-context' @{} @(401,403)
    }

    return [pscustomobject]@{
        public_ingress_ready = (@($probes | Where-Object { -not $_.ok }).Count -eq 0)
        custom_gpt_ready = $true
        tenant_oauth_metadata_ready = $true
        tenant_auth_enforcement_ready = $true
        remote_mcp_ready = $true
        probe_count = $probes.Count
        secrets_included = $false
    }
}

function Invoke-McpAppProvisioning([string]$RepositoryPath, [string]$EnvFile, [string]$RedirectUri, [string]$TunnelMode) {
    $appId = Get-StagingEnvValue $EnvFile 'REMOTE_MCP_APP_ID'
    $appSecret = Get-StagingEnvValue $EnvFile 'REMOTE_MCP_APP_SECRET'
    if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($appSecret)) { Fail 'Canonical MCP App ID/App Secret are missing from .env.staging.' }

    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile -WindowsOverride:($TunnelMode -eq 'windows_service')
    Invoke-Checked 'docker' ($composeArgs + @('exec','-T','app','node','scripts/provision-remote-mcp-client.mjs','--environment=staging','--profile=openai_chatgpt',"--client-id=$appId",'--confirm=PROVISION_REMOTE_MCP_STAGING',"--redirect-uri=$RedirectUri",'--redact-secret-output'))
    Invoke-Checked 'docker' ($composeArgs + @('exec','-T','app','node','scripts/provision-remote-mcp-client.mjs','--environment=staging','--profile=openai_chatgpt','--status'))
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = [IO.Path]::GetFullPath((Join-Path $root '..')) }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { Fail "RepositoryPath is not a Git checkout: $RepositoryPath" }

$envState = Initialize-StagingEnvironment -RepositoryPath $RepositoryPath -TunnelMode $TunnelMode -EnableActivationGateway:$EnableActivationGateway -RequireTunnelToken:($TunnelMode -eq 'docker_sidecar')
$envFile = $envState.env_file
Enforce-TunnelRuntimeExclusion $RepositoryPath $envFile $TunnelMode

# The legacy local bootstrap is deliberately tunnel-free for windows_service and
# disabled modes. Its current local-only invariant still expects app:8080 even
# though no external tunnel starts; use that value only during the bootstrap and
# immediately re-assert the selected canonical mode afterwards.
if ($TunnelMode -ne 'docker_sidecar') {
    Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ENABLED' 'false'
    Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP' 'http://app:8080'
}

$bootstrap = Join-Path $root 'Bootstrap-Staging-One-Click.ps1'
$bootstrapArgs = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$bootstrap,'-RepositoryPath',$RepositoryPath,'-BuildMode',$BuildMode)
if ($TunnelMode -ne 'docker_sidecar') { $bootstrapArgs += '-NoTunnel' }
if ($EnableActivationGateway) { $bootstrapArgs += '-EnableActivationGateway' }
if ($NoAutoDeploy) { $bootstrapArgs += '-NoAutoDeploy' }
if ($RequireSchemaBundle) { $bootstrapArgs += '-RequireSchemaBundle' }
if ($ApplySchemaBundle) { $bootstrapArgs += '-ApplySchemaBundle' }
Invoke-Checked 'powershell.exe' $bootstrapArgs

# Re-assert the selected canonical mode after local bootstrap without rotating any
# generated value. From this point forward all public readiness is mode-native.
$envState = Initialize-StagingEnvironment -RepositoryPath $RepositoryPath -TunnelMode $TunnelMode -EnableActivationGateway:$EnableActivationGateway -RequireTunnelToken:($TunnelMode -eq 'docker_sidecar')
$envFile = $envState.env_file

$tunnelState = switch ($TunnelMode) {
    'windows_service' { Assert-WindowsTunnelRuntime $RepositoryPath $envFile }
    'docker_sidecar' { Assert-DockerTunnelRuntime $RepositoryPath $envFile }
    default { [pscustomobject]@{ mode = 'disabled'; runtime = 'none'; origin = $null; ready = $true } }
}

if ($ProvisionMcpApp) {
    if ($TunnelMode -eq 'disabled') { Fail 'MCP app provisioning requires an enabled Staging public ingress mode.' }
    Invoke-McpAppProvisioning $RepositoryPath $envFile $McpRedirectUri $TunnelMode
}

$public = Invoke-StagingPublicReadiness $envFile $TunnelMode ([bool]$EnableActivationGateway)
$ready = $tunnelState.ready -and (($TunnelMode -eq 'disabled') -or ($public.public_ingress_ready -and $public.custom_gpt_ready -and $public.tenant_oauth_metadata_ready -and $public.tenant_auth_enforcement_ready -and $public.remote_mcp_ready))
if (-not $ready) { Fail 'Selected Staging mode did not satisfy public Custom GPT/MCP readiness.' }

$result = [ordered]@{
    contract = 'mad4b.staging-dual-mode-one-click.v1'
    staging_local_ready = $true
    tunnel_mode = $TunnelMode
    tunnel_runtime_ready = [bool]$tunnelState.ready
    tunnel_origin = $tunnelState.origin
    public_https_ready = [bool]$public.public_ingress_ready
    custom_gpt_schema_and_admin_probe_ready = [bool]$public.custom_gpt_ready
    tenant_oauth_metadata_ready = [bool]$public.tenant_oauth_metadata_ready
    tenant_auth_enforcement_ready = [bool]$public.tenant_auth_enforcement_ready
    remote_mcp_metadata_ready = [bool]$public.remote_mcp_ready
    activation_gateway_required = [bool]$EnableActivationGateway
    mcp_app_credentials_present = $envState.mcp_app_id_present -and $envState.mcp_app_secret_present
    mcp_app_provisioning_requested = [bool]$ProvisionMcpApp
    mcp_token_issuance_mode = $envState.mcp_token_issuance_mode
    mcp_access_tokens_persisted_to_env = $false
    platform_ready = $ready
    production_mutation = $false
    provider_mutation = $false
    secrets_included = $false
}
$result | ConvertTo-Json -Depth 6
