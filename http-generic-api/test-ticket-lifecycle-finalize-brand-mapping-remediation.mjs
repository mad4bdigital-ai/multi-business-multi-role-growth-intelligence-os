import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/250_sprint68_ticket_lifecycle_finalize_brand_mapping_remediation.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "finalizeSupportTicketBrandMappingRemediation",
  "readyForApply",
  "approval_checks",
  "verified_apply_dry_run",
  "support_ticket_finalize_remediation_not_ready",
  "runSupportTicketDiagnosticChain",
  "diagnosticBlocked",
  "brand_mapping_remediation_finalized",
  "brand_mapping_remediation_finalization_incomplete",
  "close_if_verified",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

assert(service.includes("close_if_verified = true"), "verified apply must keep default close behavior");
assert(service.includes("verified && close_if_verified"), "verified apply must respect close control");

assert(routes.includes('/admin/support/tickets/:ticket_id/brand-mapping-remediation/finalize'), "route must expose finalize endpoint");
assert(routes.includes("finalizeSupportTicketBrandMappingRemediation"), "route must call finalizer service");
const routeIndex = routes.indexOf('/admin/support/tickets/:ticket_id/brand-mapping-remediation/finalize');
const routeBlock = routes.slice(routeIndex, routeIndex + 2200);
assert(routeBlock.includes("selected_brand_ref"), "route must pass selected_brand_ref");
assert(routeBlock.includes("brand_ref_selection_hold_id"), "route must pass selection hold");
assert(routeBlock.includes("new_brand_ref_approval_hold_id"), "route must pass new brand approval hold");
assert(routeBlock.includes("remediation_approval_hold_id"), "route must pass remediation approval hold");
assert(routeBlock.includes("workflow_run_id"), "route must pass workflow run id");
assert(routeBlock.includes("plan_id"), "route must pass plan id");

assert(migration.includes("support_ticket_finalize_brand_mapping_remediation"), "migration 250 must register finalizer tool");
assert(migration.includes("diagnostic_chain"), "migration 250 must document diagnostic chain requirement");
assert(runner.includes("250_sprint68_ticket_lifecycle_finalize_brand_mapping_remediation.sql"), "runner must allowlist migration 250");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 250 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle finalize brand mapping remediation tests passed");
