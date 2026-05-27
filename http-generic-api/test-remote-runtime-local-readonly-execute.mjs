import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration154 = readFileSync("migrations/154_sprint65_remote_runtime_local_readonly_execute_tool.sql", "utf8");
const migration156 = readFileSync("migrations/156_sprint65_remote_runtime_diff_name_status.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(routes.includes("/platform/remote-runtime/local-path/execute-readonly"), "route must expose local read-only execution path");
assert(routes.includes("dispatchToolForCaller"), "route must dispatch through governed tool dispatcher");
assert(routes.includes('"connector_shell"'), "route must use connector_shell, not direct process execution");
assert(routes.includes("connectorAliasByCommand"), "route must map read-only commands to fixed connector aliases");
assert(routes.includes('status: "repo_status_growth_os"'), "route must map status to fixed repo_status_growth_os allowlist alias");
assert(routes.includes('git_status: "repo_status_growth_os"'), "route must map git_status to fixed repo_status_growth_os allowlist alias");
assert(routes.includes('diff_name_status: "repo_diff_name_status_growth_os"'), "route must map diff_name_status to fixed repo_diff_name_status_growth_os alias");
assert(routes.includes("extra_args: []"), "route must forbid extra shell args");
assert(routes.includes('action: "run"'), "route must call connector shell run action");
assert(routes.includes("planRemoteRuntimeDispatchDryRun"), "route must require successful dry-run planning before execution");
assert(routes.includes("status, git_status, and diff_name_status"), "route must reject non-read-only command keys");
assert(routes.includes("This execution route only supports local_path targets"), "route must reject Hostinger/SSH targets");
assert(routes.includes("Remote Runtime dispatch dry-run is not ready"), "route must reject failed dry-run checks");
assert(routes.includes("shell_freeform: false"), "route response must state no freeform shell");
assert(routes.includes("ssh_used: false"), "route response must state no SSH usage");
assert(routes.includes("file_access: false"), "route response must state no file access");
assert(routes.includes("allowlisted_alias_only: true"), "route response must state allowlisted alias only");
assert(routes.includes("resolveRemoteRuntimeCanonicalDeviceId"), "route must resolve legacy device ids through local_connector_device_aliases");
assert(routes.includes("local_connector_device_aliases"), "route must query device alias registry before connector_shell dispatch");
assert(routes.includes("? IS NULL OR user_id = ? OR user_id IS NULL"), "route must allow tenant-scoped aliases when target user_id is null");
assert(!routes.includes("child_process"), "route must not import child_process");
assert(!routes.includes("exec("), "route must not execute shell directly");
assert(!routes.includes("spawn("), "route must not spawn directly");

assert(migration154.includes("remote_runtime_local_readonly_execute"), "base migration must register local read-only execution tool");
assert(migration154.includes("/platform/remote-runtime/local-path/execute-readonly"), "base migration must bind execution path");
assert(migration154.includes("repo_status_growth_os"), "base migration must document fixed status alias");
assert(migration154.includes("read_only"), "tool must be tagged read_only");
assert(migration154.includes("no_secrets"), "tool must be tagged no_secrets");
assert(migration154.includes("allowlisted_alias"), "tool must be tagged allowlisted_alias");
assert(migration154.includes("connector_shell"), "tool must document connector shell backend");
assert(!migration154.includes("ssh_private_key"), "tool must not request SSH private key fields");
assert(!migration154.includes("password"), "tool must not request passwords");
assert(!migration154.includes("extra_args"), "tool schema must not expose extra_args");

assert(migration156.includes("diff_name_status"), "diff migration must register diff_name_status command");
assert(migration156.includes("repo_diff_name_status_growth_os"), "diff migration must register fixed diff alias");
assert(migration156.includes("git diff --name-status"), "diff migration must document read-only git diff --name-status");
assert(migration156.includes("allow_extra_args, description"), "diff alias must preserve no-extra-args registration");
assert(migration156.includes("enum\":[\"status\",\"git_status\",\"diff_name_status\"]"), "tool schema must allow diff_name_status");

const matches = openapi.match(/\/platform\/remote-runtime\/local-path\/execute-readonly:/g) || [];
assert.equal(matches.length, 1, "OpenAPI must document local read-only execution path exactly once");
assert(openapi.includes("operationId: remoteRuntimeLocalReadonlyExecute"), "OpenAPI must expose stable operationId");
assert(openapi.includes("x-openai-isConsequential: true"), "OpenAPI must mark execution route consequential");
assert(openapi.includes("repo_status_growth_os"), "OpenAPI must document the fixed status allowlist alias");
assert(openapi.includes("repo_diff_name_status_growth_os"), "OpenAPI must document the fixed diff allowlist alias");
assert(openapi.includes("diff_name_status"), "OpenAPI must expose diff_name_status command_key");
assert(openapi.includes("rejects Hostinger/SSH targets"), "OpenAPI must document SSH target rejection");
assert(openapi.includes("arbitrary shell"), "OpenAPI must document arbitrary shell rejection");

console.log("remote runtime local read-only execution tests passed");
