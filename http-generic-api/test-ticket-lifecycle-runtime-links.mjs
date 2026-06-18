import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTicketClassification } from "./supportTicketService.js";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/235_sprint68_ticket_lifecycle_runtime_links.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const { computeTicketSlaStatus } = _testingTicketClassification();

for (const expected of [
  "linkSupportTicketWorkflow",
  "createSupportTicketApprovalHold",
  "reconcileSupportTicketSla",
  "approval_hold_created",
  "workflow_linked",
  "sla_breached",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

for (const expectedRoute of [
  '/admin/support/tickets/:ticket_id/approval-hold',
  '/admin/support/tickets/:ticket_id/link-workflow',
  '/admin/support/tickets/sla/reconcile',
]) {
  assert(routes.includes(expectedRoute), `support routes must expose ${expectedRoute}`);
}

for (const expectedTool of [
  "support_ticket_create_approval_hold",
  "support_ticket_link_workflow",
  "support_ticket_sla_reconcile",
]) {
  assert(migration.includes(expectedTool), `migration 235 must register ${expectedTool}`);
}

assert(runner.includes("235_sprint68_ticket_lifecycle_runtime_links.sql"), "runner must allowlist migration 235");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 235 must be additive/non-destructive");

const now = new Date("2026-06-08T10:00:00.000Z");
assert.deepEqual(
  computeTicketSlaStatus({ status: "in_review", sla_status: "on_track", first_response_due_at: "2026-06-08T09:00:00.000Z" }, now),
  { status: "breached", reason: "first_response_due_at_past_due" }
);
assert.deepEqual(
  computeTicketSlaStatus({ status: "in_review", sla_status: "on_track", resolution_due_at: "2026-06-08T10:30:00.000Z" }, now),
  { status: "warning", reason: "resolution_due_at_within_60m" }
);
assert.deepEqual(
  computeTicketSlaStatus({ status: "in_review", sla_status: "on_track", triage_due_at: "2026-06-08T12:00:00.000Z" }, now),
  { status: "on_track", reason: "due_dates_on_track" }
);
assert.deepEqual(
  computeTicketSlaStatus({ status: "in_review", sla_status: "breached" }, now),
  { status: "on_track", reason: "no_due_dates" },
  "open tickets without due dates must not preserve stale stored SLA breach state"
);
assert.equal(computeTicketSlaStatus({ status: "closed", sla_status: "on_track", triage_due_at: "2026-06-08T09:00:00.000Z" }, now).reason, "ticket_not_open");

assert(service.includes("INSERT INTO approval_holds"), "approval hold service must create approval_holds rows");
assert(service.includes("INSERT INTO ticket_workflow_links"), "workflow link service must create ticket_workflow_links rows");
assert(routes.includes("createSupportTicketApprovalHold"), "approval-hold route must call service");
assert(routes.includes("linkSupportTicketWorkflow"), "link-workflow route must call service");
assert(routes.includes("reconcileSupportTicketSla"), "SLA route must call service");

console.log("ticket lifecycle runtime link tests passed");
