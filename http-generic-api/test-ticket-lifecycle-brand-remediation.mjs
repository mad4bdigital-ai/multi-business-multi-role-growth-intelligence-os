import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTicketClassification } from "./supportTicketService.js";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/241_sprint68_ticket_lifecycle_brand_mapping_remediation.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const { normalizeBrandGrantTargets } = _testingTicketClassification();

assert.deepEqual(normalizeBrandGrantTargets({ brand_ref: " all-royal " }), ["all-royal"]);
assert.deepEqual(normalizeBrandGrantTargets({ brand_refs: ["a", "a", "", "b"] }), ["a", "b"]);

for (const expected of [
  "applySupportTicketBrandMappingRemediation",
  "workspace_resource_grants",
  "v_workspace_resource_grant_effective",
  "support_ticket_remediation_requires_approved_hold",
  "support_ticket_brand_ref_required",
  "support_ticket_active_membership_required",
  "brand_mapping_remediation_applied",
  "admin_repair",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

assert(routes.includes('/admin/support/tickets/:ticket_id/brand-mapping-remediation'), "route must expose brand-mapping-remediation endpoint");
assert(routes.includes("applySupportTicketBrandMappingRemediation"), "route must call remediation service");
assert(migration.includes("support_ticket_apply_brand_mapping_remediation"), "migration 241 must register remediation tool");
assert(runner.includes("241_sprint68_ticket_lifecycle_brand_mapping_remediation.sql"), "runner must allowlist migration 241");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 241 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle brand remediation tests passed");
