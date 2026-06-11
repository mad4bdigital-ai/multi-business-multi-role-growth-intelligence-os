import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lifecycleNext = readFileSync("supportTicketLifecycleNextActionReadback.js", "utf8");
const externalReadback = readFileSync("supportTicketExternalDeliveryOrchestrationReadback.js", "utf8");
const platformReadback = readFileSync("platformOrchestrationReadback.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/910_sprint68_support_ticket_orchestration_completion_readbacks.sql", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

assert(lifecycleNext.includes("export async function readSupportTicketLifecycleNextAction"));
assert(externalReadback.includes("export async function readSupportTicketExternalDeliveryOrchestrationReadiness"));

for (const expected of ["support_ticket_lifecycle_next_action_readback", "support_ticket_external_delivery_readback", "support_ticket_external_delivery_orchestrator", "support_ticket_orchestration_completion_readbacks_policy_v1", "support_ticket_external_delivery_orchestration_readback_policy_v1", "v_platform_orchestration_support_ticket_external_delivery_readiness", "no_ticket_mutation", "no_workflow_dispatch", "no_approval_decision", "no_external_send", "no_external_write", "no_provider_call", "no_credential_payload_read", "secrets_included"]) assert(migration.includes(expected), `migration must include ${expected}`);

assert(routes.includes("readSupportTicketLifecycleNextAction"));
assert(routes.includes("readSupportTicketExternalDeliveryOrchestrationReadiness"));
assert(routes.includes('/platform/orchestration/support-ticket/next-action-readback'));
assert(routes.includes('/platform/orchestration/support-ticket/external-delivery/readback'));
assert(platformReadback.includes("support_ticket_external_delivery_orchestrator"));
assert(platformReadback.includes("support_ticket_external_delivery_readiness"));
assert(lifecycleNext.includes("customer_safe_next_step"));
assert(lifecycleNext.includes("will_mutate_ticket: false"));
assert(externalReadback.includes("will_external_send: false"));
assert(externalReadback.includes("will_read_credential_payload: false"));
assert(releaseReadiness.includes("910_sprint68_support_ticket_orchestration_completion_readbacks.sql"));
assert(releaseReadiness.includes('policy_key: "support_ticket_orchestration_completion_readbacks_policy_v1"'));
assert(runner.includes("910_sprint68_support_ticket_orchestration_completion_readbacks.sql"));

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|UPDATE\s+tickets|INSERT\s+INTO\s+`?tickets`?)\b/i;
assert(!forbiddenSql.test(migration));
for (const forbidden of ["runtime_endpoint_call", "callTool.name", "/system/tools/call", "external_send_performed = 1", "provider_dispatch_enabled_changed = 1", "credential_payload_read_allowed"]) {
  assert(!migration.includes(forbidden));
  assert(!lifecycleNext.includes(forbidden));
  assert(!externalReadback.includes(forbidden));
}

console.log("support ticket orchestration completion readbacks are read-only, registry-governed, and no-execution");
