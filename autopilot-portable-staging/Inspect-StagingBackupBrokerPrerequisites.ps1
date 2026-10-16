# Read-only inventory. This is NOT an OS/DBA identity attestor and never
# installs a service, queries MariaDB, reads credentials or issues a grant.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RepositoryPath,
  [Parameter(Mandatory=$true)][string]$ExpectedCommit
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$assessor=Join-Path $RepositoryPath 'local-connector\staging-backup-db-broker-host-discovery.mjs'
if(-not (Test-Path -LiteralPath $assessor -PathType Leaf)){throw 'BROKER_DISCOVERY_ASSESSOR_NOT_FOUND'}
if($ExpectedCommit -notmatch '^[a-f0-9]{40}$'){throw 'EXACT_SOURCE_SHA_REQUIRED'}
$e=[ordered]@{
  expected_sha=$ExpectedCommit
  app_source_sha=''
  device_id=$env:COMPUTERNAME
  network=''
  subnet=''
  app_network=''
  runtime_db_network=''
  runtime_db_host_port_exposed=$null
  containers=[ordered]@{
    app=$false;redis=$false;'governance-db'=$false
    'persistence-db'=$false;'runtime-db'=$false
  }
  windows_service_present=$false
  windows_service_running=$false
  windows_service_account=''
  docker_sidecar_present=$false
  docker_sidecar_running=$false
  docker_sidecar_sandbox_verified=$false
}
# Never output raw docker inspect: it can include environment secrets.
try {
  $netText=(& docker network inspect http-generic-api_default 2>$null | Out-String)
  if($LASTEXITCODE -eq 0){
    $net=@($netText | ConvertFrom-Json)[0]
    $e.network=[string]$net.Name
    $e.subnet=[string]$net.IPAM.Config[0].Subnet
  }
} catch {}
foreach($service in @('app','redis','governance-db','persistence-db','runtime-db')){
  try {
    $name="http-generic-api-$service-1"
    $raw=(& docker inspect $name 2>$null | Out-String)
    if($LASTEXITCODE -ne 0){continue}
    $item=@($raw | ConvertFrom-Json)[0]
    $e.containers[$service]=([string]$item.State.Health.Status -eq 'healthy')
    $names=@($item.NetworkSettings.Networks.PSObject.Properties.Name)
    if($service -eq 'app' -and $names.Count -eq 1){$e.app_network=[string]$names[0]}
    if($service -eq 'runtime-db'){
      if($names -contains 'http-generic-api_default'){$e.runtime_db_network='http-generic-api_default'}
      $mapped=@($item.NetworkSettings.Ports.PSObject.Properties |
        Where-Object {$null -ne $_.Value -and @($_.Value).Count -gt 0})
      $e.runtime_db_host_port_exposed=($mapped.Count -gt 0)
    }
  } catch {}
}
try {
  $raw=(& docker exec http-generic-api-app-1 cat /app/deployment-manifest.json 2>$null | Out-String)
  if($LASTEXITCODE -eq 0){
    $manifest=$raw | ConvertFrom-Json
    $e.app_source_sha=[string]$manifest.commit_sha
  }
} catch {}
try {
  $service=Get-CimInstance Win32_Service -Filter "Name='Mad4B-Staging-Backup-Db-Broker'" -ErrorAction Stop
  if($null -ne $service){
    $e.windows_service_present=$true
    $e.windows_service_running=($service.State -eq 'Running')
    $e.windows_service_account=[string]$service.StartName
  }
} catch {}
try {
  $sidecar=(& docker inspect http-generic-api-backup-db-broker-1 2>$null | Out-String)
  if($LASTEXITCODE -eq 0){
    $broker=@($sidecar | ConvertFrom-Json)[0]
    $e.docker_sidecar_present=$true
    $e.docker_sidecar_running=($broker.State.Running -eq $true)
    $nets=@($broker.NetworkSettings.Networks.PSObject.Properties.Name)
    $pub=@($broker.NetworkSettings.Ports.PSObject.Properties | Where-Object {$null -ne $_.Value -and @($_.Value).Count -gt 0})
    $opts=@($broker.HostConfig.SecurityOpt)
    $caps=@($broker.HostConfig.CapDrop)
    $e.docker_sidecar_sandbox_verified=(
      $broker.HostConfig.ReadonlyRootfs -eq $true -and
      $broker.HostConfig.Privileged -eq $false -and
      [string]$broker.Config.User -eq '65534:65534' -and
      $caps -contains 'ALL' -and
      $opts -contains 'no-new-privileges:true' -and
      [string]$broker.HostConfig.NetworkMode -eq 'none' -and
      $nets.Count -eq 1 -and $nets[0] -eq 'none' -and
      $pub.Count -eq 0 -and @($broker.Mounts | Where-Object {$null -ne $_}).Count -eq 0 -and
      @($broker.HostConfig.Binds | Where-Object {$null -ne $_}).Count -eq 0 -and
      @($broker.Config.Env | Where-Object {$_ -match '(?i)^(DB_|MYSQL_|MARIADB_|.*SECRET|.*TOKEN|.*PASSWORD)' }).Count -eq 0
    )
  }
} catch {}
# Sanitized evidence only. Exit 2 is deliberate: discovery never grants access.
$e | ConvertTo-Json -Depth 8 -Compress | & node $assessor
if($LASTEXITCODE -ne 2){throw 'BROKER_DISCOVERY_FAIL_CLOSED'}
exit 2
