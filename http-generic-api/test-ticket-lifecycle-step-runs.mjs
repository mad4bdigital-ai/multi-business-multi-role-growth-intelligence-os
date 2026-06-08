import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTicketClassification } from "./supportTicketService.js";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/238_sprint68_ticket_lifecycle_step_runs.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const { normalizePlanSteps, workflowStateFromSteps } = _testingTicketClassification();

const normalized = normalizePlanSteps(JSON.stringify([
  { key: "read_workspace_membership", action: "verify requester workspace membership" },
  { key: "read_brand_grants", action: "inspect grant evidence", type: "review" },
]));
assert.equal(normalized.length, 2);
assert.equal(normalized[0].key, "read_workspace_membership");
assert.equal(normalized[0].type, "action");
assert.equal(normalized[1].type, "review");

assert.deepEqual(
  workflowStateFromSteps({ run: { status: "running" }, stepRows: [{ step_key: "read_workspace_membership", status: "running" }, { step_key: "read_brand_grants", status: "pending" }] }),
  { run_status: "running", plan_status: "executing", ticket_status: "in_review", lifecycle_state: "automation_running", customer_status: "in_progress", current_step: "read_workspace_membership", reason: "step_running" }
);
assert.deepEqual(
  workflowStateFromSteps({ stepRows: [{ step_key: "approval", status: "awaiting" }] }),
  { run_status: "awaiting_review", plan_status: "executing", ticket_status: "in_review", lifecycle_state: "awaiting_internal_approval", customer_status: "waiting_for_approval", current_step: "approval", reason: "step_awaiting" }
);
assert.deepEqual(
  workflowStateFromSteps({ stepRows: [{ step_key: "read_workspace_membership", status: "completed" }, { step_key: "read_brand_grants", status: "skipped" }] }),
  { run_status: "completed", plan_status: "completed", ticket_status: "resolved", lifecycle_state: "verified", customer_status: "resolved", current_step: null, reason: "all_steps_completed" }
);
assert.deepEqual(
  workflowStateFromSteps({ stepRows: [{ step_key: "read_workspace_membership", status: "failed" }] }),
  { run_status: "failed", plan_status: "failed", ticket_status: "in_review", lifecycle_state: "verification_failed", customer_status: "under_review", current_step: "read_workspace_membership", reason: "step_failed" }
);

for (const expected of [
  "createSupportTicketStepRuns",
  "updateSupportTicketStepRun",
  "normalizePlanSteps",
  "workflowStateFromSteps",
  "INSERT INTO step_runs",
  "step_runs_created",
  "step_run_updated",
  "support_ticket_step_runs_created",
  "support_ticket_step_run_updated",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

for (const expectedRoute of [
  '/admin/support/tickets/:ticket_id/step-runs',
  '/admin/support/tickets/:ticket_id/step-run',
]) {
  assert(routes.includes(expectedRoute), `support routes must expose ${expectedRoute}`);
}
assert(routes.includes("createSupportTicketStepRuns"), "step-runs route must call creation service");
assert(routes.includes("updateSupportTicketStepRun"), "step-run route must call update service");

for (const expectedTool of [
  "support_ticket_create_step_runs",
  "support_ticket_update_step_run",
]) {
  assert(migration.includes(expectedTool), `migration 238 must register ${expectedTool}`);
}
assert(runner.includes("238_sprint68_ticket_lifecycle_step_runs.sql"), "runner must allowlist migration 238");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 238 must be additive/non-destructive");

console.log("ticket lifecycle step run tests passed");
