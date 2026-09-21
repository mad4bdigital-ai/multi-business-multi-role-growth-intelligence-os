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

$root=(Resolve-Path -LiteralPath $RepositoryPath).Path
$api=Join-Path $root "http-generic-api";$envFile=Join-Path $api ".env.staging"
. (Join-Path $root "autopilot-portable-staging/Staging-CanonicalRepairLedger.ps1")
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
$compose=@('-f',$composeBase,'-f',$composeStaging,'--env-file',$envFile)
$planJson=Get-Content -Raw -LiteralPath $planPath
$precondition=$planJson | & docker compose @compose exec -T app node scripts/staging-canonical-semantic-repair-runtime-check.mjs --action=precondition "--actual-commit=$ExpectedCommit"
Require ($LASTEXITCODE -eq 0) "live Runtime semantic precondition verification failed before ledger reservation"
$preconditionResult=($precondition|Out-String|ConvertFrom-Json)
Require ($preconditionResult.status -eq 'verified_missing' -and $preconditionResult.exact_identity_count -eq 0 -and $preconditionResult.resolver_candidate_count -eq 0 -and $preconditionResult.conflict_count -eq 0) "live Runtime semantic precondition no longer matches the immutable plan"

$ledgerRoot=[string]$env:STAGING_CANONICAL_REPAIR_LEDGER_DIR;Require (-not [string]::IsNullOrWhiteSpace($ledgerRoot)) "STAGING_CANONICAL_REPAIR_LEDGER_DIR is required"
New-Item -ItemType Directory -Force -Path $ledgerRoot | Out-Null;$ledgerPath=Join-Path $ledgerRoot "$($plan.plan_sha256).json"
Require (-not (Test-Path $ledgerPath)) "plan is already consumed"
$now=[DateTime]::UtcNow.ToString('o');$record=[ordered]@{contract='mad4b.staging.canonical-semantic-repair-ledger.v2';plan_sha256=$plan.plan_sha256;expected_commit=$ExpectedCommit;artifact_sha256=$plan.artifact.sha256;precondition_fingerprint=$plan.precondition_fingerprint;state='reserved';created_at=$now;updated_at=$now;mutation_retry_allowed=$false;secrets_included=$false}
Write-StagingCanonicalRepairJsonAtomic $ledgerPath $record;$record.state='executing';$record.updated_at=[DateTime]::UtcNow.ToString('o');Write-StagingCanonicalRepairJsonAtomic $ledgerPath $record

$sql="START TRANSACTION;`n"+(Get-Content -Raw -LiteralPath $artifact)+"`nCOMMIT;"
$sql | & docker compose @compose exec -T runtime-db sh -lc 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb --protocol=socket -uroot --binary-mode "$MARIADB_DATABASE"'
if($LASTEXITCODE -ne 0){
    $failureReadback=$planJson | & docker compose @compose exec -T app node scripts/staging-canonical-semantic-repair-runtime-check.mjs --action=precondition "--actual-commit=$ExpectedCommit" 2>$null
    $knownNotApplied=$false
    if($LASTEXITCODE -eq 0){try{$failureState=($failureReadback|Out-String|ConvertFrom-Json);$knownNotApplied=($failureState.status -eq 'verified_missing')}catch{$knownNotApplied=$false}}
    $record.state=if($knownNotApplied){'known_not_applied'}else{'unknown_outcome'}
    $record.reason=if($knownNotApplied){'semantic_non_application_verified_after_privileged_transport_failure'}else{'bounded_local_privileged_execution_failed_outcome_unknown'}
    $record.semantic_non_application_verified=$knownNotApplied;$record.reconciliation_required=(-not $knownNotApplied);$record.updated_at=[DateTime]::UtcNow.ToString('o')
    Write-StagingCanonicalRepairJsonAtomic $ledgerPath $record
    Fail $(if($knownNotApplied){"bounded artifact execution failed before any observable semantic mutation; create a new plan"}else{"bounded artifact execution failed with unknown outcome; reconciliation is required"})
}

$readback=$planJson | & docker compose @compose exec -T app node scripts/staging-canonical-semantic-repair-runtime-check.mjs --action=readback "--actual-commit=$ExpectedCommit"
Require ($LASTEXITCODE -eq 0) "same-cycle runtime identity readback failed";$readbackResult=($readback|Out-String|ConvertFrom-Json)
Require ($readbackResult.status -eq 'resolved' -and $readbackResult.exact_row_count -eq 1 -and $readbackResult.resolver_candidate_count -eq 1) "runtime identity did not verify exactly one canonical row and resolver candidate"
$record.state='succeeded';$record.updated_at=[DateTime]::UtcNow.ToString('o');$record.postcondition_exact_row_count=1;$record.postcondition_resolver_candidate_count=1;$record.readback_identity='runtime_app';$record.readback_verified=$true;Write-StagingCanonicalRepairJsonAtomic $ledgerPath $record
[ordered]@{contract='mad4b.staging.canonical-semantic-repair-result.v3';status='repaired';plan_sha256=$plan.plan_sha256;artifact_sha256=$plan.artifact.sha256;execution_authority=$plan.execution_authority;exact_row_count=1;resolver_candidate_count=1;mutation_performed=$true;readback_verified=$true;provider_mutation_performed=$false;production_mutation_performed=$false;secrets_included=$false}|ConvertTo-Json -Depth 20
