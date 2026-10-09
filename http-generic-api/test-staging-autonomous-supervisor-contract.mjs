import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staging = path.join(root, "autopilot-portable-staging");
const read = (name) => fs.readFileSync(path.join(staging, name), "utf8");
const policy = JSON.parse(read("autonomous-operations-policy.json"));
const supervisor = read("Staging-AutonomousSupervisor.ps1");
const installer = read("Install-AutonomousSupervisorTask.ps1");
const originalInstaller = read("Install-AutoDeployTask.ps1");
const removal = read("Uninstall-AutoDeployTask.ps1");
const principalIdentity = read("Staging-TaskPrincipalIdentity.ps1");

assert.equal(policy.contract, "mad4b.staging-autonomous-operations.v1");
assert.equal(policy.environment, "staging");
assert.equal(policy.expected_ref, "main");
assert.equal(policy.minimum_distinct_poll_cycles >= 2, true);
assert.equal(policy.recovery.start_stopped_watcher, true);
assert.ok(policy.recovery.max_starts_per_24_hours <= 3);
assert.ok(policy.recovery.cooldown_seconds >= 900);
for (const name of ["production_mutation", "database_mutation", "migration_apply", "provider_mutation", "cloudflare_dns_mutation", "secret_logging"]) {
  assert.equal(policy.safety[name], false, `mutation boundary: ${name}`);
}
assert.match(supervisor, /full_runtime_integrity_attested\s*=\s*\$false/i);
assert.match(supervisor, /watcher_polled_commit_mismatch/);
assert.match(supervisor, /watcher_continuity_unproven/);
assert.match(supervisor, /watcher_task_identity_invalid/);
assert.match(supervisor, /\$matched\.Count\s+-ne\s+1/);
assert.match(supervisor, /\$allPairsValid/);
assert.match(supervisor, /AUTONOMOUS_RECOVERY_BLOCKED: recovery history contract invalid/);
assert.match(supervisor, /AUTONOMOUS_RECOVERY_BLOCKED: invalid recovery attempt timestamp/);
assert.match(supervisor, /Write-StagingAtomicJson \$statePath/);
assert.match(supervisor, /Start-ScheduledTask\\s+-TaskPath\\s+/);
assert.match(supervisor, /-TaskName\\s+\\(\\[string\\]\\$Policy\\.watcher_task_name\\)/);
assert.equal((supervisor.match(/Start-ScheduledTask/g) || []).length, 1);
for (const forbidden of [/Register-ScheduledTask/, /Unregister-ScheduledTask/, /docker\s+compose\s+up/, /Invoke-Sqlcmd/, /git\s+checkout/]) {
  assert.doesNotMatch(supervisor, forbidden, `supervisor must not mutate external resources: ${forbidden}`);
}
assert.match(installer, /Custom task names are outside the governed supervisor policy/);
assert.match(installer, /exists with a different configuration; refusing overwrite/);
assert.match(installer, /\$trustedPowerShell/);
assert.match(installer, /watcher_principal_sid_mismatch/);
assert.match(installer, /watcher_action_count_invalid/);
assert.match(installer, /DiagnoseOnly/);
assert.match(installer, /diagnostic_only = \\$true/);
assert.match(installer, /Test-StagingTaskPrincipalIsCurrentUser/);
assert.match(supervisor, /Test-StagingTaskPrincipalIsCurrentUser/);
assert.match(principalIdentity, /WindowsIdentity.*GetCurrent/);
assert.match(principalIdentity, /NTAccount/);
assert.match(originalInstaller, /Staging-AutonomousSupervisor\.ps1/);
assert.match(removal, /STAGING_SUPERVISOR_TASK_REMOVED/);
assert.ok(fs.existsSync(path.join(root, "docs/runbooks/staging-autonomous-operations.md")));
console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-autonomous-supervisor-governance-test.v1",
  acceptance_is_separate_from_runtime_integrity: true,
  bounded_recovery: true,
  production_mutation: false,
  database_mutation: false,
  secrets_included: false
}));
