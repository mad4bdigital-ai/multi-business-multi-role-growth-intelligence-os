import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
assert.equal(
  createHash("sha256").update(migration).digest("hex"),
  "db8a4583a063187811c7bf1aae7a379742ddf1f862b2ff220f869683d2f5dd2e",
  "the original partially applied migration must remain immutable"
);
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

const repairName = "20260725_agent_skill_grant_request_collation_repair.sql";
const repair = readFileSync(new URL(`./migrations/${repairName}`, import.meta.url), "utf8");
for (const marker of [
  "ALTER TABLE agent_skill_grant_requests",
  "MODIFY COLUMN request_id VARCHAR(36)",
  "MODIFY COLUMN agent_id VARCHAR(36)",
  "MODIFY COLUMN skill_id VARCHAR(36)",
  "MODIFY COLUMN tenant_id VARCHAR(36)",
  "MODIFY COLUMN brand_key VARCHAR(128)",
  "original_migration_immutable=true",
  "partial_state_safe=true",
  "whole_table_convert=false",
  "same_cycle_schema_readback_required=true",
  "secrets_included=false",
]) {
  assert.ok(repair.includes(marker), `repair migration missing ${marker}`);
}
assert.equal(
  repair.match(/COLLATE utf8mb4_uca1400_ai_ci/g)?.length,
  5,
  "repair migration must align exactly the five relationship and scope columns"
);
assert.doesNotMatch(repair, /CONVERT\s+TO\s+CHARACTER\s+SET/i);
assert.doesNotMatch(repair, /\bBINARY\b/i);
assert.doesNotMatch(repair, /MODIFY COLUMN approval_hold_id/i);
assert.doesNotMatch(repair, /^\s*(DROP|TRUNCATE|DELETE FROM)\b/mi);
const repairPreflight = assessMigrationSqlPreflight(repairName, repair);
assert.equal(repairPreflight.status, "pass", JSON.stringify(repairPreflight, null, 2));
assert.equal(repairPreflight.risk_count, 0, JSON.stringify(repairPreflight, null, 2));
assert.equal(repairPreflight.counts.alter_table, 1, JSON.stringify(repairPreflight, null, 2));
assert.equal(repairPreflight.counts.alter_table_idempotent, 1, JSON.stringify(repairPreflight, null, 2));
assert.equal(repairPreflight.counts.destructive, 0, JSON.stringify(repairPreflight, null, 2));
assert.equal(repairPreflight.secrets_included, false, JSON.stringify(repairPreflight, null, 2));

const service = readFileSync(new URL("./agentSkillGrantRequestService.js", import.meta.url), "utf8");
for (const marker of [
  "AGENT_SKILL_BRAND_SCOPE_REQUIRED",
  "approval_required: requiresApproval",
  "status = 'active'",
  "const requestStatus = decision ===",
  "SET request_status = ?",
  "request.request_status === targetStatus",
  "platform_admin_decision",
  "tenant_owner_decision",
  "Typed confirmation is required",
  "runtime_effective_before_approval: false",
]) {
  assert.ok(service.includes(marker), `service missing ${marker}`);
}
assert.doesNotMatch(service, /(client_secret|backend_api_key|jwt_secret)\s*[:=]\s*["'][^"']+/i);

console.log("PASS agent-skill-grant-approval-provenance");
