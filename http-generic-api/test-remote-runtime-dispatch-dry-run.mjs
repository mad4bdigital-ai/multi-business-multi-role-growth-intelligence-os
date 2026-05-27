import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("remoteRuntime.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/153_sprint65_remote_runtime_dispatch_dry_run_tool.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(service.includes("planRemoteRuntimeDispatchDryRun"), "service must export dispatch dry-run planner");
assert(service.includes("remote_runtime_dispatch_dry_run"), "service must use stable evidence entry/route key");
assert(service.includes("target_allows_command"), "dry-run must evaluate target command allowlist");
assert(service.includes("approval_required"), "dry-run must evaluate approval requirements");
assert(service.includes("approval_satisfied"), "dry-run must evaluate approval satisfaction");
assert(service.includes("will_execute: false"), "dry-run must never execute");
assert(service.includes("dry_run: true"), "dry-run response must state dry_run=true");
assert(service.includes("Dispatch dry-run never opens SSH"), "dry-run response must document no SSH/local shell/file access");
assert(service.includes("secrets_included: false"), "dry-run responses must exclude secrets");
assert(service.includes("rejectSecretLikePayload(inputs"), "dry-run must reject secret-like input fields");
assert(!service.includes("ssh2"), "dry-run service must not import SSH client libraries");
assert(!service.includes("child_process"), "dry-run service must not spawn local commands");
assert(!service.includes("exec("), "dry-run service must not execute shell commands");
assert(!service.includes("spawn("), "dry-run service must not spawn processes");

assert(routes.includes("planRemoteRuntimeDispatchDryRun"), "route must import dispatch dry-run planner");
assert(routes.includes("/platform/remote-runtime/dispatch-dry-run"), "route must expose dispatch dry-run path");
assert(routes.includes("remote_runtime_dispatch_dry_run_failed"), "route must use structured dry-run error code");

assert(migration.includes("remote_runtime_dispatch_dry_run"), "migration must register dispatch dry-run tool");
assert(migration.includes("/platform/remote-runtime/dispatch-dry-run"), "migration must bind dispatch dry-run path");
assert(migration.includes("dry-run"), "tool must be tagged/documented as dry-run");
assert(migration.includes("no_secrets"), "tool must be tagged no_secrets");
assert(migration.includes("read_only"), "tool must be read-only diagnostic");
assert(!migration.includes("state_changing"), "dispatch dry-run tool must not be state-changing");
assert(!migration.includes("ssh_private_key"), "dispatch dry-run tool must not request private key fields");

const matches = openapi.match(/\/platform\/remote-runtime\/dispatch-dry-run:/g) || [];
assert.equal(matches.length, 1, "OpenAPI must document dispatch dry-run path exactly once");
assert(openapi.includes("operationId: remoteRuntimeDispatchDryRun"), "OpenAPI must expose stable dispatch dry-run operationId");
assert(openapi.includes("x-openai-isConsequential: false"), "OpenAPI must mark dry-run as non-consequential");
assert(openapi.includes("never executes commands"), "OpenAPI must document no command execution");
assert(openapi.includes("never returns secrets"), "OpenAPI must document no secrets");

console.log("remote runtime dispatch dry-run tests passed");
