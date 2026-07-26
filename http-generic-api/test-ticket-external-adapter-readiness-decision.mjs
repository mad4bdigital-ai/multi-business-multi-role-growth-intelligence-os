import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalAdapterReadinessChecklistService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/268_sprint68_ticket_external_adapter_readiness_decision.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "decideSupportTicketExternalAdapterReadinessChecklist",
  "ALLOWED_CHECKLIST_DECISIONS",
  "approve_for_future_pr",
  "needs_changes",
  "support_ticket_external_adapter_readiness_decision_recorded",
  "registry_mutation_performed: false",
  "adapter_implementation_performed: false",
  "dispatch_enabled_changed: false",
  "provider_dispatch_enabled_changed: false",
  "external_send_performed: false",
  "return { ...planned, ok: true, mode: \"record_checklist\"",
]) {
  assert(service.includes(expected), `adapter readiness decision service must include ${expected}`);
}

for (const expected of [
  "external_delivery_provider_adapter_readiness_decisions",
  "v_external_delivery_provider_adapter_readiness_decision_summary",
  "external_adapter_readiness_decision_policy_v1",
  "support_ticket_external_adapter_readiness_decision",
  "adapter_implementation_allowed', false",
  "provider_dispatch_enablement_allowed', false",
  "external_send_allowed', false",
  "approve_for_future_pr_does_not_enable_dispatch",
]) {
  assert(migration.includes(expected), `adapter readiness decision migration must include ${expected}`);
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
  assert(!service.includes(forbidden), `decision service must not enable or send: ${forbidden}`);
  assert(!migration.includes(forbidden), `decision migration must not enable or send: ${forbidden}`);
}

assert(routes.includes("decideSupportTicketExternalAdapterReadinessChecklist"), "routes must call checklist decision service");
assert(routes.includes('/admin/support/tickets/external-send/provider-adapter-readiness/decision'), "routes must expose checklist decision endpoint");
assert(runner.includes("268_sprint68_ticket_external_adapter_readiness_decision.sql"), "runner must allowlist migration 268");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 268 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external adapter readiness decision tests passed");
