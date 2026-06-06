import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const executor = readFileSync("hostingerSshDeployExecutor.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/206_sprint67_hostinger_ssh_deploy_executor.sql", "utf8");
const allowlist = readFileSync("openapi-route-coverage.allowlist.json", "utf8");

assert(executor.includes("REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED"), "actual SSH execution must be behind an explicit feature flag");
assert(executor.includes("dryRun"), "executor must support dry-run mode");
assert(executor.includes("dry_run_only"), "dry-run path must not execute SSH");
assert(executor.includes("resolveEffectiveCredential"), "executor must use governed credential resolver");
assert(executor.includes("planRemoteRuntimeDispatchDryRun"), "executor must reuse remote runtime dry-run planning");
assert(executor.includes("spawn(\"ssh\""), "executor must use argv-based ssh invocation, not shell freeform");
assert(executor.includes("shell: false"), "executor must disable local shell interpolation");
assert(executor.includes("mkdtemp"), "private key must be written only to a temporary file");
assert(executor.includes("rm(tempDir"), "temporary private key directory must be cleaned up");
assert(executor.includes("expected_commit_sha"), "executor must require an expected commit SHA");
assert(executor.includes("git checkout --detach"), "deploy must checkout a fixed SHA, not a mutable branch head");
assert(executor.includes("pathAllowedByTarget"), "executor must enforce target path allowlists");
assert(executor.includes("approval_reason") || executor.includes("approvalReason"), "executor must require approval reason for execution");
assert(executor.includes("secrets_included: false"), "responses and evidence must mark secrets as excluded");
assert(!executor.includes("privateKey,"), "executor response must not serialize privateKey shorthand");
assert(!executor.includes("private_key:"), "executor response must not expose private_key fields");
assert(!executor.includes("exec("), "executor must not use exec shell freeform");

assert(routes.includes("executeHostingerSshDeployRelease"), "platform routes must import hostinger deploy executor");
assert(routes.includes('/platform/remote-runtime/hosting/deploy-release'), "platform routes must expose deploy release path");
assert(routes.includes("remote_runtime_hosting_deploy_release_failed"), "route must use structured error code");

assert(migration.includes("remote_runtime_hostinger_deploy_release"), "migration must register admin tool row");
assert(migration.includes("deploy_release"), "migration must register deploy_release command");
assert(migration.includes("is_enabled") && migration.includes(" 0,"), "admin tool row must remain disabled until deployed and certified");
assert(migration.includes("approval_required"), "migration tags must record approval requirement");
assert(migration.includes("no_secrets"), "migration tags must record no_secrets boundary");
assert(migration.includes("expected_sha_required"), "migration tags must require expected SHA");
assert(migration.includes("/home/*/domains/auth.mad4b.com/nodejs"), "migration must allowlist auth.mad4b.com nodejs path");

assert(allowlist.includes("POST /platform/remote-runtime/hosting/deploy-release"), "route coverage must explicitly account for the deploy endpoint until OpenAPI regeneration");

console.log("Hostinger SSH deploy executor safety tests passed");
