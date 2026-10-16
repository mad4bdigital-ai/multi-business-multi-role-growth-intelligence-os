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
if(Test-Path -LiteralPath $installDir){throw 'BROKER_INSTALL_DIRECTORY_ALREADY_EXISTS'}
$destination=Join-Path $installDir 'Mad4B-Staging-Backup-Db-Broker.exe'
$created=$false
try{
  [void](New-Item -ItemType Directory -Path $installDir -Force)
  & icacls.exe $installDir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' |Out-Null
  if($LASTEXITCODE -ne 0){throw 'BROKER_SERVICE_ACL_SETUP_FAILED'}
  Copy-Item -LiteralPath $BinaryPath -Destination $destination -ErrorAction Stop
  if((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -cne
     $ExpectedBinarySha256.ToLowerInvariant()){throw 'BROKER_SERVICE_COPY_HASH_MISMATCH'}
  $account="NT SERVICE\$serviceName"
  & sc.exe create $serviceName binPath= ('"'+$destination+'"') start= demand obj= $account password= '' |Out-Null
  if($LASTEXITCODE -ne 0){throw 'BROKER_WINDOWS_SERVICE_REGISTRATION_FAILED'}
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
