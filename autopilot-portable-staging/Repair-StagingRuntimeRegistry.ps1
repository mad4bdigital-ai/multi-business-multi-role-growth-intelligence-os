[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepositoryPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedCommit,
    [ValidateSet("Plan","Apply","Reconcile")][string]$Mode = "Plan",
    [Parameter(Mandatory = $true)][string]$PlanFile,
    [string]$Confirmation = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()

function Fail([string]$Message) { throw "STAGING_RUNTIME_REGISTRY_RECONCILIATION_FAIL_CLOSED: $Message" }
function Require([bool]$Condition,[string]$Message) { if(-not $Condition){ Fail $Message } }
function Read-Env([string]$Path,[string]$Name) {
    $line=Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if(-not $line){Fail "Missing $Name in .env.staging"}
    return ($line -replace "^$([regex]::Escape($Name))=","")
}
function Invoke-Ledger([string]$Action,[object]$Details=$null) {
    $args=@((Join-Path $api "scripts/staging-runtime-registry-reconciliation-ledger.mjs"),"--action=$Action","--plan-file=$planPath")
    if($null -eq $Details){
        $text=& node @args
    }else{
        $json=$Details|ConvertTo-Json -Depth 30 -Compress
        $text=$json | & node @args
    }
    Require ($LASTEXITCODE -eq 0) "registry reconciliation ledger transition failed: $Action"
    try{return (($text|Out-String).Trim()|ConvertFrom-Json)}catch{Fail "registry reconciliation ledger returned invalid JSON"}
}
function Copy-RuntimeArtifacts {
    & docker compose @compose exec -T app sh -lc 'rm -rf /tmp/mad4b-staging-registry-reconciliation && mkdir -p /tmp/mad4b-staging-registry-reconciliation'
    Require ($LASTEXITCODE -eq 0) "failed to prepare bounded Runtime artifact directory"
    & docker compose @compose cp $artifactPath "app:/tmp/mad4b-staging-registry-reconciliation/runtime.registry-reconciliation.sql.gz"
    Require ($LASTEXITCODE -eq 0) "failed to copy registry reconciliation artifact into Runtime"
    & docker compose @compose cp $bundleManifestPath "app:/tmp/mad4b-staging-registry-reconciliation/staging-schema-bundle-manifest.json"
    Require ($LASTEXITCODE -eq 0) "failed to copy same-cycle bundle manifest into Runtime"
}
function Invoke-RuntimeCheck([string]$Action,[string]$PlanJson="") {
    $cmd=@("compose")+$compose+@("exec","-T","app","node","scripts/staging-runtime-registry-reconciliation-runtime-check.mjs","--action=$Action","--actual-commit=$ExpectedCommit")
    if([string]::IsNullOrEmpty($PlanJson)){
        $text=& docker @cmd
    }else{
        $text=$PlanJson | & docker @cmd
    }
    Require ($LASTEXITCODE -eq 0) "Runtime registry reconciliation check failed: $Action"
    try{return (($text|Out-String).Trim()|ConvertFrom-Json)}catch{Fail "Runtime registry reconciliation check returned invalid JSON: $Action"}
}
function Get-ValidatedPlan {
    $text=& node (Join-Path $api "scripts/staging-runtime-registry-reconciliation-plan-validate.mjs") "--plan-file=$planPath" "--actual-commit=$ExpectedCommit"
    Require ($LASTEXITCODE -eq 0) "immutable registry reconciliation plan validation failed"
    try{return (($text|Out-String).Trim()|ConvertFrom-Json)}catch{Fail "registry reconciliation plan validator returned invalid JSON"}
}
function Enter-ExclusiveRepairLock {
    $ledgerRoot=[string]$env:STAGING_RUNTIME_REGISTRY_RECONCILIATION_LEDGER_DIR
    Require (-not [string]::IsNullOrWhiteSpace($ledgerRoot)) "STAGING_RUNTIME_REGISTRY_RECONCILIATION_LEDGER_DIR is required"
    New-Item -ItemType Directory -Force -Path $ledgerRoot | Out-Null
    $lockPath=Join-Path $ledgerRoot ".runtime-registry-reconciliation.lock"
    try{return [IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
    catch{Fail "another local Staging registry reconciliation operation already holds the exclusive host lock"}
}

$root=(Resolve-Path -LiteralPath $RepositoryPath).Path
$api=Join-Path $root "http-generic-api"
$envFile=Join-Path $api ".env.staging"
$composeBase=Join-Path $api "docker-compose.yml"
$composeStaging=Join-Path $api "docker-compose.staging.yml"
$bundleDir=Join-Path $root "autopilot-portable-staging/staging-db-dumps"
$bundleManifestPath=Join-Path $bundleDir "staging-schema-bundle-manifest.json"
$artifactPath=Join-Path $bundleDir "runtime.registry-reconciliation.sql.gz"
$planPath=[IO.Path]::GetFullPath($PlanFile)
. (Join-Path $root "autopilot-portable-staging/Staging-CanonicalRepairLedger.ps1")

Require ((& git -C $root rev-parse HEAD).Trim().ToLowerInvariant() -eq $ExpectedCommit) "checked-out Git SHA differs from ExpectedCommit"
& git -C $root fetch origin main --quiet
Require ($LASTEXITCODE -eq 0) "origin/main refresh failed"
Require ((& git -C $root rev-parse origin/main).Trim().ToLowerInvariant() -eq $ExpectedCommit) "origin/main differs from ExpectedCommit"
$trackedChanges=((& git -C $root status --porcelain --untracked-files=no)|Out-String).Trim()
Require ([string]::IsNullOrWhiteSpace($trackedChanges)) "tracked working tree changes are forbidden"
Require ([string]::IsNullOrWhiteSpace([string]$env:DOCKER_HOST)) "DOCKER_HOST is forbidden for local Staging reconciliation"
Require ([string]::IsNullOrWhiteSpace([string]$env:DOCKER_CONTEXT)) "DOCKER_CONTEXT is forbidden for local Staging reconciliation"
Require (Test-Path $envFile -PathType Leaf) "local Staging environment file is missing"
Require ((Read-Env $envFile "STAGING_ENVIRONMENT_KEY") -eq "staging_local_windows_docker") "environment is not local Staging"
$database=Read-Env $envFile "DB_NAME"
Require ($database -notmatch '(?i)production|hostinger') "Production database target is forbidden"
Require (Test-Path $bundleManifestPath -PathType Leaf) "same-cycle schema bundle manifest is missing"
Require (Test-Path $artifactPath -PathType Leaf) "runtime registry reconciliation artifact is missing"
try{$bundleManifest=Get-Content -Raw -LiteralPath $bundleManifestPath|ConvertFrom-Json}catch{Fail "same-cycle schema bundle manifest is invalid JSON"}
Require ([string]$bundleManifest.contract -eq "mad4b.staging.schema-bundle-output.v1") "unsupported schema bundle manifest contract"
Require ([string]$bundleManifest.source_commit -eq $ExpectedCommit) "schema bundle manifest commit differs from ExpectedCommit"
Require ([string]$bundleManifest.source_repository -eq "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os") "schema bundle repository identity mismatch"
Require ($bundleManifest.production_accessed -eq $false -and $bundleManifest.provider_accessed -eq $false -and $bundleManifest.secrets_included -eq $false) "schema bundle safety envelope is invalid"
$metadata=$bundleManifest.canonical_registry_reconciliation_snapshot
Require ([string]$metadata.contract -eq "mad4b.staging.runtime-registry-reconciliation-snapshot.v1") "registry reconciliation snapshot metadata is missing"
Require ([string]$metadata.exact_source_commit -eq $ExpectedCommit) "registry reconciliation snapshot exact commit mismatch"
Require ((Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath).Hash.ToLowerInvariant() -eq [string]$metadata.sha256) "registry reconciliation artifact SHA mismatch"
$compose=@("-f",$composeBase,"-f",$composeStaging,"--env-file",$envFile)

if($Mode -eq "Plan"){
    Require (-not (Test-Path -LiteralPath $planPath)) "plan output already exists; choose a new immutable plan path"
    Copy-RuntimeArtifacts
    $runtimePlan=Invoke-RuntimeCheck "plan"
    $plan=$runtimePlan.plan
    Require ([string]$plan.expected_commit -eq $ExpectedCommit) "Runtime plan commit differs from ExpectedCommit"
    Require ($plan.production_access_forbidden -eq $true -and $plan.provider_access_forbidden -eq $true) "Runtime plan external authority boundary is invalid"
    Require ($plan.caller_sql_forbidden -eq $true -and $plan.caller_target_forbidden -eq $true) "Runtime plan caller authority boundary is invalid"

    if([string]$plan.status_before -eq "access_not_ready"){
        [ordered]@{
            contract="mad4b.staging-runtime-registry-reconciliation-handoff.v1"
            status="access_prerequisites_required"
            expected_commit=$ExpectedCommit
            access_condition="runtime_registry_select_denied"
            prerequisite_authority=[ordered]@{
                operation_key="database.repair"
                runbook_key="database.access_repair"
                action="dry_run"
                apply_action="apply_grants"
                target_source="staging_local_role_env"
                target_key="staging-runtime"
            }
            database_mutation_performed=$false
            production_mutation_performed=$false
            provider_mutation_performed=$false
            secrets_included=$false
        }|ConvertTo-Json -Depth 30
        return
    }
    if([string]$plan.status_before -eq "schema_not_ready"){
        [ordered]@{
            contract="mad4b.staging-runtime-registry-reconciliation-handoff.v1"
            status="schema_prerequisites_required"
            expected_commit=$ExpectedCommit
            missing_schema=$plan.status_before
            schema_prerequisites=$plan.schema_prerequisites
            prerequisite_authorities=@(
                [ordered]@{migration="20260902_staging_actions_runtime_contract_reconciliation.sql";authority="staging_schema_repair";operation_key="database.repair";runbook_key="database.schema_repair";action="dry_run";apply_action="apply_migration";target_source="staging_local_role_env";target_key="staging-runtime";confirmation_formula="APPLY_STAGING_RUNTIME_MIGRATION:<sha>:staging-runtime:<migration>"},
                [ordered]@{migration="20260815_custom_gpt_mcp_catalog_levels.sql";authority="staging_schema_repair";operation_key="database.repair";runbook_key="database.schema_repair";action="dry_run";apply_action="apply_migration";target_source="staging_local_role_env";target_key="staging-runtime";confirmation_formula="APPLY_STAGING_RUNTIME_MIGRATION:<sha>:staging-runtime:<migration>"}
            )
            database_mutation_performed=$false
            production_mutation_performed=$false
            provider_mutation_performed=$false
            secrets_included=$false
        }|ConvertTo-Json -Depth 30
        return
    }
    if([string]$plan.status_before -eq "conflict"){
        [ordered]@{contract="mad4b.staging-runtime-registry-reconciliation-handoff.v1";status="registry_conflict_review_required";expected_commit=$ExpectedCommit;conflict_count=[int]$plan.conflict_count;database_mutation_performed=$false;production_mutation_performed=$false;provider_mutation_performed=$false;secrets_included=$false}|ConvertTo-Json -Depth 20
        return
    }
    if([string]$plan.status_before -eq "already_satisfied"){
        [ordered]@{contract="mad4b.staging-runtime-registry-reconciliation-handoff.v1";status="already_satisfied";expected_commit=$ExpectedCommit;exact_count=[int]$plan.exact_count;extra_count=[int]$plan.extra_count;database_mutation_performed=$false;production_mutation_performed=$false;provider_mutation_performed=$false;secrets_included=$false}|ConvertTo-Json -Depth 20
        return
    }
    Require ($plan.repair_allowed -eq $true -and [string]$plan.status_before -eq "missing_rows") "Runtime registry state is not eligible for bounded reconciliation"
    Require ([int]$plan.conflict_count -eq 0 -and [int]$plan.missing_count -gt 0) "Runtime registry plan must contain only missing canonical rows"

    $parent=Split-Path -Parent $planPath
    if(-not [string]::IsNullOrWhiteSpace($parent)){New-Item -ItemType Directory -Force -Path $parent|Out-Null}
    $envelope=[ordered]@{
        contract="mad4b.staging-runtime-registry-reconciliation-plan-output.v1"
        plan=$plan
        runtime_provenance_verified=$true
        database_mutation_performed=$false
        production_mutation_performed=$false
        provider_mutation_performed=$false
        secrets_included=$false
        generated_at=[DateTime]::UtcNow.ToString("o")
    }
    Write-StagingCanonicalRepairJsonAtomic $planPath $envelope
    $validated=Get-ValidatedPlan
    Require ([string]$validated.plan.plan_sha256 -eq [string]$plan.plan_sha256) "plan hash changed during host validation"
    [ordered]@{
        contract="mad4b.staging-runtime-registry-reconciliation-handoff.v1"
        status="plan_ready"
        plan_file=$planPath
        plan_sha256=[string]$plan.plan_sha256
        required_confirmation=[string]$validated.validation.required_confirmation
        expected_commit=$ExpectedCommit
        missing_count=[int]$plan.missing_count
        extra_live_rows_preserved=[int]$plan.extra_count
        insertion_only=$true
        database_mutation_performed=$false
        production_mutation_performed=$false
        provider_mutation_performed=$false
        secrets_included=$false
    }|ConvertTo-Json -Depth 30
    return
}

Require (Test-Path -LiteralPath $planPath -PathType Leaf) "immutable registry reconciliation plan file is missing"
$validated=Get-ValidatedPlan
$plan=$validated.plan
Require ([string]$plan.expected_commit -eq $ExpectedCommit) "plan commit differs from ExpectedCommit"
Require ($plan.repair_allowed -eq $true -and [string]$plan.status_before -eq "missing_rows" -and [int]$plan.conflict_count -eq 0) "plan is not eligible for apply/reconciliation"
$planJson=Get-Content -Raw -LiteralPath $planPath
$lock=$null
$sqlFile=$null
try{
    $lock=Enter-ExclusiveRepairLock
    Copy-RuntimeArtifacts

    if($Mode -eq "Reconcile"){
        $record=(Invoke-Ledger "read").record
        Require ($null -ne $record -and [string]$record.state -eq "unknown_outcome") "Reconcile requires an unknown_outcome durable ledger record"
        $readback=Invoke-RuntimeCheck "reconcile-readback" $planJson
        if([string]$readback.status -eq "reconciled_succeeded"){
            Invoke-Ledger "mark-succeeded" ([ordered]@{reconciled_after_unknown_outcome=$true;reconciliation_evidence_hash=[string]$readback.reconciliation_evidence_hash;readback_verified=$true})|Out-Null
            [ordered]@{contract="mad4b.staging-runtime-registry-reconciliation-result.v1";status="reconciled_succeeded";plan_sha256=$plan.plan_sha256;mutation_retry_allowed=$false;readback_verified=$true;production_mutation_performed=$false;provider_mutation_performed=$false;secrets_included=$false}|ConvertTo-Json -Depth 20
            return
        }
        if([string]$readback.status -eq "reconciled_no_mutation"){
            Invoke-Ledger "mark-reconciled-no-mutation" ([ordered]@{reconciliation_evidence_hash=[string]$readback.reconciliation_evidence_hash;readback_verified=$true})|Out-Null
            [ordered]@{contract="mad4b.staging-runtime-registry-reconciliation-result.v1";status="reconciled_no_mutation";plan_sha256=$plan.plan_sha256;mutation_retry_allowed=$false;new_plan_required=$true;production_mutation_performed=$false;provider_mutation_performed=$false;secrets_included=$false}|ConvertTo-Json -Depth 20
            return
        }
        Fail "unknown outcome remains partially applied or conflicted; automatic retry is forbidden"
    }

    Require (-not [string]::IsNullOrWhiteSpace($Confirmation)) "typed confirmation is required for Apply"
    Require ($Confirmation -ceq [string]$validated.validation.required_confirmation) "typed confirmation mismatch"
    $precondition=Invoke-RuntimeCheck "precondition" $planJson
    Require ([string]$precondition.status -eq "verified_missing_rows" -and [int]$precondition.conflict_count -eq 0) "live Runtime registry precondition no longer matches immutable plan"

    $sqlFile=Join-Path ([IO.Path]::GetTempPath()) ("mad4b-staging-registry-reconcile-"+$plan.plan_sha256+".sql")
    if(Test-Path -LiteralPath $sqlFile){Remove-Item -LiteralPath $sqlFile -Force}
    $materialized=& node (Join-Path $api "scripts/staging-runtime-registry-reconciliation-materialize-sql.mjs") "--plan-file=$planPath" "--actual-commit=$ExpectedCommit" "--output-file=$sqlFile"
    Require ($LASTEXITCODE -eq 0) "registry reconciliation SQL materialization failed"
    $materializedResult=($materialized|Out-String).Trim()|ConvertFrom-Json
    Require ([int]$materializedResult.statement_count -eq [int]$plan.missing_count) "materialized statement count differs from immutable plan"

    Invoke-Ledger "reserve"|Out-Null
    Invoke-Ledger "mark-executing" ([ordered]@{selected_statement_count=[int]$plan.missing_count;exclusive_host_lock=$true})|Out-Null

    $previousErrorActionPreference=$ErrorActionPreference
    try{
        $ErrorActionPreference="Continue"
        Get-Content -Raw -LiteralPath $sqlFile | & docker compose @compose exec -T runtime-db sh -lc 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb --protocol=socket -uroot --binary-mode "$MARIADB_DATABASE"'
        $sqlExit=$LASTEXITCODE
    }finally{
        $ErrorActionPreference=$previousErrorActionPreference
    }

    if($sqlExit -ne 0){
        Invoke-Ledger "mark-unknown" ([ordered]@{reason="privileged_registry_transport_failed";transport_exit_code=$sqlExit;reconciliation_required=$true;mutation_retry_allowed=$false})|Out-Null
        $reconcile=$null
        try{$reconcile=Invoke-RuntimeCheck "reconcile-readback" $planJson}catch{}
        if($null -ne $reconcile -and [string]$reconcile.status -eq "reconciled_succeeded"){
            Invoke-Ledger "mark-succeeded" ([ordered]@{reconciled_after_transport_failure=$true;reconciliation_evidence_hash=[string]$reconcile.reconciliation_evidence_hash;readback_verified=$true})|Out-Null
            [ordered]@{contract="mad4b.staging-runtime-registry-reconciliation-result.v1";status="recovered_success";plan_sha256=$plan.plan_sha256;mutation_retry_allowed=$false;readback_verified=$true;production_mutation_performed=$false;provider_mutation_performed=$false;secrets_included=$false}|ConvertTo-Json -Depth 20
            return
        }
        if($null -ne $reconcile -and [string]$reconcile.status -eq "reconciled_no_mutation"){
            Invoke-Ledger "mark-reconciled-no-mutation" ([ordered]@{reconciliation_evidence_hash=[string]$reconcile.reconciliation_evidence_hash;readback_verified=$true})|Out-Null
            Fail "privileged transport failed but semantic non-application was verified; this plan is consumed and a new plan is required"
        }
        Fail "privileged transport failed with unknown outcome; run Mode=Reconcile before any new plan"
    }

    $readback=$null
    try{
        $readback=Invoke-RuntimeCheck "readback" $planJson
        Require ([string]$readback.status -eq "already_satisfied" -and $readback.readback_verified -eq $true) "same-cycle Runtime registry readback did not verify canonical completeness"
    }catch{
        try{
            Invoke-Ledger "mark-unknown" ([ordered]@{reason="same_cycle_readback_failed_after_transport_success";transport_succeeded=$true;reconciliation_required=$true;mutation_retry_allowed=$false})|Out-Null
        }catch{}
        Fail "registry transport completed but same-cycle Runtime readback failed; run Mode=Reconcile before any retry"
    }
    try{
        Invoke-Ledger "mark-succeeded" ([ordered]@{inserted_statement_count=[int]$plan.missing_count;exact_count=[int]$readback.exact_count;extra_live_rows_preserved=[int]$readback.extra_count;readback_verified=$true})|Out-Null
    }catch{
        try{Invoke-Ledger "mark-unknown" ([ordered]@{reason="success_receipt_persistence_failed";readback_verified=$true;reconciliation_required=$true;mutation_retry_allowed=$false})|Out-Null}catch{}
        Fail "registry reconciliation readback succeeded but durable success receipt failed; run Mode=Reconcile"
    }
    [ordered]@{
        contract="mad4b.staging-runtime-registry-reconciliation-result.v1"
        status="reconciled"
        plan_sha256=$plan.plan_sha256
        source_artifact_sha256=$plan.source_artifact.sha256
        inserted_statement_count=[int]$plan.missing_count
        exact_count=[int]$readback.exact_count
        extra_live_rows_preserved=[int]$readback.extra_count
        insertion_only=$true
        mutation_performed=$true
        readback_verified=$true
        mutation_retry_allowed=$false
        runtime_grants_expanded=$false
        production_mutation_performed=$false
        provider_mutation_performed=$false
        secrets_included=$false
    }|ConvertTo-Json -Depth 30
}finally{
    if($null -ne $lock){$lock.Dispose()}
    if($sqlFile -and (Test-Path -LiteralPath $sqlFile)){Remove-Item -LiteralPath $sqlFile -Force -ErrorAction SilentlyContinue}
}
