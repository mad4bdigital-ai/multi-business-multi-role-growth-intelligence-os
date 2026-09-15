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
    throw "STAGING_GATEWAY_AUTHORITY_SEED_FAIL_CLOSED: $Message"
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

function Test-SafeSeed([string]$Sql, [string]$Label, [int]$ExpectedStatements) {
    $insertCount = ([regex]::Matches($Sql, '(?im)^\s*INSERT\s+INTO\b')).Count
    Require ($insertCount -eq $ExpectedStatements) "$Label seed statement count mismatch; observed=$insertCount expected=$ExpectedStatements"
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
        Require (-not ($Sql -match $pattern)) "$Label seed contains forbidden SQL"
    }
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
$ManifestPath = Join-Path $ApiPath "config\staging-gateway-authority-seed-manifest.json"

Require-Command "git"
Require-Command "docker"
Require (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git")) "RepositoryPath is not a Git checkout"
Require (Test-Path -LiteralPath $EnvFile -PathType Leaf) "Missing local .env.staging"
Require (Test-Path -LiteralPath $ComposeBase -PathType Leaf) "Missing base Compose file"
Require (Test-Path -LiteralPath $ComposeStaging -PathType Leaf) "Missing Staging Compose file"
Require (Test-Path -LiteralPath $ManifestPath -PathType Leaf) "Missing Gateway authority seed manifest"

$observedHead = (Native-Text "git" @("-C", $RepositoryPath, "rev-parse", "HEAD")).ToLowerInvariant()
Require ($observedHead -eq $ExpectedCommit) "Local checkout does not match ExpectedCommit"
$dirty = @(git -C $RepositoryPath status --porcelain --untracked-files=no)
Require ($dirty.Count -eq 0) "Tracked working tree changes are forbidden"
$origin = Native-Text "git" @("-C", $RepositoryPath, "remote", "get-url", "origin")
Require ($origin -match 'github\.com[:/]mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os(?:\.git)?$') "Repository origin mismatch"
$remoteLine = & git -C $RepositoryPath -c protocol.version=0 -c http.version=HTTP/1.1 ls-remote origin refs/heads/main
Require ($LASTEXITCODE -eq 0) "origin/main could not be resolved"
$remoteSha = (($remoteLine | Select-Object -First 1).ToString() -split '\s+')[0].ToLowerInvariant()
Require ($remoteSha -eq $ExpectedCommit) "origin/main moved away from ExpectedCommit"

foreach ($name in @("MIGRATION_APPLIED", "DATABASE_MUTATED", "PRODUCTION_MUTATION_AUTHORIZED", "RULESET_MUTATION_AUTHORIZED")) {
    Require ((Read-Env $EnvFile $name) -ceq "false") "$name must be exactly false"
}
Require (-not $env:DOCKER_HOST) "DOCKER_HOST is forbidden"
Require (-not $env:DOCKER_CONTEXT) "DOCKER_CONTEXT is forbidden"
$context = Native-Text "docker" @("context", "show")
Require ($context -in @("default", "desktop-linux")) "Docker context must be local"
Require (-not [string]::IsNullOrWhiteSpace((Native-Text "docker" @("info", "--format", "{{.ServerVersion}}")))) "Docker daemon is unavailable"

try { $manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json }
catch { Fail "Gateway authority seed manifest is invalid JSON" }

Require ([string]$manifest.contract -ceq "mad4b.staging.gateway-authority-seed-manifest.v1") "Unsupported Gateway authority seed contract"
Require ([string]$manifest.status -ceq "active_local_staging_only") "Gateway authority seed manifest is not active"
Require ([string]$manifest.execution_identity -ceq "local_database_root") "Gateway authority seed must execute as local database root"
Require ([string]$manifest.replay_mode -ceq "explicit_local_staging_only") "Gateway authority seed replay mode is invalid"
Require ($manifest.safety.local_staging_only -eq $true) "Gateway authority seed is not local-Staging-only"
Require ($manifest.safety.production_access_forbidden -eq $true -and $manifest.safety.provider_access_forbidden -eq $true) "Gateway authority seed external-access safety is incomplete"
Require ($manifest.safety.hostinger_mutation -eq $false -and $manifest.safety.cloudflare_mutation -eq $false) "Gateway authority seed provider mutation must remain false"
Require ($manifest.safety.dns_mutation -eq $false -and $manifest.safety.custom_domain_mutation -eq $false) "Gateway authority seed network binding mutation must remain false"
Require ($manifest.safety.grant_mutation -eq $false -and $manifest.safety.provider_credentials_included -eq $false -and $manifest.safety.secrets_included -eq $false) "Gateway authority seed privilege/secret safety is incomplete"
Require ($manifest.readback_required -eq $true) "Gateway authority seed readback must be required"
Require ([string]$manifest.certification_posture.certification_status -ceq "pending") "Gateway certification posture must remain pending"
Require ($manifest.certification_posture.dispatch_allowed -eq $false -and $manifest.certification_posture.apply_allowed -eq $false) "Gateway dispatch/apply must remain disabled after seed replay"

$ComposeArgs = @("-f", $ComposeBase, "-f", $ComposeStaging, "--env-file", $EnvFile)
& docker compose @ComposeArgs config --quiet
Require ($LASTEXITCODE -eq 0) "Local Staging Compose model is invalid"

$roleConfig = @{
    runtime = [pscustomobject]@{
        Key = "runtime"
        Service = [string]$manifest.roles.runtime.container_service
        DatabaseEnv = [string]$manifest.roles.runtime.database_env
        RootPasswordEnv = [string]$manifest.roles.runtime.root_password_env
        SeedFile = [string]$manifest.roles.runtime.seed_file
        SeedSha256 = ([string]$manifest.roles.runtime.seed_sha256).ToLowerInvariant()
        StatementCount = [int]$manifest.roles.runtime.expected_statement_count
    }
    governance = [pscustomobject]@{
        Key = "governance"
        Service = [string]$manifest.roles.governance.container_service
        DatabaseEnv = [string]$manifest.roles.governance.database_env
        RootPasswordEnv = [string]$manifest.roles.governance.root_password_env
        SeedFile = [string]$manifest.roles.governance.seed_file
        SeedSha256 = ([string]$manifest.roles.governance.seed_sha256).ToLowerInvariant()
        StatementCount = [int]$manifest.roles.governance.expected_statement_count
    }
}

Require ($roleConfig.runtime.Service -ceq "runtime-db" -and $roleConfig.runtime.DatabaseEnv -ceq "DB_NAME" -and $roleConfig.runtime.RootPasswordEnv -ceq "RUNTIME_DB_ROOT_PASSWORD") "Runtime authority seed role binding is invalid"
Require ($roleConfig.governance.Service -ceq "governance-db" -and $roleConfig.governance.DatabaseEnv -ceq "GOVERNANCE_DB_NAME" -and $roleConfig.governance.RootPasswordEnv -ceq "GOVERNANCE_DB_ROOT_PASSWORD") "Governance authority seed role binding is invalid"
Require ($roleConfig.runtime.StatementCount -eq 2 -and $roleConfig.governance.StatementCount -eq 3) "Gateway authority seed role statement counts are invalid"

function Resolve-Role([object]$Role) {
    $database = Read-Env $EnvFile $Role.DatabaseEnv
    $rootPassword = Read-Env $EnvFile $Role.RootPasswordEnv
    Require ($database -match '^[A-Za-z0-9_]+$' -and $database -notmatch '(?i)(production|hostinger)') "Unsafe $($Role.Key) database name"
    $container = Native-Text "docker" (@("compose") + $ComposeArgs + @("ps", "-q", $Role.Service))
    Require ($container -match '^[0-9a-f]{12,64}$') "$($Role.Key) DB container is not running"
    Require ((Native-Text "docker" @("inspect", "--format", "{{.State.Health.Status}}", $container)) -ceq "healthy") "$($Role.Key) DB container is not healthy"
    $seedRelative = $Role.SeedFile -replace '/', [IO.Path]::DirectorySeparatorChar
    $seedPath = Join-Path $RepositoryPath $seedRelative
    Require (Test-Path -LiteralPath $seedPath -PathType Leaf) "$($Role.Key) Gateway authority seed SQL is missing"
    Require ((Get-Sha256 $seedPath) -ceq $Role.SeedSha256) "$($Role.Key) Gateway authority seed SHA-256 mismatch"
    $seedSql = Get-Content -Raw -LiteralPath $seedPath
    Test-SafeSeed $seedSql "$($Role.Key) Gateway authority" $Role.StatementCount
    return [pscustomobject]@{
        Key = $Role.Key
        Service = $Role.Service
        Database = $database
        RootPassword = $rootPassword
        SeedSql = $seedSql
        SeedSha256 = $Role.SeedSha256
    }
}

$runtime = Resolve-Role $roleConfig.runtime
$governance = Resolve-Role $roleConfig.governance

function Invoke-RoleQuery([object]$Role, [string]$Sql) {
    $result = (& docker compose @ComposeArgs exec -T -e "MYSQL_PWD=$($Role.RootPassword)" $Role.Service mariadb --protocol=socket -uroot $Role.Database --batch --skip-column-names --raw -e $Sql | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "$($Role.Key) DB readback failed" }
    return $result
}

function Require-ExactCount([object]$Role, [string]$Sql, [string]$Label) {
    $value = Invoke-RoleQuery $Role $Sql
    Require ($value -ceq "1") "$Label exact readback failed; observed=$value"
}

function Require-Table([object]$Role, [string]$Table) {
    Require-ExactCount $Role "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='$Table' AND TABLE_TYPE='BASE TABLE'" "$($Role.Key) required authority table $Table"
}

foreach ($table in @("platform_resource_authority_requirements", "resource_authority_route_family_registry")) {
    Require-Table $runtime $table
}
foreach ($table in @("capability_apply_authorization_policy_registry", "platform_resource_authority_bindings", "runtime_dispatch_certification_registry")) {
    Require-Table $governance $table
}

$runtime.SeedSql | & docker compose @ComposeArgs exec -T -e "MYSQL_PWD=$($runtime.RootPassword)" $runtime.Service mariadb --protocol=socket -uroot $runtime.Database --binary-mode
Require ($LASTEXITCODE -eq 0) "Runtime Gateway authority seed replay failed"
$governance.SeedSql | & docker compose @ComposeArgs exec -T -e "MYSQL_PWD=$($governance.RootPassword)" $governance.Service mariadb --protocol=socket -uroot $governance.Database --binary-mode
Require ($LASTEXITCODE -eq 0) "Governance Gateway authority seed replay failed"

$query = "SELECT COUNT(*) FROM platform_resource_authority_requirements WHERE requirement_key='staging_activation_gateway_apply_authority_v1' AND resource_family='cloudflare_worker' AND operation_class='external_write' AND audit_required=1 AND readback_required=1 AND apply_allowed=1 AND status='active'"
Require-ExactCount $runtime $query "Staging Gateway authority requirement"
$query = "SELECT COUNT(*) FROM resource_authority_route_family_registry WHERE route_family_key='staging_activation_gateway_apply_v1' AND route_family='cloudflare_worker' AND operation_class='external_write' AND resource_authority_required=1 AND dry_run_required=1 AND audit_required=1 AND readback_required=1 AND runtime_surface='activation_gateway_dark_deploy'"
Require-ExactCount $runtime $query "Staging Gateway authority route"

$query = "SELECT COUNT(*) FROM capability_apply_authorization_policy_registry WHERE policy_key='staging_activation_gateway_apply_policy_v1' AND app_key='cloudflare' AND capability_key='admin_cloudflare_v1' AND operation_intent='activation_gateway.staging_apply' AND runtime_surface='activation_gateway_dark_deploy' AND status='active' AND allow_external_write=1 AND requires_ready_for_dispatch=1 AND requires_dispatch_allowed=1 AND requires_zero_blocking_gaps=1 AND requires_audit_evidence=1 AND requires_readback=1 AND requires_typed_confirmation=1 AND requires_same_cycle_dry_run=1 AND JSON_UNQUOTE(JSON_EXTRACT(policy_json,'$.resource_binding_id'))='5a2b04f8-bb99-4f65-a924-0f55d3080376' AND JSON_UNQUOTE(JSON_EXTRACT(policy_json,'$.expected_policy_hash'))='c6468e051b8456d4d3ffc6478cdb98f7048b69c8ca6742f4dca27e1eb4023f32'"
Require-ExactCount $governance $query "Staging Gateway apply policy"
$query = "SELECT COUNT(*) FROM platform_resource_authority_bindings WHERE binding_id='5a2b04f8-bb99-4f65-a924-0f55d3080376' AND tenant_id='00000000-0000-0000-0000-000000000000' AND resource_type='cloudflare_worker' AND resource_uri='cloudflare://accounts/dd1024b934e907723484568d97c7c74c/workers/scripts/mad4b-activation-gateway-staging' AND recipe_key='staging_activation_gateway_apply' AND permission_level='admin' AND status='active' AND JSON_UNQUOTE(JSON_EXTRACT(resource_ref_json,'$.provider'))='cloudflare' AND JSON_UNQUOTE(JSON_EXTRACT(resource_ref_json,'$.account_id'))='dd1024b934e907723484568d97c7c74c' AND JSON_UNQUOTE(JSON_EXTRACT(resource_ref_json,'$.script_name'))='mad4b-activation-gateway-staging' AND allowed_modes_json LIKE '%dry_run%' AND allowed_modes_json LIKE '%staging_apply%'"
Require-ExactCount $governance $query "Staging Gateway resource binding"
$query = "SELECT COUNT(*) FROM runtime_dispatch_certification_registry WHERE certification_key='staging_activation_gateway_apply_v1' AND surface_key='activation_gateway_dark_deploy' AND tool_or_action_key='activation_gateway_dark_deploy' AND certification_status='pending' AND dispatch_allowed=0 AND apply_allowed=0 AND requires_resource_authority=1 AND requires_dry_run=1 AND requires_audit_evidence=1 AND requires_readback=1 AND last_evidence_ref IS NULL AND last_certified_at IS NULL AND expires_at IS NULL"
Require-ExactCount $governance $query "Staging Gateway pending dispatch certification"

$receipt = [ordered]@{
    contract = "mad4b.staging.gateway-authority-seed-replay.v1"
    status = "completed"
    source_commit = $ExpectedCommit
    runtime_seed_sha256 = $runtime.SeedSha256
    governance_seed_sha256 = $governance.SeedSha256
    runtime_authority_requirement_ready = $true
    runtime_authority_route_ready = $true
    governance_apply_policy_ready = $true
    governance_resource_binding_ready = $true
    certification_status = "pending"
    dispatch_allowed = $false
    apply_allowed = $false
    provider_mutation = $false
    grant_mutation = $false
    production_mutation = $false
    secrets_included = $false
}
$receipt | ConvertTo-Json -Depth 8
Write-Host "STAGING_GATEWAY_AUTHORITY_SEEDS_READY: commit=$ExpectedCommit binding_id=5a2b04f8-bb99-4f65-a924-0f55d3080376 certification=pending provider_mutation=false grant_mutation=false"
