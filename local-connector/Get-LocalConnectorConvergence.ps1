# Read-only Local Connector convergence inspector.
# This script performs no restart, install, file write, credential read, DNS
# mutation, provider call, or database mutation. Its JSON output is safe to
# attach to a recovery ticket: only credential presence is reported.

[CmdletBinding()]
param(
  [string]$ExpectedRoot = "C:\mad4b-connector\local-connector",
  [int]$Port = 7070,
  [string]$DeviceRuntimeHost = "",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Continue"
$Contract = "mad4b.local-connector-convergence-inspection.v1"
$CanonicalAgentService = "local-connector"
$CanonicalAgentTask = "GrowthIntelligence-LocalConnector"
$CanonicalTunnelService = "Mad4B-LocalConnector-Cloudflared"
$CanonicalTunnelTask = "Mad4B-LocalConnector-Cloudflared"
$CanonicalWatchdogTask = "GrowthIntelligence-ConnectorWatchdog"
$LegacyWatchdogTask = "Mad4B-LocalConnector-Watchdog"
$StagingTunnelService = "Mad4B-Staging-Cloudflared"

function Get-ServiceEvidence([string]$Name) {
  try {
    $value = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
    return [ordered]@{ name=$Name; exists=$true; state=[string]$value.State; start_mode=[string]$value.StartMode; process_id=[int]$value.ProcessId; path=[string]$value.PathName }
  } catch { return [ordered]@{ name=$Name; exists=$false; state="missing"; start_mode=$null; process_id=0; path=$null } }
}

function Get-TaskEvidence([string]$Name) {
  try {
    $value = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    $actions = @($value.Actions | ForEach-Object { [ordered]@{ execute=[string]$_.Execute; arguments=[string]$_.Arguments; working_directory=[string]$_.WorkingDirectory } })
    return [ordered]@{ name=$Name; exists=$true; state=([string]$value.State).ToLowerInvariant(); principal=[string]$value.Principal.UserId; actions=$actions }
  } catch { return [ordered]@{ name=$Name; exists=$false; state="missing"; principal=$null; actions=@() } }
}

function Get-EnvPresence([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try { return [bool](Select-String -LiteralPath $Path -Pattern ("^{0}=.+$" -f [regex]::Escape($Name)) -Quiet) } catch { return $false }
}

function Get-ListeningProcess([int]$TargetPort) {
  try {
    $row = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction Stop | Select-Object -First 1
    if (-not $row) { return [ordered]@{ listening=$false; process_id=0; executable=$null; command_line=$null; runtime_root=$null } }
    $pidValue = [int]$row.OwningProcess
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
    $command = [string]$process.CommandLine
    $scriptMatch = [regex]::Match($command, '(?i)(?:^|\s|\")([^\"]*server\.mjs)')
    $serverPath = if ($scriptMatch.Success) { $scriptMatch.Groups[1].Value.Trim('"') } else { "" }
    return [ordered]@{
      listening=$true
      process_id=$pidValue
      executable=[string]$process.ExecutablePath
      command_line=$command
      runtime_root=if ($serverPath) { Split-Path -Parent $serverPath } else { $null }
    }
  } catch { return [ordered]@{ listening=$false; process_id=0; executable=$null; command_line=$null; runtime_root=$null } }
}

function Get-DnsEvidence([string]$HostName) {
  if (-not $HostName) { return [ordered]@{ host=$null; status="not_configured"; answers=@() } }
  try {
    $answers = @(Resolve-DnsName -Name $HostName -ErrorAction Stop | Where-Object { $_.IPAddress -or $_.NameHost } | ForEach-Object { if ($_.IPAddress) { [string]$_.IPAddress } else { [string]$_.NameHost } })
    return [ordered]@{ host=$HostName; status=if ($answers.Count) { "resolved" } else { "empty" }; answers=$answers }
  } catch {
    $classification = if ([string]$_.Exception.Message -match '(?i)non-existent|NXDOMAIN|does not exist') { "nxdomain" } else { "resolution_failed" }
    return [ordered]@{ host=$HostName; status=$classification; answers=@() }
  }
}

$envPath = Join-Path $ExpectedRoot ".env"
$agentService = Get-ServiceEvidence $CanonicalAgentService
$agentTask = Get-TaskEvidence $CanonicalAgentTask
$tunnelService = Get-ServiceEvidence $CanonicalTunnelService
$tunnelTask = Get-TaskEvidence $CanonicalTunnelTask
$watchdogTask = Get-TaskEvidence $CanonicalWatchdogTask
$legacyWatchdog = Get-TaskEvidence $LegacyWatchdogTask
$stagingTunnel = Get-ServiceEvidence $StagingTunnelService
$listener = Get-ListeningProcess $Port
$reasons = [System.Collections.Generic.List[string]]::new()

if ($agentService.exists -and $agentTask.exists) { $reasons.Add("duplicate_agent_runtime") }
if ($tunnelService.exists -and $tunnelTask.exists) { $reasons.Add("duplicate_tunnel_runtime") }
if ($legacyWatchdog.exists -and $watchdogTask.exists) { $reasons.Add("duplicate_watchdog_runtime") }
if (-not $listener.listening) { $reasons.Add("agent_port_not_listening") }
if ($listener.runtime_root -and ([IO.Path]::GetFullPath($listener.runtime_root) -ne [IO.Path]::GetFullPath($ExpectedRoot))) { $reasons.Add("runtime_root_drift") }
if (-not (Get-EnvPresence $envPath "CONNECTOR_SECRET") -and -not (Get-EnvPresence $envPath "CONNECTOR_LOCAL_API_KEY")) { $reasons.Add("identity_missing") }
if ($stagingTunnel.exists -and $tunnelService.exists -and $stagingTunnel.process_id -eq $tunnelService.process_id -and $stagingTunnel.process_id -gt 0) { $reasons.Add("cross_runtime_binding") }

$result = [ordered]@{
  contract=$Contract
  timestamp_utc=(Get-Date).ToUniversalTime().ToString("o")
  machine=[Environment]::MachineName
  expected_runtime_root=$ExpectedRoot
  port=$Port
  runtime=[ordered]@{
    listener=$listener
    agent_service=$agentService
    agent_task=$agentTask
    tunnel_service=$tunnelService
    tunnel_task=$tunnelTask
    watchdog_task=$watchdogTask
    legacy_watchdog_task=$legacyWatchdog
    staging_tunnel_service=$stagingTunnel
  }
  identity=[ordered]@{
    env_file_present=(Test-Path -LiteralPath $envPath -PathType Leaf)
    connector_secret_present=(Get-EnvPresence $envPath "CONNECTOR_SECRET")
    compatibility_key_present=(Get-EnvPresence $envPath "CONNECTOR_LOCAL_API_KEY")
    credential_values_read=$false
  }
  route=[ordered]@{ device_runtime_dns=(Get-DnsEvidence $DeviceRuntimeHost); caller_supplied_expected_host=[bool]$DeviceRuntimeHost }
  convergence=[ordered]@{ converged=($reasons.Count -eq 0); reasons=@($reasons); mutation_allowed=$false; recommended_next_action=if ($reasons.Count) { "review_before_bounded_repair" } else { "none" } }
  mutations_executed=$false
  provider_access_performed=$false
  database_access_performed=$false
  secrets_included=$false
}

$json = $result | ConvertTo-Json -Depth 9
if ($OutputPath) { $json | Set-Content -LiteralPath $OutputPath -Encoding UTF8 }
$json
if ($reasons.Count) { exit 2 }
exit 0
