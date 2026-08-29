[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedCommit,

    [Parameter(Mandatory = $true)]
    [string]$RepairConfirmation,

    [string]$RepositoryPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
$script:State = $null

function Fail([string]$Message) {
    throw "STAGING_DATABASE_READINESS_REPAIR_FAIL_CLOSED: $Message"
}

function Require([bool]$Condition, [string]$Message) {
    if (-not $Condition) { Fail $Message }
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Fail "Required command is missing: $Name" }
}

function Native-Text([string]$File, [string[]]$Arguments) {
    $text = & $File @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "$File failed while reading local state" }
    return (($text | Out-String).Trim())
}

function Read-Env([string]$Path, [string]$Name) {
    $line = Get-Content -LiteralPath $Path | Where-Object {
        $_ -match "^$([regex]::Escape($Name))=(.*)$"
    } | Select-Object -First 1
    if (-not $line) { Fail "Missing $Name in .env.staging" }
    return ($line -replace "^$([regex]::Escape($Name))=", "")
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Sql-String([string]$Value) {
    return "'" + ([string]$Value).Replace("'", "''") + "'"
}

function Sql-Identifier([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^[A-Za-z0-9_$.-]+$') {
        Fail "Unsafe SQL identifier in local Staging readiness repair"
    }
    return '`' + $Value.Replace('`', '``') + '`'
}

function Write-JsonAtomic([string]$Path, [object]$Value) {
    $tmp = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $tmp -Encoding utf8
        Move-Item -LiteralPath $tmp -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
}

function Invoke-Compose([string[]]$Arguments, [switch]$AllowFailure) {
    & docker compose @script:ComposeArgs @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) { Fail "docker compose failed: $($Arguments -join ' ')" }
    return $code
}

function Invoke-RootSql([object]$Role, [string]$Sql) {
    $rootPassword = Read-Env $script:EnvFile $Role.RootPassword
    $Sql | & docker compose @script:ComposeArgs exec -T -e "MYSQL_PWD=$rootPassword" $Role.Service mariadb --protocol=socket -uroot --binary-mode
    if ($LASTEXITCODE -ne 0) { Fail "Root SQL execution failed for local Staging role: $($Role.Key)" }
}

function Invoke-RootQuery([object]$Role, [string]$Sql) {
    $rootPassword = Read-Env $script:EnvFile $Role.RootPassword
    $result = (& docker compose @script:ComposeArgs exec -T -e "MYSQL_PWD=$rootPassword" $Role.Service mariadb --protocol=socket -uroot --batch --skip-column-names --raw -e $Sql | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "Root readback failed for local Staging role: $($Role.Key)" }
    return $result
}

function Reconcile-SqlCacheRuntimePolicy([object]$Role) {
    Require ($Role.Key -eq "runtime") "SQL cache runtime policy reconciliation is runtime-role only"
    Require (Test-Path -LiteralPath $script:SqlCachePolicySeedPath -PathType Leaf) "Canonical SQL cache policy seed migration is missing"
    $observedSeedSha = Get-Sha256 $script:SqlCachePolicySeedPath
    Require ($observedSeedSha -eq $script:SqlCachePolicySeedSha256) "Canonical SQL cache policy seed checksum mismatch"

    $database = Read-Env $script:EnvFile $Role.Database
    $databaseIdentifier = Sql-Identifier $database
    $tableCount = [int](Invoke-RootQuery $Role "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = $(Sql-String $database) AND TABLE_NAME = 'sql_cache_runtime_policies' AND TABLE_TYPE = 'BASE TABLE'")
    Require ($tableCount -eq 1) "sql_cache_runtime_policies must already exist before readiness seed reconciliation"

    $beforeCount = [int](Invoke-RootQuery $Role "SELECT COUNT(*) FROM $databaseIdentifier.`sql_cache_runtime_policies` WHERE policy_key = 'sql_cache_policy_v2'")
    Require ($beforeCount -in @(0, 1)) "sql_cache_policy_v2 row count is invalid before reconciliation"
    $inserted = $false
    if ($beforeCount -eq 0) {
        $migrationSql = Get-Content -Raw -LiteralPath $script:SqlCachePolicySeedPath
        $insertMarker = 'INSERT INTO `sql_cache_runtime_policies`'
        $insertIndex = $migrationSql.IndexOf($insertMarker, [StringComparison]::Ordinal)
        Require ($insertIndex -ge 0) "Canonical SQL cache policy seed INSERT is missing"
        $seedSql = $migrationSql.Substring($insertIndex).Trim()
        Require ($seedSql -match '(?is)^INSERT\s+INTO\s+`sql_cache_runtime_policies`\b') "Canonical SQL cache policy seed does not start with the expected INSERT"
        Require ($seedSql -match "(?is)'sql_cache_policy_v2'") "Canonical SQL cache policy key is missing from seed"
        Require ($seedSql -match "(?is)ON\s+DUPLICATE\s+KEY\s+UPDATE") "Canonical SQL cache policy seed is not idempotent"
        Require ($seedSql -notmatch "(?im)^\s*(?:GRANT|REVOKE|CREATE\s+USER|ALTER\s+USER|CREATE\s+DATABASE|DROP\s+DATABASE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|LOAD\s+DATA)\b") "Extracted SQL cache policy seed contains forbidden authority/schema SQL"
        Require ($seedSql -notmatch "(?im)\bINTO\s+(?:OUTFILE|DUMPFILE)\b") "Extracted SQL cache policy seed contains external-data SQL"
        $qualifiedInsert = "INSERT INTO $databaseIdentifier." + '`sql_cache_runtime_policies`'
        $seedSql = $seedSql.Replace($insertMarker, $qualifiedInsert)
        Require ($seedSql.StartsWith($qualifiedInsert, [StringComparison]::OrdinalIgnoreCase)) "SQL cache policy seed target qualification failed"
        Invoke-RootSql $Role $seedSql
        $inserted = $true
    }

    $afterCount = [int](Invoke-RootQuery $Role "SELECT COUNT(*) FROM $databaseIdentifier.`sql_cache_runtime_policies` WHERE policy_key = 'sql_cache_policy_v2'")
    Require ($afterCount -eq 1) "sql_cache_policy_v2 must exist exactly once after reconciliation"
    $policyReadback = Invoke-RootQuery $Role "SELECT CONCAT(revision, CHAR(9), enabled, CHAR(9), JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.required')), CHAR(9), JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.table_blocklist'))) FROM $databaseIdentifier.`sql_cache_runtime_policies` WHERE policy_key = 'sql_cache_policy_v2' LIMIT 1"
    $parts = @($policyReadback -split "`t", 4)
    Require ($parts.Count -eq 4) "SQL cache policy readback shape is invalid"
    $revision = 0L
    Require ([long]::TryParse($parts[0], [ref]$revision) -and $revision -ge 1) "SQL cache policy revision is invalid"
    Require ($parts[1] -in @("0", "1")) "SQL cache policy enabled value is invalid"
    Require ($parts[2].ToLowerInvariant() -in @("false", "0")) "Local Staging SQL cache policy must remain required=false"
    $blockedTables = @($parts[3] -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
    Require ($blockedTables -contains "endpoints") "SQL cache policy must retain the immutable endpoints denylist"

    return [ordered]@{
        status = "completed"
        policy_key = "sql_cache_policy_v2"
        seed_file = "1023_sprint69_sql_cache_runtime_policy.sql"
        seed_sha256 = $observedSeedSha
        row_inserted = $inserted
        row_count = $afterCount
        revision = $revision
        enabled = ($parts[1] -eq "1")
        required = $false
        endpoints_blocked = $true
        root_identity_used_for_seed = $inserted
        runtime_write_authority_required = $false
        secrets_included = $false
    }
}

function Assert-ExactStringSet([string[]]$Expected, [string[]]$Actual, [string]$Label) {
    $expectedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $actualSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in @($Expected)) { if ($item) { [void]$expectedSet.Add([string]$item) } }
    foreach ($item in @($Actual)) { if ($item) { [void]$actualSet.Add([string]$item) } }
    $missing = @($expectedSet | Where-Object { -not $actualSet.Contains($_) })
    $unexpected = @($actualSet | Where-Object { -not $expectedSet.Contains($_) })
    if ($missing.Count -gt 0 -or $unexpected.Count -gt 0) {
        Fail "$Label mismatch; missing=$($missing -join ','); unexpected=$($unexpected -join ',')"
    }
}

function Wait-DatabaseSelfAuth([object]$Role) {
    $database = Read-Env $script:EnvFile $Role.Database
    $user = Read-Env $script:EnvFile $Role.User
    $password = Read-Env $script:EnvFile $Role.Password
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        $result = ""
        $probeExitCode = 1
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $result = (& docker compose @script:ComposeArgs exec -T -e "MYSQL_PWD=$password" $Role.Service mariadb --protocol=socket "--user=$user" $database --batch --skip-column-names -e "SELECT 1;" 2>$null | Out-String).Trim()
            $probeExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($probeExitCode -eq 0 -and $result -eq "1") { return }
        Start-Sleep -Seconds 2
    }
    Fail "Local database did not accept the configured role identity after non-destructive restart: $($Role.Key)"
}

function Get-RoleGrantPlan([string]$RoleKey) {
    $text = & node $script:GrantPlanScript --role $RoleKey
    if ($LASTEXITCODE -ne 0) { Fail "Grant-plan helper failed for role: $RoleKey" }
    try { $plan = (($text | Out-String).Trim() | ConvertFrom-Json) }
    catch { Fail "Grant-plan helper returned invalid JSON for role: $RoleKey" }
    Require ([string]$plan.contract -eq "mad4b.staging-role-grant-plan.v1") "Unsupported Staging grant-plan contract"
    Require ([string]$plan.role -eq $RoleKey) "Grant-plan role mismatch"
    Require ($plan.safety.local_staging_only -eq $true) "Grant plan is not local-Staging-only"
    Require ($plan.safety.production_accessed -eq $false -and $plan.safety.provider_accessed -eq $false) "Grant plan safety metadata is not fail-closed"
    return $plan
}

function Reconcile-RoleGrant([object]$Role) {
    $database = Read-Env $script:EnvFile $Role.Database
    $user = Read-Env $script:EnvFile $Role.User
    $password = Read-Env $script:EnvFile $Role.Password
    $plan = Get-RoleGrantPlan $Role.Key

    $account = "$(Sql-String $user)@'%'"
    $databaseIdentifier = Sql-Identifier $database
    $passwordLiteral = Sql-String $password
    $sql = [System.Collections.Generic.List[string]]::new()
    $sql.Add("CREATE USER IF NOT EXISTS $account IDENTIFIED BY $passwordLiteral;")
    $sql.Add("ALTER USER $account IDENTIFIED BY $passwordLiteral;")
    $sql.Add("REVOKE ALL PRIVILEGES, GRANT OPTION FROM $account;")
    foreach ($grant in @($plan.grants)) {
        $tableIdentifier = Sql-Identifier ([string]$grant.table)
        $operations = @($grant.operations | ForEach-Object { ([string]$_).ToUpperInvariant() })
        Require ($operations.Count -gt 0) "Empty Staging grant operation set"
        foreach ($operation in $operations) {
            Require ($operation -in @("SELECT", "INSERT", "UPDATE", "DELETE")) "Forbidden Staging grant privilege: $operation"
        }
        $sql.Add("GRANT $($operations -join ', ') ON $databaseIdentifier.$tableIdentifier TO $account;")
    }
    $sql.Add("FLUSH PRIVILEGES;")
    Invoke-RootSql $Role ($sql -join "`n")

    $grantee = "'$user'@'%'"
    $granteeLiteral = Sql-String $grantee
    $actualText = Invoke-RootQuery $Role "SELECT CONCAT(TABLE_SCHEMA, '.', TABLE_NAME, ':', PRIVILEGE_TYPE) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = $granteeLiteral ORDER BY TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE"
    $actual = @($actualText -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $expected = @()
    foreach ($grant in @($plan.grants)) {
        foreach ($operation in @($grant.operations)) { $expected += "$database.$([string]$grant.table):$([string]$operation)" }
    }
    Assert-ExactStringSet $expected $actual "$($Role.Key) table privilege"

    $globalCount = [int](Invoke-RootQuery $Role "SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = $granteeLiteral AND PRIVILEGE_TYPE <> 'USAGE'")
    $schemaCount = [int](Invoke-RootQuery $Role "SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = $granteeLiteral AND PRIVILEGE_TYPE <> 'USAGE'")
    $columnCount = [int](Invoke-RootQuery $Role "SELECT COUNT(*) FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE = $granteeLiteral")
    $grantOptionCount = [int](Invoke-RootQuery $Role "SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = $granteeLiteral AND IS_GRANTABLE = 'YES'")
    $roleCount = [int](Invoke-RootQuery $Role "SELECT COUNT(*) FROM information_schema.APPLICABLE_ROLES WHERE GRANTEE = $granteeLiteral")
    Require ($globalCount -eq 0) "$($Role.Key) has unexpected global privileges"
    Require ($schemaCount -eq 0) "$($Role.Key) has unexpected schema-wide privileges"
    Require ($columnCount -eq 0) "$($Role.Key) has unexpected column privileges"
    Require ($grantOptionCount -eq 0) "$($Role.Key) has GRANT OPTION"
    Require ($roleCount -eq 0) "$($Role.Key) has applicable roles"

    return [ordered]@{
        role = $Role.Key
        required_table_privilege_count = $expected.Count
        observed_table_privilege_count = $actual.Count
        no_global_privileges = $true
        no_schema_wide_privileges = $true
        no_column_privileges = $true
        no_grant_option = $true
        no_applicable_roles = $true
        secrets_included = $false
    }
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
} else {
    $RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
}

$script:ApiPath = Join-Path $RepositoryPath "http-generic-api"
$script:EnvFile = Join-Path $script:ApiPath ".env.staging"
$ComposeBase = Join-Path $script:ApiPath "docker-compose.yml"
$ComposeStaging = Join-Path $script:ApiPath "docker-compose.staging.yml"
$script:GrantPlanScript = Join-Path $script:ApiPath "scripts\staging-role-grant-plan.mjs"
$script:SqlCachePolicySeedPath = Join-Path $script:ApiPath "migrations\1023_sprint69_sql_cache_runtime_policy.sql"
$script:SqlCachePolicySeedSha256 = "50424aac877e6c3924191599b295a460007b98d01fbe009d615e06457e24fdc7"
$StartAutoPilot = Join-Path $PSScriptRoot "Start-AutoPilot.ps1"
$StateDirectory = Join-Path $PSScriptRoot "staging-db-dumps"
$StatePath = Join-Path $StateDirectory "staging-readiness-repair-state.json"

$expectedConfirmation = "REPAIR_LOCAL_STAGING_DATABASE_READINESS:${ExpectedCommit}:staging_local_windows_docker"
Require ($RepairConfirmation -ceq $expectedConfirmation) "Readiness repair confirmation mismatch"
Require (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git")) "RepositoryPath is not a Git checkout"
Require (Test-Path -LiteralPath $script:EnvFile) "Missing local .env.staging"
Require (Test-Path -LiteralPath $ComposeBase) "Missing base Compose file"
Require (Test-Path -LiteralPath $ComposeStaging) "Missing Staging Compose file"
Require (Test-Path -LiteralPath $script:GrantPlanScript) "Missing Staging role grant-plan helper"
Require (Test-Path -LiteralPath $script:SqlCachePolicySeedPath) "Missing canonical SQL cache policy seed migration"
Require (Test-Path -LiteralPath $StartAutoPilot) "Missing Auto Pilot launcher"

Require-Command "git"
Require-Command "node"
Require-Command "docker"

if ($env:DOCKER_HOST) { Fail "DOCKER_HOST is forbidden" }
if ($env:DOCKER_CONTEXT) { Fail "DOCKER_CONTEXT is forbidden" }
$context = Native-Text "docker" @("context", "show")
Require ($context -in @("default", "desktop-linux")) "Docker context must be local"
Require (-not [string]::IsNullOrWhiteSpace((Native-Text "docker" @("info", "--format", "{{.ServerVersion}}")))) "Docker daemon is unavailable"

$observedHead = (Native-Text "git" @("-C", $RepositoryPath, "rev-parse", "HEAD")).ToLowerInvariant()
Require ($observedHead -eq $ExpectedCommit) "Local checkout does not match ExpectedCommit"
$dirty = @(git -C $RepositoryPath status --porcelain --untracked-files=no)
Require ($dirty.Count -eq 0) "Tracked working tree changes are forbidden"
$origin = Native-Text "git" @("-C", $RepositoryPath, "remote", "get-url", "origin")
Require ($origin -match 'github\.com[:/]mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os(?:\.git)?$') "Repository origin mismatch"
foreach ($name in @("MIGRATION_APPLIED", "DATABASE_MUTATED", "PRODUCTION_MUTATION_AUTHORIZED", "RULESET_MUTATION_AUTHORIZED")) {
    Require ((Read-Env $script:EnvFile $name) -eq "false") "$name must be exactly false before local database readiness repair"
}
$remoteLine = & git -C $RepositoryPath -c protocol.version=0 -c http.version=HTTP/1.1 ls-remote origin refs/heads/main
Require ($LASTEXITCODE -eq 0) "origin/main could not be resolved"
$remoteSha = (($remoteLine | Select-Object -First 1).ToString() -split '\s+')[0].ToLowerInvariant()
Require ($remoteSha -eq $ExpectedCommit) "origin/main moved away from ExpectedCommit"

$roleConfig = @(
    [pscustomobject]@{ Key = "runtime"; Service = "runtime-db"; Database = "DB_NAME"; User = "DB_USER"; Password = "DB_PASSWORD"; RootPassword = "RUNTIME_DB_ROOT_PASSWORD" },
    [pscustomobject]@{ Key = "governance"; Service = "governance-db"; Database = "GOVERNANCE_DB_NAME"; User = "GOVERNANCE_DB_USER"; Password = "GOVERNANCE_DB_PASSWORD"; RootPassword = "GOVERNANCE_DB_ROOT_PASSWORD" },
    [pscustomobject]@{ Key = "runtime_persistence"; Service = "persistence-db"; Database = "RUNTIME_PERSISTENCE_DB_NAME"; User = "RUNTIME_PERSISTENCE_DB_USER"; Password = "RUNTIME_PERSISTENCE_DB_PASSWORD"; RootPassword = "RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD" }
)

$script:ComposeArgs = @("-f", $ComposeBase, "-f", $ComposeStaging, "--env-file", $script:EnvFile)
New-Item -ItemType Directory -Force -Path $StateDirectory | Out-Null
Push-Location $script:ApiPath
try {
    Invoke-Compose @("config", "--quiet") | Out-Null
    $script:State = [ordered]@{
        contract = "mad4b.staging-database-readiness-repair.v1"
        status = "database_restart"
        source_commit = $ExpectedCommit
        roles = @($roleConfig | ForEach-Object { $_.Key })
        collation = [ordered]@{ status = "pending"; target = "utf8mb4_unicode_ci"; readback = @() }
        sql_cache_runtime_policy = [ordered]@{ status = "pending"; policy_key = "sql_cache_policy_v2"; row_inserted = $false }
        grants = [ordered]@{ status = "pending"; readback = @() }
        destructive_reset = $false
        schema_replay = $false
        data_directory_moved = $false
        backup_deleted = $false
        production_accessed = $false
        provider_accessed = $false
        hostinger_mutation = $false
        cloudflare_mutation = $false
        secrets_included = $false
        started_at = (Get-Date).ToUniversalTime().ToString("o")
    }
    Write-JsonAtomic $StatePath $script:State

    Invoke-Compose @("up", "-d", "runtime-db", "governance-db", "persistence-db") | Out-Null
    foreach ($role in $roleConfig) { Wait-DatabaseSelfAuth $role }

    $script:State.status = "collation_reconciliation"
    Write-JsonAtomic $StatePath $script:State
    $collationReadback = @()
    foreach ($role in $roleConfig) {
        $database = Read-Env $script:EnvFile $role.Database
        $databaseIdentifier = Sql-Identifier $database
        Invoke-RootSql $role "ALTER DATABASE $databaseIdentifier CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
        $readback = Invoke-RootQuery $role "SELECT CONCAT(DEFAULT_CHARACTER_SET_NAME, ':', DEFAULT_COLLATION_NAME) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = $(Sql-String $database)"
        Require ($readback -eq "utf8mb4:utf8mb4_unicode_ci") "$($role.Key) database default collation did not converge"
        $collationReadback += [ordered]@{ role = $role.Key; character_set = "utf8mb4"; collation = "utf8mb4_unicode_ci" }
    }
    $script:State.collation = [ordered]@{ status = "completed"; target = "utf8mb4_unicode_ci"; readback = $collationReadback }
    Write-JsonAtomic $StatePath $script:State

    $script:State.status = "sql_cache_policy_reconciliation"
    Write-JsonAtomic $StatePath $script:State
    $runtimeRole = $roleConfig | Where-Object { $_.Key -eq "runtime" } | Select-Object -First 1
    Require ($null -ne $runtimeRole) "Runtime role is missing from readiness repair contract"
    $script:State.sql_cache_runtime_policy = Reconcile-SqlCacheRuntimePolicy $runtimeRole
    Write-JsonAtomic $StatePath $script:State

    $script:State.status = "grant_reconciliation"
    Write-JsonAtomic $StatePath $script:State
    $grantReadback = @()
    foreach ($role in $roleConfig) { $grantReadback += Reconcile-RoleGrant $role }
    $script:State.grants = [ordered]@{ status = "completed"; readback = $grantReadback }
    Write-JsonAtomic $StatePath $script:State

    $script:State.status = "restart_and_certify"
    Write-JsonAtomic $StatePath $script:State
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $StartAutoPilot -RepositoryPath $RepositoryPath -ExpectedCommit $ExpectedCommit -BuildMode Smart -SkipSelfUpdate
    Require ($LASTEXITCODE -eq 0) "Auto Pilot restart failed after local Staging readiness repair"

    $autoPilotStatePath = Join-Path $PSScriptRoot "autopilot-state.json"
    Require (Test-Path -LiteralPath $autoPilotStatePath) "Auto Pilot state is missing after readiness repair"
    $autoPilotState = Get-Content -Raw -LiteralPath $autoPilotStatePath | ConvertFrom-Json
    Require ([string]$autoPilotState.commit -eq $ExpectedCommit) "Readiness-repaired Auto Pilot state commit mismatch"
    Require ([string]$autoPilotState.certification_status -eq "ready") "Readiness-repaired Staging runtime is not certified ready"

    $script:State.status = "ready"
    $script:State.certification_status = "ready"
    $script:State.completed_at = (Get-Date).ToUniversalTime().ToString("o")
    Write-JsonAtomic $StatePath $script:State
    Write-Host "STAGING_DATABASE_READINESS_REPAIR_READY: commit=$ExpectedCommit"
    Write-Host "SQL cache runtime authority, least-privilege grants, and certification were reconciled without a database reset or schema replay."
    Write-Host "No data-directory move, Production/provider/Hostinger/Cloudflare mutation, or backup deletion was performed."
} catch {
    if ($null -ne $script:State) {
        $script:State.status = "failed"
        $script:State.failure = $_.Exception.Message
        $script:State.failed_at = (Get-Date).ToUniversalTime().ToString("o")
        try { Write-JsonAtomic $StatePath $script:State } catch { }
    }
    throw
} finally {
    Pop-Location
}
