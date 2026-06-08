import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/244_sprint68_ticket_lifecycle_brand_ref_selection.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "requestSupportTicketBrandRefSelection",
  "approveSupportTicketBrandRefSelection",
  "brand_ref_selection_requested",
  "brand_ref_selection_approved",
  "support_ticket_brand_ref_selection_not_required",
  "support_ticket_selected_brand_ref_required",
  "support_ticket_selected_brand_ref_not_in_candidates",
  "selected_brand_ref",
  "manual_brand_ref_selection",
  "resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence: 0, limit: 50 }",
  "JSON_OBJECT('selected_brand_ref'",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

for (const expectedRoute of [
  '/admin/support/tickets/:ticket_id/brand-ref-selection/request',
  '/admin/support/tickets/:ticket_id/brand-ref-selection/approve',
]) {
  assert(routes.includes(expectedRoute), `support routes must expose ${expectedRoute}`);
}
assert(routes.includes("requestSupportTicketBrandRefSelection"), "request route must call request service");
assert(routes.includes("approveSupportTicketBrandRefSelection"), "approve route must call approve service");

for (const expectedTool of [
  "support_ticket_request_brand_ref_selection",
  "support_ticket_approve_brand_ref_selection",
]) {
  assert(migration.includes(expectedTool), `migration 244 must register ${expectedTool}`);
}
assert(runner.includes("244_sprint68_ticket_lifecycle_brand_ref_selection.sql"), "runner must allowlist migration 244");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 244 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle brand ref selection tests passed");
