import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const packageRoot = path.join(root, "autopilot-portable-staging");
const launcher = fs.readFileSync(path.join(packageRoot, "One-Click-Staging.ps1"), "utf8");
const cmd = fs.readFileSync(path.join(packageRoot, "Start-Staging-One-Click.cmd"), "utf8");
const policy = JSON.parse(fs.readFileSync(path.join(packageRoot, "autopilot-one-click-policy.json"), "utf8"));
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

assert.equal(policy.contract, "mad4b.staging-one-click-autopilot.v1");
assert.equal(policy.ref, "main");
assert.equal(policy.requires_exact_commit, true);
assert.equal(policy.requires_ci_eligibility, true);
assert.deepEqual(policy.allowed_staging_hosts, ["dev.mad4b.com", "mcp_dev.mad4b.com"]);
assert.deepEqual(policy.forbidden_hosts, ["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com", "activation_dev.mad4b.com"]);
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
assert.match(launcher, /auth", "login/);
assert.match(launcher, /Get-MainSha/);
assert.match(launcher, /Wait-Eligibility/);
assert.match(launcher, /Staging Main Deploy Eligibility/);
assert.match(launcher, /Start-AutoPilot\.ps1/);
assert.match(launcher, /Install-AutoDeployTask\.ps1/);
assert.match(launcher, /Clone-StagingDatabases\.ps1/);
assert.match(launcher, /MIGRATION_APPLIED.*false/);
assert.match(launcher, /DATABASE_MUTATED.*false/);
assert.match(launcher, /RequireSchemaBundle/);
assert.match(launcher, /CLOUDFLARE_TUNNEL_TOKEN/);
assert.match(launcher, /Read-Host "Staging Tunnel token" -AsSecureString/);
assert.ok(launcher.includes("https://dev.mad4b.com"));
assert.ok(launcher.includes("https://mcp_dev.mad4b.com"));
assert.doesNotMatch(launcher, /CLOUDFLARE_TUNNEL_HOSTNAMES.*auth\.mad4b\.com/);
assert.doesNotMatch(launcher, /activation_dev\.mad4b\.com/);
assert.match(launcher, /AUTO_PILOT_ONE_CLICK_FAIL_CLOSED/);
assert.match(launcher, /production_deploy = \$false/);
assert.match(launcher, /cloudflare_dns_mutation = \$false/);
assert.match(launcher, /hostinger_mutation = \$false/);

assert.match(cmd, /Start-Process powershell\.exe -Verb RunAs/);
assert.match(cmd, /ExecutionPolicy/);
assert.match(gitignore, /autopilot-portable-staging\/one-click-state\.json/);
assert.match(gitignore, /autopilot-portable-staging\/staging-db-dumps\//);

console.log(JSON.stringify({
  ok: true,
  contract: policy.contract,
  one_click: true,
  bootstrap: true,
  ci_eligibility: true,
  auto_deploy: true,
  tunnel: "prompt-only-for-missing-token",
  database_seed: "schema-only-if-local-bundle-exists",
  production_mutation: false,
  cloudflare_dns_mutation: false,
  secrets_included: false,
}));
