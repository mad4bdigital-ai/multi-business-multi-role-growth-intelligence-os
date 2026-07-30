import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

// frontend-surface-operation: POST /platform/orchestration/support-ticket/snapshot-propose

const service = readFileSync("supportTicketLifecycleSnapshotProposal.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/272_sprint68_support_ticket_lifecycle_snapshot_proposal.sql", "utf8");
const openapiSource = readFileSync("openapi.yaml", "utf8");
const openapi = YAML.parse(openapiSource);
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

const module = await import("./supportTicketLifecycleSnapshotProposal.js");
assert.equal(typeof module.proposeSupportTicketLifecycleSnapshot, "function", "snapshot proposal service must export function");

for (const expected of [
  "support_ticket_lifecycle_snapshot_proposal_policy_v1",
  "support_ticket_lifecycle_snapshot_propose",
  "/platform/orchestration/support-ticket/snapshot-propose",
  "snapshot_candidate",
  "recommendation_candidate",
  "writes_database",
  "no_ticket_mutation",
  "no_workflow_dispatch",
  "no_approval_decision",
  "no_provider_call",
  "no_credential_payload_read",
  "no_external_send",
  "secrets_included",
]) assert(migration.includes(expected), `migration must include ${expected}`);

assert(routes.includes("proposeSupportTicketLifecycleSnapshot"), "route must import proposal service");
assert(routes.includes('router.post("/platform/orchestration/support-ticket/snapshot-propose"'), "route must mount proposal endpoint");
assert(service.includes("writes_database: false"), "service must not write database");
assert(service.includes("will_record_snapshot: false"), "service must not record snapshot in this slice");
assert(service.includes("will_record_recommendation: false"), "service must not record recommendation in this slice");
assert(service.includes("will_mutate_ticket: false"), "service must not mutate tickets");
assert(service.includes("will_dispatch_workflow: false"), "service must not dispatch workflows");
assert(service.includes("will_decide_approval: false"), "service must not decide approvals");
assert(service.includes("will_execute_provider_call: false"), "service must not execute provider calls");
assert(service.includes("will_read_credential_payload: false"), "service must not read credential payloads");
assert(service.includes("will_external_send: false"), "service must not send externally");
assert(service.includes("recommendation_only"), "service must classify recommendation-only behavior");

const proposalOperation = openapi?.paths?.["/platform/orchestration/support-ticket/snapshot-propose"]?.post;
assert.equal(proposalOperation?.operationId, "supportTicketLifecycleSnapshotPropose", "OpenAPI must document Support Ticket proposal route");
const executionProperties = proposalOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.execution?.properties;
assert.deepEqual(executionProperties?.will_mutate_ticket?.enum, [false], "OpenAPI must declare no ticket mutation");
assert.deepEqual(executionProperties?.will_external_send?.enum, [false], "OpenAPI must declare no external send");

assert(releaseReadiness.includes("272_sprint68_support_ticket_lifecycle_snapshot_proposal.sql"), "release readiness must track migration 272");
assert(releaseReadiness.includes('policy_key: "support_ticket_lifecycle_snapshot_proposal_policy_v1"'), "release readiness must require proposal policy");
assert(runner.includes("272_sprint68_support_ticket_lifecycle_snapshot_proposal.sql"), "governed migration runner must allowlist migration 272");

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;
assert(!forbiddenSql.test(migration), "proposal migration must not contain destructive SQL");
for (const forbidden of ["recordSupportTicketLifecycleSnapshot", "UPDATE tickets", "INSERT INTO `platform_orchestration_state_snapshots`", "INSERT INTO `platform_orchestration_recommendations`", "/system/tools/call", "runtime_endpoint_call", "callTool.name"]) {
  assert(!service.includes(forbidden), `service must not include forbidden behavior ${forbidden}`);
  assert(!migration.includes(forbidden), `migration must not include forbidden behavior ${forbidden}`);
}

console.log("support ticket lifecycle snapshot proposal is registered, documented, no-write, and no-execution");
