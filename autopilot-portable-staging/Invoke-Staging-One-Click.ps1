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
    [ValidateRange(65,300)]
    [int]$TunnelStabilitySeconds = 95,
    [ValidateSet('Smart','ForceBuild','SkipBuild')]
    [string]$BuildMode = 'Smart'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
. (Join-Path $root 'Staging-Environment.ps1')
. (Join-Path $root 'Staging-WindowsCloudflared.ps1')

function Fail([string]$Message) { throw "STAGING_DUAL_MODE_ONE_CLICK_FAIL_CLOSED: $Message" }

function Invoke-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "$File exited with code $LASTEXITCODE" }
}

function Get-StagingComposeArgs(
    [string]$RepositoryPath,
    [string]$EnvFile,
    [switch]$WindowsOverride,
    [switch]$DockerTunnelOverride
) {
    $api = Join-Path $RepositoryPath 'http-generic-api'
    $args = @('compose','-f',(Join-Path $api 'docker-compose.yml'),'-f',(Join-Path $api 'docker-compose.staging.yml'))
    if ($WindowsOverride) {
        $override = Join-Path $api 'docker-compose.staging.windows-service.yml'
        if (-not (Test-Path -LiteralPath $override)) { Fail 'Windows service Compose override is missing.' }
        $args += @('-f',$override)
    }
    if ($DockerTunnelOverride) {
        $override = Join-Path $api 'docker-compose.staging.docker-sidecar.yml'
        if (-not (Test-Path -LiteralPath $override)) { Fail 'Docker sidecar Compose override is missing.' }
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
    if ($service.Status -ne 'Stopped') { Fail 'Cloudflared Windows service could not be stopped before Staging topology transition.' }
}

function Stop-DockerTunnelRuntime {
    $idsText = (& docker ps -q --filter 'label=com.docker.compose.service=cloudflared' 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($idsText)) { return }
    foreach ($id in @($idsText -split '\s+' | Where-Object { $_ })) {
        $envJson = (& docker inspect --format '{{json .Config.Env}}' $id 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { continue }
        $isStaging = $envJson -match 'TUNNEL_ENVIRONMENT=staging' -or $envJson -match 'CLOUDFLARE_TUNNEL_ENVIRONMENT=staging'
        $isCanonical = $envJson -match 'TUNNEL_ORIGIN_APP=http://127\.0\.0\.1:8080' -or $envJson -match 'CLOUDFLARE_TUNNEL_ORIGIN_APP=http://127\.0\.0\.1:8080'
        if (-not ($isStaging -or $isCanonical)) { continue }
        & docker stop $id 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'Docker cloudflared sidecar could not be stopped before Staging topology transition.' }
    }
}

function Quiesce-StagingTunnelRuntimes {
    Stop-WindowsTunnelRuntime
    Stop-DockerTunnelRuntime
}

function Assert-WindowsTunnelInactive {
    $service = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.State -eq 'Running') {
        Fail 'Tunnel mutual-exclusion violation: Cloudflared Windows service is running while docker_sidecar mode is selected.'
    }
}

function Assert-DockerTunnelInactive([string]$RepositoryPath, [string]$EnvFile) {
    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile -DockerTunnelOverride
    $id = (& docker @($composeArgs + @('--profile','tunnel','ps','-q','cloudflared')) 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Fail 'Could not prove Docker tunnel inactivity for Windows service mode.' }
    if ([string]::IsNullOrWhiteSpace($id)) { return }
    foreach ($containerId in @($id -split '\s+' | Where-Object { $_ })) {
        $running = (& docker inspect --format '{{.State.Running}}' $containerId 2>$null | Out-String).Trim().ToLowerInvariant()
        if ($LASTEXITCODE -ne 0) { Fail 'Could not inspect Docker tunnel state for mutual-exclusion evidence.' }
        if ($running -eq 'true') {
            Fail 'Tunnel mutual-exclusion violation: Docker cloudflared is running while windows_service mode is selected.'
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
        Fail "Remote probe failed for ${Uri}: $($_.Exception.Message)"
    }
}

function Ensure-WindowsLoopbackPublication([string]$RepositoryPath, [string]$EnvFile) {
    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile -WindowsOverride
    Invoke-Checked 'docker' ($composeArgs + @('config','--quiet'))
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

function Assert-WindowsTunnelRuntime([string]$RepositoryPath, [string]$EnvFile, [int]$StabilitySeconds) {
    $origin = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP'
    if ($origin -ne 'http://127.0.0.1:8080') { Fail 'windows_service mode requires canonical origin http://127.0.0.1:8080' }
    Ensure-WindowsLoopbackPublication $RepositoryPath $EnvFile
    Assert-DockerTunnelInactive $RepositoryPath $EnvFile

    try { $reconciled = Ensure-StagingCloudflaredWindowsService $EnvFile }
    catch { Fail "Windows Cloudflared self-healing failed: $($_.Exception.Message)" }
    $initialPid = [int]$reconciled.process_id
    $deadline = [DateTime]::UtcNow.AddSeconds($StabilitySeconds)
    $samples = 0
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 5
        $after = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction SilentlyContinue
        if ($null -eq $after -or $after.State -ne 'Running' -or [int]$after.ProcessId -ne $initialPid) {
            Fail "Cloudflared Windows service did not remain process-stable for $StabilitySeconds seconds."
        }
        $samples++
    }

    $health = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 10
    if ([int]$health.StatusCode -ne 200) { Fail 'Windows tunnel origin lost local health after stability window.' }
    try { $remoteOrigin = Assert-StagingRemoteManagedOriginEvidence 'windows_service' $EnvFile }
    catch { Fail $_.Exception.Message }
    Assert-DockerTunnelInactive $RepositoryPath $EnvFile

    return [pscustomobject]@{
        mode = 'windows_service'; runtime = 'Cloudflared'; origin = $origin; process_id = $initialPid
        stability_seconds = $StabilitySeconds; stability_samples = $samples
        service_reconciled = [bool]$reconciled.service_reconciled
        remote_managed_origin_verified = $true; remote_managed_origin = $remoteOrigin.remote_managed_origin
        mutually_exclusive = $true; ready = $true
    }
}

function Assert-DockerTunnelRuntime([string]$RepositoryPath, [string]$EnvFile) {
    $origin = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP'
    if ($origin -ne 'http://127.0.0.1:8080') { Fail 'docker_sidecar mode requires canonical shared loopback origin http://127.0.0.1:8080' }
    Assert-WindowsTunnelInactive
    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile -DockerTunnelOverride
    Invoke-Checked 'docker' ($composeArgs + @('config','--quiet'))
    Invoke-Checked 'docker' ($composeArgs + @('--profile','tunnel','up','-d','--no-deps','--force-recreate','cloudflared'))
    $id = (& docker @($composeArgs + @('--profile','tunnel','ps','-q','cloudflared')) 2>$null | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($id)) { Fail 'docker_sidecar mode requires the cloudflared Compose service.' }
    $running = (& docker inspect --format '{{.State.Running}}' $id 2>$null | Out-String).Trim().ToLowerInvariant()
    if ($running -ne 'true') { Fail 'cloudflared Compose sidecar is not running.' }
    $networkMode = (& docker inspect --format '{{.HostConfig.NetworkMode}}' $id 2>$null | Out-String).Trim()
    if ($networkMode -notmatch '^container:') { Fail 'Docker cloudflared must share the app network namespace for canonical loopback origin compatibility.' }
    Start-Sleep -Seconds 8
    $runningAfter = (& docker inspect --format '{{.State.Running}}' $id 2>$null | Out-String).Trim().ToLowerInvariant()
    if ($runningAfter -ne 'true') { Fail 'cloudflared Compose sidecar exited during the initial stability check.' }
    try { $remoteOrigin = Assert-StagingRemoteManagedOriginEvidence 'docker_sidecar' $EnvFile $id }
    catch { Fail $_.Exception.Message }
    Assert-WindowsTunnelInactive
    return [pscustomobject]@{
        mode = 'docker_sidecar'; runtime = 'docker'; origin = $origin; container_id = $id
        remote_managed_origin_verified = $true; remote_managed_origin = $remoteOrigin.remote_managed_origin
        mutually_exclusive = $true; ready = $true
    }
}

function Invoke-StagingSemanticSchemaReadiness([string]$RepositoryPath, [string]$EnvFile, [string]$Mode, [bool]$ActivationGateway) {
    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile -WindowsOverride:($Mode -eq 'windows_service') -DockerTunnelOverride:($Mode -eq 'docker_sidecar')
    $scriptArgs = @('exec','-T','app','node','scripts/staging-public-schema-readiness.mjs')
    if ($ActivationGateway) { $scriptArgs += '--activation-required' }
    $raw = (& docker @($composeArgs + $scriptArgs) 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "Published OpenAPI semantic readiness failed: $raw" }
    try { $evidence = $raw | ConvertFrom-Json -ErrorAction Stop }
    catch { Fail 'Published OpenAPI semantic readiness did not emit valid JSON evidence.' }
    if ($evidence.ready -ne $true) { Fail 'Published OpenAPI semantic readiness did not reach ready=true.' }
    return $evidence
}

function Invoke-StagingPublicReadiness([string]$RepositoryPath, [string]$EnvFile, [string]$Mode, [bool]$ActivationGateway) {
    if ($Mode -eq 'disabled') {
        return [pscustomobject]@{
            public_ingress_ready = $false; schema_semantic_ready = $false; custom_gpt_ready = $false
            tenant_oauth_metadata_ready = $false; tenant_auth_enforcement_ready = $false
            remote_mcp_ready = $false; activation_gateway_ready = $false
            reason = 'tunnel_disabled'; secrets_included = $false
        }
    }

    $probes = @()
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/health'
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/.well-known/oauth-authorization-server'
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/.well-known/oauth-protected-resource'
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/connect/status' @{} @(401,403)
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/.well-known/oauth-authorization-server/auth/mcp'
    $probes += Invoke-HttpProbe 'https://mcp_dev.mad4b.com/.well-known/oauth-protected-resource'

    $backendKey = Get-StagingEnvValue $EnvFile 'BACKEND_API_KEY'
    if ([string]::IsNullOrWhiteSpace($backendKey)) { Fail 'BACKEND_API_KEY is required for the bounded Admin GPT remote probe.' }
    $probes += Invoke-HttpProbe 'https://dev.mad4b.com/system/tools' @{ Authorization = "Bearer $backendKey" }

    if ($ActivationGateway) {
        $probes += Invoke-HttpProbe 'https://activation-dev.mad4b.com/health'
        $probes += Invoke-HttpProbe 'https://activation-dev.mad4b.com/.well-known/oauth-authorization-server'
        $probes += Invoke-HttpProbe 'https://activation-dev.mad4b.com/tenant/activation/session-context' @{} @(401,403)
    }

    $semantic = Invoke-StagingSemanticSchemaReadiness $RepositoryPath $EnvFile $Mode $ActivationGateway
    $allHttpReady = @($probes | Where-Object { -not $_.ok }).Count -eq 0
    return [pscustomobject]@{
        public_ingress_ready = $allHttpReady
        schema_semantic_ready = [bool]$semantic.ready
        custom_gpt_ready = $allHttpReady -and [bool]$semantic.ready
        tenant_oauth_metadata_ready = $true
        tenant_auth_enforcement_ready = $true
        remote_mcp_ready = $allHttpReady -and [bool]$semantic.ready
        activation_gateway_ready = [bool]$ActivationGateway -and $allHttpReady -and [bool]$semantic.ready
        probe_count = $probes.Count; schema_count = $semantic.schema_count; secrets_included = $false
    }
}

function Invoke-StagingAuthenticatedRemoteReadiness([string]$RepositoryPath, [string]$EnvFile, [string]$Mode) {
    if ($Mode -eq 'disabled') {
        return [pscustomobject]@{
            ready = $false; probe_principal_active = $false; tenant_oauth_ready = $false
            tenant_authenticated_action_ready = $false; remote_mcp_oauth_ready = $false
            remote_mcp_read_ready = $false; probe_residue = 0; reason = 'tunnel_disabled'; secrets_included = $false
        }
    }
    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile -WindowsOverride:($Mode -eq 'windows_service') -DockerTunnelOverride:($Mode -eq 'docker_sidecar')
    $raw = (& docker @($composeArgs + @('exec','-T','app','node','scripts/staging-authenticated-remote-readiness.mjs')) 2>&1 | Out-String).Trim()
    $exit = $LASTEXITCODE
    $lines = @($raw -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($lines.Count -eq 0) { Fail 'Authenticated Tenant/MCP readiness emitted no evidence.' }
    try { $evidence = $lines[-1] | ConvertFrom-Json -ErrorAction Stop }
    catch { Fail 'Authenticated Tenant/MCP readiness did not emit valid final JSON evidence.' }
    if ($exit -ne 0 -or $evidence.ready -ne $true) {
        $reason = if ($evidence.failure.code) { $evidence.failure.code } else { "exit_$exit" }
        Fail "Authenticated Tenant/MCP remote readiness failed: $reason"
    }
    if ($evidence.probe_residue -ne 0) { Fail "Authenticated Tenant/MCP readiness left durable probe residue: $($evidence.probe_residue)" }
    if ($evidence.secrets_included -ne $false -or $evidence.runtime_tokens_persisted_to_env -ne $false) { Fail 'Authenticated remote readiness violated the secret boundary.' }
    return $evidence
}

function Invoke-McpAppProvisioning([string]$RepositoryPath, [string]$EnvFile, [string]$RedirectUri, [string]$TunnelMode) {
    $appId = Get-StagingEnvValue $EnvFile 'REMOTE_MCP_APP_ID'
    $appSecret = Get-StagingEnvValue $EnvFile 'REMOTE_MCP_APP_SECRET'
    if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($appSecret)) { Fail 'Canonical MCP App ID/App Secret are missing from .env.staging.' }
    $composeArgs = Get-StagingComposeArgs $RepositoryPath $EnvFile -WindowsOverride:($TunnelMode -eq 'windows_service') -DockerTunnelOverride:($TunnelMode -eq 'docker_sidecar')
    Invoke-Checked 'docker' ($composeArgs + @('exec','-T','app','node','scripts/provision-remote-mcp-client.mjs','--environment=staging','--profile=openai_chatgpt',"--client-id=$appId",'--confirm=PROVISION_REMOTE_MCP_STAGING',"--redirect-uri=$RedirectUri",'--redact-secret-output'))
    Invoke-Checked 'docker' ($composeArgs + @('exec','-T','app','node','scripts/provision-remote-mcp-client.mjs','--environment=staging','--profile=openai_chatgpt','--status'))
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { $RepositoryPath = [IO.Path]::GetFullPath((Join-Path $root '..')) }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { Fail "RepositoryPath is not a Git checkout: $RepositoryPath" }

$envState = Initialize-StagingEnvironment -RepositoryPath $RepositoryPath -TunnelMode $TunnelMode -EnableActivationGateway:$EnableActivationGateway -RequireTunnelToken:($TunnelMode -eq 'docker_sidecar')
$envFile = $envState.env_file
Quiesce-StagingTunnelRuntimes

# Bootstrap the local stack without a tunnel, then restore the selected canonical mode.
Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ENABLED' 'false'
Set-StagingEnvValue $envFile 'CLOUDFLARE_TUNNEL_ORIGIN_APP' 'http://app:8080'

$bootstrap = Join-Path $root 'Bootstrap-Staging-One-Click.ps1'
$bootstrapArgs = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$bootstrap,'-RepositoryPath',$RepositoryPath,'-BuildMode',$BuildMode,'-NoTunnel')
if ($EnableActivationGateway) { $bootstrapArgs += '-EnableActivationGateway' }
if ($NoAutoDeploy) { $bootstrapArgs += '-NoAutoDeploy' }
if ($RequireSchemaBundle) { $bootstrapArgs += '-RequireSchemaBundle' }
if ($ApplySchemaBundle) { $bootstrapArgs += '-ApplySchemaBundle' }
Invoke-Checked 'powershell.exe' $bootstrapArgs

$envState = Initialize-StagingEnvironment -RepositoryPath $RepositoryPath -TunnelMode $TunnelMode -EnableActivationGateway:$EnableActivationGateway -RequireTunnelToken:($TunnelMode -eq 'docker_sidecar')
$envFile = $envState.env_file

$tunnelState = switch ($TunnelMode) {
    'windows_service' { Assert-WindowsTunnelRuntime $RepositoryPath $envFile $TunnelStabilitySeconds }
    'docker_sidecar' { Assert-DockerTunnelRuntime $RepositoryPath $envFile }
    default { [pscustomobject]@{ mode = 'disabled'; runtime = 'none'; origin = $null; remote_managed_origin_verified = $false; mutually_exclusive = $true; ready = $true } }
}

if ($ProvisionMcpApp) {
    if ($TunnelMode -eq 'disabled') { Fail 'MCP app provisioning requires an enabled Staging public ingress mode.' }
    Invoke-McpAppProvisioning $RepositoryPath $envFile $McpRedirectUri $TunnelMode
}

$public = Invoke-StagingPublicReadiness $RepositoryPath $envFile $TunnelMode ([bool]$EnableActivationGateway)
$authenticated = Invoke-StagingAuthenticatedRemoteReadiness $RepositoryPath $envFile $TunnelMode
$publicRequired = $TunnelMode -ne 'disabled'
$activationRequiredForPlatform = $true
$platformReady = $publicRequired -and [bool]$EnableActivationGateway -and $tunnelState.ready -and $tunnelState.remote_managed_origin_verified -and $public.public_ingress_ready -and $public.schema_semantic_ready -and $public.custom_gpt_ready -and $public.tenant_oauth_metadata_ready -and $public.tenant_auth_enforcement_ready -and $authenticated.ready -and $authenticated.tenant_oauth_ready -and $authenticated.tenant_authenticated_action_ready -and $public.remote_mcp_ready -and $authenticated.remote_mcp_oauth_ready -and $authenticated.remote_mcp_read_ready -and ($authenticated.probe_residue -eq 0) -and $public.activation_gateway_ready

if ($publicRequired -and -not $EnableActivationGateway) {
    Fail 'PLATFORM_READY requires the Staging Activation Gateway; rerun with -EnableActivationGateway or select disabled for local-only readiness.'
}

$databaseMutationScope = if ($ProvisionMcpApp) { 'remote_mcp_client_provisioning_plus_authenticated_oauth_probe_zero_residue' } elseif ($publicRequired) { 'authenticated_oauth_probe_zero_residue' } else { 'none' }
$result = [ordered]@{
    contract = 'mad4b.staging-dual-mode-one-click.v1'
    staging_local_ready = $true
    tunnel_mode = $TunnelMode
    tunnel_runtime_ready = [bool]$tunnelState.ready
    tunnel_mutual_exclusion_verified = [bool]$tunnelState.mutually_exclusive
    tunnel_origin = $tunnelState.origin
    remote_managed_tunnel_origin_required = 'http://127.0.0.1:8080'
    remote_managed_tunnel_origin_verified = [bool]$tunnelState.remote_managed_origin_verified
    public_https_ready = [bool]$public.public_ingress_ready
    openapi_semantic_ready = [bool]$public.schema_semantic_ready
    custom_gpt_schema_and_admin_probe_ready = [bool]$public.custom_gpt_ready
    authenticated_remote_e2e_required = $true
    readiness_probe_principal_configured = [bool]$envState.readiness_probe_principal_configured
    readiness_probe_principal_active = [bool]$authenticated.probe_principal_active
    tenant_oauth_metadata_ready = [bool]$public.tenant_oauth_metadata_ready
    tenant_auth_enforcement_ready = [bool]$public.tenant_auth_enforcement_ready
    tenant_oauth_flow_ready = [bool]$authenticated.tenant_oauth_ready
    tenant_authenticated_action_ready = [bool]$authenticated.tenant_authenticated_action_ready
    tenant_authenticated_action_state = if ($authenticated.tenant_authenticated_action_ready) { 'ready' } else { 'blocked' }
    remote_mcp_metadata_and_schema_ready = [bool]$public.remote_mcp_ready
    remote_mcp_oauth_ready = [bool]$authenticated.remote_mcp_oauth_ready
    remote_mcp_authenticated_read_ready = [bool]$authenticated.remote_mcp_read_ready
    remote_mcp_oauth_read_state = if ($authenticated.remote_mcp_oauth_ready -and $authenticated.remote_mcp_read_ready) { 'ready' } else { 'blocked' }
    authenticated_probe_residue = $authenticated.probe_residue
    activation_gateway_required = $activationRequiredForPlatform
    activation_gateway_enabled = [bool]$EnableActivationGateway
    activation_gateway_ready = [bool]$public.activation_gateway_ready
    mcp_app_credentials_present = $envState.mcp_app_id_present -and $envState.mcp_app_secret_present
    mcp_app_provisioning_requested = [bool]$ProvisionMcpApp
    mcp_token_issuance_mode = $envState.mcp_token_issuance_mode
    mcp_access_tokens_persisted_to_env = $false
    staging_database_mutation = [bool]($ProvisionMcpApp -or $publicRequired)
    staging_database_transient_probe_mutation = [bool]$publicRequired
    database_mutation_scope = $databaseMutationScope
    production_database_mutation = $false
    platform_ready = [bool]$platformReady
    local_only_mode = $TunnelMode -eq 'disabled'
    production_mutation = $false
    cloudflare_mutation = $false
    provider_mutation = $false
    secrets_included = $false
}
$result | ConvertTo-Json -Depth 6
