import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalProviderEnablementProposalService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/266_sprint68_ticket_external_provider_enablement_proposal.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "listSupportTicketExternalProviderEnablementCandidates",
  "proposeSupportTicketExternalProviderAdapterEnablement",
  "external_delivery_provider_adapter_enablement_proposals",
  "proposal_only: true",
  "registry_mutation_performed: false",
  "external_send_performed: false",
  "provider_dispatch_disabled_by_policy",
  "adapter_implementation_missing",
  "support_ticket_external_provider_adapter_enablement_proposed",
]) {
  assert(service.includes(expected), `enablement proposal service must include ${expected}`);
}

for (const expected of [
  "external_provider_adapter_enablement_proposal_policy_v1",
  "support_ticket_external_provider_enablement_candidates",
  "support_ticket_external_provider_enablement_propose",
  "registry_mutation_allowed', false",
  "provider_dispatch_enablement_allowed', false",
  "external_send_allowed', false",
  "v_external_delivery_provider_enablement_proposal_readiness",
]) {
  assert(migration.includes(expected), `enablement proposal migration must include ${expected}`);
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
  assert(!service.includes(forbidden), `enablement proposal service must not enable or send: ${forbidden}`);
  assert(!migration.includes(forbidden), `enablement proposal migration must not enable or send: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalProviderEnablementProposalService.js"), "routes must import provider enablement proposal service");
assert(routes.includes('/admin/support/tickets/external-send/provider-adapter-enablement/candidates'), "routes must expose enablement candidates endpoint");
assert(routes.includes('/admin/support/tickets/external-send/provider-adapter-enablement/propose'), "routes must expose enablement propose endpoint");
assert(routes.includes("listSupportTicketExternalProviderEnablementCandidates"), "routes must call candidates service");
assert(routes.includes("proposeSupportTicketExternalProviderAdapterEnablement"), "routes must call propose service");
assert(runner.includes("266_sprint68_ticket_external_provider_enablement_proposal.sql"), "runner must allowlist migration 266");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 266 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external provider enablement proposal tests passed");
