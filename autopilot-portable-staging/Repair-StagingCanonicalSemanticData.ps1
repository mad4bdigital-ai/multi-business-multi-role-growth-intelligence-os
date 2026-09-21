[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepositoryPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedCommit,
    [Parameter(Mandatory = $true)][string]$PlanFile,
    [Parameter(Mandatory = $true)][string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail([string]$Message) { throw "STAGING_CANONICAL_SEMANTIC_REPAIR_FAIL_CLOSED: $Message" }
function Require([bool]$Condition,[string]$Message) { if(-not $Condition){ Fail $Message } }
function Read-Env([string]$Path,[string]$Name) { $line=Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1; if(-not $line){Fail "Missing $Name in .env.staging"}; return ($line -replace "^$([regex]::Escape($Name))=","") }
function Write-JsonAtomic([string]$Path,[object]$Value) { $tmp="$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"; try{$Value|ConvertTo-Json -Depth 40|Set-Content -LiteralPath $tmp -Encoding utf8;Move-Item -LiteralPath $tmp -Destination $Path -Force}finally{if(Test-Path $tmp){Remove-Item $tmp -Force -ErrorAction SilentlyContinue}} }

$root=(Resolve-Path -LiteralPath $RepositoryPath).Path
$api=Join-Path $root "http-generic-api";$envFile=Join-Path $api ".env.staging"
$composeBase=Join-Path $api "docker-compose.yml";$composeStaging=Join-Path $api "docker-compose.staging.yml"
$planPath=(Resolve-Path -LiteralPath $PlanFile).Path;$ExpectedCommit=$ExpectedCommit.ToLowerInvariant()
Require ((& git -C $root rev-parse HEAD).Trim().ToLowerInvariant() -eq $ExpectedCommit) "checked-out Git SHA differs from ExpectedCommit"
& git -C $root fetch origin main --quiet; Require ($LASTEXITCODE -eq 0) "origin/main refresh failed"
Require ((& git -C $root rev-parse origin/main).Trim().ToLowerInvariant() -eq $ExpectedCommit) "origin/main differs from ExpectedCommit"
Require (Test-Path $envFile -PathType Leaf) "local Staging environment file is missing"
Require ((Read-Env $envFile "STAGING_ENVIRONMENT_KEY") -eq "staging_local_windows_docker") "environment is not local Staging"
$database=Read-Env $envFile "DB_NAME";Require ($database -notmatch '(?i)production|hostinger') "Production database target is forbidden"

$validatedText=& node (Join-Path $api "scripts/validate-staging-canonical-semantic-repair-plan.mjs") "--plan-file=$planPath" "--actual-commit=$ExpectedCommit"
Require ($LASTEXITCODE -eq 0) "immutable plan validation failed";$validated=($validatedText|Out-String|ConvertFrom-Json);$plan=$validated.plan
Require ([string]$plan.artifact.artifact_key -eq "platform_admin_workspace") "artifact_key is not bounded"
Require ([string]$plan.execution_authority -eq "repository_bound_local_staging_canonical_repair") "repair authority mismatch"
Require ($plan.caller_sql_forbidden -eq $true -and $plan.caller_target_forbidden -eq $true) "caller-controlled SQL or target is forbidden"
Require ($plan.production_access_forbidden -eq $true -and $plan.provider_access_forbidden -eq $true) "external target prohibition is missing"
Require ($Confirmation -ceq [string]$validated.validation.required_confirmation) "typed confirmation mismatch"
$artifact=Join-Path $api ([string]$plan.artifact.file -replace '^http-generic-api/','')
Require (Test-Path $artifact -PathType Leaf) "registered artifact is missing"
Require ((Get-FileHash -Algorithm SHA256 $artifact).Hash.ToLowerInvariant() -eq [string]$plan.artifact.sha256) "registered artifact SHA mismatch"

$ledgerRoot=[string]$env:STAGING_CANONICAL_REPAIR_LEDGER_DIR;Require (-not [string]::IsNullOrWhiteSpace($ledgerRoot)) "STAGING_CANONICAL_REPAIR_LEDGER_DIR is required"
New-Item -ItemType Directory -Force -Path $ledgerRoot | Out-Null;$ledgerPath=Join-Path $ledgerRoot "$($plan.plan_sha256).json"
Require (-not (Test-Path $ledgerPath)) "plan is already consumed"
$now=[DateTime]::UtcNow.ToString('o');$record=[ordered]@{contract='mad4b.staging.canonical-semantic-repair-ledger.v2';plan_sha256=$plan.plan_sha256;expected_commit=$ExpectedCommit;artifact_sha256=$plan.artifact.sha256;precondition_fingerprint=$plan.precondition_fingerprint;state='reserved';created_at=$now;updated_at=$now;mutation_retry_allowed=$false;secrets_included=$false}
Write-JsonAtomic $ledgerPath $record;$record.state='executing';$record.updated_at=[DateTime]::UtcNow.ToString('o');Write-JsonAtomic $ledgerPath $record

$rootPassword=Read-Env $envFile "RUNTIME_DB_ROOT_PASSWORD";$compose=@('-f',$composeBase,'-f',$composeStaging,'--env-file',$envFile)
$sql="START TRANSACTION;`n"+(Get-Content -Raw -LiteralPath $artifact)+"`nCOMMIT;"
$sql | & docker compose @compose exec -T -e "MYSQL_PWD=$rootPassword" runtime-db mariadb --protocol=socket -uroot --binary-mode $database
if($LASTEXITCODE -ne 0){$record.state='unknown_outcome';$record.reason='bounded_local_privileged_execution_failed';$record.updated_at=[DateTime]::UtcNow.ToString('o');Write-JsonAtomic $ledgerPath $record;Fail "bounded artifact execution failed; reconciliation is required"}

$runtimeUser=Read-Env $envFile "DB_USER";$runtimePassword=Read-Env $envFile "DB_PASSWORD"
$readbackSql=@"
SELECT COUNT(*) FROM workspace_registry
WHERE workspace_id='b50db01b-617e-4b7a-8bda-6bf4876f754f'
  AND tenant_id='00000000-0000-0000-0000-000000000000'
  AND workspace_key='platform_repo_governance_zero'
  AND display_name='Platform Admin' AND workspace_type='brand' AND bootstrap_status='ready'
  AND JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.authority_scope_key'))='platform:root'
  AND JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.platform_admin_workspace'))='true';
SELECT COUNT(*) FROM workspace_registry
WHERE tenant_id='00000000-0000-0000-0000-000000000000' AND bootstrap_status='ready'
  AND (workspace_key='platform_admin_workspace' OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.authority_scope_key'))='platform:root' OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.platform_admin_workspace'))='true');
"@
$readback=& docker compose @compose exec -T -e "MYSQL_PWD=$runtimePassword" runtime-db mariadb --protocol=socket "--user=$runtimeUser" $database --batch --skip-column-names --raw -e $readbackSql
Require ($LASTEXITCODE -eq 0) "same-cycle runtime identity readback failed";$counts=@($readback|ForEach-Object{[string]$_}|Where-Object{$_ -match '^\d+$'})
Require ($counts.Count -eq 2 -and $counts[0] -eq '1' -and $counts[1] -eq '1') "runtime identity did not verify exactly one canonical row and resolver candidate"
$record.state='succeeded';$record.updated_at=[DateTime]::UtcNow.ToString('o');$record.postcondition_exact_row_count=1;$record.postcondition_resolver_candidate_count=1;$record.readback_identity='runtime_app';$record.readback_verified=$true;Write-JsonAtomic $ledgerPath $record
[ordered]@{contract='mad4b.staging.canonical-semantic-repair-result.v3';status='repaired';plan_sha256=$plan.plan_sha256;artifact_sha256=$plan.artifact.sha256;execution_authority=$plan.execution_authority;exact_row_count=1;resolver_candidate_count=1;mutation_performed=$true;readback_verified=$true;provider_mutation_performed=$false;production_mutation_performed=$false;secrets_included=$false}|ConvertTo-Json -Depth 20
