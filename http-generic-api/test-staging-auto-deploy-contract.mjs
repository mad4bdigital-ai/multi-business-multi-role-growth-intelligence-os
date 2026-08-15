import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "autopilot-portable-staging", "auto-deploy-policy.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "staging-main-deploy-eligibility.yml"), "utf8");
const deployScript = fs.readFileSync(path.join(root, "autopilot-portable-staging", "Auto-Deploy-Staging.ps1"), "utf8");
const installer = fs.readFileSync(path.join(root, "autopilot-portable-staging", "Install-AutoDeployTask.ps1"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

assert.equal(policy.contract, "mad4b.staging-auto-deploy.v1");
assert.equal(policy.ref, "main");
assert.equal(policy.deployment_mode, "local_windows_task_scheduler");
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
});

assert.match(workflow, /on:\n  push:\n    branches: \[main\]/);
assert.match(workflow, /name: Staging Main Deploy Eligibility/);
assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
assert.match(workflow, /test \"\$\(git rev-parse HEAD\)\" = \"\$EXPECTED_HEAD_SHA\"/);
assert.match(workflow, /staging_deploy_only: true/);
assert.match(workflow, /production_deploy: false/);
assert.match(workflow, /secrets_included: false/);
assert.doesNotMatch(workflow, /auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com/);
assert.doesNotMatch(workflow, /CLOUDFLARE_TUNNEL_TOKEN|BACKEND_API_KEY|JWT_SECRET/);

assert.match(deployScript, /Get-LatestEligibility/);
assert.match(deployScript, /eligibility_check_name/);
assert.match(deployScript, /Start-AutoPilot\.ps1/);
assert.match(deployScript, /AUTO_DEPLOY_FAIL_CLOSED/);
assert.match(deployScript, /production_deploy = \$false/);
assert.match(deployScript, /database_mutated = \$false/);
assert.match(deployScript, /migration_applied = \$false/);
assert.match(deployScript, /PollSeconds -lt \[int\]\$Policy\.minimum_poll_seconds/);
assert.doesNotMatch(deployScript, /auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com/);
assert.doesNotMatch(deployScript, /CLOUDFLARE_TUNNEL_TOKEN\s*=/i);
assert.match(installer, /Register-ScheduledTask/);
assert.match(installer, /InteractiveToken/);
assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
assert.match(gitignore, /autopilot-portable-staging\/autopilot-state\.json/);
assert.match(gitignore, /autopilot-portable-staging\/auto-deploy-state\.json/);

console.log(JSON.stringify({
  ok: true,
  contract: policy.contract,
  trigger: "push:main",
  deploy_target: "local_staging_only",
  production_deploy: false,
  secrets_included: false,
}));
