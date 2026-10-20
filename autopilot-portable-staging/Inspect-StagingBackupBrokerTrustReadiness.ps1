# Staging-only, read-only OS service observation. Never installs a service,
# accesses passwords or keys, queries SQL, or grants DBA privileges.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RepositoryPath,
  [Parameter(Mandatory=$true)][string]$ExpectedCommit
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($ExpectedCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'EXACT_STAGING_SHA_REQUIRED'}
$assessor=Join-Path $RepositoryPath 'local-connector\staging-backup-db-broker-trust-readiness.mjs'
$hostInspector=Join-Path $RepositoryPath 'autopilot-portable-staging\Inspect-StagingBackupBrokerPrerequisites.ps1'
if(-not(Test-Path -LiteralPath $assessor -PathType Leaf) -or
   -not(Test-Path -LiteralPath $hostInspector -PathType Leaf)){throw 'TRUST_PREFLIGHT_SOURCE_MISSING'}
$reportRaw=(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hostInspector -RepositoryPath $RepositoryPath -ExpectedCommit $ExpectedCommit 2>$null|Out-String)
if($LASTEXITCODE -ne 2){throw 'BASE_HOST_DISCOVERY_MUST_FAIL_CLOSED'}
try{
  $base=$reportRaw.Trim()|ConvertFrom-Json
  if($base.contract -ne 'mad4b.staging.backup-db-broker-host-discovery.v1' -or
     $base.expected_sha -ne $ExpectedCommit){throw 'HOST_DISCOVERY_CONTRACT_UNVERIFIED'}
}catch{throw 'HOST_DISCOVERY_CONTRACT_UNVERIFIED'}
$service=$null;$serviceImageDigest=''
$serviceImageMeasurementStatus='service_not_running'
try{
  $service=Get-CimInstance Win32_Service -Filter "Name='Mad4B-Staging-Backup-Db-Broker'" -ErrorAction Stop
}catch{}
if($null -ne $service -and $service.State -eq 'Running' -and $service.ProcessId -gt 0){
  $serviceImageMeasurementStatus='process_metadata_unavailable'
  try{
    $process=Get-CimInstance Win32_Process -Filter "ProcessId = $($service.ProcessId)" -ErrorAction Stop
    if($null -ne $process){
      $exe=[string]$process.ExecutablePath
      if([string]::IsNullOrWhiteSpace($exe)){
        $serviceImageMeasurementStatus='process_path_not_disclosed'
      }else{
        # Never substitute an SCM ImagePath/build artifact for the running image.
        $serviceImageMeasurementStatus='process_image_unreadable'
        if(Test-Path -LiteralPath $exe -PathType Leaf -ErrorAction Stop){
          $serviceImageDigest=(Get-FileHash -LiteralPath $exe -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
          $serviceImageMeasurementStatus='measured_from_process_path'
        }
      }
    }
  }catch{
    if($_.Exception -is [System.UnauthorizedAccessException] -or
       $_.Exception.Message -match '(?i)access is denied|permission denied'){
      $serviceImageMeasurementStatus='os_access_denied'
    }else{
      $serviceImageMeasurementStatus='measurement_failed'
    }
  }
}
$e=[ordered]@{
  expected_sha=$ExpectedCommit
  app_source_sha=if($base.topology_observed -eq $true){$ExpectedCommit}else{''}
  device_id=$env:COMPUTERNAME
  topology_observed=($base.topology_observed -eq $true)
  # Presence and running state are different. The Windows SCM host remains
  # inert even when running; discovery must not mint operational authority.
  broker_candidate_found=($base.broker_candidate_found -eq $true)
  broker_candidate_running=($base.broker_candidate_running -eq $true)
  windows_service_present=($null -ne $service)
  windows_service_running=($null -ne $service -and $service.State -eq 'Running')
  windows_service_pid=if($null -ne $service){[int]$service.ProcessId}else{0}
  windows_service_account=if($null -ne $service){[string]$service.StartName}else{''}
  process_image_sha256=$serviceImageDigest
  process_image_measurement_status=$serviceImageMeasurementStatus
}
$e|ConvertTo-Json -Depth 6 -Compress|& node $assessor
if($LASTEXITCODE -ne 2){throw 'BROKER_TRUST_DISCOVERY_MUST_FAIL_CLOSED'}
exit 2
