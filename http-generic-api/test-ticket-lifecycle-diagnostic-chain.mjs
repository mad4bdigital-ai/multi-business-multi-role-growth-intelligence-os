import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/240_sprint68_ticket_lifecycle_diagnostic_chain.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "runSupportTicketDiagnosticChain",
  "executeSupportTicketDiagnosticStep",
  "createSupportTicketStepRuns",
  "createSupportTicketApprovalHold",
  "diagnostic_chain_completed",
  "mapping_review_required",
  "existing_open_remediation_hold",
  "support_ticket_diagnostic_chain_completed",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

assert(routes.includes('/admin/support/tickets/:ticket_id/diagnostic-chain'), "route must expose diagnostic-chain endpoint");
assert(routes.includes("runSupportTicketDiagnosticChain"), "route must call diagnostic chain service");
assert(migration.includes("support_ticket_run_diagnostic_chain"), "migration 240 must register support_ticket_run_diagnostic_chain");
assert(runner.includes("240_sprint68_ticket_lifecycle_diagnostic_chain.sql"), "runner must allowlist migration 240");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 240 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket lifecycle diagnostic chain tests passed");
