import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("remoteRuntime.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/151_sprint65_remote_runtime_catalog_probe_tools.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(service.includes("listRemoteRuntimeTargets"), "service must export target catalog function");
assert(service.includes("probeRemoteRuntimeTarget"), "service must export readiness probe function");
assert(service.includes("remote_runtime_targets"), "service must read remote runtime targets");
assert(service.includes("remote_runtime_command_allowlists"), "service must read command allowlists");
assert(service.includes("writeExecutionEvidence"), "probe must write execution evidence");
assert(service.includes("will_execute: false"), "probe must never execute in this phase");
assert(service.includes("dispatch_ready: false"), "probe must not mark dispatch ready");
assert(service.includes("Probe never opens SSH"), "probe response must explain no SSH/local shell/file execution");
assert(service.includes("secrets_included: false"), "service must explicitly exclude secrets");
assert(!service.includes("ssh2"), "catalog/probe service must not import SSH client libraries");
assert(!service.includes("child_process"), "catalog/probe service must not spawn local commands");
assert(!service.includes("exec("), "catalog/probe service must not execute shell commands");
assert(!service.includes("spawn("), "catalog/probe service must not spawn processes");

assert(routes.includes("listRemoteRuntimeTargets"), "routes must import target catalog service");
assert(routes.includes("probeRemoteRuntimeTarget"), "routes must import probe service");
assert(routes.includes("/platform/remote-runtime/targets/catalog"), "routes must expose remote runtime catalog path");
assert(routes.includes("/platform/remote-runtime/probe"), "routes must expose remote runtime probe path");
assert(routes.includes("remote_runtime_catalog_failed"), "catalog route must use structured error code");
assert(routes.includes("remote_runtime_probe_failed"), "probe route must use structured error code");

assert(migration.includes("remote_runtime_target_catalog"), "migration must register target catalog tool");
assert(migration.includes("remote_runtime_probe"), "migration must register probe tool");
assert(migration.includes("/platform/remote-runtime/targets/catalog"), "migration must bind catalog path");
assert(migration.includes("/platform/remote-runtime/probe"), "migration must bind probe path");
assert(migration.includes("no_secrets"), "tools must be tagged no_secrets");
assert(migration.includes("read_only"), "tools must be read-only diagnostics");
assert(!migration.includes("state_changing"), "catalog/probe tools must not be state-changing");
assert(!migration.includes("ssh_private_key"), "catalog/probe tool registration must not reference private key fields");

const catalogPathMatches = openapi.match(/\/platform\/remote-runtime\/targets\/catalog:/g) || [];
const probePathMatches = openapi.match(/\/platform\/remote-runtime\/probe:/g) || [];
assert.equal(catalogPathMatches.length, 1, "OpenAPI must document catalog path exactly once");
assert.equal(probePathMatches.length, 1, "OpenAPI must document probe path exactly once");
assert(openapi.includes("operationId: remoteRuntimeTargetCatalog"), "OpenAPI must expose stable catalog operationId");
assert(openapi.includes("operationId: remoteRuntimeProbe"), "OpenAPI must expose stable probe operationId");
assert(openapi.includes("x-openai-isConsequential: false"), "OpenAPI must mark catalog/probe as non-consequential");
assert(openapi.includes("never opens SSH"), "OpenAPI must document no SSH execution");

console.log("remote runtime catalog/probe tests passed");
