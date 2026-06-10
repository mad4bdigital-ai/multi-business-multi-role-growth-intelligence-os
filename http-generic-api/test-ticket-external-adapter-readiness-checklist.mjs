import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalAdapterReadinessChecklistService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/267_sprint68_ticket_external_adapter_readiness_checklist.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "planSupportTicketExternalAdapterReadinessChecklist",
  "recordSupportTicketExternalAdapterReadinessChecklist",
  "external_delivery_provider_adapter_readiness_checklists",
  "blocked_until_future_implementation_and_policy",
  "adapter_implementation_pr_required",
  "provider_dispatch_policy_required",
  "support_ticket_external_adapter_readiness_checklist_recorded",
  "registry_mutation_performed: false",
  "external_send_performed: false",
  "SAFE_SECRET_MARKER_KEYS",
]) {
  assert(service.includes(expected), `adapter readiness checklist service must include ${expected}`);
}

for (const expected of [
  "external_adapter_readiness_checklist_policy_v1",
  "support_ticket_external_adapter_readiness_plan",
  "support_ticket_external_adapter_readiness_record",
  "adapter_implementation_allowed', false",
  "provider_dispatch_enablement_allowed', false",
  "external_send_allowed', false",
  "v_external_delivery_provider_adapter_readiness_checklist_summary",
]) {
  assert(migration.includes(expected), `adapter readiness checklist migration must include ${expected}`);
}

for (const forbidden of [
  "sendMail",
  "nodemailer",
  "fetch(",
  "axios",
  "webhook.send",
  "external_send_performed: true",
  "external_send_performed', true",
  "provider_dispatch_enabled = 1",
  "dispatch_enabled = 1",
  "UPDATE external_delivery_provider_adapter_contract_registry",
]) {
  assert(!service.includes(forbidden), `readiness checklist service must not enable or send: ${forbidden}`);
  assert(!migration.includes(forbidden), `readiness checklist migration must not enable or send: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalAdapterReadinessChecklistService.js"), "routes must import adapter readiness checklist service");
assert(routes.includes('/admin/support/tickets/external-send/provider-adapter-readiness/plan'), "routes must expose readiness plan endpoint");
assert(routes.includes('/admin/support/tickets/external-send/provider-adapter-readiness/record'), "routes must expose readiness record endpoint");
assert(routes.includes("planSupportTicketExternalAdapterReadinessChecklist"), "routes must call readiness plan service");
assert(routes.includes("recordSupportTicketExternalAdapterReadinessChecklist"), "routes must call readiness record service");
assert(runner.includes("267_sprint68_ticket_external_adapter_readiness_checklist.sql"), "runner must allowlist migration 267");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 267 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external adapter readiness checklist tests passed");
