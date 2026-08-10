import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const executor = readFileSync("hostingerSshDeployExecutor.js", "utf8");
const authority = readFileSync("productionDeploymentAuthority.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/206_sprint67_hostinger_ssh_deploy_executor.sql", "utf8");
const authorityMigration = readFileSync("migrations/20260810_hostinger_production_deploy_authority_binding.sql", "utf8");
const allowlist = readFileSync("openapi-route-coverage.allowlist.json", "utf8");

assert(executor.includes("REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED"), "actual SSH execution must be behind an explicit feature flag");
assert(executor.includes("dryRun"), "executor must support dry-run mode");
assert(executor.includes("dry_run_only"), "dry-run path must not execute SSH");
assert(executor.includes("resolveEffectiveCredential"), "executor must use governed credential resolver");
assert(executor.includes("planRemoteRuntimeDispatchDryRun"), "executor must reuse remote runtime dry-run planning");
assert(executor.includes("command = \"ssh\"") || executor.includes("spawn(\"ssh\""), "executor must use argv-based ssh invocation, not shell freeform");
assert(executor.includes("spawn(command, args") || executor.includes("spawn(\"ssh\""), "executor must spawn an allowlisted SSH command with argv args");
assert(executor.includes("shell: false"), "executor must disable local shell interpolation");
assert(executor.includes('command: "timeout"'), "executor must wrap SSH with coreutils timeout to avoid stuck probes");
assert(executor.includes("detached: true"), "executor must spawn SSH wrapper in its own process group");
assert(executor.includes("killProcessTree"), "executor must kill the process group on timeout fallback");
assert(executor.includes("ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}"), "executor must bound SSH connection establishment");
assert(executor.includes("ConnectionAttempts=1"), "executor must avoid repeated SSH connection attempts");
assert(executor.includes("ServerAliveInterval"), "executor must bound established SSH liveness checks");
assert(executor.includes("NumberOfPasswordPrompts=1"), "password auth must not hang on repeated prompts");
assert(executor.includes("sshpass"), "password auth must use sshpass helper when selected");
assert(executor.includes('"-d"') && executor.includes('"3"'), "password auth must pass the password through file descriptor 3, not argv or env");
assert(!executor.includes("SSHPASS"), "password auth must not place passwords in SSHPASS env");
assert(executor.includes("MAX_PROBE_TIMEOUT_MS = 75000"), "read-only probe timeout must stay below proxy/request limits");
assert(executor.includes("mkdtemp"), "private key must be written only to a temporary file");
assert(executor.includes("rm(tempDir"), "temporary private key directory must be cleaned up");
assert(executor.includes("expected_commit_sha"), "executor must require an expected commit SHA");
assert(executor.includes("resolveVerifiedProductionDeploymentAuthority"), "deploy executor must resolve the production branch from governed environment authority");
assert(!executor.includes("ALLOWED_BRANCHES"), "deploy executor must not use a caller-selected static branch allowlist");
assert(executor.includes('let branch = compact(input.branch || "", 64)'), "caller branch may only be captured as an optional compatibility assertion");
assert(executor.includes("branch = deploymentAuthority.production_branch"), "effective deploy branch must come from production authority");
assert(executor.includes("production_branch_head_sha"), "deploy evidence must carry same-cycle Production branch head readback");
assert(executor.includes("expected_sha_matches_production_head"), "deploy evidence must prove the expected SHA equals current Production head");
assert(!executor.includes('branch: branch || "main"'), "continuation evidence must not fall back to main for production deployment");

assert(authority.includes("/git/ref/heads/"), "production authority must read the governed branch head from GitHub");
assert(authority.includes("production_deployment_sha_stale"), "stale Production SHA must use a structured fail-closed error");
assert(authority.includes("production_deployment_branch_authority_mismatch") || executor.includes("resolveVerifiedProductionDeploymentAuthority"), "unauthorized branch selection must fail through environment authority");
assert(authority.includes("same_cycle_branch_readback"), "authority evidence must explicitly mark same-cycle branch readback");
assert(!authority.includes("test-token-never-returned"), "runtime authority module must not contain test credential material");

assert(authorityMigration.includes("branch selection is removed from governed caller schemas") || authorityMigration.includes("Remove caller-controlled branch selection"), "corrective migration must remove caller-controlled branch selection");
assert(authorityMigration.includes("JSON_ARRAY('target_id','app_key','app_path','expected_commit_sha','approval_reason')"), "command schema must no longer require branch");
assert(authorityMigration.includes('"required":["target_id","app_key","app_path","expected_commit_sha"]'), "admin tool schema must no longer require branch");
assert(!authorityMigration.includes("'branch',JSON_OBJECT"), "command schema must not expose branch as a caller-selectable property");
assert(authorityMigration.includes("same_cycle_branch_readback_required"), "execution policy must require same-cycle branch head readback");
assert(authorityMigration.includes("caller_branch_selection_allowed', FALSE"), "execution policy must explicitly deny caller branch selection");
for (const marker of [
  "no_credential_payload_read",
  "no_external_send",
  "no_external_write",
  "no_hostinger_runtime_mutation",
  "migration_source_only",
  "secrets_included_false",
]) {
  assert(authorityMigration.includes(marker), `authority-binding migration must preserve ${marker}`);
}

assert(executor.includes("git checkout --detach"), "deploy must checkout a fixed SHA, not a mutable branch head");
assert(executor.includes("pathAllowedByTarget"), "executor must enforce target path allowlists");
assert(executor.includes("approval_reason") || executor.includes("approvalReason"), "executor must require approval reason for execution");
assert(executor.includes("buildHostingerDeployReloadVerification"), "deploy must build explicit reload verification evidence");
assert(executor.includes("scheduled:tmp/restart.txt"), "deploy restart must be deferred until after the response can flush");
assert(executor.includes("deployment_run_id"), "deploy responses must expose a deployment run id");
assert(executor.includes("http_status: httpStatus"), "deploy responses must expose their intended HTTP status");
assert(executor.includes("readHostingerSshDeployRunStatus"), "deploy must expose bounded run-status readback");
assert(executor.includes("restart_signal_ok"), "deploy must verify restart signal emission when restart is requested");
assert(executor.includes("runtime_health_readback_required"), "deploy must require live health readback after restart signal emission");
assert(executor.includes("buildHostingerDeployContinuationEvidence"), "deploy must create continuation evidence for pending reload/health verification");
assert(executor.includes("deploy_reload_pending"), "deploy reload gaps must use the shared deploy_reload_pending interruption signal");
assert(executor.includes("createContinuationCheckpoint") && executor.includes("planContinuationResume"), "deploy reload continuation must use the shared reconciliation engine");
assert(executor.includes("live_ready: deployOk && reloadVerification.runtime_health_readback_required !== true"), "deploy responses must not claim live readiness before health readback");
assert(executor.includes("secrets_included: false"), "responses and evidence must mark secrets as excluded");
assert(!executor.includes("privateKey:"), "executor response must not serialize privateKey fields");
assert(!executor.includes("private_key:"), "executor response must not expose private_key fields");
assert(!executor.includes("exec("), "executor must not use exec shell freeform");

assert(routes.includes("executeHostingerSshDeployRelease"), "platform routes must import hostinger deploy executor");
assert(routes.includes('/platform/remote-runtime/hosting/deploy-release'), "platform routes must expose deploy release path");
assert(routes.includes("remote_runtime_hosting_deploy_release_failed"), "route must use structured error code");
assert(routes.includes("result.http_status"), "deploy route must honor 202 accepted responses");
assert(routes.includes("/platform/remote-runtime/hosting/deploy-runs/:deploymentRunId"), "platform routes must expose deploy status readback");
assert(routes.includes("remote_runtime_hosting_deploy_run_read_failed"), "readback route must use a structured error code");

assert(migration.includes("remote_runtime_hostinger_deploy_release"), "historical migration must still register admin tool row");
assert(migration.includes("deploy_release"), "historical migration must still register deploy_release command");
assert(migration.includes("is_enabled") && migration.includes(" 0,"), "admin tool row must remain disabled until deployed and certified");
assert(migration.includes("approval_required"), "migration tags must record approval requirement");
assert(migration.includes("no_secrets"), "migration tags must record no_secrets boundary");
assert(migration.includes("expected_sha_required"), "migration tags must require expected SHA");
assert(migration.includes("/home/*/domains/auth.mad4b.com/nodejs"), "migration must allowlist auth.mad4b.com nodejs path");

assert(!allowlist.includes("POST /platform/remote-runtime/hosting/deploy-release"), "documented deploy endpoint must not remain allowlisted");

console.log("Hostinger SSH deploy executor safety tests passed");
