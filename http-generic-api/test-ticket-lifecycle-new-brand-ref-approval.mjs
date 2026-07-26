import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/246_sprint68_ticket_lifecycle_new_brand_ref_approval.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "findApprovedNewBrandRefApproval",
  "requestSupportTicketNewBrandRefApproval",
  "approveSupportTicketNewBrandRef",
  "new_brand_ref_approval_requested",
  "new_brand_ref_approved",
  "support_ticket_new_brand_ref_approval_required",
  "support_ticket_new_brand_ref_approval_hold_not_found",
  "support_ticket_new_brand_ref_approval_hold_not_open",
  "newBrandRefApprovalRequired",
  "newBrandRefApprovalBlocked",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

for (const expectedRoute of [
  '/admin/support/tickets/:ticket_id/new-brand-ref-approval/request',
  '/admin/support/tickets/:ticket_id/new-brand-ref-approval/approve',
]) {
  assert(routes.includes(expectedRoute), `support routes must expose ${expectedRoute}`);
}
assert(routes.includes("requestSupportTicketNewBrandRefApproval"), "request route must call request service");
assert(routes.includes("approveSupportTicketNewBrandRef"), "approve route must call approve service");

for (const expectedTool of [
  "support_ticket_request_new_brand_ref_approval",
  "support_ticket_approve_new_brand_ref",
]) {
  assert(migration.includes(expectedTool), `migration 246 must register ${expectedTool}`);
}
assert(runner.includes("246_sprint68_ticket_lifecycle_new_brand_ref_approval.sql"), "runner must allowlist migration 246");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 246 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

const policyIndex = service.indexOf("const newBrandRefApprovalRequired");
const applyIndex = service.indexOf("const selection = await approveSupportTicketBrandRefSelection", policyIndex);
assert(policyIndex > -1, "new brand ref approval policy must exist");
assert(applyIndex > policyIndex, "policy must execute before apply mutations");
const policyBlock = service.slice(policyIndex, applyIndex);
assert(policyBlock.includes("findApprovedNewBrandRefApproval"), "policy must query approved new_brand_ref approval evidence");
assert(policyBlock.includes("support_ticket_new_brand_ref_approval_required"), "policy must block missing new brand_ref approval evidence");
assert(policyBlock.includes("throw err"), "policy must throw before mutation");

console.log("ticket lifecycle new brand ref approval tests passed");
