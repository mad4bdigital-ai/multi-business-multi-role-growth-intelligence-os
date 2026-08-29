[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedCommit,

    [Parameter(Mandatory = $true)]
    [string]$ResetConfirmation,

    [Parameter(Mandatory = $true)]
    [string]$GrantConfirmation,

    [string]$RepositoryPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
$script:RecoveryState = $null

function Fail([string]$Message) {
    throw "STAGING_DATABASE_RECOVERY_FAIL_CLOSED: $Message"
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
    $line = Get-Content -LiteralPath $Path | Where-Object {
        $_ -match "^$([regex]::Escape($Name))=(.*)$"
    } | Select-Object -First 1
    if (-not $line) { Fail "Missing $Name in .env.staging" }
    return ($line -replace "^$([regex]::Escape($Name))=", "")
}

function Sql-String([string]$Value) {
    return "'" + ([string]$Value).Replace("'", "''") + "'"
}

function Sql-Identifier([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^[A-Za-z0-9_$.-]+$') {
        Fail "Unsafe SQL identifier in local Staging recovery"
    }
    return '`' + $Value.Replace('`', '``') + '`'
}

function Write-JsonAtomic([string]$Path, [object]$Value) {
    $tmp = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $tmp -Encoding utf8
        Move-Item -LiteralPath $tmp -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $tmp) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Invoke-Compose([string[]]$Arguments, [switch]$AllowFailure) {
    & docker compose @script:ComposeArgs @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        Fail "docker compose failed: $($Arguments -join ' ')"
    }
    return $code
}

function Invoke-RootSql([object]$Role, [string]$Sql) {
    $rootPassword = Read-Env $script:EnvFile $Role.RootPassword
    $Sql | & docker compose @script:ComposeArgs exec -T -e "MYSQL_PWD=$rootPassword" $Role.Service mariadb --protocol=socket -uroot --binary-mode
    if ($LASTEXITCODE -ne 0) {
        Fail "Root SQL execution failed for local Staging role: $($Role.Key)"
    }
}

function Invoke-RootQuery([object]$Role, [string]$Sql) {
    $rootPassword = Read-Env $script:EnvFile $Role.RootPassword
    $result = (& docker compose @script:ComposeArgs exec -T -e "MYSQL_PWD=$rootPassword" $Role.Service mariadb --protocol=socket -uroot --batch --skip-column-names --raw -e $Sql | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail "Root readback failed for local Staging role: $($Role.Key)"
    }
    return $result
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
            # Fresh MariaDB initialization can legitimately reject the first
            # socket probes. Windows PowerShell 5.1 otherwise promotes native
            # stderr into a terminating NativeCommandError while the script is
            # globally fail-closed with ErrorActionPreference=Stop.
            $ErrorActionPreference = "Continue"
            $result = (& docker compose @script:ComposeArgs exec -T -e "MYSQL_PWD=$password" $Role.Service mariadb --protocol=socket "--user=$user" $database --batch --skip-column-names -e "SELECT 1;" 2>$null | Out-String).Trim()
            $probeExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($probeExitCode -eq 0 -and $result -eq "1") { return }
        Start-Sleep -Seconds 2
    }
    Fail "Fresh local database did not accept the configured role identity: $($Role.Key)"
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
        foreach ($operation in @($grant.operations)) {
            $expected += "$database.$([string]$grant.table):$([string]$operation)"
        }
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
$Builder = Join-Path $script:ApiPath "scripts\build-staging-schema-bundle.mjs"
$script:GrantPlanScript = Join-Path $script:ApiPath "scripts\staging-role-grant-plan.mjs"
$Clone = Join-Path $PSScriptRoot "Clone-StagingDatabases.ps1"
$StartAutoPilot = Join-Path $PSScriptRoot "Start-AutoPilot.ps1"
$DumpDirectory = Join-Path $PSScriptRoot "staging-db-dumps"
$DataRoot = Join-Path $script:ApiPath ".staging-data"
$RecoveryStatePath = Join-Path $DumpDirectory "staging-database-recovery-state.json"

$expectedResetConfirmation = "RESET_LOCAL_STAGING_DATABASES:${ExpectedCommit}:staging_local_windows_docker"
$expectedGrantConfirmation = "APPLY_STAGING_ROLE_GRANTS:${ExpectedCommit}:staging_local_windows_docker"
Require ($ResetConfirmation -ceq $expectedResetConfirmation) "Reset confirmation mismatch"
Require ($GrantConfirmation -ceq $expectedGrantConfirmation) "Grant confirmation mismatch"
Require (Test-Path -LiteralPath (Join-Path $RepositoryPath ".git")) "RepositoryPath is not a Git checkout"
Require (Test-Path -LiteralPath $script:EnvFile) "Missing local .env.staging"
Require (Test-Path -LiteralPath $ComposeBase) "Missing base Compose file"
Require (Test-Path -LiteralPath $ComposeStaging) "Missing Staging Compose file"
Require (Test-Path -LiteralPath $Builder) "Missing Staging schema bundle builder"
Require (Test-Path -LiteralPath $script:GrantPlanScript) "Missing Staging role grant-plan helper"
Require (Test-Path -LiteralPath $Clone) "Missing Staging schema importer"
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
    Require ((Read-Env $script:EnvFile $name) -eq "false") "$name must be exactly false before local database recovery"
}

$remoteLine = & git -C $RepositoryPath -c protocol.version=0 -c http.version=HTTP/1.1 ls-remote origin refs/heads/main
Require ($LASTEXITCODE -eq 0) "origin/main could not be resolved"
$remoteSha = (($remoteLine | Select-Object -First 1).ToString() -split '\s+')[0].ToLowerInvariant()
Require ($remoteSha -eq $ExpectedCommit) "origin/main moved away from ExpectedCommit"

$roleConfig = @(
    [pscustomobject]@{ Key = "runtime"; Service = "runtime-db"; Database = "DB_NAME"; User = "DB_USER"; Password = "DB_PASSWORD"; RootPassword = "RUNTIME_DB_ROOT_PASSWORD"; DataDir = "runtime-db" },
    [pscustomobject]@{ Key = "governance"; Service = "governance-db"; Database = "GOVERNANCE_DB_NAME"; User = "GOVERNANCE_DB_USER"; Password = "GOVERNANCE_DB_PASSWORD"; RootPassword = "GOVERNANCE_DB_ROOT_PASSWORD"; DataDir = "governance-db" },
    [pscustomobject]@{ Key = "runtime_persistence"; Service = "persistence-db"; Database = "RUNTIME_PERSISTENCE_DB_NAME"; User = "RUNTIME_PERSISTENCE_DB_USER"; Password = "RUNTIME_PERSISTENCE_DB_PASSWORD"; RootPassword = "RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD"; DataDir = "persistence-db" }
)

$script:ComposeArgs = @("-f", $ComposeBase, "-f", $ComposeStaging, "--env-file", $script:EnvFile)
Push-Location $script:ApiPath
try {
    Invoke-Compose @("config", "--quiet") | Out-Null

    New-Item -ItemType Directory -Force -Path $DumpDirectory | Out-Null
    & node $Builder --expected-commit $ExpectedCommit --confirm BUILD_STAGING_SCHEMA_BUNDLE
    Require ($LASTEXITCODE -eq 0) "Staging schema bundle generation failed"

    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Clone -DumpDirectory $DumpDirectory -ExpectedCommit $ExpectedCommit -Mode schema_only
    Require ($LASTEXITCODE -eq 0) "Staging schema bundle dry-run validation failed"

    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
    $backupRoot = Join-Path $DataRoot ("_recovery_backups\" + $stamp)
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

    $script:RecoveryState = [ordered]@{
        contract = "mad4b.staging-database-recovery.v1"
        status = "stopping"
        source_commit = $ExpectedCommit
        backup_root = $backupRoot
        roles = @($roleConfig | ForEach-Object { $_.Key })
        schema_bundle = [ordered]@{ status = "validated"; directory = $DumpDirectory }
        grants = [ordered]@{ status = "pending"; readback = @() }
        production_accessed = $false
        provider_accessed = $false
        hostinger_mutation = $false
        cloudflare_mutation = $false
        backups_deleted = $false
        secrets_included = $false
        started_at = (Get-Date).ToUniversalTime().ToString("o")
    }
    Write-JsonAtomic $RecoveryStatePath $script:RecoveryState

    Invoke-Compose @("--profile", "tunnel", "down", "--remove-orphans") | Out-Null
    $script:RecoveryState.status = "backing_up"
    Write-JsonAtomic $RecoveryStatePath $script:RecoveryState

    foreach ($role in $roleConfig) {
        $source = Join-Path $DataRoot $role.DataDir
        if (Test-Path -LiteralPath $source) {
            $destination = Join-Path $backupRoot $role.DataDir
            Move-Item -LiteralPath $source -Destination $destination
        }
    }

    $script:RecoveryState.status = "fresh_database_start"
    Write-JsonAtomic $RecoveryStatePath $script:RecoveryState
    Invoke-Compose @("up", "-d", "runtime-db", "governance-db", "persistence-db") | Out-Null
    foreach ($role in $roleConfig) { Wait-DatabaseSelfAuth $role }

    $script:RecoveryState.status = "schema_import"
    Write-JsonAtomic $RecoveryStatePath $script:RecoveryState
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Clone -DumpDirectory $DumpDirectory -ExpectedCommit $ExpectedCommit -Mode schema_only -Apply
    Require ($LASTEXITCODE -eq 0) "Staging schema bundle apply failed"

    $script:RecoveryState.status = "grant_reconciliation"
    Write-JsonAtomic $RecoveryStatePath $script:RecoveryState
    $grantReadback = @()
    foreach ($role in $roleConfig) {
        $grantReadback += Reconcile-RoleGrant $role
    }
    $script:RecoveryState.grants = [ordered]@{ status = "completed"; readback = $grantReadback }
    Write-JsonAtomic $RecoveryStatePath $script:RecoveryState

    $script:RecoveryState.status = "restart_and_certify"
    Write-JsonAtomic $RecoveryStatePath $script:RecoveryState
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $StartAutoPilot -RepositoryPath $RepositoryPath -ExpectedCommit $ExpectedCommit -BuildMode Smart -SkipSelfUpdate
    Require ($LASTEXITCODE -eq 0) "Auto Pilot restart failed after local database recovery"

    $autoPilotStatePath = Join-Path $PSScriptRoot "autopilot-state.json"
    Require (Test-Path -LiteralPath $autoPilotStatePath) "Auto Pilot state is missing after recovery"
    $autoPilotState = Get-Content -Raw -LiteralPath $autoPilotStatePath | ConvertFrom-Json
    Require ([string]$autoPilotState.commit -eq $ExpectedCommit) "Recovered Auto Pilot state commit mismatch"
    Require ([string]$autoPilotState.certification_status -eq "ready") "Recovered Staging runtime is not certified ready"

    $script:RecoveryState.status = "ready"
    $script:RecoveryState.certification_status = "ready"
    $script:RecoveryState.completed_at = (Get-Date).ToUniversalTime().ToString("o")
    Write-JsonAtomic $RecoveryStatePath $script:RecoveryState
    Write-Host "STAGING_DATABASE_RECOVERY_READY: commit=$ExpectedCommit backup_root=$backupRoot"
    Write-Host "Backups were preserved and were not deleted. Production/provider/Hostinger/Cloudflare mutation was not performed."
}
catch {
    if ($null -ne $script:RecoveryState) {
        $script:RecoveryState.status = "failed"
        $script:RecoveryState.failure = $_.Exception.Message
        $script:RecoveryState.failed_at = (Get-Date).ToUniversalTime().ToString("o")
        try { Write-JsonAtomic $RecoveryStatePath $script:RecoveryState } catch { }
        Write-Host "STAGING_DATABASE_RECOVERY_BACKUP_PRESERVED: $($script:RecoveryState.backup_root)" -ForegroundColor Yellow
    }
    throw
}
finally {
    Pop-Location
}