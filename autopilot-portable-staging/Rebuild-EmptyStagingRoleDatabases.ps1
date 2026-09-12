[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [ValidatePattern('^[0-9a-fA-F]{40}$')] [string]$ExpectedCommit,
  [switch]$Apply,
  [string]$RebuildConfirmation = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$api = Join-Path $repo "http-generic-api"
$envFile = Join-Path $api ".env.staging"
$builder = Join-Path $api "scripts\build-staging-schema-bundle.mjs"
$importer = Join-Path $PSScriptRoot "Clone-StagingDatabases.ps1"
$governanceSeed = Join-Path $api "config\staging-empty-governance-certification-seed.sql"
$classifier = Join-Path $api "scripts\classify-staging-empty-role-census.mjs"
$dumpDirectory = Join-Path $PSScriptRoot "staging-db-dumps"
$compose = @("-f", (Join-Path $api "docker-compose.yml"), "-f", (Join-Path $api "docker-compose.staging.yml"), "--env-file", $envFile)

function Fail([string]$Message) { throw "STAGING_REBUILD_EMPTY_FAIL_CLOSED: $Message" }
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }
function Native-Text([string]$Program, [string[]]$Arguments) {
  $result = (& $Program @Arguments 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { Fail "$Program failed while verifying local Staging state" }
  return $result
}
function Read-Env([string]$Key) {
  $values = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($Key))=" })
  Require ($values.Count -eq 1) "Missing or duplicate local role environment key: $Key"
  return ($values[0] -replace "^$([regex]::Escape($Key))=", "")
}

Require (Test-Path -LiteralPath $envFile -PathType Leaf) "Local .env.staging is missing"
foreach ($file in @($builder, $importer, $governanceSeed, $classifier)) { Require (Test-Path -LiteralPath $file -PathType Leaf) "Required canonical bootstrap component is missing" }
foreach ($command in @("git", "node", "docker", "powershell.exe")) { Require ($null -ne (Get-Command $command -ErrorAction SilentlyContinue)) "Required command is missing: $command" }
Require (-not $env:DOCKER_HOST -and -not $env:DOCKER_CONTEXT) "Remote Docker context overrides are forbidden"
Require ((Native-Text "docker" @("context", "show")) -in @("default", "desktop-linux")) "Docker context is not local"
Require (-not [string]::IsNullOrWhiteSpace((Native-Text "docker" @("info", "--format", "{{.ServerVersion}}")))) "Local Docker daemon is unavailable"
Require ((Native-Text "git" @("-C", $repo, "rev-parse", "HEAD")).ToLowerInvariant() -eq $ExpectedCommit) "Exact checkout commit mismatch"
Require ([string]::IsNullOrWhiteSpace((Native-Text "git" @("-C", $repo, "status", "--porcelain", "--untracked-files=no")))) "Tracked working tree is dirty"
Require ((Native-Text "git" @("-C", $repo, "remote", "get-url", "origin")) -match 'github\.com[:/]mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os(?:\.git)?$') "Repository origin mismatch"
foreach ($key in @("MIGRATION_APPLIED", "DATABASE_MUTATED", "PRODUCTION_MUTATION_AUTHORIZED", "RULESET_MUTATION_AUTHORIZED")) { Require ((Read-Env $key) -ceq "false") "$key must be false" }
if ($Apply) {
  Require ($RebuildConfirmation -ceq "REBUILD_EMPTY_LOCAL_STAGING_DATABASES:$ExpectedCommit") "Exact rebuild_empty confirmation mismatch"
  $remoteLine = Native-Text "git" @("-C", $repo, "-c", "protocol.version=0", "-c", "http.version=HTTP/1.1", "ls-remote", "origin", "refs/heads/main")
  Require ((($remoteLine -split '\s+')[0]).ToLowerInvariant() -eq $ExpectedCommit) "origin/main moved away from the exact checkout"
}

& docker compose @compose config --quiet
Require ($LASTEXITCODE -eq 0) "Local Staging Compose model is invalid"
$roles = @(
  @{ key = "runtime"; service = "runtime-db"; name = "DB_NAME"; root = "RUNTIME_DB_ROOT_PASSWORD" },
  @{ key = "governance"; service = "governance-db"; name = "GOVERNANCE_DB_NAME"; root = "GOVERNANCE_DB_ROOT_PASSWORD" },
  @{ key = "runtime_persistence"; service = "persistence-db"; name = "RUNTIME_PERSISTENCE_DB_NAME"; root = "RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD" }
)
$census = @()
foreach ($role in $roles) {
  $db = Read-Env $role.name
  Require ($db -match '^[A-Za-z0-9_]+$' -and $db -notmatch '(?i)(production|hostinger)') "Unsafe local role database name: $($role.key)"
  $container = Native-Text "docker" (@("compose") + $compose + @("ps", "-q", $role.service))
  Require ($container -match '^[0-9a-f]{12,64}$') "Local role database container is not running: $($role.key)"
  Require ((Native-Text "docker" @("inspect", "--format", "{{.State.Health.Status}}", $container)) -eq "healthy") "Local role database is not healthy: $($role.key)"
  $literal = "'" + $db + "'"
  $query = "SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=$literal) + (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=$literal) + (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=$literal) + (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=$literal)"
  $password = Read-Env $role.root
  $exists = (& docker compose @compose exec -T -e "MYSQL_PWD=$password" $role.service mariadb --protocol=socket -uroot --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=$literal" | Out-String).Trim()
  Require ($LASTEXITCODE -eq 0 -and $exists -ceq "1") "Role database is missing: $($role.key)"
  $objects = (& docker compose @compose exec -T -e "MYSQL_PWD=$password" $role.service mariadb --protocol=socket -uroot --batch --skip-column-names -e $query | Out-String).Trim()
  Require ($LASTEXITCODE -eq 0 -and $objects -match '^\d+$') "Root object census failed: $($role.key)"
  $census += [pscustomobject]@{ role = $role.key; object_count = [int]$objects; classification = $(if ([int]$objects -eq 0) { "rebuild_empty" } else { "schema_repair_or_access_repair_required" }) }
}
$census | ConvertTo-Json -Depth 4
$censusJson = ConvertTo-Json -InputObject $census -Depth 4 -Compress
$classificationJson = (& node $classifier --census-json $censusJson | Out-String).Trim()
Require ($LASTEXITCODE -eq 0) "At least one role contains objects; rebuild_empty refuses mixed, partial, or populated databases"
$classification = $classificationJson | ConvertFrom-Json
Require ($classification.ready_for_rebuild_empty -eq $true -and $classification.database_mutation -eq $false) "Role census classifier did not approve empty rebuild"
& node $builder --expected-commit $ExpectedCommit --plan
Require ($LASTEXITCODE -eq 0) "Canonical role schema bundle plan failed"
if (-not $Apply) { Write-Host "STAGING_REBUILD_EMPTY_PLAN_READY: commit=$ExpectedCommit roles=runtime,governance,runtime_persistence mutation=false"; exit 0 }

# The verified importer repeats the root census under its import lock before any DDL.
& node $builder --expected-commit $ExpectedCommit --confirm BUILD_STAGING_SCHEMA_BUNDLE
Require ($LASTEXITCODE -eq 0) "Canonical schema bundle build failed"
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $importer -DumpDirectory $dumpDirectory -ExpectedCommit $ExpectedCommit -Mode schema_only
Require ($LASTEXITCODE -eq 0) "Prepared role schema bundle validation failed"
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $importer -DumpDirectory $dumpDirectory -ExpectedCommit $ExpectedCommit -Mode schema_only -Apply
Require ($LASTEXITCODE -eq 0) "Empty role schema import or post-import census failed; grants remain a separate operation"
$governance = $roles | Where-Object { $_.key -eq "governance" } | Select-Object -First 1
Require ($null -ne $governance) "Governance role is missing"
$governanceDb = Read-Env $governance.name
$governanceRoot = Read-Env $governance.root
$seedSql = Get-Content -Raw -LiteralPath $governanceSeed
Require ($seedSql -match "'staging_activation_gateway_apply_v1'" -and $seedSql -match "'pending'" -and $seedSql -notmatch '(?im)^\s*(?:DROP|DELETE|GRANT|REVOKE|UPDATE)\b') "Reviewed pending-only governance seed is invalid"
$seedSql | & docker compose @compose exec -T -e "MYSQL_PWD=$governanceRoot" $governance.service mariadb --protocol=socket -uroot $governanceDb --binary-mode
Require ($LASTEXITCODE -eq 0) "Pending Governance certification seed failed; grants remain a separate operation"
$seedReadback = (& docker compose @compose exec -T -e "MYSQL_PWD=$governanceRoot" $governance.service mariadb --protocol=socket -uroot $governanceDb --batch --skip-column-names -e "SELECT CONCAT(certification_status,':',dispatch_allowed,':',apply_allowed) FROM runtime_dispatch_certification_registry WHERE certification_key='staging_activation_gateway_apply_v1'" | Out-String).Trim()
Require ($LASTEXITCODE -eq 0 -and $seedReadback -ceq "pending:0:0") "Governance Gateway certification is not fail-closed after schema bootstrap"
Write-Host "STAGING_REBUILD_EMPTY_SCHEMA_READY: commit=$ExpectedCommit schema=verified grants=not_applied runtime_certification=not_asserted gateway_apply_certification=pending next_action=database.access_repair"
