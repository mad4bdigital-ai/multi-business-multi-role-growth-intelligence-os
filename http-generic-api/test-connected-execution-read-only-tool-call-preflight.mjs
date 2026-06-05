import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const worker = readFileSync("connectedExecutionWorker.js", "utf8");
const routes = readFileSync("routes/connectedExecutionRoutes.js", "utf8");
const migration = readFileSync("migrations/193_sprint66_connected_execution_read_only_tool_call_preflight.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const readiness = readFileSync("releaseReadiness.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const docs = readFileSync("../docs/connected-execution-read-only-tool-call-preflight-2026-06-05.md", "utf8");

assert(worker.includes("READ_ONLY_TOOL_CALL_ALLOWLIST"), "worker must define read-only tool call allowlist");
assert(worker.includes("platform_data_source_census"), "allowlist should include a safe diagnostic read tool");
assert(worker.includes("buildReadOnlyToolCallPreflight"), "worker must build preflight evidence");
assert(worker.includes("tool_not_in_read_only_allowlist"), "worker must block non-allowlisted tools");
assert(worker.includes("tool_method_not_get_read_only"), "worker must block non-GET tools");
assert(worker.includes("tool_has_mutating_tag"), "worker must block mutating tags");
assert(worker.includes("certification_allows_apply"), "worker must block apply-enabled certifications");
assert(worker.includes("read_only_tool_call_preflight_only"), "worker must mark preflight-only phase");
assert(worker.includes("tool_call_executed: false"), "worker must not execute tool calls in this phase");
assert(worker.includes("external_tool_calls_executed: false"), "worker must preserve no-external-call evidence");
assert(!worker.includes("callAdminTool"), "worker must not call dispatcher directly");
assert(!worker.includes("fetch("), "worker must not call external HTTP from this phase");
assert(!worker.includes("exec("), "worker must not execute shell commands");

assert(routes.includes('["analysis_step", "tool_call"].includes(action.action_kind)'), "enqueue route must allow tool_call preflight");
assert(routes.includes("will_preflight_tool_call"), "enqueue response must expose preflight flag");
assert(routes.includes("will_call_tools: willExecuteReadOnlyToolCall"), "enqueue response must keep preflight separate from opt-in execution");

assert(migration.includes("connected_execution_worker_bridge_v2_read_only_tool_call_preflight"), "migration must register v2 certification");
assert(migration.includes("read_only_tool_call_preflight"), "migration must update tool tags/description");
assert(migration.includes("no_tool_execution"), "migration must preserve no-tool-execution tag");
assert(!/DROP\s+/i.test(migration));
assert(!/DELETE\s+/i.test(migration));
assert(!/TRUNCATE\s+/i.test(migration));

assert(runner.includes("193_sprint66_connected_execution_read_only_tool_call_preflight.sql"), "runner must allow migration 193");
assert(readiness.includes("193_sprint66_connected_execution_read_only_tool_call_preflight.sql"), "readiness must expect migration 193");
assert(openapi.includes("enum: [analysis_step, tool_call]"), "OpenAPI must document tool_call enqueue action kind");
assert(openapi.includes("will_preflight_tool_call"), "OpenAPI must document preflight flag");
assert(docs.includes("read-only preflight and evidence"), "docs must state preflight scope");

console.log("connected execution read-only tool call preflight contract tests passed");
