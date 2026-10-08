import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "autopilot-portable-staging");
const logger = fs.readFileSync(path.join(packageRoot, "Staging-Operations-Log.ps1"), "utf8");
const healthMonitor = fs.readFileSync(path.join(packageRoot, "Staging-HealthMonitor.ps1"), "utf8");
const doctor = fs.readFileSync(path.join(packageRoot, "Staging-Doctor.ps1"), "utf8");
const maintenanceCmd = fs.readFileSync(path.join(packageRoot, "Staging-Maintenance.cmd"), "utf8");
const maintenancePolicy = JSON.parse(fs.readFileSync(path.join(packageRoot, "staging-maintenance-policy.json"), "utf8"));
const stagingAutoDeployPolicy = JSON.parse(fs.readFileSync(path.join(packageRoot, "auto-deploy-policy.json"), "utf8"));
const stagingOneClickPolicy = JSON.parse(fs.readFileSync(path.join(packageRoot, "autopilot-one-click-policy.json"), "utf8"));
const stagingExample = fs.readFileSync(path.join(root, "http-generic-api", ".env.staging.example"), "utf8");
const installer = fs.readFileSync(path.join(packageRoot, "Install-AutoDeployTask.ps1"), "utf8");
const uninstaller = fs.readFileSync(path.join(packageRoot, "Uninstall-AutoDeployTask.ps1"), "utf8");
const oneClick = fs.readFileSync(path.join(packageRoot, "One-Click-Staging.ps1"), "utf8");
const autoDeploy = fs.readFileSync(path.join(packageRoot, "Auto-Deploy-Staging.ps1"), "utf8");
const appOperations = fs.readFileSync(path.join(packageRoot, "Start-AutoPilot.ps1"), "utf8");
const cmd = fs.readFileSync(path.join(packageRoot, "Start-Staging-One-Click.cmd"), "utf8");
const viewer = fs.readFileSync(path.join(packageRoot, "Show-StagingLogs.ps1"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

assert.match(logger, /operations\.jsonl/);
assert.match(logger, /operations\.1\.jsonl/);
assert.match(healthMonitor, /health-snapshot\.json/);
assert.match(logger, /latest-status\.json/);
assert.match(logger, /last-failure\.json/);
assert.match(logger, /run_id/);
assert.match(logger, /Write-StagingHeartbeat/);
assert.match(logger, /REDACTED/);
assert.match(logger, /SECRET\|PASSWORD\|TOKEN\|API_KEY/);
assert.match(logger, /Bearer/);
assert.match(logger, /Write-StagingLog/);
assert.match(logger, /Write-StagingOperationBoundary/);
assert.match(logger, /StagingLogSchemaVersion = 2/);
assert.match(logger, /Global\\Mad4bStagingOperationsLog/);
assert.match(logger, /Invoke-StagingLogLocked/);
assert.match(logger, /WaitOne\(15000\)/);
assert.match(logger, /Write-StagingUtf8Atomic/);
assert.match(logger, /AppendAllText/);
assert.match(logger, /Start-Sleep -Milliseconds/);
assert.match(logger, /Get-Variable\s+-Name\s+Mad4bStagingRunId\s+-Scope\s+Global\s+-ValueOnly\s+-ErrorAction\s+SilentlyContinue/);
assert.match(logger, /StrictMode throws when an unset global variable is read directly/);
assert.doesNotMatch(logger, /\$global:Mad4bStagingRunId\)\)\s*\{/);

for (const script of [oneClick, autoDeploy, appOperations]) {
  assert.match(script, /Staging-Operations-Log\.ps1/);
  assert.match(script, /AUTO_PILOT_FAILURE_LOGGED|AUTO_DEPLOY_FAILURE_LOGGED|APP_OPERATIONS_FAILURE_LOGGED/);
  assert.match(script, /last-failure|Write-StagingLog/);
}
assert.match(oneClick, /eligibility/);
assert.match(autoDeploy, /Stage "poll"/);
assert.match(appOperations, /health:/);
assert.match(appOperations, /Stage "tunnel"/);
assert.match(healthMonitor, /health-snapshot\.json/);
assert.match(healthMonitor, /Write-StagingHeartbeat/);
assert.match(healthMonitor, /Global\\Mad4bStagingHealthMonitor/);
assert.match(healthMonitor, /MaxBackoffSeconds/);
assert.match(healthMonitor, /Get-NextDelay/);
assert.match(healthMonitor, /Docker daemon is unavailable/);
assert.match(healthMonitor, /Health Monitor recovered after component failure/);
assert.match(healthMonitor, /suppressed_failures/);
assert.match(oneClick, /bootstrap-console\.log/);
assert.match(cmd, /Auto Pilot log directory/);
assert.match(healthMonitor, /docker context show/);
assert.match(healthMonitor, /GATEWAY_POLICY_STALE/);
assert.match(healthMonitor, /activation_policy_stale/);
assert.match(healthMonitor, /ACTIVATION_STAGING_GATEWAY_ENABLED/);
assert.match(healthMonitor, /Invoke-RestMethod/);
assert.match(healthMonitor, /activation_gateway/);
assert.match(healthMonitor, /activation-dev/);
assert.doesNotMatch(healthMonitor, /CLOUDFLARE_TUNNEL_TOKEN/);
assert.match(doctor, /ValidateSet\("Status", "Repair", "Logs"\)/);
assert.match(doctor, /maintenance-status\.json/);
assert.match(doctor, /RepairTasks/);
assert.match(doctor, /Repair/);
assert.match(doctor, /\$gitCommand = Get-Command git -ErrorAction SilentlyContinue/);
assert.match(doctor, /if \(\$null -ne \$gitCommand -and \(Test-Path/);
assert.doesNotMatch(doctor, /Get-Command git -ErrorAction SilentlyContinue -and/);
// PowerShell binds $host to the read-only automatic $Host variable (case-insensitive).
assert.doesNotMatch(doctor, /\bforeach\s*\(\s*\$host\b/i);
assert.match(doctor, /foreach\s*\(\s*\$forbiddenHostname\s+in\s+\$Policy\.forbidden_hosts\s*\)/);
assert.match(doctor, /\[regex\]::Escape\(\$forbiddenHostname\)/);
assert.match(doctor, /forbidden-host:\$forbiddenHostname/);
assert.match(doctor, /detached:exact-local-origin-/);
assert.match(doctor, /detached:not-exact-local-origin-/);
assert.match(doctor, /rev-parse --verify "refs\/remotes\/origin\/\$expectedBranch"/);
assert.match(doctor, /\$localShaValid -and \$remoteShaValid -and \(\$localSha -eq \$remoteSha\)/);
assert.match(doctor, /Add-Check \$checks "repository:branch" \$branchEligible \$branch \$false/);
// Reject partial PowerShell regex literals caused by JavaScript replacement interpolation.
assert.ok(doctor.includes("($localSha -match '^[0-9a-fA-F]{40}$')"));
assert.ok(doctor.includes("($remoteSha -match '^[0-9a-fA-F]{40}$')"));
assert.equal((doctor.match(/function Invoke-Status\s*\{/g) || []).length, 1);
assert.equal((doctor.match(/\$dirty = @\(\)/g) || []).length, 1);
assert.equal(maintenancePolicy.maintenance.repair_may_delete_data, false);
assert.match(maintenanceCmd, /Staging-Doctor\.ps1/);
assert.equal(maintenancePolicy.contract, "mad4b.staging-maintenance.v1");
assert.deepEqual(
  [...maintenancePolicy.forbidden_hosts].sort(),
  [...stagingAutoDeployPolicy.forbidden_hosts].sort(),
  "Maintenance Doctor must enforce the Auto Deploy Production denylist",
);
assert.deepEqual(
  [...maintenancePolicy.forbidden_hosts].sort(),
  [...stagingOneClickPolicy.forbidden_hosts].sort(),
  "Maintenance Doctor must enforce the One Click Production denylist",
);
assert.ok(Array.isArray(maintenancePolicy.optional_staging_hosts));
assert.equal(new Set(maintenancePolicy.optional_staging_hosts).size, maintenancePolicy.optional_staging_hosts.length);
for (const allowedHost of [...maintenancePolicy.required_hosts, ...maintenancePolicy.optional_staging_hosts]) {
  assert.ok(stagingAutoDeployPolicy.allowed_staging_hosts.includes(allowedHost), `Auto Deploy must allow ${allowedHost}`);
  assert.ok(stagingOneClickPolicy.allowed_staging_hosts.includes(allowedHost), `One Click must allow ${allowedHost}`);
  assert.ok(!maintenancePolicy.forbidden_hosts.includes(allowedHost), `Doctor cannot deny approved Staging host: ${allowedHost}`);
}
assert.ok(maintenancePolicy.optional_staging_hosts.includes("activation-dev.mad4b.com"));
assert.match(stagingExample, /^ACTIVATION_HOST_GATEWAY_HOST=activation-dev\.mad4b\.com$/m);
assert.match(stagingExample, /^TENANT_GPT_STAGING_ACTIVATION_AUTHORIZATION_SERVER_URL=https:\/\/activation-dev\.mad4b\.com$/m);
for (const forbiddenHost of ["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com"]) {
  assert.ok(maintenancePolicy.forbidden_hosts.includes(forbiddenHost), `Production host must remain blocked: ${forbiddenHost}`);
}
assert.equal(maintenancePolicy.maintenance.repair_may_delete_data, false);
assert.equal(maintenancePolicy.maintenance.repair_may_apply_migrations, false);
assert.equal(maintenancePolicy.maintenance.repair_may_touch_production, false);
assert.match(installer, /Staging-HealthMonitor\.ps1/);
assert.match(installer, /STAGING_HEALTH_TASK_INSTALLED/);
assert.match(uninstaller, /STAGING_HEALTH_TASK_REMOVED/);
assert.match(viewer, /FailuresOnly/);
assert.match(viewer, /Component/);
assert.match(gitignore, /autopilot-portable-staging\/logs\//);

for (const source of [logger, healthMonitor, doctor, maintenanceCmd, installer, uninstaller, oneClick, autoDeploy, appOperations, cmd, viewer]) {
  assert.doesNotMatch(source, /CLOUDFLARE_TUNNEL_TOKEN\s*=\s*[A-Za-z0-9]{20,}/i);
  assert.doesNotMatch(source, /BACKEND_API_KEY\s*=\s*[A-Za-z0-9]{20,}/i);
  assert.doesNotMatch(source, /JWT_SECRET\s*=\s*[A-Za-z0-9]{20,}/i);
}

const gatewaySeedContract = spawnSync(
  process.execPath,
  [path.join(root, "http-generic-api", "staging-governance-authority-seed-recovery-contract.mjs")],
  { cwd: root, encoding: "utf8" },
);
assert.equal(gatewaySeedContract.status, 0, gatewaySeedContract.stderr || gatewaySeedContract.stdout);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-operations-logging.v1",
  durable_jsonl: true,
  components: ["auto-pilot", "auto-deploy", "app-operations"],
  failure_snapshot: true,
  secret_redaction: true,
  production_mutation: false,
  health_monitor: true,
  log_rotation: true,
  correlation_id: true,
  maintenance_doctor: true,
  destructive_repair: false,
  gateway_authority_seed_recovery_contract: true,
}));
