import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLATFORM_TENANT_ID,
  _testingAgentSkillGrantRequestService,
  platformSkillGrantDecisionConfirm,
} from "./agentSkillGrantRequestService.js";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

assert.equal(PLATFORM_TENANT_ID, "00000000-0000-0000-0000-000000000000");
assert.equal(
  platformSkillGrantDecisionConfirm("11111111-2222-3333-4444-555555555555", "approve"),
  "DECIDE_AGENT_SKILL_GRANT_REQUEST_11111111_2222_3333_4444_555555555555_APPROVE"
);
assert.equal(_testingAgentSkillGrantRequestService.normalizeSkillGrantDecision({ decision: "reject" }).decision, "reject");
assert.throws(
  () => _testingAgentSkillGrantRequestService.normalizeSkillGrantDecision({ decision: "activate" }),
  (error) => error.code === "AGENT_SKILL_GRANT_DECISION_INVALID"
);

const migrationName = "20260722_agent_skill_grant_approval_provenance.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
for (const marker of [
  "CREATE TABLE IF NOT EXISTS agent_skill_grant_requests",
  "grant_request_id",
  "v_effective_agent_skill_grants",
  "v_activation_agent_skill_grant_requests",
  "platform_bootstrap_migration",
  "brand_scope_required_v1",
  "request_status IN pending,deferred",
  "approval_required_grants_fail_closed=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `migration missing ${marker}`);
}
assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE FROM)\b/mi);
const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));

const service = readFileSync(new URL("./agentSkillGrantRequestService.js", import.meta.url), "utf8");
for (const marker of [
  "AGENT_SKILL_BRAND_SCOPE_REQUIRED",
  "approval_required: requiresApproval",
  "status = 'active'",
  "request_status = 'approved'",
  "platform_admin_decision",
  "tenant_owner_decision",
  "Typed confirmation is required",
  "runtime_effective_before_approval: false",
]) {
  assert.ok(service.includes(marker), `service missing ${marker}`);
}
assert.doesNotMatch(service, /(client_secret|backend_api_key|jwt_secret)\s*[:=]\s*["'][^"']+/i);

console.log("PASS agent-skill-grant-approval-provenance");
