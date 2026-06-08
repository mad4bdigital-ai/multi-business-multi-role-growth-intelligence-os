import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTicketClassification } from "./supportTicketService.js";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/243_sprint68_ticket_lifecycle_brand_ref_resolution.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const { mergeBrandRefCandidate } = _testingTicketClassification();

const candidates = new Map();
mergeBrandRefCandidate(candidates, { brand_ref: "all-royal", source: "workspace_assets", confidence: 75, reason: "asset evidence" });
mergeBrandRefCandidate(candidates, { brand_ref: "all-royal", source: "effective_brand_grant", confidence: 100, reason: "grant evidence" });
assert.equal(candidates.get("all-royal").confidence, 100);
assert.deepEqual(candidates.get("all-royal").sources.sort(), ["effective_brand_grant", "workspace_assets"]);

for (const expected of [
  "resolveSupportTicketBrandRefs",
  "mergeBrandRefCandidate",
  "effective_brand_grant",
  "workspace_assets",
  "workspace_registry",
  "legacy_brand_registry",
  "trusted_for_remediation",
  "selected_brand_ref",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

assert(routes.includes('/admin/support/tickets/:ticket_id/brand-ref-resolution'), "route must expose brand-ref-resolution endpoint");
assert(routes.includes("resolveSupportTicketBrandRefs"), "route must call resolver service");
assert(migration.includes("support_ticket_resolve_brand_refs"), "migration 243 must register resolver tool");
assert(runner.includes("243_sprint68_ticket_lifecycle_brand_ref_resolution.sql"), "runner must allowlist migration 243");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 243 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle brand ref resolution tests passed");
