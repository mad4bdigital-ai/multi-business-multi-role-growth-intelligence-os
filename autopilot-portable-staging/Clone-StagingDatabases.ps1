[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string]$DumpDirectory,
  [ValidateSet("schema_only", "sanitized_data")] [string]$Mode = "schema_only",
  [switch]$Apply,
  [switch]$AllowSanitizedData
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ApiPath = Join-Path $RepoRoot "http-generic-api"
$EnvFile = Join-Path $ApiPath ".env.staging"
$ComposeBase = Join-Path $ApiPath "docker-compose.yml"
$ComposeStaging = Join-Path $ApiPath "docker-compose.staging.yml"

function Fail([string]$Message) { throw "FAIL-CLOSED: $Message" }
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }
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

Require (Test-Path -LiteralPath $EnvFile) "Missing local .env.staging; run Start-AutoPilot.ps1 first."
Require (Test-Path -LiteralPath $ComposeBase) "Missing base Compose file."
Require (Test-Path -LiteralPath $ComposeStaging) "Missing staging Compose file."
Require (Test-Path -LiteralPath $DumpDirectory -PathType Container) "DumpDirectory must be an existing local directory."
Require (-not ($DumpDirectory -match '(?i)(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com|hostinger|production)')) "Production/provider paths are forbidden as dump sources."
Require ($env:DOCKER_HOST -eq $null -or $env:DOCKER_HOST -eq "") "DOCKER_HOST is forbidden."
Require ($env:DOCKER_CONTEXT -eq $null -or $env:DOCKER_CONTEXT -eq "") "DOCKER_CONTEXT is forbidden."
Assert-UniqueEnvKeys $EnvFile

function Read-Env([string]$Name) {
  $line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
  if (-not $line) { Fail "Missing $Name in .env.staging" }
  return $line -replace "^$([regex]::Escape($Name))=", ""
}

$stagingMigrationApplied = Read-Env "MIGRATION_APPLIED"
$stagingDatabaseMutated = Read-Env "DATABASE_MUTATED"
Require ($stagingMigrationApplied -eq "false") "MIGRATION_APPLIED must be exactly false in .env.staging."
Require ($stagingDatabaseMutated -eq "false") "DATABASE_MUTATED must be exactly false in .env.staging."

if ($Mode -eq "sanitized_data") {
  Require $AllowSanitizedData.IsPresent "sanitized_data requires -AllowSanitizedData."
  Require ($env:STAGING_DB_COPY_APPROVED -eq "true") "Set STAGING_DB_COPY_APPROVED=true only after independent review."
}

$services = @(
  @{ Key = "runtime"; Service = "runtime-db"; Database = "DB_NAME"; User = "DB_USER"; Password = "DB_PASSWORD"; File = "runtime.schema.sql.gz" },
  @{ Key = "governance"; Service = "governance-db"; Database = "GOVERNANCE_DB_NAME"; User = "GOVERNANCE_DB_USER"; Password = "GOVERNANCE_DB_PASSWORD"; File = "governance.schema.sql.gz" },
  @{ Key = "persistence"; Service = "persistence-db"; Database = "RUNTIME_PERSISTENCE_DB_NAME"; User = "RUNTIME_PERSISTENCE_DB_USER"; Password = "RUNTIME_PERSISTENCE_DB_PASSWORD"; File = "persistence.schema.sql.gz" }
)

$compose = @("-f", $ComposeBase, "-f", $ComposeStaging, "--env-file", $EnvFile)
$plan = @()
foreach ($item in $services) {
  $fileName = if ($Mode -eq "schema_only") { $item.File } else { $item.File -replace '\.schema\.sql\.gz$', '.sanitized.sql.gz' }
  $source = Join-Path $DumpDirectory $fileName
  Require (Test-Path -LiteralPath $source -PathType Leaf) "Missing required $Mode dump: $fileName"
  $plan += [pscustomobject]@{ database = $item.Key; service = $item.Service; dump = $source; mode = $Mode }
}

$plan | ConvertTo-Json -Depth 4
if (-not $Apply) {
  Write-Host "DRY-RUN only. No database or file mutation was performed. Re-run with -Apply after reviewing the plan."
  exit 0
}

Require ((Read-Env "MIGRATION_APPLIED") -eq "false") "MIGRATION_APPLIED must remain false during staging copy."
Require ((Read-Env "DATABASE_MUTATED") -eq "false") "DATABASE_MUTATED must remain false before explicit staging copy completion."

foreach ($item in $services) {
  $fileName = if ($Mode -eq "schema_only") { $item.File } else { $item.File -replace '\.schema\.sql\.gz$', '.sanitized.sql.gz' }
  $source = Join-Path $DumpDirectory $fileName
  $containerPath = "/tmp/$fileName"
  $db = Read-Env $item.Database
  $user = Read-Env $item.User
  $password = Read-Env $item.Password
  docker compose @compose cp $source "$($item.Service):$containerPath"
  docker compose @compose exec -T -e "MYSQL_PWD=$password" $item.Service sh -lc "gzip -dc '$containerPath' | mariadb --protocol=socket -u'$user' '$db'"
  docker compose @compose exec -T $item.Service rm -f $containerPath
}

Write-Host "Staging database copy completed for runtime, governance, and persistence using mode=$Mode."
Write-Host "Provider mutation, Production access, and migrations were not used."
