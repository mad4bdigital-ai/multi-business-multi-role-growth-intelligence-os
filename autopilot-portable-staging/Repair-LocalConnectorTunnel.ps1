[CmdletBinding()]
param(
    [string]$ConnectorService = "local-connector",
    [string]$CloudflaredService = "cloudflared",
    [string]$ConnectorTask = "GrowthIntelligence-LocalConnector",
    [string]$CloudflaredTask = "GrowthIntelligence-CloudflaredTunnel",
    [int]$Port = 7070,
    [ValidateRange(5, 120)]
    [int]$RecoveryWaitSeconds = 30,
    [string]$StatePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $PSCommandPath
if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path $scriptRoot "logs\local-connector-tunnel-state.json"
}

function Write-State([hashtable]$State) {
    $State["generated_at"] = [DateTime]::UtcNow.ToString("o")
    $State["secrets_included"] = $false
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StatePath) | Out-Null
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($StatePath, ($State | ConvertTo-Json -Depth 8), $encoding)
}

function Get-ServiceRuntime([string]$Name) {
    try {
        $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
        if ($null -eq $service) { return $null }
        return [pscustomobject]@{ kind = "service"; name = $Name; state = $service.Status.ToString().ToLowerInvariant() }
    } catch { return $null }
}

function Get-TaskRuntime([string]$Name) {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    try {
        $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
        if ($null -eq $task) { return $null }
        return [pscustomobject]@{ kind = "scheduled_task"; name = $Name; state = $task.State.ToString().ToLowerInvariant() }
    } catch { return $null }
}

function Resolve-Runtime([string]$ServiceName, [string]$TaskName) {
    $service = Get-ServiceRuntime $ServiceName
    if ($null -ne $service) { return $service }
    return Get-TaskRuntime $TaskName
}

function Ensure-RuntimeRunning([object]$Runtime) {
    if ($null -eq $Runtime) { return $false }
    if ([string]$Runtime.kind -eq "service") {
        try {
            $service = Get-Service -Name ([string]$Runtime.name) -ErrorAction Stop
            if ($service.Status -ne "Running") {
                Start-Service -Name ([string]$Runtime.name) -ErrorAction Stop
                $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(20))
                $service.Refresh()
            }
            return ($service.Status -eq "Running")
        } catch { return $false }
    }
    if ([string]$Runtime.kind -eq "scheduled_task") {
        try {
            $task = Get-ScheduledTask -TaskName ([string]$Runtime.name) -ErrorAction Stop
            if ($task.State -ne "Running") { Start-ScheduledTask -TaskName ([string]$Runtime.name) -ErrorAction Stop }
            Start-Sleep -Seconds 2
            $task = Get-ScheduledTask -TaskName ([string]$Runtime.name) -ErrorAction Stop
            return ($task.State -eq "Running")
        } catch { return $false }
    }
    return $false
}

function Restart-Runtime([object]$Runtime) {
    if ($null -eq $Runtime) { return $false }
    if ([string]$Runtime.kind -eq "service") {
        try {
            Restart-Service -Name ([string]$Runtime.name) -Force -ErrorAction Stop
            $service = Get-Service -Name ([string]$Runtime.name) -ErrorAction Stop
            $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(20))
            $service.Refresh()
            return ($service.Status -eq "Running")
        } catch { return $false }
    }
    if ([string]$Runtime.kind -eq "scheduled_task") {
        try {
            Stop-ScheduledTask -TaskName ([string]$Runtime.name) -ErrorAction SilentlyContinue
            Start-ScheduledTask -TaskName ([string]$Runtime.name) -ErrorAction Stop
            Start-Sleep -Seconds 2
            $task = Get-ScheduledTask -TaskName ([string]$Runtime.name) -ErrorAction Stop
            return ($task.State -eq "Running")
        } catch { return $false }
    }
    return $false
}

function Test-LocalConnectorHealth {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        return ([int]$response.StatusCode -eq 200)
    } catch { return $false }
}

function Get-PublicConnectorHealth {
    try {
        $response = Invoke-WebRequest -Uri "https://connector.mad4b.com/health" -UseBasicParsing -TimeoutSec 12 -ErrorAction Stop
        return [pscustomobject]@{ healthy = ([int]$response.StatusCode -eq 200); http_status = [int]$response.StatusCode; error = $null }
    } catch {
        $status = $null
        try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch { }
        $text = [string]$_.Exception.Message
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                $text += " " + $reader.ReadToEnd()
            }
        } catch { }
        $errorCode = if ($status -eq 530 -or $text -match '(?i)\b1033\b') { "cloudflare_1033" } else { "remote_unavailable" }
        return [pscustomobject]@{ healthy = $false; http_status = $status; error = $errorCode }
    }
}

function Wait-LocalHealth([int]$Seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-LocalConnectorHealth) { return $true }
        Start-Sleep -Seconds 2
    }
    return (Test-LocalConnectorHealth)
}

function Wait-PublicHealth([int]$Seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    $last = Get-PublicConnectorHealth
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($last.healthy) { return $last }
        Start-Sleep -Seconds 3
        $last = Get-PublicConnectorHealth
    }
    return $last
}

$connectorRuntime = Resolve-Runtime $ConnectorService $ConnectorTask
$tunnelRuntime = Resolve-Runtime $CloudflaredService $CloudflaredTask
$state = @{
    contract = "mad4b.local-connector-startup-recovery.v1"
    connector_runtime = if ($null -eq $connectorRuntime) { "missing" } else { "$($connectorRuntime.kind):$($connectorRuntime.name)" }
    tunnel_runtime = if ($null -eq $tunnelRuntime) { "missing" } else { "$($tunnelRuntime.kind):$($tunnelRuntime.name)" }
    connector_runtime_started = $false
    tunnel_runtime_started = $false
    local_health = $false
    public_health = $false
    public_http_status = $null
    public_error = $null
    tunnel_restart_attempted = $false
    connector_restart_attempted = $false
    status = "checking"
}

if ($null -eq $connectorRuntime -or $null -eq $tunnelRuntime) {
    $state.status = "runtime_missing"
    $state.public_error = if ($null -eq $connectorRuntime) { "connector_runtime_missing" } else { "tunnel_runtime_missing" }
    Write-State $state
    Write-Host "LOCAL_CONNECTOR_RECOVERY_BLOCKED: reason=$($state.public_error)"
    exit 2
}

$state.connector_runtime_started = Ensure-RuntimeRunning $connectorRuntime
$state.tunnel_runtime_started = Ensure-RuntimeRunning $tunnelRuntime
$state.local_health = Wait-LocalHealth ([Math]::Min(20, $RecoveryWaitSeconds))

if (-not $state.local_health) {
    $state.connector_restart_attempted = $true
    [void](Restart-Runtime $connectorRuntime)
    $state.local_health = Wait-LocalHealth $RecoveryWaitSeconds
}

$public = Get-PublicConnectorHealth
if (-not $public.healthy -and $state.local_health) {
    $state.tunnel_restart_attempted = $true
    [void](Restart-Runtime $tunnelRuntime)
    $public = Wait-PublicHealth $RecoveryWaitSeconds
}

$state.public_health = [bool]$public.healthy
$state.public_http_status = $public.http_status
$state.public_error = $public.error
$state.status = if ($state.local_health -and $state.public_health) { "healthy" } elseif ($state.local_health) { "tunnel_unhealthy" } else { "connector_unhealthy" }
Write-State $state

if ($state.status -eq "healthy") {
    Write-Host "LOCAL_CONNECTOR_RECOVERY_READY: hostname=connector.mad4b.com runtime=$($state.connector_runtime) tunnel=$($state.tunnel_runtime)"
    exit 0
}

Write-Host "LOCAL_CONNECTOR_RECOVERY_DEGRADED: status=$($state.status) error=$($state.public_error) http_status=$($state.public_http_status)"
exit 1
