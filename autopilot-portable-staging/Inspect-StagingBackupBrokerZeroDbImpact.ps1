# Read-only exact-SHA candidate preflight. Does not start services, create
# networks, connect databases, read DBA secrets, or mutate Docker resources.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RepositoryPath,
  [Parameter(Mandatory=$true)][string]$ExpectedCommit
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$blockers=[System.Collections.Generic.List[string]]::new()
if($ExpectedCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'EXACT_MAIN_SHA_REQUIRED'}
$api=Join-Path $RepositoryPath 'http-generic-api'
$base=@(
  '-f',(Join-Path $api 'docker-compose.yml'),
  '-f',(Join-Path $api 'docker-compose.staging.yml'),
  '-f',(Join-Path $api 'docker-compose.staging.windows-service.yml'),
  '--env-file',(Join-Path $api '.env.staging')
)
$extra=@('-f',(Join-Path $api 'docker-compose.staging.backup-broker-preflight.yml'))
function Read-Compose($argsList) {
  $raw=(& docker compose @argsList config --format json 2>$null | Out-String)
  if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)){throw 'DOCKER_COMPOSE_READ_ONLY_CONFIG_FAILED'}
  return ($raw|ConvertFrom-Json)
}
try {
  $a=Read-Compose $base
  $b=Read-Compose ($base+$extra+@('--profile','backup-broker-preflight'))
  $existing=@('app','redis','governance-db','persistence-db','runtime-db')
  $identical=$true
  foreach($key in $existing){
    $left=$a.services.PSObject.Properties[$key]
    $right=$b.services.PSObject.Properties[$key]
    if($null -eq $left -or $null -eq $right -or
       ($left.Value|ConvertTo-Json -Depth 80 -Compress) -cne
       ($right.Value|ConvertTo-Json -Depth 80 -Compress)){$identical=$false}
  }
  if(-not $identical){$blockers.Add('EXISTING_COMPOSE_SERVICE_DRIFT')}
  if(($a.networks|ConvertTo-Json -Depth 80 -Compress) -cne
     ($b.networks|ConvertTo-Json -Depth 80 -Compress)){
     $blockers.Add('DOCKER_NETWORK_DECLARATION_DRIFT')
  }
  $probe=$b.services.PSObject.Properties['backup-db-broker']
  if($null -eq $probe){$blockers.Add('CANDIDATE_SERVICE_MISSING')}
  else {
    $c=$probe.Value
    $optionalCount=0
    foreach($propName in @('ports','volumes','depends_on','environment')){
      $p=$c.PSObject.Properties[$propName]
      if($null -ne $p -and $null -ne $p.Value){
        if($p.Value -is [pscustomobject]){
          $optionalCount+=@($p.Value.PSObject.Properties).Count
        }else{
          $optionalCount+=@($p.Value|Where-Object{$null -ne $_}).Count
        }
      }
    }
    if([string]$c.network_mode -ne 'none' -or
       [string]$c.user -ne '65534:65534' -or
       $c.read_only -ne $true -or
       @($c.cap_drop) -notcontains 'ALL' -or
       @($c.security_opt) -notcontains 'no-new-privileges:true' -or
       $optionalCount -ne 0){
       $blockers.Add('CANDIDATE_SANDBOX_CONTRACT_UNVERIFIED')
    }
  }
  $db=@((& docker inspect http-generic-api-runtime-db-1 2>$null|Out-String)|ConvertFrom-Json)[0]
  if($null -eq $db -or $db.State.Health.Status -ne 'healthy' -or
     @($db.NetworkSettings.Networks.PSObject.Properties.Name).Count -ne 1 -or
     @($db.NetworkSettings.Networks.PSObject.Properties.Name)[0] -ne 'http-generic-api_default' -or
     @($db.NetworkSettings.Ports.PSObject.Properties|
       Where-Object{$null -ne $_.Value -and @($_.Value).Count -gt 0}).Count -ne 0){
     $blockers.Add('LIVE_RUNTIME_DB_TOPOLOGY_UNVERIFIED')
  }
  $manifest=(& docker exec http-generic-api-app-1 cat /app/deployment-manifest.json 2>$null|Out-String|ConvertFrom-Json)
  if($manifest.commit_sha -cne $ExpectedCommit){$blockers.Add('STAGING_SOURCE_SHA_MISMATCH')}
  $candidateCount=@(docker ps -a --format '{{.Names}}' | Where-Object{$_ -eq 'http-generic-api-backup-db-broker-1'}).Count
  if($candidateCount -ne 0){$blockers.Add('BROKER_CANDIDATE_ALREADY_PRESENT')}
}catch{
  $blockers.Add('READ_ONLY_PRECHECK_FAILED')
}
$report=[ordered]@{
  contract='mad4b.staging.backup-broker.zero-db-impact-preflight.v1'
  expected_sha=$ExpectedCommit
  preflight_pass=($blockers.Count -eq 0)
  mode='read_only'
  candidate_activated=$false
  operational_broker_certified=$false
  owner_operation_approved=$false
  database_mutated=$false
  production_mutation=$false
  blockers=@($blockers)
}
$report|ConvertTo-Json -Depth 8 -Compress
if($blockers.Count -gt 0){exit 2}
exit 0
