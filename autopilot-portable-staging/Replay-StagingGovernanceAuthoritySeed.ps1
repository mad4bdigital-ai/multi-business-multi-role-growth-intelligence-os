[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedCommit,

    [string]$RepositoryPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()

function Fail([string]$Message) {
    throw "STAGING_GOVERNANCE_AUTHORITY_SEED_FAIL_CLOSED: $Message"
}

function Require([bool]$Condition, [string]$Message) {
    if (-not $Condition) { Fail $Message }
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail "Required command is missing: $Name"
    }
}

function Native-Text([string]$File, [string[]]$Arguments) {
    $text = & $File @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "$File failed while reading local state" }
    return (($text | Out-String).Trim())
}

function Read-Env([string]$Path, [string]$Name) {
    $values = @(Get-Content -LiteralPath $Path | Where-Object {
        $_ -match "^$([regex]::Escape($Name))=(.*)$"
    })
    Require ($values.Count -eq 1) "Missing or duplicate $Name in .env.staging"
    return ($values[0] -replace "^$([regex]::Escape($Name))=", "")
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
} else {
    $RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
}

$ApiPath = Join-Path $RepositoryPath "http-generic-api"
$EnvFile = Join-Path $ApiPath ".env.staging"
$ComposeBase = Join-Path $ApiPath "docker-compose.yml"
$ComposeStaging = Join-Path $ApiPath "docker-compose.staging.yml"
$ManifestPath = Join-Path $ApiPath "config\staging-governance-authority-seed-manifest.json"

Require-Command "git"
Require-Command "docker"
Require (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git")) "RepositoryPath is not a Git checkout"
Require (Test-Path -LiteralPath $EnvFile -PathType Leaf) "Missing local .env.staging"
Require (Test-Path -LiteralPath $ComposeBase -PathType Leaf) "Missing base Compose file"
Require (Test-Path -LiteralPath $ComposeStaging -PathType Leaf) "Missing Staging Compose file"
Require (Test-Path -LiteralPath $ManifestPath -PathType Leaf) "Missing Governance authority seed manifest"

$observedHead = (Native-Text "git" @("-C", $RepositoryPath, "rev-parse", "HEAD")).ToLowerInvariant()
Require ($observedHead -eq $ExpectedCommit) "Local checkout does not match ExpectedCommit"
$dirty = @(git -C $RepositoryPath status --porcelain --untracked-files=no)
Require ($dirty.Count -eq 0) "Tracked working tree changes are forbidden"

foreach ($name in @("MIGRATION_APPLIED", "DATABASE_MUTATED", "PRODUCTION_MUTATION_AUTHORIZED", "RULESET_MUTATION_AUTHORIZED")) {
    Require ((Read-Env $EnvFile $name) -ceq "false") "$name must be exactly false"
}
Require (-not $env:DOCKER_HOST) "DOCKER_HOST is forbidden"
Require (-not $env:DOCKER_CONTEXT) "DOCKER_CONTEXT is forbidden"
$context = Native-Text "docker" @("context", "show")
Require ($context -in @("default", "desktop-linux")) "Docker context must be local"
Require (-not [string]::IsNullOrWhiteSpace((Native-Text "docker" @("info", "--format", "{{.ServerVersion}}")))) "Docker daemon is unavailable"

try { $manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json }
catch { Fail "Governance authority seed manifest is invalid JSON" }

Require ([string]$manifest.contract -ceq "mad4b.staging.governance-authority-seed-manifest.v1") "Unsupported Governance authority seed contract"
Require ([string]$manifest.status -ceq "active_local_staging_only") "Governance authority seed manifest is not active"
Require ([string]$manifest.target_role -ceq "governance") "Governance authority seed target role must be governance"
Require ([string]$manifest.execution_identity -ceq "local_database_root") "Governance authority seed must execute as local database root"
Require ([string]$manifest.replay_mode -ceq "explicit_local_staging_only") "Governance authority seed replay mode is invalid"
Require ($manifest.safety.local_staging_only -eq $true) "Governance authority seed is not local-Staging-only"
Require ($manifest.safety.production_access_forbidden -eq $true -and $manifest.safety.provider_access_forbidden -eq $true) "Governance authority seed external-access safety is incomplete"
Require ($manifest.safety.hostinger_mutation -eq $false -and $manifest.safety.cloudflare_mutation -eq $false) "Governance authority seed provider mutation must remain false"
Require ($manifest.safety.dns_mutation -eq $false -and $manifest.safety.custom_domain_mutation -eq $false) "Governance authority seed network binding mutation must remain false"
Require ($manifest.safety.grant_mutation -eq $false -and $manifest.safety.provider_credentials_included -eq $false -and $manifest.safety.secrets_included -eq $false) "Governance authority seed privilege/secret safety is incomplete"
Require ($manifest.readback_required -eq $true) "Governance authority seed readback must be required"
Require ([string]$manifest.certification_posture.certification_status -ceq "pending") "Gateway certification posture must remain pending"
Require ($manifest.certification_posture.dispatch_allowed -eq $false -and $manifest.certification_posture.apply_allowed -eq $false) "Gateway dispatch/apply must remain disabled after seed replay"

$seedRelative = ([string]$manifest.seed_file) -replace '/', [IO.Path]::DirectorySeparatorChar
$SeedPath = Join-Path $RepositoryPath $seedRelative
Require (Test-Path -LiteralPath $SeedPath -PathType Leaf) "Governance authority seed SQL is missing"
Require ((Get-Sha256 $SeedPath) -ceq ([string]$manifest.seed_sha256).ToLowerInvariant()) "Governance authority seed SHA-256 mismatch"

$seedSql = Get-Content -Raw -LiteralPath $SeedPath
$insertCount = ([regex]::Matches($seedSql, '(?im)^\s*INSERT\s+INTO\b')).Count
Require ($insertCount -eq [int]$manifest.expected_statement_count) "Governance authority seed statement count mismatch"
foreach ($pattern in @(
    '(?im)^\s*GRANT\b',
    '(?im)^\s*REVOKE\b',
    '(?im)^\s*CREATE\s+USER\b',
    '(?im)^\s*ALTER\s+USER\b',
    '(?im)^\s*CREATE\s+DATABASE\b',
    '(?im)^\s*DROP\s+DATABASE\b',
    '(?im)^\s*LOAD\s+DATA\b',
    '(?im)\bINTO\s+(?:OUTFILE|DUMPFILE)\b'
)) {
    Require (-not ($seedSql -match $pattern)) "Governance authority seed contains forbidden SQL"
}

$ComposeArgs = @("-f", $ComposeBase, "-f", $ComposeStaging, "--env-file", $EnvFile)
& docker compose @ComposeArgs config --quiet
Require ($LASTEXITCODE -eq 0) "Local Staging Compose model is invalid"

$database = Read-Env $EnvFile "GOVERNANCE_DB_NAME"
$rootPassword = Read-Env $EnvFile "GOVERNANCE_DB_ROOT_PASSWORD"
Require ($database -match '^[A-Za-z0-9_]+$' -and $database -notmatch '(?i)(production|hostinger)') "Unsafe Governance database name"
$container = Native-Text "docker" (@("compose") + $ComposeArgs + @("ps", "-q", "governance-db"))
Require ($container -match '^[0-9a-f]{12,64}$') "Governance DB container is not running"
Require ((Native-Text "docker" @("inspect", "--format", "{{.State.Health.Status}}", $container)) -ceq "healthy") "Governance DB container is not healthy"

function Invoke-GovernanceQuery([string]$Sql) {
    $result = (& docker compose @ComposeArgs exec -T -e "MYSQL_PWD=$rootPassword" governance-db mariadb --protocol=socket -uroot $database --batch --skip-column-names --raw -e $Sql | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "Governance DB readback failed" }
    return $result
}

function Require-ExactCount([string]$Sql, [string]$Label) {
    $value = Invoke-GovernanceQuery $Sql
    Require ($value -ceq "1") "$Label exact readback failed; observed=$value"
}

$requiredTables = @(
    "platform_resource_authority_requirements",
    "resource_authority_route_family_registry",
    "capability_apply_authorization_policy_registry",
    "platform_resource_authority_bindings",
    "runtime_dispatch_certification_registry"
)
foreach ($table in $requiredTables) {
    Require-ExactCount "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='$table' AND TABLE_TYPE='BASE TABLE'" "Required Governance seed table $table"
}

$seedSql | & docker compose @ComposeArgs exec -T -e "MYSQL_PWD=$rootPassword" governance-db mariadb --protocol=socket -uroot $database --binary-mode
Require ($LASTEXITCODE -eq 0) "Governance authority seed replay failed"

$query = "SELECT COUNT(*) FROM platform_resource_authority_requirements WHERE requirement_key='staging_activation_gateway_apply_authority_v1' AND resource_family='cloudflare_worker' AND operation_class='external_write' AND audit_required=1 AND readback_required=1 AND apply_allowed=1 AND status='active'"
Require-ExactCount $query "Staging Gateway authority requirement"

$query = "SELECT COUNT(*) FROM resource_authority_route_family_registry WHERE route_family_key='staging_activation_gateway_apply_v1' AND route_family='cloudflare_worker' AND operation_class='external_write' AND resource_authority_required=1 AND dry_run_required=1 AND audit_required=1 AND readback_required=1 AND runtime_surface='activation_gateway_dark_deploy'"
Require-ExactCount $query "Staging Gateway authority route"

$query = "SELECT COUNT(*) FROM capability_apply_authorization_policy_registry WHERE policy_key='staging_activation_gateway_apply_policy_v1' AND app_key='cloudflare' AND capability_key='admin_cloudflare_v1' AND operation_intent='activation_gateway.staging_apply' AND runtime_surface='activation_gateway_dark_deploy' AND status='active' AND allow_external_write=1 AND requires_ready_for_dispatch=1 AND requires_dispatch_allowed=1 AND requires_zero_blocking_gaps=1 AND requires_audit_evidence=1 AND requires_readback=1 AND requires_typed_confirmation=1 AND requires_same_cycle_dry_run=1 AND JSON_UNQUOTE(JSON_EXTRACT(policy_json,'$.resource_binding_id'))='5a2b04f8-bb99-4f65-a924-0f55d3080376' AND JSON_UNQUOTE(JSON_EXTRACT(policy_json,'$.expected_policy_hash'))='c6468e051b8456d4d3ffc6478cdb98f7048b69c8ca6742f4dca27e1eb4023f32'"
Require-ExactCount $query "Staging Gateway apply policy"

$query = "SELECT COUNT(*) FROM platform_resource_authority_bindings WHERE binding_id='5a2b04f8-bb99-4f65-a924-0f55d3080376' AND tenant_id='00000000-0000-0000-0000-000000000000' AND resource_type='cloudflare_worker' AND resource_uri='cloudflare://accounts/dd1024b934e907723484568d97c7c74c/workers/scripts/mad4b-activation-gateway-staging' AND recipe_key='staging_activation_gateway_apply' AND permission_level='admin' AND status='active' AND JSON_UNQUOTE(JSON_EXTRACT(resource_ref_json,'$.provider'))='cloudflare' AND JSON_UNQUOTE(JSON_EXTRACT(resource_ref_json,'$.account_id'))='dd1024b934e907723484568d97c7c74c' AND JSON_UNQUOTE(JSON_EXTRACT(resource_ref_json,'$.script_name'))='mad4b-activation-gateway-staging' AND allowed_modes_json LIKE '%dry_run%' AND allowed_modes_json LIKE '%staging_apply%'"
Require-ExactCount $query "Staging Gateway resource binding"

$query = "SELECT COUNT(*) FROM runtime_dispatch_certification_registry WHERE certification_key='staging_activation_gateway_apply_v1' AND surface_key='activation_gateway_dark_deploy' AND tool_or_action_key='activation_gateway_dark_deploy' AND certification_status='pending' AND dispatch_allowed=0 AND apply_allowed=0 AND requires_resource_authority=1 AND requires_dry_run=1 AND requires_audit_evidence=1 AND requires_readback=1 AND last_evidence_ref IS NULL AND last_certified_at IS NULL AND expires_at IS NULL"
Require-ExactCount $query "Staging Gateway pending dispatch certification"

$receipt = [ordered]@{
    contract = "mad4b.staging.governance-authority-seed-replay.v1"
    status = "completed"
    source_commit = $ExpectedCommit
    target_role = "governance"
    seed_sha256 = ([string]$manifest.seed_sha256).ToLowerInvariant()
    authority_requirement_ready = $true
    authority_route_ready = $true
    apply_policy_ready = $true
    resource_binding_ready = $true
    certification_status = "pending"
    dispatch_allowed = $false
    apply_allowed = $false
    provider_mutation = $false
    grant_mutation = $false
    production_mutation = $false
    secrets_included = $false
}
$receipt | ConvertTo-Json -Depth 8
Write-Host "STAGING_GOVERNANCE_AUTHORITY_SEED_READY: commit=$ExpectedCommit binding_id=5a2b04f8-bb99-4f65-a924-0f55d3080376 certification=pending provider_mutation=false grant_mutation=false"
