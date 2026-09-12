[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [ValidatePattern('^[0-9a-fA-F]{40}$')] [string]$ExpectedCommit,
  [switch]$Apply,
  [string]$ApprovalConfirmation = "",
  [string]$VerifiedRequestFile = "",
  [string]$RebuildConfirmation = "",
  [string]$AuthorityUrl = "https://activation-dev.mad4b.com",
  [string]$CorrelationId = "",
  [string]$EvidenceDirectory = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$api = Join-Path $repo "http-generic-api"
$envFile = Join-Path $api ".env.staging"
$builder = Join-Path $api "scripts\build-staging-schema-bundle.mjs"
$classifier = Join-Path $api "scripts\classify-staging-empty-role-census.mjs"
$inspectionPreparer = Join-Path $api "scripts\prepare-staging-rebuild-empty-inspection.mjs"
$verifiedRunner = Join-Path $api "scripts\host-breakglass-local-verified.mjs"
$bundleManifest = Join-Path $PSScriptRoot "staging-db-dumps\staging-schema-bundle-manifest.json"
$compose = @("-f", (Join-Path $api "docker-compose.yml"), "-f", (Join-Path $api "docker-compose.staging.yml"), "--env-file", $envFile)
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) { $EvidenceDirectory = Join-Path $PSScriptRoot "logs\rebuild-empty" }
if ([string]::IsNullOrWhiteSpace($CorrelationId)) { $CorrelationId = "staging-rebuild-empty-$([Guid]::NewGuid().ToString('N'))" }

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
function Save-Json([string]$Path, $Value) {
  $parent = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Value | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $Path -Encoding UTF8
}
function Invoke-Authority([string]$Path, $Body, [string]$ApiKey) {
  $uri = "$($AuthorityUrl.TrimEnd('/'))$Path"
  try {
    return Invoke-RestMethod -Method Post -Uri $uri -Headers @{ "x-api-key" = $ApiKey; "x-request-id" = $CorrelationId } -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 32 -Compress) -TimeoutSec 30
  } catch {
    $detail = $_.ErrorDetails.Message
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $_.Exception.Message }
    Fail "Staging authority rejected or could not process $Path : $detail"
  }
}
function Invoke-RecoverySystemTool([string]$Name, $Arguments, [string]$ApiKey) {
  $body = [ordered]@{ name = $Name; tool_args = $Arguments }
  return Invoke-Authority "/admin/system/tools/call" $body $ApiKey
}

Require (Test-Path -LiteralPath $envFile -PathType Leaf) "Local .env.staging is missing"
foreach ($file in @($builder, $classifier, $inspectionPreparer, $verifiedRunner)) { Require (Test-Path -LiteralPath $file -PathType Leaf) "Required canonical bootstrap component is missing: $file" }
foreach ($command in @("git", "node", "docker")) { Require ($null -ne (Get-Command $command -ErrorAction SilentlyContinue)) "Required command is missing: $command" }
Require (-not $env:DOCKER_HOST -and -not $env:DOCKER_CONTEXT) "Remote Docker context overrides are forbidden"
Require ((Native-Text "docker" @("context", "show")) -in @("default", "desktop-linux")) "Docker context is not local"
Require (-not [string]::IsNullOrWhiteSpace((Native-Text "docker" @("info", "--format", "{{.ServerVersion}}")))) "Local Docker daemon is unavailable"
Require ((Native-Text "git" @("-C", $repo, "rev-parse", "HEAD")).ToLowerInvariant() -eq $ExpectedCommit) "Exact checkout commit mismatch"
Require ([string]::IsNullOrWhiteSpace((Native-Text "git" @("-C", $repo, "status", "--porcelain", "--untracked-files=no")))) "Tracked working tree is dirty"
Require ((Native-Text "git" @("-C", $repo, "remote", "get-url", "origin")) -match 'github\.com[:/]mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os(?:\.git)?$') "Repository origin mismatch"
foreach ($key in @("MIGRATION_APPLIED", "DATABASE_MUTATED", "PRODUCTION_MUTATION_AUTHORIZED", "RULESET_MUTATION_AUTHORIZED")) { Require ((Read-Env $key) -ceq "false") "$key must be false" }
Require ([string]::IsNullOrWhiteSpace($RebuildConfirmation)) "Legacy REBUILD_EMPTY_LOCAL_STAGING_DATABASES confirmation is retired; server-issued Recovery approval/ticket authority is required"
Require ($AuthorityUrl -match '^https://activation-dev\.mad4b\.com/?$') "Rebuild-empty authority must remain activation-dev.mad4b.com"

& docker compose @compose config --quiet
Require ($LASTEXITCODE -eq 0) "Local Staging Compose model is invalid"

if ($Apply -and -not [string]::IsNullOrWhiteSpace($VerifiedRequestFile)) {
  $verifiedPath = [IO.Path]::GetFullPath($VerifiedRequestFile)
  Require (Test-Path -LiteralPath $verifiedPath -PathType Leaf) "Verified local request file is missing"
  $remoteLine = Native-Text "git" @("-C", $repo, "-c", "protocol.version=0", "-c", "http.version=HTTP/1.1", "ls-remote", "origin", "refs/heads/main")
  Require ((($remoteLine -split '\s+')[0]).ToLowerInvariant() -eq $ExpectedCommit) "origin/main moved away from the exact approved checkout"
  & node $verifiedRunner --request-file $verifiedPath --env-file $envFile
  Require ($LASTEXITCODE -eq 0) "Governed selective rebuild execution failed or requires reconciliation"
  Write-Host "STAGING_REBUILD_EMPTY_SCHEMA_READY: commit=$ExpectedCommit grants=not_applied runtime_certification=not_asserted gateway_apply_certification=pending next_action=database.access_repair"
  exit 0
}
if ($Apply -and [string]::IsNullOrWhiteSpace($VerifiedRequestFile) -and [string]::IsNullOrWhiteSpace($ApprovalConfirmation)) {
  Fail "-Apply requires either a server-issued -VerifiedRequestFile or the exact -ApprovalConfirmation returned by Recovery prepare"
}

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
  $password = Read-Env $role.root
  $exists = (& docker compose @compose exec -T -e "MYSQL_PWD=$password" $role.service mariadb --protocol=socket -uroot --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=$literal" | Out-String).Trim()
  Require ($LASTEXITCODE -eq 0 -and $exists -ceq "1") "Role database is missing: $($role.key)"
  $query = "SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=$literal AND TABLE_TYPE='BASE TABLE'),(SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA=$literal),(SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=$literal),(SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=$literal),(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=$literal)"
  $raw = (& docker compose @compose exec -T -e "MYSQL_PWD=$password" $role.service mariadb --protocol=socket -uroot --batch --skip-column-names -e $query | Out-String).Trim()
  Require ($LASTEXITCODE -eq 0 -and $raw -match '^\d+\t\d+\t\d+\t\d+\t\d+$') "Root object-kind census failed: $($role.key)"
  $parts = $raw -split "`t"
  $counts = [ordered]@{ tables = [int]$parts[0]; views = [int]$parts[1]; triggers = [int]$parts[2]; routines = [int]$parts[3]; events = [int]$parts[4] }
  $total = [int]($counts.tables + $counts.views + $counts.triggers + $counts.routines + $counts.events)
  $census += [pscustomobject]@{ role = $role.key; object_count = $total; object_counts = [ordered]@{ tables = $counts.tables; views = $counts.views; triggers = $counts.triggers; routines = $counts.routines; events = $counts.events; total = $total } }
}

$censusJson = ConvertTo-Json -InputObject $census -Depth 8 -Compress
$classificationJson = (& node $classifier --census-json $censusJson | Out-String).Trim()
Require ($LASTEXITCODE -eq 0) "No zero-object role is eligible for governed rebuild_empty"
$classification = $classificationJson | ConvertFrom-Json
Require ($classification.candidate_for_governed_rebuild_empty -eq $true -and $classification.ready_for_local_mutation -eq $false -and $classification.role_selection_authoritative -eq $false) "Local census must remain non-authoritative and mutation-disabled"

& node $builder --expected-commit $ExpectedCommit --plan
Require ($LASTEXITCODE -eq 0) "Canonical role schema bundle plan failed"
& node $builder --expected-commit $ExpectedCommit --confirm BUILD_STAGING_SCHEMA_BUNDLE
Require ($LASTEXITCODE -eq 0) "Canonical schema bundle build failed"
Require (Test-Path -LiteralPath $bundleManifest -PathType Leaf) "Canonical generated schema-bundle manifest is missing"

$inspectionJson = (& node $inspectionPreparer --expected-commit $ExpectedCommit --correlation-id $CorrelationId --census-json $censusJson --manifest $bundleManifest --env-file $envFile | Out-String).Trim()
Require ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($inspectionJson)) "Governed inspection evidence preparation failed"
$inspectionEnvelope = $inspectionJson | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$inspectionPath = Join-Path $EvidenceDirectory "inspection-$CorrelationId.json"
Save-Json $inspectionPath $inspectionEnvelope

$apiKey = Read-Env "BACKEND_API_KEY"
Require (-not [string]::IsNullOrWhiteSpace($apiKey)) "Existing BACKEND_API_KEY is required for private Staging Recovery authority"
$inspectionReceipt = Invoke-RecoverySystemTool "staging_recovery_rebuild_empty_inspection_record" $inspectionEnvelope $apiKey
Require ($inspectionReceipt.status -ceq "durable_full_inspection_recorded" -and $inspectionReceipt.role_selection_authoritative -eq $true -and $inspectionReceipt.database_mutation_performed -eq $false) "Recovery authority did not durably authorize selected zero-object roles"

$prepareInput = [ordered]@{ expected_sha = $ExpectedCommit; inspection_run_id = $inspectionReceipt.inspection_run_id; idempotency_key = $CorrelationId }
$prepareReceipt = Invoke-RecoverySystemTool "staging_recovery_rebuild_empty_prepare" $prepareInput $apiKey
Require ($prepareReceipt.status -in @("approval_required", "execution_ticket_already_issued") -and $prepareReceipt.database_mutation_performed -eq $false) "Staging rebuild plan did not remain inside the Recovery approval lifecycle"
$preparePath = Join-Path $EvidenceDirectory "prepare-$CorrelationId.json"
Save-Json $preparePath $prepareReceipt

if ([string]::IsNullOrWhiteSpace($ApprovalConfirmation)) {
  Write-Host "STAGING_REBUILD_EMPTY_APPROVAL_REQUIRED: commit=$ExpectedCommit inspection_run_id=$($inspectionReceipt.inspection_run_id) selected_roles=$([string]::Join(',', $inspectionReceipt.selected_zero_object_roles)) preserved_roles=$([string]::Join(',', $inspectionReceipt.preserved_nonempty_roles))"
  Write-Host "approval_confirmation=$($prepareReceipt.approval_confirmation)"
  Write-Host "prepare_receipt=$preparePath"
  Write-Host "database_mutation=false grants=not_applied"
  exit 0
}

Require ($ApprovalConfirmation -ceq $prepareReceipt.approval_confirmation) "Approval confirmation does not match the exact Recovery plan/step/SHA/role selection"
$approveInput = [ordered]@{
  plan_id = $prepareReceipt.plan_id
  authority_plan_hash = $prepareReceipt.authority_plan_hash
  step_id = $prepareReceipt.step_id
  idempotency_key = $CorrelationId
  approval_confirmation = $ApprovalConfirmation
}
$approvalReceipt = Invoke-RecoverySystemTool "staging_recovery_rebuild_empty_approve" $approveInput $apiKey
Require ($approvalReceipt.status -ceq "execution_ticket_issued_local_handoff_ready" -and $approvalReceipt.local_handoff.verified_request -and $approvalReceipt.database_mutation_performed -eq $false) "Recovery authority did not issue the verified local selective rebuild handoff"
$verifiedPath = Join-Path $EvidenceDirectory $approvalReceipt.local_handoff.request_file_name
Save-Json $verifiedPath $approvalReceipt.local_handoff.verified_request
Write-Host "STAGING_REBUILD_EMPTY_VERIFIED_HANDOFF_READY: commit=$ExpectedCommit selected_roles=$([string]::Join(',', $approvalReceipt.selected_zero_object_roles)) preserved_roles=$([string]::Join(',', $approvalReceipt.preserved_nonempty_roles)) request=$verifiedPath mutation=false"

if ($Apply) {
  $remoteLine = Native-Text "git" @("-C", $repo, "-c", "protocol.version=0", "-c", "http.version=HTTP/1.1", "ls-remote", "origin", "refs/heads/main")
  Require ((($remoteLine -split '\s+')[0]).ToLowerInvariant() -eq $ExpectedCommit) "origin/main moved away from the exact approved checkout"
  & node $verifiedRunner --request-file $verifiedPath --env-file $envFile
  Require ($LASTEXITCODE -eq 0) "Governed selective rebuild execution failed or requires reconciliation"
  Write-Host "STAGING_REBUILD_EMPTY_SCHEMA_READY: commit=$ExpectedCommit grants=not_applied runtime_certification=not_asserted gateway_apply_certification=pending next_action=database.access_repair"
}
