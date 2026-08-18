import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const packageRoot = path.join(root, "autopilot-portable-staging");
const launcher = fs.readFileSync(path.join(packageRoot, "One-Click-Staging.ps1"), "utf8");
const startAutoPilot = fs.readFileSync(path.join(packageRoot, "Start-AutoPilot.ps1"), "utf8");
const certification = fs.readFileSync(path.join(packageRoot, "Invoke-StagingCertification.ps1"), "utf8");
const installAutoDeploy = fs.readFileSync(path.join(packageRoot, "Install-AutoDeployTask.ps1"), "utf8");
const windowsPreflight = fs.readFileSync(path.join(packageRoot, "Staging-Windows-Preflight.ps1"), "utf8");
const cmd = fs.readFileSync(path.join(packageRoot, "Start-Staging-One-Click.cmd"), "utf8");
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
assert.match(launcher, /Start-AutoPilot\.ps1/);
assert.match(launcher, /Install-AutoDeployTask\.ps1/);
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
assert.match(startAutoPilot, /Invoke-StagingCertification\.ps1/);
assert.match(certification, /STAGING_CERT_REQUIRE_READY=false/);
assert.match(certification, /certification_degraded_reasons/);
assert.match(installAutoDeploy, /-LogonType Interactive(\s|`|$)/);
assert.doesNotMatch(installAutoDeploy, /InteractiveToken/);

assert.match(cmd, /Start-Process powershell\.exe -Verb RunAs/);
assert.match(cmd, /ExecutionPolicy/);
assert.match(cmd, /bootstrap-console\.log/);
assert.match(gitignore, /autopilot-portable-staging\/one-click-state\.json/);
assert.match(gitignore, /autopilot-portable-staging\/staging-db-dumps\//);

console.log(JSON.stringify({
  ok: true,
  contract: policy.contract,
  one_click: true,
  bootstrap: true,
  ci_eligibility: true,
  auto_deploy: true,
  certification: "ready_or_degraded_with_blocked_fail_closed",
  tunnel: "prompt-only-for-missing-token",
  database_seed: "dry-run-by-default-explicit-apply-only",
  production_mutation: false,
  cloudflare_dns_mutation: false,
  secrets_included: false,
}));
