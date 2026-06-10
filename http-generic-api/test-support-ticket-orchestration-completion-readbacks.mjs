import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lifecycleNext = readFileSync("supportTicketLifecycleNextActionReadback.js", "utf8");
const externalReadback = readFileSync("supportTicketExternalDeliveryOrchestrationReadback.js", "utf8");
const platformReadback = readFileSync("platformOrchestrationReadback.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/910_sprint68_support_ticket_orchestration_completion_readbacks.sql", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

const lifecycleModule = await import("./supportTicketLifecycleNextActionReadback.js");
const externalModule = await import("./supportTicketExternalDeliveryOrchestrationReadback.js");
assert.equal(typeof lifecycleModule.readSupportTicketLifecycleNextAction, "function");
assert.equal(typeof externalModule.readSupportTicketExternalDeliveryOrchestrationReadiness, "function");

for (const expected of [
  "support_ticket_lifecycle_next_action_readback",
  "support_ticket_external_delivery_readback",
  "support_ticket_external_delivery_orchestrator",
  "support_ticket_orchestration_completion_readbacks_policy_v1",
  "support_ticket_external_delivery_orchestration_readback_policy_v1",
  "v_platform_orchestration_support_ticket_external_delivery_readiness",
  "no_ticket_mutation",
  "no_workflow_dispatch",
  "no_approval_decision",
  "no_external_send",
  "no_external_write",
  "no_provider_call",
  "no_credential_payload_read",
  "secrets_included",
]) assert(migration.includes(expected), `migration must include ${expected}`);

assert(routes.includes("readSupportTicketLifecycleNextAction"), "routes must import lifecycle next-action readback");
assert(routes.includes("readSupportTicketExternalDeliveryOrchestrationReadiness"), "routes must import external delivery readback");
assert(routes.includes('/platform/orchestration/support-ticket/next-action-readback'), "next-action route must be mounted");
assert(routes.includes('/platform/orchestration/support-ticket/external-delivery/readback'), "external delivery route must be mounted");
assert(platformReadback.includes("support_ticket_external_delivery_orchestrator"), "generic readback must know external delivery graph");
assert(platformReadback.includes("support_ticket_external_delivery_readiness"), "generic readback must return external delivery readiness");
assert(lifecycleNext.includes("customer_safe_next_step"), "next-action readback must produce customer-safe guidance");
assert(lifecycleNext.includes("will_mutate_ticket: false"), "next-action readback must not mutate ticket");
assert(externalReadback.includes("will_external_send: false"), "external delivery readback must not send externally");
assert(externalReadback.includes("will_read_credential_payload: false"), "external delivery readback must not read credential payloads");
assert(releaseReadiness.includes("910_sprint68_support_ticket_orchestration_completion_readbacks.sql"), "release readiness must track migration 910");
assert(releaseReadiness.includes('policy_key: "support_ticket_orchestration_completion_readbacks_policy_v1"'), "release readiness must require completion policy");
assert(runner.includes("910_sprint68_support_ticket_orchestration_completion_readbacks.sql"), "governed migration runner must allowlist migration 910");

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|UPDATE\s+tickets|INSERT\s+INTO\s+`?tickets`?)\b/i;
assert(!forbiddenSql.test(migration), "completion migration must not contain destructive SQL or ticket mutation");
for (const forbidden of ["runtime_endpoint_call", "callTool.name", "/system/tools/call", "external_send_performed = 1", "provider_dispatch_enabled_changed = 1", "credential_payload_read_allowed"]) {
  assert(!migration.includes(forbidden), `migration must not include forbidden surface ${forbidden}`);
  assert(!lifecycleNext.includes(forbidden), `next-action service must not include forbidden surface ${forbidden}`);
  assert(!externalReadback.includes(forbidden), `external delivery service must not include forbidden surface ${forbidden}`);
}

console.log("support ticket orchestration completion readbacks are read-only, registry-governed, and no-execution");
