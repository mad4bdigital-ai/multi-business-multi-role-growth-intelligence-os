import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/270_sprint68_support_ticket_lifecycle_orchestration_readback.sql", "utf8");
const service = readFileSync("supportTicketLifecycleOrchestrationReadback.js", "utf8");
const orchestrationReadback = readFileSync("platformOrchestrationReadback.js", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

const module = await import("./supportTicketLifecycleOrchestrationReadback.js");
assert.equal(typeof module.readSupportTicketLifecycleOrchestrationReadiness, "function", "Support Ticket lifecycle readback service must export function");

for (const expected of [
  "support_ticket_lifecycle_orchestrator",
  "v_platform_orchestration_support_ticket_lifecycle_readiness",
  "support_ticket_lifecycle_orchestration_readback_policy_v1",
  "platform_orchestration_plugins",
  "platform_orchestration_stages",
  "platform_orchestration_edges",
  "tickets",
  "ticket_lifecycle_events",
  "ticket_workflow_links",
  "execution_plans",
  "workflow_runs",
  "step_runs",
  "approval_holds",
]) {
  assert(migration.includes(expected), `migration must include ${expected}`);
}

for (const expected of [
  "readSupportTicketLifecycleOrchestrationReadiness",
  "support_ticket_lifecycle_orchestrator",
  "will_external_send: false",
  "will_execute_provider_call: false",
  "will_read_credential_payload: false",
  "will_change_spend: false",
  "recommendation_only: true",
  "secrets_included: false",
]) {
  assert(service.includes(expected), `service must include ${expected}`);
}

assert(orchestrationReadback.includes("readSupportTicketLifecycleOrchestrationReadiness"), "generic orchestration readback must import Support Ticket readback");
assert(orchestrationReadback.includes("support_ticket_lifecycle_readiness"), "generic readback must expose Support Ticket readiness evidence");
assert(orchestrationReadback.includes("support_ticket_lifecycle_orchestrator"), "generic readback must know Support Ticket graph expected counts");
assert(releaseReadiness.includes("270_sprint68_support_ticket_lifecycle_orchestration_readback.sql"), "release readiness must track migration 270");
assert(releaseReadiness.includes('policy_key: "support_ticket_lifecycle_orchestration_readback_policy_v1"'), "release readiness must require Support Ticket readback policy");
assert(runner.includes("270_sprint68_support_ticket_lifecycle_orchestration_readback.sql"), "governed migration runner must allow migration 270");

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;
assert(!forbiddenSql.test(migration), "Support Ticket orchestration readback migration must not contain destructive SQL");

for (const forbidden of [
  "/system/tools/call",
  "runtime_endpoint_call",
  "callTool.name",
  "tenant_platform_endpoint_tools.runtime_endpoint_call",
]) {
  assert(!migration.includes(forbidden), `migration must not touch Tool Bus surface ${forbidden}`);
  assert(!service.includes(forbidden), `service must not touch Tool Bus surface ${forbidden}`);
}

for (const forbidden of [
  "external_send_performed = 1",
  "provider_dispatch_enabled_changed = 1",
  "adapter_implementation_performed = 1",
  "dispatch_enabled_changed = 1",
]) {
  assert(!migration.includes(forbidden), `migration must not enable external delivery mutation: ${forbidden}`);
}

console.log("support ticket lifecycle orchestration readback is registered as read-only and Tool-Bus independent");
