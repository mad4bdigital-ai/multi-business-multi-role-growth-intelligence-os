import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const executor = readFileSync("hostingerSshDeployExecutor.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/207_sprint67_hostinger_ssh_target_probe.sql", "utf8");
const allowlist = readFileSync("openapi-route-coverage.allowlist.json", "utf8");

const startMarker = "export async function executeHostingerSshTargetProbe";
const endMarker = "export async function executeHostingerSshDeployRelease";
const start = executor.indexOf(startMarker);
const end = executor.indexOf(endMarker, start);
assert(start >= 0, "executor must export executeHostingerSshTargetProbe");
assert(end > start, "probe block must be separate from deploy executor block");
const probeBlock = executor.slice(start, end);

assert(executor.includes("REMOTE_RUNTIME_HOSTINGER_SSH_PROBE_ENABLED"), "actual SSH probe must be behind an explicit feature flag");
assert(executor.includes("remote_runtime_hostinger_ssh_probe_enabled"), "probe must support governed DB-backed execution gate for stateless runtimes");
assert(executor.includes("loadHostingerSshProbeGate"), "probe must evaluate a governed runtime gate before SSH execution");
assert(executor.includes("HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE"), "probe must expose a queue worker job type to avoid long request 503s");
assert(executor.includes("runHostingerSshTargetProbeJob"), "probe must expose a queue worker entrypoint");
assert(probeBlock.includes("dry_run_only"), "probe must support dry-run mode");
assert(probeBlock.includes("resolveSshConnectionCredentials") || probeBlock.includes("resolveSshCredential"), "probe must use governed SSH credential resolver wrapper");
assert(executor.includes("resolveEffectiveCredential"), "SSH credential resolver wrapper must use governed credential resolver");
assert(probeBlock.includes("planRemoteRuntimeDispatchDryRun"), "probe must reuse remote runtime dry-run planning");
assert(probeBlock.includes("ssh_probe"), "probe must use the ssh_probe command key");
assert(probeBlock.includes("activate_on_success"), "target activation must be explicit");
assert(probeBlock.includes("status = 'active'"), "target active status must only be set after probe success");
assert(probeBlock.includes("probeOk && activateOnSuccess"), "activation must require same-cycle probe success and explicit flag");
assert(probeBlock.includes("secrets_included: false"), "probe responses and evidence must mark secrets excluded");
assert(executor.includes("isPlatformManagedTarget"), "managed platform Hostinger targets must route missing credentials to platform-scoped intake");
assert(executor.includes("intakeScope: result?.owner_type === \"platform\""), "credential intake scope must prefer platform ownership signals");
assert(executor.includes("ssh_password"), "Hostinger SSH password credential role must be supported");
assert(executor.includes("sshpass"), "password auth must use sshpass helper rather than interactive shell prompts");
assert(executor.includes("\"-d\", \"3\""), "sshpass must read password from a file descriptor, not argv or environment");
assert(!executor.includes("SSHPASS"), "SSH password must not be exposed through environment variables");
assert(!probeBlock.includes("git fetch"), "probe must not fetch remote git data");
assert(!probeBlock.includes("git checkout"), "probe must not checkout or mutate repo state");
assert(!probeBlock.includes("touch tmp/restart.txt"), "probe must not restart the app");
assert(!probeBlock.includes("rm -rf"), "probe must not run destructive shell commands");

assert(routes.includes("executeHostingerSshTargetProbe"), "platform routes must import target probe executor");
assert(routes.includes('/platform/remote-runtime/hosting/ssh-probe'), "platform routes must expose SSH probe path");
assert(routes.includes("remote_runtime_hosting_ssh_probe_failed"), "route must use structured probe error code");

assert(migration.includes("remote_runtime_hostinger_ssh_probe"), "migration must register admin tool row");
assert(migration.includes("ssh_probe"), "migration must register ssh_probe command");
assert(migration.includes("is_enabled") && migration.includes(" 0,"), "admin tool row must remain disabled until deployed and certified");
assert(migration.includes("read_only"), "migration tags must record read_only boundary");
assert(migration.includes("no_secrets"), "migration tags must record no_secrets boundary");
assert(migration.includes("activation_requires_probe_success"), "migration tags must require same-cycle probe success before activation");
assert(migration.includes("/home/*/domains/auth.mad4b.com/nodejs"), "migration must allowlist auth.mad4b.com nodejs path");

assert(allowlist.includes("POST /platform/remote-runtime/hosting/ssh-probe"), "route coverage must explicitly account for the probe endpoint until OpenAPI regeneration");

console.log("Hostinger SSH target probe safety tests passed");
