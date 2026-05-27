import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/154_sprint65_remote_runtime_local_readonly_execute_tool.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(routes.includes("/platform/remote-runtime/local-path/execute-readonly"), "route must expose local read-only execution path");
assert(routes.includes("dispatchToolForCaller"), "route must dispatch through governed tool dispatcher");
assert(routes.includes('"connector_shell"'), "route must use connector_shell, not direct process execution");
assert(routes.includes('alias: "repo_status_growth_os"'), "route must use fixed repo_status_growth_os allowlist alias");
assert(routes.includes("extra_args: []"), "route must forbid extra shell args");
assert(routes.includes('action: "run"'), "route must call connector shell run action");
assert(routes.includes('planRemoteRuntimeDispatchDryRun'), "route must require successful dry-run planning before execution");
assert(routes.includes('commandKey: "status"'), "route must gate execution through status dry-run only");
assert(routes.includes("Only read-only local_path commands status and git_status"), "route must reject non-read-only command keys");
assert(routes.includes("This execution route only supports local_path targets"), "route must reject Hostinger/SSH targets");
assert(routes.includes("Remote Runtime dispatch dry-run is not ready"), "route must reject failed dry-run checks");
assert(routes.includes("shell_freeform: false"), "route response must state no freeform shell");
assert(routes.includes("ssh_used: false"), "route response must state no SSH usage");
assert(routes.includes("file_access: false"), "route response must state no file access");
assert(routes.includes("allowlisted_alias_only: true"), "route response must state allowlisted alias only");
assert(!routes.includes("child_process"), "route must not import child_process");
assert(!routes.includes("exec("), "route must not execute shell directly");
assert(!routes.includes("spawn("), "route must not spawn directly");

assert(migration.includes("remote_runtime_local_readonly_execute"), "migration must register local read-only execution tool");
assert(migration.includes("/platform/remote-runtime/local-path/execute-readonly"), "migration must bind execution path");
assert(migration.includes("repo_status_growth_os"), "migration must document fixed alias");
assert(migration.includes("read_only"), "tool must be tagged read_only");
assert(migration.includes("no_secrets"), "tool must be tagged no_secrets");
assert(migration.includes("allowlisted_alias"), "tool must be tagged allowlisted_alias");
assert(migration.includes("connector_shell"), "tool must document connector shell backend");
assert(!migration.includes("ssh_private_key"), "tool must not request SSH private key fields");
assert(!migration.includes("password"), "tool must not request passwords");
assert(!migration.includes("extra_args"), "tool schema must not expose extra_args");

const matches = openapi.match(/\/platform\/remote-runtime\/local-path\/execute-readonly:/g) || [];
assert.equal(matches.length, 1, "OpenAPI must document local read-only execution path exactly once");
assert(openapi.includes("operationId: remoteRuntimeLocalReadonlyExecute"), "OpenAPI must expose stable operationId");
assert(openapi.includes("x-openai-isConsequential: true"), "OpenAPI must mark execution route consequential");
assert(openapi.includes("repo_status_growth_os"), "OpenAPI must document the fixed allowlist alias");
assert(openapi.includes("rejects Hostinger/SSH targets"), "OpenAPI must document SSH target rejection");
assert(openapi.includes("arbitrary shell"), "OpenAPI must document arbitrary shell rejection");

console.log("remote runtime local read-only execution tests passed");
