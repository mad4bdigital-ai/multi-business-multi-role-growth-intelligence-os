import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/242_sprint68_ticket_lifecycle_approval_remediation.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "resolveTicketApprovalHold",
  "decideSupportTicketApprovalHold",
  "completeSupportTicketBrandMappingRemediation",
  "approval_hold_decided",
  "brand_mapping_remediation_completed",
  "support_ticket_approval_hold_decided",
  "support_ticket_brand_mapping_remediation_completed",
  "support_ticket_approval_hold_not_open",
  "support_ticket_approval_decision_invalid",
  "support_ticket_completion_requires_approved_hold",
  "approved_for_remediation",
  "close_if_verified",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

for (const expectedRoute of [
  '/admin/support/tickets/:ticket_id/approval-hold/decision',
  '/admin/support/tickets/:ticket_id/brand-mapping-remediation/complete',
]) {
  assert(routes.includes(expectedRoute), `support routes must expose ${expectedRoute}`);
}
assert(routes.includes("decideSupportTicketApprovalHold"), "approval decision route must call decision service");
assert(routes.includes("completeSupportTicketBrandMappingRemediation"), "completion route must call completion service");

for (const expectedTool of [
  "support_ticket_decide_approval_hold",
  "support_ticket_complete_brand_mapping_remediation",
]) {
  assert(migration.includes(expectedTool), `migration 242 must register ${expectedTool}`);
}
assert(runner.includes("242_sprint68_ticket_lifecycle_approval_remediation.sql"), "runner must allowlist migration 242");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 242 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle approval remediation tests passed");
