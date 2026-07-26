import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const worker = readFileSync("connectedExecutionWorker.js", "utf8");
const routes = readFileSync("routes/connectedExecutionRoutes.js", "utf8");
const jobRunner = readFileSync("jobRunner.js", "utf8");
const executionAsync = readFileSync("executionAsync.js", "utf8");
const migration = readFileSync("migrations/191_sprint66_connected_execution_worker_bridge.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const readiness = readFileSync("releaseReadiness.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const doc = readFileSync("../docs/connected-execution-worker-bridge-2026-06-04.md", "utf8");

assert(worker.includes('CONNECTED_EXECUTION_RESUME_ACTION_JOB_TYPE = "connected_execution_resume_action"'));
assert(worker.includes('["analysis_step", "tool_call"].includes(actionKind)'));
assert(worker.includes("unsupported_action_kind_for_worker_bridge"));
assert(worker.includes("external_tool_calls_executed: false"));
assert(worker.includes("repo_mutation_executed: false"));
assert(worker.includes("provider_calls_executed: false"));
assert(worker.includes("local_device_calls_executed: false"));
assert(worker.includes("secrets_included: false"));
assert(!worker.includes("fetch("));
assert(!worker.includes("exec("));

assert(routes.includes("/connected-execution/sessions/:connected_session_id/resume-actions/:resume_action_id/enqueue"));
assert(routes.includes("CONNECTED_EXECUTION_RESUME_ACTION_JOB_TYPE"));
assert(routes.includes('["analysis_step", "tool_call"].includes(action.action_kind)'));
assert(routes.includes("will_execute_external_action: false"));
assert(routes.includes("will_call_tools: willExecuteReadOnlyToolCall"));
assert(routes.includes("will_mutate_repo: false"));
assert(routes.includes("will_call_provider: false"));
assert(routes.includes("will_call_local_device: false"));

assert(jobRunner.includes("runConnectedExecutionResumeAction"));
assert(jobRunner.includes("CONNECTED_EXECUTION_RESUME_ACTION_JOB_TYPE"));
assert(executionAsync.includes("CONNECTED_EXECUTION_RESUME_ACTION_JOB_TYPE"));
assert(executionAsync.includes("isConnectedExecutionResumeActionJob"));

assert(migration.includes("connected_execution_resume_action_enqueue_dry_run"));
assert(migration.includes("connected_execution_worker_bridge_v1"));
assert(migration.includes("analysis_step_only"));
assert(migration.includes("no_tool_execution"));
assert(migration.includes("no_repo_mutation"));
assert(migration.includes("no_provider_call"));
assert(migration.includes("no_local_device_call"));
assert(migration.includes("apply_allowed"));
assert(!/DROP\s+/i.test(migration));
assert(!/DELETE\s+/i.test(migration));
assert(!/TRUNCATE\s+/i.test(migration));
assert(!/CAST\s*\(\s*\?\s+AS\s+JSON\s*\)/i.test(migration));

assert(runner.includes("191_sprint66_connected_execution_worker_bridge.sql"));
assert(readiness.includes("191_sprint66_connected_execution_worker_bridge.sql"));
assert(openapi.includes("operationId: enqueueConnectedExecutionResumeActionDryRun"));
assert(openapi.includes("ConnectedExecutionResumeActionEnqueueRequest"));
assert(openapi.includes("ConnectedExecutionResumeActionEnqueueResponse"));
assert(doc.includes("Phase 1: analysis_step metadata only"));

console.log("connected execution worker bridge contract tests passed");
