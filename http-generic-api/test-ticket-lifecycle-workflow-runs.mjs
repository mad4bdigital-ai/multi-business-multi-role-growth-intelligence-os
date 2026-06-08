import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTicketClassification } from "./supportTicketService.js";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/237_sprint68_ticket_lifecycle_workflow_runs.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const { ticketStateFromRuntime } = _testingTicketClassification();

assert.deepEqual(
  ticketStateFromRuntime({ run: { status: "running" }, plan: { plan_status: "executing" } }),
  { status: "in_review", lifecycle_state: "automation_running", customer_status: "in_progress", reason: "workflow_running" }
);
assert.deepEqual(
  ticketStateFromRuntime({ run: { status: "completed" } }),
  { status: "resolved", lifecycle_state: "verified", customer_status: "resolved", reason: "workflow_completed" }
);
assert.deepEqual(
  ticketStateFromRuntime({ run: { status: "failed" } }),
  { status: "in_review", lifecycle_state: "verification_failed", customer_status: "under_review", reason: "workflow_failed" }
);
assert.deepEqual(
  ticketStateFromRuntime({ hold: { status: "open" } }),
  { status: "awaiting_approval", lifecycle_state: "awaiting_internal_approval", customer_status: "waiting_for_approval", reason: "approval_hold_open" }
);

for (const expected of [
  "createSupportTicketWorkflowRun",
  "syncSupportTicketRuntimeStatus",
  "resolveTicketExecutionPlan",
  "ticketStateFromRuntime",
  "INSERT INTO workflow_runs",
  "workflow_run_created",
  "runtime_status_synced",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

for (const expectedRoute of [
  '/admin/support/tickets/:ticket_id/workflow-run',
  '/admin/support/tickets/:ticket_id/runtime-sync',
]) {
  assert(routes.includes(expectedRoute), `support routes must expose ${expectedRoute}`);
}
assert(routes.includes("createSupportTicketWorkflowRun"), "workflow-run route must call service");
assert(routes.includes("syncSupportTicketRuntimeStatus"), "runtime-sync route must call service");

for (const expectedTool of [
  "support_ticket_create_workflow_run",
  "support_ticket_runtime_sync",
]) {
  assert(migration.includes(expectedTool), `migration 237 must register ${expectedTool}`);
}
assert(runner.includes("237_sprint68_ticket_lifecycle_workflow_runs.sql"), "runner must allowlist migration 237");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 237 must be additive/non-destructive");

console.log("ticket lifecycle workflow run tests passed");
