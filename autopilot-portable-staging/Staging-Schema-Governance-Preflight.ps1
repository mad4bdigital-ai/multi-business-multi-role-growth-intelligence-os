param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedCommit,

    [string]$ReportPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath($RepositoryPath)
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
$logsRoot = Join-Path $scriptRoot "logs"
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $logsRoot "staging-schema-governance-preflight.json"
}
$ReportPath = [IO.Path]::GetFullPath($ReportPath)

$report = [ordered]@{
    contract = "mad4b.staging.schema-governance-preflight.v1"
    status = "running"
    expected_commit = $ExpectedCommit
    observed_commit = $null
    checks = [ordered]@{}
    safety = [ordered]@{
        read_only = $true
        schema_bundle_applied = $false
        database_mutation = $false
        migration_apply = $false
        production_access = $false
        provider_access = $false
        data_export = $false
        credential_access = $false
        secrets_included = $false
        tunnel_started = $false
        auto_deploy_installed = $false
    }
    generated_at = $null
    error = $null
}

function Write-PreflightReport {
    $report.generated_at = (Get-Date).ToUniversalTime().ToString("o")
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding utf8
}

function Fail([string]$Message) {
    $safe = $Message -replace '(?i)(TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*[^\s,;]+', '$1=REDACTED'
    $report.status = "blocked"
    $report.error = $safe
    try { Write-PreflightReport } catch { }
    throw "STAGING_SCHEMA_GOVERNANCE_PREFLIGHT_FAIL_CLOSED: $safe"
}

function Require-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { Fail $Message }
}

function Get-PropertyValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Invoke-GitText([string[]]$Arguments) {
    $output = & git @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "Git read failed: $($Arguments -join ' ')" }
    return (($output | Out-String).Trim())
}

function Invoke-NodeJson([string]$ScriptPath, [string[]]$Arguments) {
    $stdoutPath = Join-Path ([IO.Path]::GetTempPath()) ("staging-preflight-{0}.stdout" -f ([guid]::NewGuid().ToString("N")))
    $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ("staging-preflight-{0}.stderr" -f ([guid]::NewGuid().ToString("N")))
    try {
        & $nodeCommand.Source $ScriptPath @Arguments 1> $stdoutPath 2> $stderrPath
        $exitCode = $LASTEXITCODE
        $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -Raw -LiteralPath $stdoutPath } else { "" }
        $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { "" }
        if ($exitCode -ne 0) {
            $detail = (($stderr + " " + $stdout).Trim() -replace '(?i)(TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*[^\s,;]+', '$1=REDACTED')
            Fail "Static Node check failed: $([IO.Path]::GetFileName($ScriptPath)) ($detail)"
        }
        try { return ($stdout | ConvertFrom-Json) }
        catch { Fail "Static Node check returned invalid JSON: $([IO.Path]::GetFileName($ScriptPath))" }
    } finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-NodeCheck([string]$ScriptPath, [string[]]$Arguments, [switch]$NodeTest) {
    $stdoutPath = Join-Path ([IO.Path]::GetTempPath()) ("staging-preflight-{0}.stdout" -f ([guid]::NewGuid().ToString("N")))
    $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ("staging-preflight-{0}.stderr" -f ([guid]::NewGuid().ToString("N")))
    try {
        $nodeArguments = @()
        if ($NodeTest) { $nodeArguments += "--test" }
        $nodeArguments += $ScriptPath
        $nodeArguments += $Arguments
        & $nodeCommand.Source @nodeArguments 1> $stdoutPath 2> $stderrPath
        $exitCode = $LASTEXITCODE
        $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { "" }
        $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -Raw -LiteralPath $stdoutPath } else { "" }
        if ($exitCode -ne 0) {
            $detail = (($stderr + " " + $stdout).Trim() -replace '(?i)(TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*[^\s,;]+', '$1=REDACTED')
            Fail "Static Node contract failed: $([IO.Path]::GetFileName($ScriptPath)) ($detail)"
        }
        return [ordered]@{
            passed = $true
            script = [IO.Path]::GetFileName($ScriptPath)
            output_tail = (($stdout | Out-String).Trim() | ForEach-Object { if ($_.Length -gt 1200) { $_.Substring($_.Length - 1200) } else { $_ } })
        }
    } finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

try {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { Fail "Required command is missing: node.exe" }
    $nodeVersion = (& $nodeCommand.Source --version 2>$null | Out-String).Trim()
    Require-Condition ($LASTEXITCODE -eq 0 -and $nodeVersion -match '^v22\.') "Node.js 22.x is required for the portable Staging preflight"
    $report.checks.node = [ordered]@{ version = $nodeVersion; major_contract = "22.x" }

    Require-Condition (Test-Path -LiteralPath (Join-Path $repoRoot ".git")) "RepositoryPath is not a Git repository"
    Push-Location $repoRoot
    try {
        $observedCommit = Invoke-GitText @("rev-parse", "HEAD").ToLowerInvariant()
        $report.observed_commit = $observedCommit
        Require-Condition ($observedCommit -eq $ExpectedCommit) "Repository HEAD does not match the expected exact commit"
        $dirty = Invoke-GitText @("status", "--porcelain", "--untracked-files=all")
        Require-Condition ([string]::IsNullOrWhiteSpace($dirty)) "Working tree is not clean; static schema preflight refuses to continue"
        $origin = Invoke-GitText @("config", "--get", "remote.origin.url")
        Require-Condition ($origin -match "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os") "Repository origin identity mismatch"
        $baseCommit = Invoke-GitText @("rev-parse", "HEAD^1").ToLowerInvariant()
    } finally {
        Pop-Location
    }
    $report.checks.repository = [ordered]@{
        exact_commit = $true
        clean_worktree = $true
        origin_identity = $true
        base_commit = $baseCommit
    }

    foreach ($name in @("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")) {
        Require-Condition ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) "$name must be unset for local Docker-only Staging"
    }
    $report.checks.docker_environment = [ordered]@{
        local_only = $true
        forbidden_remote_environment_variables = @("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")
    }

    Push-Location $repoRoot
    try {
        $builderPath = Join-Path $repoRoot "http-generic-api/scripts/build-staging-schema-bundle.mjs"
        $plan = Invoke-NodeJson $builderPath @("--expected-commit", $ExpectedCommit, "--plan")
        $migrationGovernancePath = Join-Path $repoRoot "http-generic-api/scripts/migration-contract-governance.mjs"
        $migrationReportPath = Join-Path $logsRoot "staging-migration-contract-governance.json"
        $migrationSummary = Invoke-NodeJson $migrationGovernancePath @("--root", $repoRoot, "--expected-commit", $ExpectedCommit, "--output", $migrationReportPath)
        $migrationReport = Get-Content -Raw -LiteralPath $migrationReportPath | ConvertFrom-Json
        $schemaRegressionPath = Join-Path $repoRoot "http-generic-api/test-staging-schema-bundle-builder.mjs"
        $schemaRegression = Invoke-NodeCheck $schemaRegressionPath @() -NodeTest
        $contractTestPath = Join-Path $repoRoot "http-generic-api/test-staging-one-click-autopilot-contract.mjs"
        $contractTest = Invoke-NodeCheck $contractTestPath @()
    } finally {
        Pop-Location
    }

    Require-Condition ((Get-PropertyValue $plan "expected_commit") -eq $ExpectedCommit) "Schema plan expected commit mismatch"
    Require-Condition ((Get-PropertyValue $plan "plan_only") -eq $true) "Schema builder did not remain plan-only"
    Require-Condition ((Get-PropertyValue $plan "production_access_forbidden") -eq $true) "Schema plan does not forbid Production access"
    Require-Condition ((Get-PropertyValue $plan "provider_access_forbidden") -eq $true) "Schema plan does not forbid provider access"
    Require-Condition ((Get-PropertyValue $plan "confirmation_required") -eq "BUILD_STAGING_SCHEMA_BUNDLE") "Schema confirmation contract drifted"

    $preuse = Get-PropertyValue $plan "ordered_preuse_audit"
    Require-Condition ((Get-PropertyValue $preuse "missing_table_gaps") -eq 0 -and (Get-PropertyValue $preuse "missing_column_gaps") -eq 0 -and (Get-PropertyValue $preuse "unique_true_preuse_gaps") -eq 0) "Ordered schema pre-use audit reports unresolved gaps"
    Require-Condition ((Get-PropertyValue $preuse "view_column_references_checked") -gt 0 -and (Get-PropertyValue $preuse "insert_arity_checks") -gt 0 -and (Get-PropertyValue $preuse "insert_arity_mismatches") -eq 0 -and (Get-PropertyValue $preuse "update_target_column_checks") -gt 0 -and (Get-PropertyValue $preuse "update_target_column_missing_columns") -eq 0) "Ordered schema pre-use audit is incomplete or reports arity/target-column findings"
    $bootstrap = Get-PropertyValue $plan "canonical_table_bootstrap"
    Require-Condition ((Get-PropertyValue $bootstrap "unresolved_missing_table_gaps") -eq 0) "Canonical table bootstrap reports unresolved missing tables"

    $guardNames = @(
        "ordered_collation_chain",
        "ordered_enum_seed_chain",
        "ordered_text_width_chain",
        "ordered_index_key_width_chain",
        "ordered_required_insert_column_chain",
        "ordered_generated_column_chain",
        "ordered_foreign_key_compatibility_chain"
    )
    $guardEvidence = [ordered]@{}
    foreach ($guardName in $guardNames) {
        $guard = Get-PropertyValue $plan $guardName
        Require-Condition ((Get-PropertyValue $guard "ok") -eq $true -and (Get-PropertyValue $guard "ready") -eq $true -and (Get-PropertyValue $guard "finding_count") -eq 0) "$guardName is not ready or reports findings"
        foreach ($safetyName in @("database_connection_performed", "sql_mutation_performed", "provider_mutation_performed", "credential_access_performed", "data_export_performed", "runtime_mutation_performed", "secrets_included")) {
            Require-Condition ((Get-PropertyValue $guard $safetyName) -eq $false) "$guardName violated static-only safety: $safetyName"
        }
        $guardEvidence[$guardName] = [ordered]@{
            ok = $true
            ready = $true
            finding_count = 0
            files_checked = Get-PropertyValue $guard "files_checked"
            statements_checked = Get-PropertyValue $guard "statements_checked"
        }
    }

    $report.checks.schema_plan = [ordered]@{
        contract = Get-PropertyValue $plan "contract"
        expected_commit = Get-PropertyValue $plan "expected_commit"
        plan_only = Get-PropertyValue $plan "plan_only"
        migration_count = Get-PropertyValue $plan "migration_count"
        statement_count = Get-PropertyValue $plan "statement_count"
        confirmation_required = Get-PropertyValue $plan "confirmation_required"
        ordered_preuse_audit = [ordered]@{
            missing_table_gaps = Get-PropertyValue $preuse "missing_table_gaps"
            missing_column_gaps = Get-PropertyValue $preuse "missing_column_gaps"
            unique_true_preuse_gaps = Get-PropertyValue $preuse "unique_true_preuse_gaps"
            view_column_references_checked = Get-PropertyValue $preuse "view_column_references_checked"
            insert_arity_checks = Get-PropertyValue $preuse "insert_arity_checks"
            insert_arity_mismatches = Get-PropertyValue $preuse "insert_arity_mismatches"
            update_target_column_checks = Get-PropertyValue $preuse "update_target_column_checks"
            update_target_column_missing_columns = Get-PropertyValue $preuse "update_target_column_missing_columns"
        }
        canonical_table_bootstrap = [ordered]@{
            unresolved_missing_table_gaps = Get-PropertyValue $bootstrap "unresolved_missing_table_gaps"
            resolved_missing_table_gaps = Get-PropertyValue $bootstrap "resolved_missing_table_gaps"
            entry_count = Get-PropertyValue $bootstrap "entry_count"
        }
        guards = $guardEvidence
        production_access_forbidden = Get-PropertyValue $plan "production_access_forbidden"
        provider_access_forbidden = Get-PropertyValue $plan "provider_access_forbidden"
    }

    Require-Condition ((Get-PropertyValue $migrationSummary "source_commit") -eq $ExpectedCommit) "Migration governance source commit mismatch"
    Require-Condition ((Get-PropertyValue (Get-PropertyValue $migrationSummary "summary") "ok") -eq $true) "Migration governance summary is not OK"
    Require-Condition ((Get-PropertyValue (Get-PropertyValue $migrationSummary "summary") "blockers") -eq 0) "Migration governance reports blockers"
    Require-Condition ((Get-PropertyValue (Get-PropertyValue $migrationSummary "summary") "reviews") -eq 0) "Migration governance reports review findings"
    foreach ($safetyName in @("database_connection_performed", "database_mutation_performed", "provider_access_performed", "credential_access_performed", "data_export_performed", "runtime_mutation_performed", "secrets_included")) {
        Require-Condition ((Get-PropertyValue $migrationReport "safety").$safetyName -eq $false) "Migration governance violated static-only safety: $safetyName"
    }
    $report.checks.migration_governance = [ordered]@{
        source_commit = Get-PropertyValue $migrationSummary "source_commit"
        summary_ok = $true
        blockers = 0
        reviews = 0
        safety_read_only = $true
        report_path = "logs/staging-migration-contract-governance.json"
    }
    $report.checks.static_regressions = [ordered]@{
        schema_bundle_builder = $schemaRegression
        launcher_contract = $contractTest
    }

    $environmentReportPath = Join-Path $logsRoot "staging-environment-impact-closure.json"
    Push-Location $repoRoot
    try {
        $environmentSummary = Invoke-NodeJson (Join-Path $repoRoot "http-generic-api/scripts/environment-impact-closure.mjs") @("--base-sha", $baseCommit, "--head-sha", $ExpectedCommit, "--report-file", $environmentReportPath)
    } finally {
        Pop-Location
    }
    Require-Condition ((Get-PropertyValue $environmentSummary "converged") -eq $true) "Environment impact closure is not converged for this exact commit"
    $environmentReport = Get-Content -Raw -LiteralPath $environmentReportPath | ConvertFrom-Json
    Require-Condition ((Get-PropertyValue $environmentReport "safety").read_only -eq $true -and (Get-PropertyValue $environmentReport "safety").database_mutation -eq $false -and (Get-PropertyValue $environmentReport "safety").provider_mutation -eq $false -and (Get-PropertyValue $environmentReport "safety").production_deploy -eq $false -and (Get-PropertyValue $environmentReport "safety").secrets_included -eq $false) "Environment impact closure violated local-only safety"
    $report.checks.environment_impact = [ordered]@{
        converged = $true
        issue_count = Get-PropertyValue $environmentSummary "issue_count"
        changed_path_count = Get-PropertyValue $environmentSummary "changed_path_count"
        base_commit = $baseCommit
        head_commit = $ExpectedCommit
        report_path = "logs/staging-environment-impact-closure.json"
    }

    $report.status = "passed"
    Write-PreflightReport
    Write-Output (ConvertTo-Json ([ordered]@{
        contract = $report.contract
        status = $report.status
        expected_commit = $ExpectedCommit
        report_path = $ReportPath
        schema_plan_only = $report.checks.schema_plan.plan_only
        migration_governance_ok = $report.checks.migration_governance.summary_ok
        environment_impact_converged = $report.checks.environment_impact.converged
        schema_bundle_applied = $report.safety.schema_bundle_applied
        database_mutation = $report.safety.database_mutation
        production_access = $report.safety.production_access
        provider_access = $report.safety.provider_access
        tunnel_started = $report.safety.tunnel_started
        auto_deploy_installed = $report.safety.auto_deploy_installed
    }) -Depth 8)
    exit 0
} catch {
    if ($_.Exception.Message -like "STAGING_SCHEMA_GOVERNANCE_PREFLIGHT_FAIL_CLOSED:*") { throw }
    Fail $_.Exception.Message
}
