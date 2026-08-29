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
$RoleManifestPath = Join-Path $ApiPath "config\staging-database-role-migration-manifest.json"
$PlannerPath = Join-Path $ApiPath "scripts\prepare-staging-role-schema-replay.mjs"
$LegacyImporterPath = Join-Path $PSScriptRoot "Clone-StagingDatabases.Legacy.ps1"
$BundleManifestPath = Join-Path $DumpDirectory "staging-schema-bundle-manifest.json"
$ReplayEvidencePath = Join-Path $DumpDirectory "role-schema-replay-plan.json"
$RecoveryStatePath = Join-Path $DumpDirectory "schema-import-state.json"

function Fail([string]$Message) { throw "FAIL-CLOSED: $Message" }
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }
function Require-Command([string]$Name) { if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Fail "Required command is missing: $Name" } }
function Invoke-NodeJson([string[]]$Arguments, [string]$Label) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = (& node @Arguments 2>&1 | Out-String).Trim()
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) { Fail "$Label failed: $output" }
  try { return $output | ConvertFrom-Json }
  catch { Fail "$Label returned invalid JSON" }
}
function Assert-ReplayPlan([object]$Plan) {
  Require ([string]$Plan.contract -eq "mad4b.staging.role-schema-replay-plan.v1") "Unsupported role schema replay plan contract."
  Require ([string]$Plan.source_commit -eq $ExpectedCommit.ToLowerInvariant()) "Role schema replay plan source_commit mismatch."
  Require ([string]$Plan.builder_database -eq "staging_schema_build") "Unexpected disposable builder database identity."
  Require ($Plan.production_accessed -eq $false -and $Plan.provider_accessed -eq $false -and $Plan.data_exported -eq $false) "Role schema replay plan accessed a forbidden external surface."
  Require ($Plan.database_connection_used -eq $false -and $Plan.database_mutation -eq $false -and $Plan.grant_mutation -eq $false) "Role schema replay planner must remain offline and non-mutating."
  Require ($Plan.hostinger_mutation -eq $false -and $Plan.cloudflare_mutation -eq $false -and $Plan.secrets_included -eq $false) "Role schema replay plan safety metadata is not fail-closed."
  foreach ($role in @("runtime", "governance", "runtime_persistence")) {
    Require ($null -ne $Plan.roles.$role) "Role schema replay plan is missing role: $role"
    Require (@($Plan.roles.$role.expected_objects).Count -gt 0) "Role schema replay plan has no expected objects for: $role"
  }
}

Require (Test-Path -LiteralPath $DumpDirectory -PathType Container) "DumpDirectory must be an existing local directory."
Require (Test-Path -LiteralPath $BundleManifestPath -PathType Leaf) "Schema bundle manifest is missing."
Require (Test-Path -LiteralPath $RoleManifestPath -PathType Leaf) "Canonical Staging role manifest is missing."
Require (Test-Path -LiteralPath $PlannerPath -PathType Leaf) "Role schema replay planner is missing."
Require (Test-Path -LiteralPath $LegacyImporterPath -PathType Leaf) "Verified legacy Staging importer is missing."
Require (-not ($DumpDirectory -match '(?i)(auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com|hostinger|production)')) "Production/provider paths are forbidden as dump sources."
Require-Command "node"
Require-Command "powershell.exe"

$plannerArgs = @(
  $PlannerPath,
  "--dump-directory", $DumpDirectory,
  "--role-manifest", $RoleManifestPath,
  "--bundle-manifest", $BundleManifestPath,
  "--expected-commit", $ExpectedCommit,
  "--plan"
)
$plan = Invoke-NodeJson $plannerArgs "Role schema replay plan"
Assert-ReplayPlan $plan
$plan | ConvertTo-Json -Depth 20

$legacyArgs = @(
  "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", $LegacyImporterPath,
  "-DumpDirectory", $DumpDirectory,
  "-ExpectedCommit", $ExpectedCommit,
  "-Mode", $Mode
)
if ($AllowSanitizedData.IsPresent) { $legacyArgs += "-AllowSanitizedData" }

if (-not $Apply.IsPresent) {
  & powershell.exe @legacyArgs
  if ($LASTEXITCODE -ne 0) { Fail "Verified legacy Staging importer dry-run failed." }
  Write-Host "ROLE_SCHEMA_REPLAY_PLAN_VALIDATED: plan_sha256=$($plan.plan_sha256) cross_role_views=$($plan.excluded_cross_role_view_count)"
  exit 0
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "mad4b-staging-role-replay-$PID-$([guid]::NewGuid().ToString('N'))"
$preparedStatePath = Join-Path $tempRoot "schema-import-state.json"
try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  $prepareArgs = @(
    $PlannerPath,
    "--dump-directory", $DumpDirectory,
    "--role-manifest", $RoleManifestPath,
    "--bundle-manifest", $BundleManifestPath,
    "--expected-commit", $ExpectedCommit,
    "--output-directory", $tempRoot
  )
  $prepared = Invoke-NodeJson $prepareArgs "Role schema replay preparation"
  Assert-ReplayPlan $prepared
  Require ([string]$prepared.plan_sha256 -eq [string]$plan.plan_sha256) "Role schema replay plan changed between validation and preparation."
  Require (Test-Path -LiteralPath ([string]$prepared.prepared_manifest_file) -PathType Leaf) "Prepared schema bundle manifest is missing."
  foreach ($role in @("runtime", "governance", "runtime_persistence")) {
    Require (Test-Path -LiteralPath ([string]$prepared.roles.$role.output_file) -PathType Leaf) "Prepared role bundle is missing: $role"
  }

  $plan | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReplayEvidencePath -Encoding utf8
  $applyArgs = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $LegacyImporterPath,
    "-DumpDirectory", $tempRoot,
    "-ExpectedCommit", $ExpectedCommit,
    "-Mode", $Mode,
    "-Apply"
  )
  if ($AllowSanitizedData.IsPresent) { $applyArgs += "-AllowSanitizedData" }
  & powershell.exe @applyArgs
  $legacyExitCode = $LASTEXITCODE
  if (Test-Path -LiteralPath $preparedStatePath -PathType Leaf) {
    Copy-Item -LiteralPath $preparedStatePath -Destination $RecoveryStatePath -Force
  }
  if ($legacyExitCode -ne 0) { Fail "Verified legacy Staging importer failed after role-aware replay preparation." }
  Require (Test-Path -LiteralPath $RecoveryStatePath -PathType Leaf) "Schema import state was not returned to the canonical dump directory."
  $completedState = Get-Content -Raw -LiteralPath $RecoveryStatePath | ConvertFrom-Json
  Require ([string]$completedState.status -eq "completed") "Prepared schema import did not complete."
  Write-Host "ROLE_SCHEMA_REPLAY_COMPLETED: plan_sha256=$($plan.plan_sha256) cross_role_views=$($plan.excluded_cross_role_view_count)"
} finally {
  if (Test-Path -LiteralPath $preparedStatePath -PathType Leaf) {
    try { Copy-Item -LiteralPath $preparedStatePath -Destination $RecoveryStatePath -Force } catch { }
  }
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
