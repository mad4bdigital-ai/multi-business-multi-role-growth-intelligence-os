# Governed installation of an inert Staging-only Windows SCM service.
# Default is read-only Plan; -Apply requires actual elevated operator session,
# exact deployed source SHA, binary SHA, and explicit non-DB operation scope.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$RepositoryPath,
 [Parameter(Mandatory=$true)][string]$ExpectedCommit,
 [Parameter(Mandatory=$true)][string]$BinaryPath,
 [Parameter(Mandatory=$true)][string]$ExpectedBinarySha256,
 [switch]$Apply,
 [switch]$ResumeInterruptedRegistration,
 [string]$OperationScope=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$serviceName='Mad4B-Staging-Backup-Db-Broker'
$scope='STAGING_INERT_SERVICE_ONLY_NO_DBA'
if($env:COMPUTERNAME -ne 'DESKTOP-91FDEFP'){throw 'BROKER_STAGING_HOST_REQUIRED'}
if($ExpectedCommit -cnotmatch '^[a-f0-9]{40}$' -or
   $ExpectedBinarySha256 -cnotmatch '^[a-f0-9]{64}$'){
  throw 'BROKER_EXACT_SOURCE_AND_BINARY_HASH_REQUIRED'
}
$sha=(& git -C $RepositoryPath rev-parse HEAD 2>$null|Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $sha -cne $ExpectedCommit){
  throw 'BROKER_REPOSITORY_HEAD_MISMATCH'
}
$liveMain=(& git -C $RepositoryPath ls-remote origin refs/heads/main 2>$null|Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $liveMain.Split()[0] -cne $ExpectedCommit){
  throw 'BROKER_GITHUB_MAIN_MISMATCH'
}
if(-not(Test-Path -LiteralPath $BinaryPath -PathType Leaf)){
  throw 'BROKER_COMPILED_BINARY_NOT_FOUND'
}
$hash=(Get-FileHash -LiteralPath $BinaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
if($hash -cne $ExpectedBinarySha256.ToLowerInvariant()){
  throw 'BROKER_COMPILED_BINARY_SHA256_MISMATCH'
}
# Never execute a supplied EXE inside an elevated installer.
# Compile and self-test under the unprivileged Build helper instead;
# this installer checks only the exact externally reviewed file digest.
# Digest equality proves integrity only, not independent publisher trust.
$deploy=Get-Content -Raw (Join-Path $RepositoryPath 'autopilot-portable-staging\auto-deploy-state.json')|ConvertFrom-Json
if($deploy.deployed_commit -cne $ExpectedCommit -or
   $deploy.certified_commit -cne $ExpectedCommit -or
   $deploy.certification_status -cne 'ready' -or
   $deploy.production_deploy -ne $false){
  throw 'BROKER_STAGING_DEPLOYMENT_NOT_CERTIFIED'
}
$manifest=(& docker exec http-generic-api-app-1 cat /app/deployment-manifest.json 2>$null|Out-String|ConvertFrom-Json)
if($LASTEXITCODE -ne 0 -or $manifest.commit_sha -cne $ExpectedCommit){
  throw 'BROKER_STAGING_CONTAINER_MANIFEST_MISMATCH'
}
$service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
if($null -ne $service){throw 'BROKER_SERVICE_ALREADY_REGISTERED'}
if($OperationScope -and $OperationScope -cne $scope){throw 'BROKER_OPERATION_SCOPE_DENIED'}
$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $Apply){
  [pscustomobject]@{
    contract='mad4b.staging.backup-broker.native-install-plan.v1'
    exact_sha=$ExpectedCommit
    sha256_verified=$true
    installer_executed_binary=$false
    staging_certified=$true
    service_present=$false
    interrupted_install_directory_present=(Test-Path -LiteralPath (Join-Path $env:ProgramData 'MAD4B\StagingBackupBrokerHost') -PathType Container)
    resume_interrupted_registration_requested=[bool]$ResumeInterruptedRegistration
    can_apply_under_current_token=$isAdmin
    apply_requires_exact_scope=$scope
    installed=$false
    db_admin_authorized=$false
    production_mutation=$false
  }|ConvertTo-Json -Compress
  exit 0
}
if(-not $isAdmin){throw 'BROKER_WINDOWS_ADMINISTRATOR_REQUIRED'}
if($OperationScope -cne $scope){throw 'BROKER_EXPLICIT_NO_DBA_SCOPE_REQUIRED'}
$installDir=Join-Path $env:ProgramData 'MAD4B\StagingBackupBrokerHost'
$destination=Join-Path $installDir 'Mad4B-Staging-Backup-Db-Broker.exe'
$existingDir=Test-Path -LiteralPath $installDir -PathType Container
if($existingDir -and -not $ResumeInterruptedRegistration){
  throw 'BROKER_INSTALL_DIRECTORY_ALREADY_EXISTS_USE_EXPLICIT_RECOVERY'
}
if($existingDir){
  # Fail closed: recover only the one exact previously copied binary, never a general directory.
  $folder=Get-Item -LiteralPath $installDir -Force -ErrorAction Stop
  $entries=@(Get-ChildItem -LiteralPath $installDir -Force -ErrorAction Stop)
  if(($folder.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
     $entries.Count -ne 1 -or $entries[0].FullName -cne $destination -or
     $entries[0].PSIsContainer -or
     ($entries[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'BROKER_INTERRUPTED_DIRECTORY_CONTENT_UNVERIFIED'
  }
  if((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -cne
     $ExpectedBinarySha256.ToLowerInvariant()){
    throw 'BROKER_INTERRUPTED_BINARY_HASH_MISMATCH'
  }
  $directoryAcl=Get-Acl -LiteralPath $installDir -ErrorAction Stop
  $aces=@($directoryAcl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))
  $sids=@($aces | ForEach-Object {$_.IdentityReference.Value})
  if(-not $directoryAcl.AreAccessRulesProtected -or $aces.Count -ne 2 -or
     @($sids | Sort-Object -Unique).Count -ne 2 -or
     @($sids | Where-Object {$_ -notin @('S-1-5-18','S-1-5-32-544')}).Count -ne 0){
    throw 'BROKER_INTERRUPTED_DIRECTORY_ACL_UNVERIFIED'
  }
  foreach($ace in $aces){
    if($ace.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
       ($ace.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
       [Security.AccessControl.FileSystemRights]::FullControl){
      throw 'BROKER_INTERRUPTED_DIRECTORY_ACL_UNVERIFIED'
    }
  }
}
$created=$false
try{
  if(-not $existingDir){
    [void](New-Item -ItemType Directory -Path $installDir -Force)
    & icacls.exe $installDir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' |Out-Null
    if($LASTEXITCODE -ne 0){throw 'BROKER_SERVICE_ACL_SETUP_FAILED'}
    Copy-Item -LiteralPath $BinaryPath -Destination $destination -ErrorAction Stop
    if((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -cne
       $ExpectedBinarySha256.ToLowerInvariant()){throw 'BROKER_SERVICE_COPY_HASH_MISMATCH'}
  }
  $account="NT SERVICE\$serviceName"
  # Virtual accounts require a NULL password, not an empty PowerShell native argument.
  # PowerShell 5.1 silently drops the empty string in "password= ''", breaking sc.exe.
  $scOutput=(& sc.exe create $serviceName binPath= ('"'+$destination+'"') start= demand obj= $account 2>&1 |Out-String)
  $scExit=$LASTEXITCODE
  if($scExit -ne 0){
    $nativeCode=[regex]::Match($scOutput,'FAILED\s+(\d+)').Groups[1].Value
    throw "BROKER_WINDOWS_SERVICE_REGISTRATION_FAILED: sc_exit=$scExit win32_code=$nativeCode"
  }
  $created=$true
  & sc.exe sidtype $serviceName unrestricted |Out-Null
  if($LASTEXITCODE -ne 0){throw 'BROKER_WINDOWS_SERVICE_SID_SETUP_FAILED'}
  & icacls.exe $installDir /grant:r "${account}:(OI)(CI)RX" |Out-Null
  if($LASTEXITCODE -ne 0){throw 'BROKER_VIRTUAL_SERVICE_READ_ACL_FAILED'}
  $configured=Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  if($configured.StartName -cne $account -or $configured.StartMode -ne 'Manual'){
    throw 'BROKER_WINDOWS_SERVICE_IDENTITY_MISMATCH'
  }
  Start-Service -Name $serviceName -ErrorAction Stop
  $running=Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  if($running.State -ne 'Running' -or $running.StartName -cne $account){
    throw 'BROKER_NATIVE_SERVICE_START_FAILED'
  }
  [pscustomobject]@{
    contract='mad4b.staging.backup-broker.native-service-install.v1'
    service_name=$serviceName
    service_running=$true
    service_account_is_virtual=$true
    binary_sha256=$hash
    operational_broker_certified=$false
    db_admin_authorized=$false
    owner_operation_approved=$false
    backup_executed=$false
    production_mutation=$false
  }|ConvertTo-Json -Compress
}catch{
  if($created){
    try{Stop-Service -Name $serviceName -ErrorAction SilentlyContinue}catch{}
    & sc.exe delete $serviceName |Out-Null
  }
  throw
}
