import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const packageRoot = path.join(root, "autopilot-portable-staging");
const launcher = fs.readFileSync(path.join(packageRoot, "One-Click-Staging.ps1"), "utf8");
const bootstrap = fs.readFileSync(path.join(packageRoot, "Bootstrap-Staging-One-Click.ps1"), "utf8");
const startAutoPilot = fs.readFileSync(path.join(packageRoot, "Start-AutoPilot.ps1"), "utf8");
const certification = fs.readFileSync(path.join(packageRoot, "Invoke-StagingCertification.ps1"), "utf8");
const autoDeploy = fs.readFileSync(path.join(packageRoot, "Auto-Deploy-Staging.ps1"), "utf8");
const installAutoDeploy = fs.readFileSync(path.join(packageRoot, "Install-AutoDeployTask.ps1"), "utf8");
const windowsPreflight = fs.readFileSync(path.join(packageRoot, "Staging-Windows-Preflight.ps1"), "utf8");
const gitSafety = fs.readFileSync(path.join(packageRoot, "Staging-GitSafety.ps1"), "utf8");
const gitTransport = fs.readFileSync(path.join(packageRoot, "Staging-GitTransport.ps1"), "utf8");
const cmd = fs.readFileSync(path.join(packageRoot, "Start-Staging-One-Click.cmd"), "utf8");
const schemaPreflight = fs.readFileSync(path.join(packageRoot, "Staging-Schema-Governance-Preflight.ps1"), "utf8");
const portableManifestGenerator = fs.readFileSync(path.join(root, "http-generic-api/scripts/generate-portable-staging-manifest.mjs"), "utf8");
const portableManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "manifest.json"), "utf8"));
const policy = JSON.parse(fs.readFileSync(path.join(packageRoot, "autopilot-one-click-policy.json"), "utf8"));
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

assert.equal(policy.contract, "mad4b.staging-one-click-autopilot.v1");
assert.equal(policy.ref, "main");
assert.equal(policy.requires_exact_commit, true);
assert.equal(policy.requires_ci_eligibility, true);
assert.deepEqual(policy.allowed_staging_hosts, ["dev.mad4b.com", "mcp_dev.mad4b.com", "activation-dev.mad4b.com"]);
assert.deepEqual(policy.forbidden_hosts, ["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com"]);
assert.equal(policy.database_seed.default_mode, "schema_only_dry_run_if_local_bundle_exists");
assert.equal(policy.database_seed.apply_requires_explicit_switch, true);
assert.equal(policy.database_seed.apply_switch, "ApplySchemaBundle");
assert.equal(policy.database_seed.migration_apply, false);
assert.equal(policy.database_seed.production_database_access, false);
assert.equal(policy.lifecycle.schema_import.required_runtime_registry_table_count, 18);
assert.deepEqual(policy.lifecycle.schema_import.required_runtime_support_tables, ["connected_systems", "admin_platform_endpoint_tools", "tenant_platform_endpoint_tools", "customer_sessions", "gpt_session_turns"]);
assert.equal(policy.lifecycle.canonical_seeds.contract, "mad4b.staging.canonical-seed-manifest.v1");
assert.deepEqual(policy.lifecycle.canonical_seeds.seed_files, [
  "039_sprint43_data_integrity_and_missing_tables.sql",
  "1043_sprint69_dynamic_container_hvac_activity_seed.sql",
  "20260815_custom_gpt_mcp_catalog_levels.sql",
]);
assert.equal(policy.lifecycle.canonical_seeds.explicit_apply_only, true);
assert.equal(policy.lifecycle.canonical_seeds.readback_required, true);
assert.equal(policy.lifecycle.activation_readiness.stale_policy_blocks_activation, true);
assert.equal(policy.lifecycle.activation_readiness.schema_and_catalog_readiness_required, true);
assert.deepEqual(policy.safety, {
  production_deploy: false,
  hostinger_mutation: false,
  cloudflare_dns_mutation: false,
  database_mutation: false,
  migration_applied: false,
  provider_mutation: false,
  secrets_included: false,
});

assert.match(launcher, /Install-WingetPackage/);
assert.match(launcher, /GitHub\.cli/);
assert.match(launcher, /Docker\.DockerDesktop/);
assert.match(launcher, /wsl\.exe --install -d Ubuntu/);
assert.match(launcher, /Staging-Windows-Preflight\.ps1/);
assert.match(launcher, /Wait-StagingWsl2Distribution/);
assert.doesNotMatch(launcher, /function Test-Wsl2DistributionReady/);
assert.match(launcher, /Wait-StagingWsl2Distribution -Attempts 24 -DelaySeconds 5/);
assert.match(windowsPreflight, /-replace "\\x00", ""/);
assert.doesNotMatch(windowsPreflight, /\[char\]0/);
assert.match(launcher, /installExitCode/);
assert.match(windowsPreflight, /Start-Sleep -Seconds \$DelaySeconds/);
assert.doesNotMatch(launcher, /\$wslExitCode -eq 0 -and \(Test-Wsl2DistributionReady/);
assert.match(launcher, /auth", "login/);
assert.match(launcher, /Get-MainSha/);
assert.match(launcher, /Wait-Eligibility/);
assert.match(launcher, /Staging Main Deploy Eligibility/);
assert.match(launcher, /function Invoke-BootstrapSync/);
assert.match(launcher, /-SkipBootstrap/);
assert.match(launcher, /if \(-not \$SkipBootstrap\) \{ Invoke-BootstrapSync \$repo \}/);
assert.match(launcher, /InheritedRunLock/);
assert.match(launcher, /Assert-StagingOriginIdentity/);
assert.match(launcher, /ExpectedRepository/);
assert.match(launcher, /Start-AutoPilot\.ps1/);
assert.match(launcher, /Write-StagingUtf8NoBom/);
assert.match(launcher, /Start-AutoPilot\.ps1/);
assert.match(launcher, /Install-AutoDeployTask\.ps1/);
assert.match(bootstrap, /git.*fetch.*origin/s);
assert.match(bootstrap, /git.*checkout.*--detach/s);
assert.match(bootstrap, /Working tree is not clean/);
assert.match(bootstrap, /Quarantine-KnownBackupFiles/);
assert.match(bootstrap, /prepare-staging-build-context\.mjs/);
assert.match(bootstrap, /STAGING_BUILD_TREE/);
assert.match(bootstrap, /STAGING_BUILD_CONTEXT_FILE_SET_SHA256/);
assert.match(bootstrap, /-SkipBuild/);
assert.match(bootstrap, /-SkipBootstrap/);
assert.match(bootstrap, /InheritedRunLock/);
assert.match(bootstrap, /Assert-StagingOriginIdentity/);
assert.match(bootstrap, /Global\\Mad4bPortableStagingAutoPilot/);
assert.match(bootstrap, /Staging-Schema-Governance-Preflight\.ps1/);
assert.match(bootstrap, /Static schema\/governance preflight/);
assert.match(bootstrap, /-ExpectedCommit/);
assert.match(bootstrap, /-ReportPath/);
assert.ok(bootstrap.indexOf('Invoke-Git @("checkout", "--detach"') < bootstrap.indexOf('$preflightReportPath'));
assert.match(schemaPreflight, /--plan/);
assert.match(schemaPreflight, /migration-contract-governance\.mjs/);
assert.match(schemaPreflight, /environment-impact-closure\.mjs/);
assert.match(schemaPreflight, /test-staging-schema-bundle-builder\.mjs/);
assert.match(schemaPreflight, /test-staging-one-click-autopilot-contract\.mjs/);
assert.match(schemaPreflight, /ordered_preuse_audit/);
assert.match(schemaPreflight, /ordered_foreign_key_compatibility_chain/);
assert.match(schemaPreflight, /DOCKER_HOST/);
assert.match(schemaPreflight, /DOCKER_CONTEXT/);
assert.match(schemaPreflight, /schema_bundle_applied = \$false/);
assert.match(schemaPreflight, /tunnel_started = \$false/);
assert.match(schemaPreflight, /auto_deploy_installed = \$false/);
assert.doesNotMatch(schemaPreflight, /--confirm/);
assert.doesNotMatch(schemaPreflight, /ApplySchemaBundle/);
assert.doesNotMatch(schemaPreflight, /docker\s+compose/i);
assert.doesNotMatch(schemaPreflight, /Start-AutoPilot/i);
assert.doesNotMatch(schemaPreflight, /Auto-Deploy-Staging/i);
assert.doesNotMatch(schemaPreflight, /cloudflared/i);
assert.match(portableManifestGenerator, /Staging-Schema-Governance-Preflight\.ps1/);
assert.ok(portableManifest.files.some((entry) => entry.path === "autopilot-portable-staging/Staging-Schema-Governance-Preflight.ps1"));
assert.match(gitSafety, /ConvertTo-StagingRepositoryIdentity/);
assert.match(gitSafety, /STAGING_REPOSITORY_ORIGIN_MISMATCH/);
assert.match(gitSafety, /Write-StagingUtf8NoBom/);
assert.match(gitTransport, /protocol\.version=0/);
assert.match(gitTransport, /http\.version=HTTP\/1\.1/);
assert.match(gitTransport, /StagingGitMaxAttempts/);
assert.match(gitTransport, /connection was reset/);
assert.match(gitTransport, /empty reply from server/);
assert.match(gitTransport, /STAGING_GIT_OPERATION_FAILED/);
assert.match(gitTransport, /STAGING_GIT_RETRY/);
assert.match(gitTransport, /\$ErrorActionPreference = "Continue"/);
assert.match(gitTransport, /__staging_git_exit_marker/);
assert.match(gitTransport, /if \(\$lastExitCode -eq 0\)/);
assert.match(gitTransport, /STAGING_GIT_OPERATION_FAILED/);
assert.match(gitTransport, /remote: \|warning: \|hint: /);
assert.match(launcher, /Staging-GitTransport\.ps1/);
assert.match(bootstrap, /Staging-GitTransport\.ps1/);
assert.match(startAutoPilot, /Staging-GitTransport\.ps1/);
assert.match(autoDeploy, /Staging-GitTransport\.ps1/);
assert.match(launcher, /Clone-StagingDatabases\.ps1/);
assert.match(launcher, /Invoke-StagingCertification\.ps1/);
assert.match(launcher, /MIGRATION_APPLIED.*false/);
assert.match(launcher, /DATABASE_MUTATED.*false/);
assert.match(launcher, /RequireSchemaBundle/);
assert.match(launcher, /\[switch\]\$ApplySchemaBundle/);
assert.match(launcher, /if \(\$ApplySchemaBundle\) \{\s*\$cloneArgs \+= "-Apply"/s);
assert.match(launcher, /schema_only_dry_run/);
assert.match(launcher, /schema_only_applied/);
assert.match(launcher, /explicit Staging schema seed completed; re-certifying same exact commit/);
assert.match(launcher, /staging_schema_seed_applied = \$schemaSeedApplied/);
assert.match(launcher, /canonical_seed_status/);
assert.match(launcher, /canonical_seed_readback/);
assert.match(launcher, /Canonical seed\/readback evidence is incomplete/);
assert.match(launcher, /Activation Gateway cannot be enabled until schema\/catalog\/gateway readback is ready/);
assert.match(launcher, /gateway_policy_not_stale/);
assert.match(launcher, /database_mutated = \$schemaSeedApplied/);
assert.match(launcher, /certification_status = \[string\]\$runtimeState\.certification_status/);
assert.match(launcher, /AUTO_PILOT_ONE_CLICK_DEGRADED/);
assert.match(launcher, /AUTO_PILOT_ONE_CLICK_READY/);
assert.match(launcher, /if \(\$EnableActivationGateway\) \{ \$argList \+= "-EnableActivationGateway" \}/);
assert.match(launcher, /if \(\$ApplySchemaBundle\) \{ \$argList \+= "-ApplySchemaBundle" \}/);
assert.match(launcher, /CLOUDFLARE_TUNNEL_TOKEN/);
assert.match(launcher, /Read-Host "Staging Tunnel token" -AsSecureString/);
assert.ok(launcher.includes("https://dev.mad4b.com"));
assert.ok(launcher.includes("https://mcp_dev.mad4b.com"));
assert.doesNotMatch(launcher, /CLOUDFLARE_TUNNEL_HOSTNAMES.*auth\.mad4b\.com/);
assert.match(launcher, /activation-dev\.mad4b\.com/);
assert.match(launcher, /\[switch\]\$EnableActivationGateway/);
assert.match(launcher, /TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET/);
assert.match(launcher, /ACTIVATION_HOST_GATEWAY_HOST/);
assert.match(launcher, /ACTIVATION_STAGING_AUTH_HOST/);
assert.doesNotMatch(launcher, /CLOUDFLARE_TUNNEL_HOSTNAMES.*activation-dev\.mad4b\.com/);
assert.match(launcher, /AUTO_PILOT_ONE_CLICK_FAIL_CLOSED/);
assert.match(launcher, /Write-EarlyBootstrapLog/);
assert.match(launcher, /bootstrap-console\.log/);
assert.match(launcher, /staging environment initialized before prerequisite checks/);
assert.match(launcher, /if \(Test-Path \(Join-Path \$repo "\.git"\)\)/);
assert.match(launcher, /production_deploy = \$false/);
assert.match(launcher, /cloudflare_dns_mutation = \$false/);
assert.match(launcher, /hostinger_mutation = \$false/);
assert.match(startAutoPilot, /TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET/);
assert.match(startAutoPilot, /TENANT_GPT_STAGING_OAUTH_CLIENT_ID/);
assert.match(startAutoPilot, /TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED/);
assert.match(startAutoPilot, /Ensure-EnvDefault/);
assert.match(startAutoPilot, /Quarantine-KnownBackupFiles/);
assert.match(startAutoPilot, /Assert-StagingOriginIdentity/);
assert.match(startAutoPilot, /ExpectedRepository/);
assert.match(startAutoPilot, /\[switch\]\$RequireSchemaBundle/);
assert.match(startAutoPilot, /\[switch\]\$ApplySchemaBundle/);
assert.match(startAutoPilot, /function Seed-SchemaBundle/);
assert.ok(startAutoPilot.includes('$missingRequired = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $dumpDir $_)) })'));
assert.ok(startAutoPilot.includes('$available = (Test-Path -LiteralPath $dumpDir -PathType Container) -and ($missingArtifacts.Count -eq 0)'));
assert.equal(startAutoPilot.includes('(($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $dumpDir $_)) }).Count -eq 0)'), false);
assert.ok(startAutoPilot.includes('$bundleManifestPath = Join-Path $dumpDir "staging-schema-bundle-manifest.json"'));
assert.ok(startAutoPilot.includes('return "skipped_invalid_schema_bundle"'));
assert.ok(startAutoPilot.includes('return "skipped_incompatible_schema_bundle"'));
assert.ok(startAutoPilot.includes('return "skipped_stale_schema_bundle"'));
assert.ok(startAutoPilot.includes('Schema bundle manifest is not bound to ExpectedCommit'));
assert.ok(startAutoPilot.includes('if ($RequireSchemaBundle -or $ApplySchemaBundle) { Fail "Schema bundle manifest is not bound to ExpectedCommit:'));
assert.ok(startAutoPilot.indexOf('return "skipped_stale_schema_bundle"') < startAutoPilot.indexOf('$clone = Join-Path $RepoPath "autopilot-portable-staging\\Clone-StagingDatabases.ps1"'));
assert.match(startAutoPilot, /Clone-StagingDatabases\.ps1/);
assert.match(startAutoPilot, /schema_only/);
assert.match(startAutoPilot, /schema_bundle_required/);
assert.match(startAutoPilot, /Write-StagingUtf8NoBom/);
assert.match(startAutoPilot, /function Invoke-SelfUpdate/);
assert.match(startAutoPilot, /-SkipSelfUpdate/);
assert.match(startAutoPilot, /if \(\$RequireSchemaBundle\) \{ \$childArgs \+= "-RequireSchemaBundle" \}/);
assert.match(startAutoPilot, /if \(\$ApplySchemaBundle\) \{ \$childArgs \+= "-ApplySchemaBundle" \}/);
assert.match(startAutoPilot, /reloaded exact-commit Auto Pilot before local execution/);
assert.match(startAutoPilot, /prepare-staging-build-context\.mjs/);
assert.match(startAutoPilot, /Invoke-StagingCertification\.ps1/);
assert.match(certification, /STAGING_CERT_REQUIRE_READY=false/);
assert.match(certification, /ps -q app/);
assert.match(certification, /docker inspect --format '\{\{\.Image\}\}'/);
assert.match(certification, /full container ID/);
assert.match(certification, /content-addressed sha256 digest/);
assert.match(certification, /certification_degraded_reasons/);
assert.match(autoDeploy, /Assert-StagingOriginIdentity/);
assert.match(autoDeploy, /ExpectedRepository.*ExpectedCommit/);
assert.match(installAutoDeploy, /-LogonType Interactive(\s|`|$)/);
assert.doesNotMatch(installAutoDeploy, /InteractiveToken/);

assert.match(cmd, /Invoke-Staging-One-Click\.ps1/);
assert.match(cmd, /Start-Process powershell\.exe -Verb RunAs/);
assert.match(cmd, /'-TunnelMode','%TUNNEL_MODE%'/);
assert.match(cmd, /windows_service\^\|docker_sidecar\^\|disabled/);
assert.match(cmd, /-NoAutoDeploy/);
assert.doesNotMatch(cmd, /-ApplySchemaBundle/);
assert.match(cmd, /ExecutionPolicy/);
assert.match(cmd, /Auto Pilot log directory/);
assert.match(gitignore, /autopilot-portable-staging\/one-click-state\.json/);
assert.match(gitignore, /autopilot-portable-staging\/staging-db-dumps\//);

console.log(JSON.stringify({
  ok: true,
  contract: policy.contract,
  one_click: true,
  bootstrap: true,
  bootstrap_self_update: true,
  ci_eligibility: true,
  auto_deploy: true,
  certification: "ready_or_degraded_with_blocked_fail_closed",
  tunnel: "prompt-only-for-missing-token",
  database_seed: "dry-run-by-default-explicit-apply-only",
  production_mutation: false,
  cloudflare_dns_mutation: false,
  secrets_included: false,
}));
