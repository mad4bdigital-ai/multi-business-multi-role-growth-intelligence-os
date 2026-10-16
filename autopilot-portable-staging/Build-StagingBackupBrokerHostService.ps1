# Compile inert native Windows SCM host WITHOUT installing a service.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RepositoryPath,
  [string]$OutputDirectory = (Join-Path $env:TEMP 'mad4b-staging-broker-host-build')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'DESKTOP-91FDEFP'){throw 'STAGING_DEVICE_MISMATCH'}
$source=Join-Path $RepositoryPath 'local-connector\staging-backup-db-broker-host-service.cs'
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$dll=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.ServiceProcess.dll'
if(-not(Test-Path -LiteralPath $source -PathType Leaf) -or
   -not(Test-Path -LiteralPath $csc -PathType Leaf) -or
   -not(Test-Path -LiteralPath $dll -PathType Leaf)){
  throw 'STAGING_NATIVE_HOST_BUILD_PREREQUISITES_MISSING'
}
[void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
$binary=Join-Path $OutputDirectory 'Mad4B-Staging-Backup-Db-Broker.exe'
& $csc /nologo /target:exe /platform:x64 /optimize+ ("/out:"+$binary) ("/reference:"+$dll) $source
if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $binary -PathType Leaf)){
  throw 'STAGING_NATIVE_HOST_COMPILATION_FAILED'
}
$line=(& $binary --self-test 2>$null | Out-String).Trim()
if($LASTEXITCODE -ne 0){throw 'STAGING_NATIVE_HOST_SELF_TEST_FAILED'}
$contract=$line|ConvertFrom-Json
if($contract.contract -ne 'mad4b.staging.backup-broker.os-service-host.v1' -or
   $contract.operational_broker -ne $false -or
   $contract.db_admin_authorized -ne $false -or
   $contract.production_mutation -ne $false){throw 'STAGING_NATIVE_HOST_CONTRACT_FAILED'}
$sha=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
[pscustomobject]@{
  contract='mad4b.staging.backup-broker.os-service-build.v1'
  output_binary=$binary
  binary_sha256=$sha
  service_name=$contract.service_name
  operational_broker=$false
  db_admin_authorized=$false
  installed=$false
  executed_real_sql=$false
  production_mutation=$false
}|ConvertTo-Json -Compress
