import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/249_sprint68_ticket_lifecycle_verified_apply_rollback.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "applySupportTicketBrandMappingVerified",
  "before_grants",
  "before_effective",
  "after_grants",
  "after_effective",
  "support_ticket_verified_apply_readback_failed",
  "rollback_on_failed_verification",
  "brand_mapping_verified_apply_completed",
  "brand_mapping_verified_apply_unverified",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

assert(routes.includes('/admin/support/tickets/:ticket_id/brand-mapping-remediation/verified-apply'), "route must expose verified-apply endpoint");
assert(routes.includes("requireTrustedBrandRefForRemediation"), "verified route must use trusted brand ref guard");
assert(routes.includes("applySupportTicketBrandMappingVerified"), "verified route must call verified apply service");
const routeIndex = routes.indexOf('/admin/support/tickets/:ticket_id/brand-mapping-remediation/verified-apply');
const routeBlock = routes.slice(routeIndex, routeIndex + 1800);
assert(routeBlock.indexOf("requireTrustedBrandRefForRemediation") < routeBlock.indexOf("applySupportTicketBrandMappingVerified"), "trusted brand ref guard must run before verified apply service");

assert(migration.includes("support_ticket_verified_brand_mapping_apply"), "migration 249 must register verified apply tool");
assert(migration.includes("rollback"), "migration 249 must document rollback behavior");
assert(runner.includes("249_sprint68_ticket_lifecycle_verified_apply_rollback.sql"), "runner must allowlist migration 249");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 249 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle verified apply rollback tests passed");
