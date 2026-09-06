# Mad4B Local Connector Watchdog
# Runs independently from server.mjs. Keeps the connector-owned cloudflared runtime
# and local-connector alive, publishes authenticated runtime health only to the
# environment-bound control plane, and rolls back server.mjs if a bad upgrade
# prevents local health from returning. Both Windows-service and legacy Scheduled
# Task installations are supported so reboot recovery does not depend on one installer.

param(
  [string]$Root = "C:\mad4b-connector\local-connector",
  [string]$ConnectorService = "local-connector",
  [string]$CloudflaredService = "cloudflared",
  [string]$ConnectorTask = "GrowthIntelligence-LocalConnector",
  [string]$CloudflaredTask = "GrowthIntelligence-CloudflaredTunnel",
  [int]$Port = 7070,
  [int]$HealthTimeoutSeconds = 8
)

$ErrorActionPreference = "Continue"
$WatchdogVersion = "2026.09.06.1"
$AgentVersion = "2026.05.28.1"
$LogPath = Join-Path $Root "watchdog.log"
$StatePath = Join-Path $Root "connector-runtime-state.json"
$EnvPath = Join-Path $Root ".env"
$ServerPath = Join-Path $Root "server.mjs"
$StablePath = Join-Path $Root "server.mjs.stable"
$LastGoodPath = Join-Path $Root "server.mjs.lastgood"
$PublicHealthUrl = "https://connector.mad4b.com/health"

function Write-WatchdogLog($Message) {
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Get-ServiceState($Name) {
  try {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { return "missing" }
    return $svc.Status.ToString().ToLowerInvariant()
  } catch {
    return "unknown"
  }
}

function Get-TaskState($Name) {
  try {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if (-not $task) { return "missing" }
    return ([string]$task.State).ToLowerInvariant()
  } catch {
    return "unknown"
  }
}

function Get-DotEnvValue([string]$Name) {
  try {
    if (-not (Test-Path $EnvPath)) { return "" }
    $prefix = "$Name="
    foreach ($line in Get-Content -LiteralPath $EnvPath -ErrorAction Stop) {
      $text = [string]$line
      if ($text.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
        return $text.Substring($prefix.Length).Trim()
      }
    }
  } catch {
    Write-WatchdogLog "env_read_failed name=$Name"
  }
  return ""
}

function Get-ConnectorEnvironmentBinding {
  $environment = (Get-DotEnvValue "CONNECTOR_ENVIRONMENT").ToLowerInvariant()
  $expectedHost = switch ($environment) {
    "production" { "auth.mad4b.com" }
    "staging" { "dev.mad4b.com" }
    default { "" }
  }
  return [pscustomobject]@{
    environment = $environment
    expected_host = $expectedHost
  }
}

function Test-HeartbeatBinding([string]$HeartbeatUrl) {
  $binding = Get-ConnectorEnvironmentBinding
  if (-not $binding.expected_host -or -not $HeartbeatUrl) { return $false }
  try {
    $uri = [Uri]$HeartbeatUrl
    return (
      $uri.Scheme -eq "https" -and
      $uri.Host.ToLowerInvariant() -eq $binding.expected_host -and
      $uri.AbsolutePath -eq "/connector-agent/heartbeat" -and
      -not $uri.Query -and
      -not $uri.Fragment
    )
  } catch {
    return $false
  }
}

function Write-RuntimeState($Stage, [bool]$LocalHealth, $Details = "", [bool]$HeartbeatSent = $false, $PublicHealth = $null) {
  try {
    $binding = Get-ConnectorEnvironmentBinding
    $state = [ordered]@{
      timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
      stage = $Stage
      local_health = $LocalHealth
      heartbeat_sent = $HeartbeatSent
      watchdog_version = $WatchdogVersion
      agent_version = $AgentVersion
      connector_environment = $binding.environment
      cloudflared_service = $CloudflaredService
      cloudflared_status = Get-ServiceState $CloudflaredService
      cloudflared_task = $CloudflaredTask
      cloudflared_task_status = Get-TaskState $CloudflaredTask
      connector_status = Get-ServiceState $ConnectorService
      connector_task = $ConnectorTask
      connector_task_status = Get-TaskState $ConnectorTask
      public_connector_health = if ($null -ne $PublicHealth) { [ordered]@{ ok = [bool]$PublicHealth.ok; http_status = $PublicHealth.http_status; error = $PublicHealth.error } } else { $null }
      details = [string]$Details
      secrets_included = $false
    }
    $state | ConvertTo-Json -Depth 5 | Set-Content -Path $StatePath -Encoding UTF8
  } catch {
    Write-WatchdogLog "state_write_failed"
  }
}

function Publish-Heartbeat(
  [string]$Status,
  [string]$EventType,
  [bool]$LocalHealth,
  [string]$ErrorCode = "",
  [string]$ErrorMessage = ""
) {
  try {
    $secret = Get-DotEnvValue "CONNECTOR_SECRET"
    $heartbeatUrl = Get-DotEnvValue "CONNECTOR_HEARTBEAT_URL"
    $binding = Get-ConnectorEnvironmentBinding
    if (-not $secret) {
      Write-WatchdogLog "heartbeat_skipped reason=connector_secret_missing"
      return $false
    }
    if (-not (Test-HeartbeatBinding $heartbeatUrl)) {
      Write-WatchdogLog "heartbeat_skipped reason=environment_binding_invalid environment=$($binding.environment)"
      return $false
    }

    $payload = [ordered]@{
      device_id = [Environment]::MachineName
      event_type = $EventType
      status = $Status
      source = "watchdog"
      agent_version = $AgentVersion
      watchdog_version = $WatchdogVersion
      watchdog_installed = $true
      active_slot = "legacy"
      metadata = [ordered]@{
        local_health = $LocalHealth
        connector_environment = $binding.environment
        connector_status = Get-ServiceState $ConnectorService
        connector_task_status = Get-TaskState $ConnectorTask
        cloudflared_service = $CloudflaredService
        cloudflared_status = Get-ServiceState $CloudflaredService
        cloudflared_task_status = Get-TaskState $CloudflaredTask
        secrets_included = $false
      }
    }
    if ($ErrorCode) { $payload.error_code = $ErrorCode.Substring(0, [Math]::Min(128, $ErrorCode.Length)) }
    if ($ErrorMessage) { $payload.error_message = $ErrorMessage.Substring(0, [Math]::Min(1000, $ErrorMessage.Length)) }

    $headers = @{ Authorization = "Bearer $secret" }
    $body = $payload | ConvertTo-Json -Depth 5 -Compress
    $response = Invoke-RestMethod -Uri $heartbeatUrl -Method Post -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 20
    $eventId = [string]$response.heartbeat.event_id
    Write-WatchdogLog "heartbeat_sent event_type=$EventType status=$Status environment=$($binding.environment) event_id=$eventId"
    return $true
  } catch {
    $statusCode = "unknown"
    try { $statusCode = [string][int]$_.Exception.Response.StatusCode.value__ } catch {}
    Write-WatchdogLog "heartbeat_failed event_type=$EventType status=$Status http_status=$statusCode"
    return $false
  }
}

function Test-LocalHealth {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec $HealthTimeoutSeconds
    return ($res.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Get-WebFailureText($ErrorRecord) {
  $text = [string]$ErrorRecord.Exception.Message
  try {
    $response = $ErrorRecord.Exception.Response
    if ($null -ne $response) {
      $stream = $response.GetResponseStream()
      if ($null -ne $stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        if ($body) { $text += " $body" }
      }
    }
  } catch {}
  return $text
}

function Test-PublicConnectorHealth {
  try {
    $res = Invoke-WebRequest -Uri $PublicHealthUrl -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    return [pscustomobject]@{ ok = ([int]$res.StatusCode -eq 200); http_status = [int]$res.StatusCode; error = $null }
  } catch {
    $statusCode = $null
    try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch {}
    $failureText = Get-WebFailureText $_
    $errorClass = if ($failureText -match '(?i)\b1033\b' -or $statusCode -eq 530) { "cloudflare_1033" } else { "public_tunnel_unavailable" }
    return [pscustomobject]@{ ok = $false; http_status = $statusCode; error = $errorClass }
  }
}

function Ensure-ServiceRunning($Name) {
  try {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { Write-WatchdogLog "service_missing name=$Name"; return $false }
    if ($svc.Status -eq 'Running') { return $true }
    Start-Service -Name $Name -ErrorAction SilentlyContinue
    $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    $svc.Refresh()
    $ready = ($svc.Status -eq 'Running')
    Write-WatchdogLog "service_ensure name=$Name running=$ready"
    return $ready
  } catch {
    Write-WatchdogLog "service_ensure_failed name=$Name"
    return $false
  }
}

function Ensure-TaskRunning($Name) {
  try {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if (-not $task) { Write-WatchdogLog "task_missing name=$Name"; return $false }
    if ([string]$task.State -eq 'Running') { return $true }
    Start-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
      Start-Sleep -Seconds 1
      $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
      if ($null -ne $task -and [string]$task.State -eq 'Running') {
        Write-WatchdogLog "task_ensure name=$Name running=true"
        return $true
      }
    }
    Write-WatchdogLog "task_ensure name=$Name running=false"
    return $false
  } catch {
    Write-WatchdogLog "task_ensure_failed name=$Name"
    return $false
  }
}

function Ensure-RuntimeRunning($ServiceName, $TaskName) {
  if ((Get-ServiceState $ServiceName) -ne 'missing') { return Ensure-ServiceRunning $ServiceName }
  return Ensure-TaskRunning $TaskName
}

function Restart-ServiceSafe($Name) {
  try {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { Write-WatchdogLog "service_missing name=$Name"; return $false }
    Restart-Service -Name $Name -Force -ErrorAction SilentlyContinue
    $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    $svc.Refresh()
    return ($svc.Status -eq 'Running')
  } catch {
    Write-WatchdogLog "service_restart_failed name=$Name"
    return $false
  }
}

function Restart-TaskSafe($Name) {
  try {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if (-not $task) { Write-WatchdogLog "task_missing name=$Name"; return $false }
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Start-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    return Ensure-TaskRunning $Name
  } catch {
    Write-WatchdogLog "task_restart_failed name=$Name"
    return $false
  }
}

function Restart-RuntimeSafe($ServiceName, $TaskName) {
  if ((Get-ServiceState $ServiceName) -ne 'missing') { return Restart-ServiceSafe $ServiceName }
  return Restart-TaskSafe $TaskName
}

function Restore-StableServer {
  try {
    $candidate = $null
    if (Test-Path $StablePath) { $candidate = $StablePath }
    elseif (Test-Path $LastGoodPath) { $candidate = $LastGoodPath }
    else {
      $latestBackup = Get-ChildItem -Path $Root -Filter "server.mjs.bak-*" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($latestBackup) { $candidate = $latestBackup.FullName }
    }
    if (-not $candidate) { Write-WatchdogLog "rollback_skipped no_stable_candidate"; return $false }

    Copy-Item -LiteralPath $ServerPath -Destination (Join-Path $Root ("server.mjs.failed-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))) -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $candidate -Destination $ServerPath -Force
    Write-WatchdogLog "rollback_applied candidate=$candidate"
    return $true
  } catch {
    Write-WatchdogLog "rollback_failed"
    return $false
  }
}

try {
  if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
  $configuredCloudflaredService = Get-DotEnvValue "CONNECTOR_CLOUDFLARED_SERVICE"
  if ($configuredCloudflaredService -and $configuredCloudflaredService -match '^[A-Za-z0-9_.-]{1,128}$') { $CloudflaredService = $configuredCloudflaredService }
  $configuredConnectorTask = Get-DotEnvValue "CONNECTOR_SCHEDULED_TASK"
  if ($configuredConnectorTask) { $ConnectorTask = $configuredConnectorTask }
  $configuredTunnelTask = Get-DotEnvValue "CONNECTOR_CLOUDFLARED_TASK"
  if ($configuredTunnelTask) { $CloudflaredTask = $configuredTunnelTask }

  Write-WatchdogLog "watchdog_tick root=$Root port=$Port cloudflared_service=$CloudflaredService cloudflared_task=$CloudflaredTask connector_task=$ConnectorTask"

  $cloudflaredReady = Ensure-RuntimeRunning $CloudflaredService $CloudflaredTask
  $connectorReady = Ensure-RuntimeRunning $ConnectorService $ConnectorTask
  if ($connectorReady) { Start-Sleep -Seconds 2 }
  $initialHealth = Test-LocalHealth

  if ($initialHealth) {
    if (Test-Path $ServerPath) { Copy-Item -LiteralPath $ServerPath -Destination $LastGoodPath -Force -ErrorAction SilentlyContinue }
    if ($cloudflaredReady) {
      $publicHealth = Test-PublicConnectorHealth
      if (-not $publicHealth.ok) {
        Write-WatchdogLog "public_tunnel_failed error=$($publicHealth.error) action=restart_tunnel"
        [void](Restart-RuntimeSafe $CloudflaredService $CloudflaredTask)
        Start-Sleep -Seconds 5
        $publicHealth = Test-PublicConnectorHealth
      }
      if ($publicHealth.ok) {
        $heartbeatSent = Publish-Heartbeat "ok" "health_ok" $true
        Write-WatchdogLog "health_ok initial=true tunnel_runtime=true public_tunnel=true heartbeat_sent=$heartbeatSent"
        Write-RuntimeState "healthy" $true "tunnel_runtime=true public_tunnel=true" $heartbeatSent $publicHealth
        if ($heartbeatSent) { exit 0 }
        exit 4
      }
      $errorCode = if ($publicHealth.error -eq 'cloudflare_1033') { 'cloudflare_1033' } else { 'connector_public_tunnel_unavailable' }
      $heartbeatSent = Publish-Heartbeat "failed" "health_failed" $true $errorCode "connector.mad4b.com public tunnel is unavailable."
      Write-WatchdogLog "public_tunnel_unavailable error=$($publicHealth.error) heartbeat_sent=$heartbeatSent"
      Write-RuntimeState "public_tunnel_unavailable" $true "error=$($publicHealth.error)" $heartbeatSent $publicHealth
      exit 3
    }
    $heartbeatSent = Publish-Heartbeat "failed" "health_failed" $true "cloudflared_unavailable" "Connector cloudflared runtime is not running."
    Write-WatchdogLog "health_ok tunnel_runtime=false heartbeat_sent=$heartbeatSent"
    Write-RuntimeState "tunnel_runtime_unavailable" $true "connector cloudflared runtime is not running" $heartbeatSent
    exit 3
  }

  Write-WatchdogLog "health_failed action=restart_connector"
  [void](Restart-RuntimeSafe $ConnectorService $ConnectorTask)
  Start-Sleep -Seconds 2
  $healthAfterRestart = Test-LocalHealth
  if ($healthAfterRestart) {
    if (Test-Path $ServerPath) { Copy-Item -LiteralPath $ServerPath -Destination $LastGoodPath -Force -ErrorAction SilentlyContinue }
    $publicHealth = if ($cloudflaredReady) { Test-PublicConnectorHealth } else { $null }
    if ($cloudflaredReady -and $null -ne $publicHealth -and -not $publicHealth.ok) {
      [void](Restart-RuntimeSafe $CloudflaredService $CloudflaredTask)
      Start-Sleep -Seconds 5
      $publicHealth = Test-PublicConnectorHealth
    }
    $publicReady = $cloudflaredReady -and $null -ne $publicHealth -and $publicHealth.ok
    $status = if ($publicReady) { "ok" } else { "failed" }
    $errorCode = if ($publicReady) { "" } elseif ($null -ne $publicHealth -and $publicHealth.error -eq 'cloudflare_1033') { "cloudflare_1033" } else { "cloudflared_unavailable" }
    $errorMessage = if ($publicReady) { "" } else { "Connector public tunnel is not ready." }
    $heartbeatSent = Publish-Heartbeat $status "service_restart" $true $errorCode $errorMessage
    Write-WatchdogLog "health_ok after_restart=true public_tunnel=$publicReady heartbeat_sent=$heartbeatSent"
    Write-RuntimeState "healthy_after_restart" $true "public_tunnel=$publicReady" $heartbeatSent $publicHealth
    if ($publicReady -and $heartbeatSent) { exit 0 }
    if (-not $publicReady) { exit 3 }
    exit 4
  }

  Write-WatchdogLog "health_failed action=rollback"
  if (Restore-StableServer) {
    [void](Restart-RuntimeSafe $ConnectorService $ConnectorTask)
    Start-Sleep -Seconds 2
    $healthAfterRollback = Test-LocalHealth
    if ($healthAfterRollback) {
      $publicHealth = if ($cloudflaredReady) { Test-PublicConnectorHealth } else { $null }
      $publicReady = $cloudflaredReady -and $null -ne $publicHealth -and $publicHealth.ok
      $status = if ($publicReady) { "ok" } else { "failed" }
      $errorCode = if ($publicReady) { "" } elseif ($null -ne $publicHealth -and $publicHealth.error -eq 'cloudflare_1033') { "cloudflare_1033" } else { "cloudflared_unavailable" }
      $errorMessage = if ($publicReady) { "" } else { "Connector public tunnel is not ready." }
      $heartbeatSent = Publish-Heartbeat $status "rollback" $true $errorCode $errorMessage
      Write-WatchdogLog "health_ok after_rollback=true public_tunnel=$publicReady heartbeat_sent=$heartbeatSent"
      Write-RuntimeState "healthy_after_rollback" $true "public_tunnel=$publicReady" $heartbeatSent $publicHealth
      if ($publicReady -and $heartbeatSent) { exit 0 }
      if (-not $publicReady) { exit 3 }
      exit 4
    }
  }

  $heartbeatSent = Publish-Heartbeat "failed" "health_failed" $false "local_health_unavailable" "Local health remained unavailable after restart and rollback."
  Write-WatchdogLog "manual_required health_still_down=true heartbeat_sent=$heartbeatSent"
  Write-RuntimeState "manual_required" $false "local health remained unavailable after restart and rollback" $heartbeatSent
  exit 2
} catch {
  $message = [string]$_.Exception.Message
  $heartbeatSent = Publish-Heartbeat "failed" "health_failed" $false "watchdog_exception" $message
  Write-WatchdogLog "watchdog_exception heartbeat_sent=$heartbeatSent"
  Write-RuntimeState "watchdog_exception" $false $message $heartbeatSent
  exit 1
}
