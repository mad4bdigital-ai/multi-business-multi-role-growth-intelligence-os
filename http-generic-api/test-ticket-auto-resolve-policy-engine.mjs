import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketAutoResolveService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/253_sprint68_ticket_auto_resolve_policy_engine.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "AUTO_RESOLVE_POLICIES",
  "brand_authority_missing",
  "tenant_onboarding_issue",
  "connector_unreachable",
  "workflow_failed",
  "requires_admin_approval",
  "readback_required",
  "rollback_required",
  "notify_before_apply",
  "listSupportTicketAutoResolveCandidates",
  "proposeSupportTicketAutoResolution",
  "backend_agent_proposed_resolution",
  "auto_resolution_proposed",
  "support_ticket_auto_resolve_not_eligible",
]) {
  assert(service.includes(expected), `auto resolve service must include ${expected}`);
}

for (const forbidden of ["applySupportTicketBrandMapping", "finalizeSupportTicketBrandMapping", "mode: \"apply\"", "mode = \"apply\""]) {
  assert(!service.includes(forbidden), `auto resolve policy engine must not execute apply path: ${forbidden}`);
}

assert(routes.includes("supportTicketAutoResolveService.js"), "routes must import auto resolve service");
assert(routes.includes('/admin/support/tickets/auto-resolve/candidates'), "routes must expose auto-resolve candidates endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/auto-resolve/propose'), "routes must expose auto-resolve proposal endpoint");
assert(routes.includes("listSupportTicketAutoResolveCandidates"), "route must call candidates service");
assert(routes.includes("proposeSupportTicketAutoResolution"), "route must call proposal service");

for (const expectedTool of ["support_ticket_auto_resolve_candidates", "support_ticket_auto_resolve_propose"]) {
  assert(migration.includes(expectedTool), `migration 253 must register ${expectedTool}`);
}
assert(migration.includes("Proposal only") || migration.includes("no auto-apply"), "migration must document no auto-apply behavior");
assert(runner.includes("253_sprint68_ticket_auto_resolve_policy_engine.sql"), "runner must allowlist migration 253");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 253 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket auto resolve policy engine tests passed");
