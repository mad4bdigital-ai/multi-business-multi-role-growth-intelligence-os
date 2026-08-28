param(
  [Parameter(Mandatory = $true)] [string]$DumpDirectory,
  [Parameter(Mandatory = $true)] [ValidatePattern('^[0-9a-fA-F]{40}$')] [string]$ExpectedCommit,
  [ValidateSet("schema_only", "sanitized_data")] [string]$Mode = "schema_only",
  [switch]$Apply,
  [switch]$AllowSanitizedData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ApiPath = Join-Path $RepoRoot "http-generic-api"
$EnvFile = Join-Path $ApiPath ".env.staging"
$ComposeBase = Join-Path $ApiPath "docker-compose.yml"
$ComposeStaging = Join-Path $ApiPath "docker-compose.staging.yml"
$RoleMigrationManifestPath = Join-Path $ApiPath "config\staging-database-role-migration-manifest.json"
$BundleStatePath = Join-Path $DumpDirectory "schema-import-state.json"
$script:ImportMutex = $null

function Fail([string]$Message) { throw "FAIL-CLOSED: $Message" }
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }
function Require-Command([string]$Name) { if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Fail "Required command is missing: $Name" } }
function Native-Text([string]$File, [string[]]$Arguments) {
  $text = & $File @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "$File failed while reading local state" }
  return (($text | Out-String).Trim())
}
function Assert-UniqueEnvKeys([string]$Path) {
  $seen = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=') {
      $key = $Matches[1]
      if ($seen.ContainsKey($key)) { Fail "Duplicate environment key is forbidden: $key" }
      $seen[$key] = $true
    }
  }
}
function Read-Env([string]$Name) {
  $line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
  if (-not $line) { Fail "Missing $Name in .env.staging" }
  return $line -replace "^$([regex]::Escape($Name))=", ""
}
function Write-JsonAtomic([string]$Path, [object]$Value) {
  $temporary = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }
}
function Read-Json([string]$Path) {
  try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json }
  catch { Fail "Invalid JSON state/manifest: $Path" }
}
function Acquire-ImportLock {
  try {
    $script:ImportMutex = New-Object System.Threading.Mutex($false, "Global\Mad4bStagingSchemaImport")
    if (-not $script:ImportMutex.WaitOne(0)) { Fail "Another Staging schema import is already running; refusing overlap" }
  } catch [System.Threading.AbandonedMutexException] {
    Write-Host "Recovered abandoned Staging schema import lock." -ForegroundColor Yellow
  } catch {
    Fail "Unable to acquire schema import lock: $($_.Exception.Message)"
  }
}
function Release-ImportLock {
  if ($null -ne $script:ImportMutex) {
    try { $script:ImportMutex.ReleaseMutex() } catch { }
    try { $script:ImportMutex.Dispose() } catch { }
    $script:ImportMutex = $null
  }
}
function Get-Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
function Test-GzipFile([string]$Path) {
  $file = $null
  $gzip = $null
  try {
    $file = [IO.File]::OpenRead($Path)
    $gzip = New-Object IO.Compression.GzipStream($file, [IO.Compression.CompressionMode]::Decompress)
    $buffer = New-Object byte[] 65536
    $total = 0L
    while (($read = $gzip.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $total += $read
      if ($total -gt 1073741824) { throw "decompressed bundle exceeds 1 GiB safety limit" }
    }
    return ($total -gt 0)
  } catch { return $false }
  finally {
    if ($null -ne $gzip) { $gzip.Dispose() }
    if ($null -ne $file) { $file.Dispose() }
  }
}
function Get-TableNames([string]$Text) {
  return @($Text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { ($_ -split "`t")[0].Trim() } | Where-Object { $_ })
}
function Assert-SetEqual([string[]]$Expected, [string[]]$Actual, [string]$Role) {
  $expectedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $actualSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($item in $Expected) { [void]$expectedSet.Add([string]$item) }
  foreach ($item in $Actual) { [void]$actualSet.Add([string]$item) }
  $missing = @($Expected | Where-Object { -not $actualSet.Contains([string]$_) })
  $unexpected = @($Actual | Where-Object { -not $expectedSet.Contains([string]$_) })
  if ($missing.Count -gt 0 -or $unexpected.Count -gt 0) {
    Fail "$Role database table set mismatch; missing=$($missing -join ','); unexpected=$($unexpected -join ',')"
  }
}
function Invoke-DatabaseQuery([object]$Item, [string[]]$ComposeArgs, [string]$Sql) {
  $db = Read-Env $Item.Database
  $user = Read-Env $Item.User
  $password = Read-Env $Item.Password
  $result = (& docker compose @ComposeArgs exec -T -e "MYSQL_PWD=$password" $Item.Service mariadb --protocol=socket -u$user $db --batch --skip-column-names --raw --binary-mode -e $Sql | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { Fail "Runtime database query failed for $($Item.Key)" }
  return $result
}
function Invoke-DatabaseScalar([object]$Item, [string[]]$ComposeArgs, [string]$Sql) {
  $value = Invoke-DatabaseQuery $Item $ComposeArgs $Sql
  if ([string]::IsNullOrWhiteSpace($value)) { Fail "Runtime database scalar query returned no value for $($Item.Key)" }
  return $value.Trim()
}
function Test-SafeCanonicalSeed([string]$Sql, [string]$File) {
  $forbidden = @(
    '(?im)^\s*GRANT\b', '(?im)^\s*REVOKE\b', '(?im)^\s*CREATE\s+USER\b',
    '(?im)^\s*ALTER\s+USER\b', '(?im)^\s*DROP\s+DATABASE\b', '(?im)^\s*CREATE\s+DATABASE\b',
    '(?im)^\s*LOAD\s+DATA\b', '(?im)\bINTO\s+(?:OUTFILE|DUMPFILE)\b'
  )
  foreach ($pattern in $forbidden) { if ($Sql -match $pattern) { Fail "Canonical seed contains forbidden authority/external-data SQL: $File" } }
  Require ($Sql -match '(?im)\b(?:INSERT|UPDATE)\b') "Canonical seed contains no deterministic seed statements: $File"
}
function Assert-CountAtLeast([string]$Value, [int]$Minimum, [string]$Label) {
  $parsed = 0
  if (-not [int]::TryParse($Value.Trim(), [ref]$parsed) -or $parsed -lt $Minimum) { Fail "$Label canonical readback is below minimum: observed=$Value minimum=$Minimum" }
  return $parsed
}
function Assert-ContainsSet([string[]]$Required, [string[]]$Actual, [string]$Label) {
  $actualSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($item in $Actual) { [void]$actualSet.Add([string]$item) }
  $missing = @($Required | Where-Object { -not $actualSet.Contains([string]$_) })
  if ($missing.Count -gt 0) { Fail "$Label table census is missing: $($missing -join ',')" }
}

Require (Test-Path -LiteralPath $EnvFile) "Missing local .env.staging; run Start-AutoPilot.ps1 first."
Require (Test-Path -LiteralPath $ComposeBase) "Missing base Compose file."
Require (Test-Path -LiteralPath $ComposeStaging) "Missing staging Compose file."
Require (Test-Path -LiteralPath $RoleMigrationManifestPath -PathType Leaf) "Missing canonical Staging role migration manifest."
Require (Test-Path -LiteralPath $DumpDirectory -PathType Container) "DumpDirectory must be an existing local directory."
Require (-not ($DumpDirectory -match '(?i)(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com|hostinger|production)')) "Production/provider paths are forbidden as dump sources."
Require ($env:DOCKER_HOST -eq $null -or $env:DOCKER_HOST -eq "") "DOCKER_HOST is forbidden."
Require ($env:DOCKER_CONTEXT -eq $null -or $env:DOCKER_CONTEXT -eq "") "DOCKER_CONTEXT is forbidden."
Require-Command "docker"
$dockerContext = Native-Text "docker" @("context", "show")
Require ($dockerContext -in @("default", "desktop-linux")) "Docker context must be local; received '$dockerContext'."
Require (-not [string]::IsNullOrWhiteSpace((Native-Text "docker" @("info", "--format", "{{.ServerVersion}}")))) "Docker daemon is not reachable."
Assert-UniqueEnvKeys $EnvFile
Require ((Read-Env "MIGRATION_APPLIED") -eq "false") "MIGRATION_APPLIED must be exactly false in .env.staging."
Require ((Read-Env "DATABASE_MUTATED") -eq "false") "DATABASE_MUTATED must be exactly false in .env.staging."

if ($Mode -eq "sanitized_data") {
  Require $AllowSanitizedData.IsPresent "sanitized_data requires -AllowSanitizedData."
  Require ($env:STAGING_DB_COPY_APPROVED -eq "true") "Set STAGING_DB_COPY_APPROVED=true only after independent review."
  # Legacy runtime.sanitized.sql.gz, governance.sanitized.sql.gz, and persistence.sanitized.sql.gz artifacts are intentionally blocked here.
  Fail "sanitized_data import is not part of the zero-click governed schema lifecycle; use a separately reviewed data-restore procedure."
}

$manifestPath = Join-Path $DumpDirectory "staging-schema-bundle-manifest.json"
Require (Test-Path -LiteralPath $manifestPath -PathType Leaf) "Schema bundle manifest is missing: staging-schema-bundle-manifest.json"
$bundleManifest = Read-Json $manifestPath
Require ([string]$bundleManifest.contract -eq "mad4b.staging.schema-bundle-output.v1") "Unsupported schema bundle manifest contract."
Require ([string]$bundleManifest.source_commit -eq $ExpectedCommit.ToLowerInvariant()) "Schema bundle source_commit does not match ExpectedCommit."
Require ($bundleManifest.schema_only -eq $true) "Schema bundle is not schema_only."
Require ($bundleManifest.production_accessed -eq $false -and $bundleManifest.provider_accessed -eq $false -and $bundleManifest.data_exported -eq $false -and $bundleManifest.secrets_included -eq $false) "Schema bundle safety metadata is not fail-closed."
Require ($bundleManifest.validation.required_tables_checked -eq $true -and $bundleManifest.validation.runtime_exclusions_checked -eq $true -and $bundleManifest.validation.three_role_partition_checked -eq $true) "Schema bundle validation metadata is incomplete."
$requiredRuntimeCensus = @($bundleManifest.validation.required_runtime_table_census)
Require ($requiredRuntimeCensus.Count -eq 18) "Schema bundle runtime census must declare exactly 18 registry tables."
$roleMigrationManifest = Read-Json $RoleMigrationManifestPath
Require ([string]$roleMigrationManifest.contract -eq "mad4b.staging.database-role-migration-manifest.v1") "Unsupported canonical Staging role migration manifest contract."
$canonicalRuntimeCensus = @($roleMigrationManifest.validation.required_runtime_table_census)
Require ($canonicalRuntimeCensus.Count -eq 18) "Canonical Staging role manifest must declare exactly 18 runtime census tables."
Assert-SetEqual $canonicalRuntimeCensus $requiredRuntimeCensus "schema bundle runtime census projection"
$requiredRuntimeSupportTables = @($roleMigrationManifest.validation.required_runtime_support_tables)
Require ($requiredRuntimeSupportTables.Count -eq 11) "Canonical Staging role manifest must declare exactly 11 runtime support tables."
Assert-ContainsSet $requiredRuntimeSupportTables @($roleMigrationManifest.roles.runtime.required_tables) "canonical runtime support declaration"
$canonicalSeedManifest = $bundleManifest.canonical_seed_lifecycle
Require ([string]$canonicalSeedManifest.contract -eq "mad4b.staging.canonical-seed-manifest.v1") "Canonical seed manifest contract is missing."
Require ([string]$canonicalSeedManifest.target_role -eq "runtime" -and [string]$canonicalSeedManifest.replay_mode -eq "explicit_local_staging_only") "Canonical seed replay policy is invalid."
Require ($canonicalSeedManifest.production_access_forbidden -eq $true -and $canonicalSeedManifest.provider_access_forbidden -eq $true -and $canonicalSeedManifest.readback_required -eq $true) "Canonical seed safety/readback policy is not fail-closed."
$canonicalSeedRows = @($canonicalSeedManifest.seed_files)
$expectedCanonicalSeedFiles = @("039_sprint43_data_integrity_and_missing_tables.sql", "1043_sprint69_dynamic_container_hvac_activity_seed.sql", "20260815_custom_gpt_mcp_catalog_levels.sql")
Require (($canonicalSeedRows | ForEach-Object { [string]$_.file }) -join "," -eq ($expectedCanonicalSeedFiles -join ",") ) "Canonical seed file order is not exact."
foreach ($seed in $canonicalSeedRows) {
  $seedPath = Join-Path $ApiPath (Join-Path "migrations" ([string]$seed.file))
  Require (Test-Path -LiteralPath $seedPath -PathType Leaf) "Canonical seed source is missing: $($seed.file)"
  Require ((Get-Sha256 $seedPath) -eq ([string]$seed.sha256).ToLowerInvariant()) "Canonical seed hash mismatch: $($seed.file)"
  Test-SafeCanonicalSeed (Get-Content -Raw -LiteralPath $seedPath) ([string]$seed.file)
}
Require (@($canonicalSeedManifest.mcp_catalog_required_columns).Count -eq 2) "Canonical MCP catalog column contract is incomplete."
$manifestSha = Get-Sha256 $manifestPath

$roleConfig = @(
  @{ Key = "runtime"; Service = "runtime-db"; Database = "DB_NAME"; User = "DB_USER"; Password = "DB_PASSWORD"; File = "runtime.schema.sql.gz" },
  @{ Key = "governance"; Service = "governance-db"; Database = "GOVERNANCE_DB_NAME"; User = "GOVERNANCE_DB_USER"; Password = "GOVERNANCE_DB_PASSWORD"; File = "governance.schema.sql.gz" },
  @{ Key = "runtime_persistence"; Service = "persistence-db"; Database = "RUNTIME_PERSISTENCE_DB_NAME"; User = "RUNTIME_PERSISTENCE_DB_USER"; Password = "RUNTIME_PERSISTENCE_DB_PASSWORD"; File = "persistence.schema.sql.gz" }
)
$services = @()
foreach ($item in $roleConfig) {
  $role = $bundleManifest.roles.($item.Key)
  Require ($null -ne $role) "Schema bundle manifest is missing role: $($item.Key)"
  Require ([string]$role.file -eq $item.File) "Schema bundle role/file mapping mismatch for $($item.Key)"
  Require ([int]$role.table_count -gt 0 -and @($role.tables).Count -eq [int]$role.table_count) "Schema bundle role table metadata is invalid for $($item.Key)"
  $source = Join-Path $DumpDirectory $item.File
  Require (Test-Path -LiteralPath $source -PathType Leaf) "Missing required schema_only bundle: $($item.File)"
  Require ((Get-Sha256 $source) -eq ([string]$role.sha256).ToLowerInvariant()) "Bundle hash mismatch: $($item.File)"
  Require (Test-GzipFile $source) "Bundle gzip validation failed: $($item.File)"
  $services += [pscustomobject]@{ Key = $item.Key; Service = $item.Service; Database = $item.Database; User = $item.User; Password = $item.Password; File = $item.File; Source = $source; ExpectedTables = @($role.tables) }
}
$runtimeRole = $bundleManifest.roles.runtime
Assert-ContainsSet $requiredRuntimeCensus @($runtimeRole.tables) "runtime required 18-table census"
Assert-ContainsSet $requiredRuntimeSupportTables @($runtimeRole.tables) "runtime support"

$compose = @("-f", $ComposeBase, "-f", $ComposeStaging, "--env-file", $EnvFile)
& docker compose @compose config --quiet
Require ($LASTEXITCODE -eq 0) "Staging Compose model is invalid."
$plan = @($services | ForEach-Object { [pscustomobject]@{ database = $_.Key; service = $_.Service; dump = $_.Source; mode = "schema_only"; source_commit = $ExpectedCommit.ToLowerInvariant(); manifest_sha256 = $manifestSha } })
$plan | ConvertTo-Json -Depth 6
if (-not $Apply) {
  Write-Host "DRY-RUN only. Manifest, hashes, gzip, role mappings, and safety metadata passed. No database or file mutation was performed."
  exit 0
}

$state = $null
Acquire-ImportLock
try {
  foreach ($item in $services) {
    $containerId = Native-Text "docker" ( @("compose") + $compose + @("ps", "-q", $item.Service) )
    Require (-not [string]::IsNullOrWhiteSpace($containerId)) "Missing local container for $($item.Service); run Auto Pilot first."
    $health = Native-Text "docker" @("inspect", "--format", "{{.State.Health.Status}}", $containerId)
    Require ($health -eq "healthy") "Database service is not healthy: $($item.Service)"
  }

  $existingState = $null
  if (Test-Path -LiteralPath $BundleStatePath) { $existingState = Read-Json $BundleStatePath }
  if ($null -ne $existingState -and [string]$existingState.status -eq "completed" -and [string]$existingState.source_commit -eq $ExpectedCommit.ToLowerInvariant() -and [string]$existingState.manifest_sha256 -eq $manifestSha -and [string]$existingState.canonical_seed_status -eq "completed" -and [string]$existingState.canonical_seed_readback.status -eq "passed") {
    Write-Host "SCHEMA_IMPORT_ALREADY_COMPLETE: source_commit=$ExpectedCommit manifest_sha256=$manifestSha"
    exit 0
  }
  if ($null -ne $existingState -and [string]$existingState.status -eq "applying") { Fail "Previous schema import is marked applying; refusing blind resume. Stop/reset local Staging containers and rerun after review." }

  $state = [ordered]@{
    contract = "mad4b.staging.schema-import-state.v1"
    status = "applying"
    source_commit = $ExpectedCommit.ToLowerInvariant()
    manifest_sha256 = $manifestSha
    mode = "schema_only"
    roles = @($services | ForEach-Object { $_.Key })
    applied_roles = @()
    canonical_seed_contract = [string]$canonicalSeedManifest.contract
    canonical_seed_files = @($canonicalSeedRows | ForEach-Object { [string]$_.file })
    canonical_seed_status = "pending"
    canonical_seed_applied_files = @()
    canonical_seed_readback = [ordered]@{ status = "pending"; required_runtime_table_census = @(); required_runtime_support_tables = @(); mcp_catalog_columns = @(); canonical_row_counts = @{} }
    production_accessed = $false
    provider_accessed = $false
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
  }
  Write-JsonAtomic $BundleStatePath $state

  foreach ($item in $services) {
    $db = Read-Env $item.Database
    $user = Read-Env $item.User
    $password = Read-Env $item.Password
    Require ($db -notmatch '(?i)(production|hostinger)' -and $user -notmatch '(?i)(production|hostinger)') "Target database identity is not Staging-local: $($item.Key)"
    $containerPath = "/tmp/$($item.File)"
    & docker compose @compose cp $item.Source "$($item.Service):$containerPath"
    Require ($LASTEXITCODE -eq 0) "Failed to copy bundle into $($item.Service)"
    & docker compose @compose exec -T -e "MYSQL_PWD=$password" $item.Service sh -lc "gzip -dc '$containerPath' | mariadb --protocol=socket -u'$user' '$db'"
    if ($LASTEXITCODE -ne 0) { Fail "Schema import failed for role $($item.Key); state remains applying for explicit recovery." }
    & docker compose @compose exec -T $item.Service rm -f $containerPath
    if ($LASTEXITCODE -ne 0) { Fail "Failed to remove temporary bundle from $($item.Service)" }
    $state.applied_roles = @($state.applied_roles + $item.Key)
    Write-JsonAtomic $BundleStatePath $state
  }

  $runtimeService = $services | Where-Object { $_.Key -eq "runtime" } | Select-Object -First 1
  Require ($null -ne $runtimeService) "Runtime role service is missing for canonical seed phase."
  $runtimeDb = Read-Env $runtimeService.Database
  $runtimeUser = Read-Env $runtimeService.User
  $runtimePassword = Read-Env $runtimeService.Password
  Require ($runtimeDb -notmatch '(?i)(production|hostinger)' -and $runtimeUser -notmatch '(?i)(production|hostinger)') "Canonical seed target identity is not Staging-local."
  foreach ($seed in $canonicalSeedRows) {
    $seedPath = Join-Path $ApiPath (Join-Path "migrations" ([string]$seed.file))
    $seedSql = Get-Content -Raw -LiteralPath $seedPath
    Test-SafeCanonicalSeed $seedSql ([string]$seed.file)
    $seedSql | docker compose @compose exec -T -e "MYSQL_PWD=$runtimePassword" $runtimeService.Service mariadb --protocol=socket -u$runtimeUser $runtimeDb --binary-mode
    if ($LASTEXITCODE -ne 0) { Fail "Canonical seed apply failed: $($seed.file); state remains applying for explicit recovery." }
    $state.canonical_seed_applied_files = @($state.canonical_seed_applied_files + [string]$seed.file)
    Write-JsonAtomic $BundleStatePath $state
  }
  $state.canonical_seed_status = "applied"
  Write-JsonAtomic $BundleStatePath $state
  Write-Host "STAGING_CANONICAL_SEEDS_COMPLETED: files=$($state.canonical_seed_applied_files -join ',') target=runtime-db"

  foreach ($item in $services) {
    $db = Read-Env $item.Database
    $user = Read-Env $item.User
    $password = Read-Env $item.Password
    $tableText = (& docker compose @compose exec -T -e "MYSQL_PWD=$password" $item.Service mariadb --protocol=socket -u$user $db --batch --skip-column-names -e "SHOW FULL TABLES") | Out-String
    Require ($LASTEXITCODE -eq 0) "Post-import table readback failed for $($item.Key)"
    $actualTables = Get-TableNames $tableText
    Assert-SetEqual $item.ExpectedTables $actualTables $item.Key
    if ($item.Key -eq "runtime") { $runtimeTableNames = @($actualTables) }
  }
  Assert-ContainsSet $requiredRuntimeCensus @($runtimeTableNames) "post-import 18-table census"
  Assert-ContainsSet $requiredRuntimeSupportTables @($runtimeTableNames) "post-import runtime support"
  $mcpColumnsText = Invoke-DatabaseQuery $runtimeService $compose "SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('admin_platform_endpoint_tools', 'tenant_platform_endpoint_tools') AND COLUMN_NAME = 'mcp_catalog_level' ORDER BY TABLE_NAME"
  $mcpColumns = Get-TableNames $mcpColumnsText
  Assert-SetEqual @($canonicalSeedManifest.mcp_catalog_required_columns) @($mcpColumns) "MCP catalog column"
  $canonicalRowCounts = [ordered]@{
    registry_surfaces_catalog = Assert-CountAtLeast (Invoke-DatabaseScalar $runtimeService $compose "SELECT COUNT(*) FROM registry_surfaces_catalog WHERE surface_id LIKE 'surface.%'") 1 "registry_surfaces_catalog"
    business_type_profiles = Assert-CountAtLeast (Invoke-DatabaseScalar $runtimeService $compose "SELECT COUNT(*) FROM business_type_profiles WHERE active IS NULL OR active IN ('1','true','yes','active')") 1 "business_type_profiles"
    brand_paths = Assert-CountAtLeast (Invoke-DatabaseScalar $runtimeService $compose "SELECT COUNT(*) FROM brand_paths WHERE active IS NULL OR active IN ('1','true','yes','active')") 1 "brand_paths"
    hvac_activity = Assert-CountAtLeast (Invoke-DatabaseScalar $runtimeService $compose "SELECT COUNT(*) FROM business_activity_types WHERE business_activity_type_key = 'hvac_air_conditioning_services' AND status = 'active'") 1 "hvac business activity"
  }
  $supportRowCounts = [ordered]@{
    connected_systems_query = Assert-CountAtLeast (Invoke-DatabaseScalar $runtimeService $compose "SELECT COUNT(*) FROM connected_systems") 0 "connected_systems"
    admin_tool_catalog_query = Assert-CountAtLeast (Invoke-DatabaseScalar $runtimeService $compose "SELECT COUNT(*) FROM admin_platform_endpoint_tools WHERE mcp_catalog_level IS NOT NULL") 0 "admin tool catalog"
    tenant_tool_catalog_query = Assert-CountAtLeast (Invoke-DatabaseScalar $runtimeService $compose "SELECT COUNT(*) FROM tenant_platform_endpoint_tools WHERE mcp_catalog_level IS NOT NULL") 0 "tenant tool catalog"
  }
  $state.canonical_seed_status = "completed"
  $state.canonical_seed_readback = [ordered]@{
    status = "passed"
    required_runtime_table_census = @($requiredRuntimeCensus)
    required_runtime_support_tables = @($requiredRuntimeSupportTables)
    mcp_catalog_columns = @($mcpColumns)
    canonical_row_counts = $canonicalRowCounts
    support_row_counts = $supportRowCounts
  }
  $state.status = "completed"
  $state.completed_at = (Get-Date).ToUniversalTime().ToString("o")
  $state.post_import_role_table_verification = $true
  $state.database_mutated = $true
  Write-JsonAtomic $BundleStatePath $state
  Write-Host "STAGING_SCHEMA_IMPORT_COMPLETED: commit=$ExpectedCommit roles=runtime,governance,runtime_persistence verification=exact_table_sets"
  Write-Host "Provider mutation, Production access, and migrations were not used."
} catch {
  if ($null -ne $state) {
    $state.status = "failed"
    $state.failure = $_.Exception.Message
    $state.failed_at = (Get-Date).ToUniversalTime().ToString("o")
    try { Write-JsonAtomic $BundleStatePath $state } catch { }
  }
  throw
} finally {
  Release-ImportLock
}
