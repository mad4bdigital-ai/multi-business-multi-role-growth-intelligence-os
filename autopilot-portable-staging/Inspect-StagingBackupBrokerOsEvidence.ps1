# Elevated, read-only Staging OS measurement. NOT a signed or independent trust grant.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RepositoryPath,
  [Parameter(Mandatory=$true)][string]$ExpectedCommit,
  [Parameter(Mandatory=$true)][string]$ExpectedBinarySha256
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$serviceName='Mad4B-Staging-Backup-Db-Broker'
$hostName='DESKTOP-91FDEFP'
$serviceAccount="NT SERVICE\$serviceName"
$installDir=Join-Path $env:ProgramData 'MAD4B\StagingBackupBrokerHost'
$exe=Join-Path $installDir "$serviceName.exe"
if($env:COMPUTERNAME -cne $hostName){throw 'BROKER_STAGING_HOST_REQUIRED'}
if($ExpectedCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'BROKER_EXACT_SHA_REQUIRED'}
if($ExpectedBinarySha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'BROKER_BINARY_SHA256_REQUIRED'}
$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $isAdmin){throw 'BROKER_ELEVATED_READ_ONLY_MEASUREMENT_REQUIRED'}
$repo=[IO.Path]::GetFullPath($RepositoryPath)
$autoPath=Join-Path $repo 'autopilot-portable-staging\auto-deploy-state.json'
if(-not(Test-Path -LiteralPath $autoPath -PathType Leaf)){throw 'BROKER_STAGING_CERTIFICATION_STATE_MISSING'}
$state=Get-Content -Raw -LiteralPath $autoPath |ConvertFrom-Json -ErrorAction Stop
if($state.certification_status -cne 'ready' -or $state.overall -cne 'ready' -or
   $state.certified_commit -cne $ExpectedCommit -or
   $state.deployed_commit -cne $ExpectedCommit){
  throw 'BROKER_EXACT_CERTIFIED_STAGING_SOURCE_MISMATCH'
}
$service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
if($null -eq $service -or $service.State -cne 'Running' -or
   $service.StartMode -cne 'Manual' -or $service.StartName -cne $serviceAccount -or
   $service.ProcessId -lt 1){throw 'BROKER_OS_SERVICE_IDENTITY_UNVERIFIED'}
$servicePath=([string]$service.PathName).Trim('"')
if(-not [string]::Equals($servicePath,$exe,[StringComparison]::OrdinalIgnoreCase)){
  throw 'BROKER_OS_SERVICE_BINARY_PATH_MISMATCH'
}
foreach($path in @($installDir,$exe)){
  $entry=Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'BROKER_OS_REPARSE_POINT_DENIED'
  }
}
$process=Get-CimInstance Win32_Process -Filter "ProcessId = $($service.ProcessId)" -ErrorAction Stop
if($null -eq $process -or
   -not [string]::Equals([string]$process.ExecutablePath,$exe,[StringComparison]::OrdinalIgnoreCase)){
  throw 'BROKER_OS_PROCESS_BINARY_PATH_UNVERIFIED'
}
$hash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
if($hash -cne $ExpectedBinarySha256){throw 'BROKER_OS_INSTALLED_BINARY_HASH_MISMATCH'}
$serviceSid=([Security.Principal.NTAccount]$serviceAccount).Translate(
  [Security.Principal.SecurityIdentifier]).Value
$dirAcl=Get-Acl -LiteralPath $installDir -ErrorAction Stop
if(-not $dirAcl.AreAccessRulesProtected){throw 'BROKER_OS_DIRECTORY_INHERITANCE_ENABLED'}
$expectedRights=@{
  'S-1-5-18' = 2032127  # NT AUTHORITY\SYSTEM FullControl
  'S-1-5-32-544' = 2032127 # BUILTIN\Administrators FullControl
}
$expectedRights[$serviceSid]=1179817 # Virtual account ReadAndExecute + Synchronize
$rules=@($dirAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if($rules.Count -ne 3){throw 'BROKER_OS_DIRECTORY_ACE_COUNT_MISMATCH'}
$seen=@{}
foreach($rule in $rules){
  $sid=[string]$rule.IdentityReference.Value
  if(-not $expectedRights.ContainsKey($sid) -or $seen.ContainsKey($sid) -or
     $rule.IsInherited -or
     $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
     [int]$rule.FileSystemRights -ne [int]$expectedRights[$sid]){
    throw 'BROKER_OS_DIRECTORY_ACE_MISMATCH'
  }
  $seen[$sid]=$true
}
$exeAcl=Get-Acl -LiteralPath $exe -ErrorAction Stop
$exeRules=@($exeAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
foreach($rule in $exeRules){
  $sid=[string]$rule.IdentityReference.Value
  if(-not $expectedRights.ContainsKey($sid) -or
     $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
     ([int]$rule.FileSystemRights -band [int][Security.AccessControl.FileSystemRights]::Write) -ne 0 -and
     $sid -eq $serviceSid){
    throw 'BROKER_OS_BINARY_FILE_ACL_UNVERIFIED'
  }
}
$scOutput=(& sc.exe qsidtype $serviceName 2>&1|Out-String)
if($LASTEXITCODE -ne 0 -or $scOutput -notmatch 'SERVICE_SID_TYPE:\s+UNRESTRICTED'){
  throw 'BROKER_OS_SERVICE_SID_TYPE_UNVERIFIED'
}
[pscustomobject]@{
  contract='mad4b.staging.backup-broker.os-evidence.v1'
  mode='elevated_local_os_read_only'
  device_id=$env:COMPUTERNAME
  exact_staging_sha=$ExpectedCommit
  service_name=$serviceName
  service_pid=[int]$service.ProcessId
  service_running=$true
  start_mode='Manual'
  service_virtual_identity=$serviceAccount
  service_sid_type='UNRESTRICTED'
  binary_sha256=$hash
  directory_acl_protected=$true
  directory_acl_exact_three_principals=$true
  binary_acl_no_unexpected_principals=$true
  os_evidence_checks_passed=$true
  independently_signed=$false
  externally_custodied=$false
  operational_broker_certified=$false
  db_admin_authorized=$false
  backup_executed=$false
  restore_executed=$false
  production_mutation=$false
  generated_at_utc=[DateTimeOffset]::UtcNow.ToString('o')
} |ConvertTo-Json -Depth 5 -Compress
