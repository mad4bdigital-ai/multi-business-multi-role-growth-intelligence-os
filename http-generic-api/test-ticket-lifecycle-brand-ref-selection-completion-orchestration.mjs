import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/245_sprint68_ticket_lifecycle_brand_ref_selection_completion.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "completeSupportTicketBrandRefSelectionRemediation",
  "brand_ref_selection_hold_id",
  "remediation_approval_hold_id",
  "mode = \"dry_run\"",
  "would_apply_grant",
  "support_ticket_remediation_approval_hold_not_found",
  "approveSupportTicketBrandRefSelection",
  "completeSupportTicketBrandMappingRemediation",
  "brand_ref_selection_remediation_orchestrated",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

assert(routes.includes('/admin/support/tickets/:ticket_id/brand-ref-selection/approve-and-complete'), "route must expose approve-and-complete endpoint");
assert(routes.includes("completeSupportTicketBrandRefSelectionRemediation"), "route must call orchestration service");
assert(routes.includes("brand_ref_selection_hold_id"), "route must accept selection hold id separately");
assert(routes.includes("remediation_approval_hold_id"), "route must accept remediation hold id separately");

assert(migration.includes("support_ticket_approve_brand_ref_selection_and_complete"), "migration 245 must register orchestration tool");
assert(migration.includes("dry_run"), "migration schema must include dry_run mode");
assert(runner.includes("245_sprint68_ticket_lifecycle_brand_ref_selection_completion.sql"), "runner must allowlist migration 245");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 245 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle brand ref selection completion orchestration tests passed");
