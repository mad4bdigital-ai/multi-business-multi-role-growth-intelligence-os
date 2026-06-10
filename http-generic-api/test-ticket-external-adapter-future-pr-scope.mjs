import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalAdapterFuturePrScopeService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/269_sprint68_ticket_external_adapter_future_pr_scope.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "planSupportTicketExternalAdapterFuturePrScope",
  "recordSupportTicketExternalAdapterFuturePrScope",
  "approve_for_future_pr",
  "generated_scope_only",
  "support_ticket_external_adapter_future_pr_scope_recorded",
  "registry_mutation_performed: false",
  "adapter_implementation_performed: false",
  "dispatch_enabled_changed: false",
  "provider_dispatch_enabled_changed: false",
  "external_send_performed: false",
  "out_of_scope",
]) {
  assert(service.includes(expected), `future PR scope service must include ${expected}`);
}

for (const expected of [
  "external_delivery_provider_adapter_future_pr_scopes",
  "v_external_delivery_provider_adapter_future_pr_scope_summary",
  "external_adapter_future_pr_scope_policy_v1",
  "support_ticket_external_adapter_future_pr_scope_plan",
  "support_ticket_external_adapter_future_pr_scope_record",
  "adapter_implementation_allowed', false",
  "provider_dispatch_enablement_allowed', false",
  "external_send_allowed', false",
  "requires_approve_for_future_pr_decision",
]) {
  assert(migration.includes(expected), `future PR scope migration must include ${expected}`);
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
  assert(!service.includes(forbidden), `future PR scope service must not enable or send: ${forbidden}`);
  assert(!migration.includes(forbidden), `future PR scope migration must not enable or send: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalAdapterFuturePrScopeService.js"), "routes must import future PR scope service");
assert(routes.includes('/admin/support/tickets/external-send/provider-adapter-future-pr-scope/plan'), "routes must expose future PR scope plan endpoint");
assert(routes.includes('/admin/support/tickets/external-send/provider-adapter-future-pr-scope/record'), "routes must expose future PR scope record endpoint");
assert(runner.includes("269_sprint68_ticket_external_adapter_future_pr_scope.sql"), "runner must allowlist migration 269");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 269 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external adapter future PR scope tests passed");
