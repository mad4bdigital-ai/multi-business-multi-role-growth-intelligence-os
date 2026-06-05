import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const worker = readFileSync("connectedExecutionWorker.js", "utf8");
const routes = readFileSync("routes/connectedExecutionRoutes.js", "utf8");
const migration = readFileSync("migrations/195_sprint66_connected_execution_read_only_tool_execution.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const readiness = readFileSync("releaseReadiness.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const docs = readFileSync("../docs/connected-execution-read-only-tool-execution-2026-06-05.md", "utf8");

assert(worker.includes("dispatchToolForCaller"), "worker must use governed internal tool dispatcher");
assert(worker.includes("shouldExecuteReadOnlyToolCall"), "worker must require explicit read-only execution opt-in");
assert(worker.includes("execute_read_only_tool_call === true"), "action payload opt-in must be required");
assert(worker.includes("allow_read_only_tool_execution === true"), "guardrail opt-in must be required");
assert(worker.includes("READ_ONLY_TOOL_OUTPUT_DEFAULT_MAX_CHARS = 6000"), "worker must define bounded output default");
assert(worker.includes("READ_ONLY_TOOL_OUTPUT_HARD_MAX_CHARS = 10000"), "worker must define hard output cap");
assert(worker.includes("max_tool_calls: 1"), "worker must budget one tool call per action");
assert(worker.includes("redactForEvidence"), "worker must redact output before evidence");
assert(worker.includes("tool_result_redacted"), "worker must store redacted result evidence");
assert(worker.includes("read_only_tool_call_execution_v1"), "worker must mark execution phase");
assert(worker.includes("internal_tool_dispatch_executed: true"), "execution evidence must record internal dispatch");
assert(worker.includes("mutating_call_executed: false"), "execution evidence must record no mutating call");
assert(worker.includes("repo_mutation_executed: false"), "execution evidence must record no repo mutation");
assert(worker.includes("provider_calls_executed: false"), "execution evidence must record no provider calls");
assert(worker.includes("local_device_calls_executed: false"), "execution evidence must record no local device calls");
assert(worker.includes("apply_operation_executed: false"), "execution evidence must record no apply operation");
assert(worker.includes("secrets_included: false"), "execution evidence must remain no-secret");
assert(!worker.includes("exec("), "worker must not execute shell commands");

assert(routes.includes("willExecuteReadOnlyToolCall"), "enqueue route must compute read-only execution intent");
assert(routes.includes("execute_read_only_tool_call === true"), "route must require action payload execution opt-in");
assert(routes.includes("allow_read_only_tool_execution === true"), "route must require guardrail execution opt-in");
assert(routes.includes("will_execute_read_only_tool_call"), "route response must expose read-only execution flag");
assert(routes.includes("will_call_tools: willExecuteReadOnlyToolCall"), "route must only announce tool calls for opted-in executions");

assert(migration.includes("connected_execution_worker_bridge_v3_read_only_tool_execution"), "migration must register v3 execution certification");
assert(migration.includes("read_only_tool_call_execution"), "migration must update tool tags");
assert(migration.includes("budgeted_tool_call"), "migration must tag budgeted execution");
assert(migration.includes("output_redaction"), "migration must tag output redaction");
assert(migration.includes("no_repo_mutation"), "migration must preserve no repo mutation");
assert(migration.includes("no_provider_call"), "migration must preserve no provider call");
assert(migration.includes("no_local_device_call"), "migration must preserve no local device call");
assert(migration.includes("no_apply"), "migration must preserve no apply operation");
assert(migration.includes("updated_at = CURRENT_TIMESTAMP"), "migration should use registry freshness column");
assert(!/DROP\s+/i.test(migration));
assert(!/DELETE\s+/i.test(migration));
assert(!/TRUNCATE\s+/i.test(migration));

assert(runner.includes("195_sprint66_connected_execution_read_only_tool_execution.sql"), "runner must allow migration 195");
assert(readiness.includes("195_sprint66_connected_execution_read_only_tool_execution.sql"), "readiness must expect migration 195");
assert(openapi.includes("will_execute_read_only_tool_call"), "OpenAPI must document execution flag");
assert(openapi.includes("True only when an allowlisted read-only tool_call action explicitly opts into execution"), "OpenAPI must describe guarded tool execution");
assert(docs.includes("Required opt-in"), "docs must describe execution opt-in");
assert(docs.includes("max_tool_calls: 1"), "docs must document tool-call budget");
assert(docs.includes("output_redaction"), "docs must document output redaction");
assert(docs.includes("read_only_tool_call_allowlist_v2"), "docs must document the bumped allowlist version");
assert(docs.includes("platform_graph_status"), "docs must document the second diagnostic GET tool");

console.log("connected execution read-only tool execution contract tests passed");
