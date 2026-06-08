import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTicketClassification } from "./supportTicketService.js";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/239_sprint68_ticket_lifecycle_diagnostic_steps.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const { buildDiagnosticStepOutput } = _testingTicketClassification();

assert.equal(typeof buildDiagnosticStepOutput, "function");

for (const expected of [
  "executeSupportTicketDiagnosticStep",
  "buildDiagnosticStepOutput",
  "read_workspace_membership",
  "read_brand_grants",
  "read_workspace_assets",
  "recommend_mapping_fix",
  "FROM memberships",
  "FROM v_workspace_resource_grant_effective",
  "FROM workspace_assets",
  "diagnostic_step_executed",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

assert(routes.includes('/admin/support/tickets/:ticket_id/step-run/execute'), "route must expose diagnostic step execution endpoint");
assert(routes.includes("executeSupportTicketDiagnosticStep"), "route must call diagnostic step service");
assert(migration.includes("support_ticket_execute_diagnostic_step"), "migration 239 must register support_ticket_execute_diagnostic_step");
assert(runner.includes("239_sprint68_ticket_lifecycle_diagnostic_steps.sql"), "runner must allowlist migration 239");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 239 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle diagnostic step tests passed");
