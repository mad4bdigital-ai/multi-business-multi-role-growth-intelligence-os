import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "./migrations/20260725_agent_delegation_grant_persistence_contract.sql",
  import.meta.url,
);
const schemaUrl = new URL(
  "../specs/011-durable-governed-execution-and-agent-delegation/schemas/delegation-grant.schema.json",
  import.meta.url,
);
const sql = await readFile(migrationUrl, "utf8");
const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
const normalized = sql.replace(/\s+/g, " ").trim();

assert.match(normalized, /ALTER TABLE agent_delegations/i);
assert.match(normalized, /CREATE OR REPLACE VIEW effective_agent_delegation_grants_v/i);
assert.doesNotMatch(normalized, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE)\b(?!\s+VIEW)/i);
assert.doesNotMatch(normalized, /canonical_status\s+VARCHAR\(32\)\s+NOT NULL/i);
assert.doesNotMatch(normalized, /canonical_status[^,;]*DEFAULT\s+'active'/i);

const requiredColumns = [
  "grant_schema_version",
  "approval_mode",
  "plan_hash",
  "resource_scope_json",
  "resource_scope_hash",
  "allowed_intents_json",
  "denied_intents_json",
  "max_risk_tier",
  "max_mutations",
  "consumed_mutations",
  "max_retries",
  "consumed_retries",
  "max_pull_requests",
  "consumed_pull_requests",
  "require_readback",
  "stop_on_drift",
  "policy_version",
  "grant_hash",
  "idempotency_key",
  "canonical_status",
  "approval_hold_id",
  "approved_by",
  "approved_at",
  "revoked_by",
  "revoked_at",
  "revocation_reason",
  "runtime_policy_ready",
  "canonical_created_at",
  "canonical_updated_at",
];
for (const column of requiredColumns) {
  assert.match(normalized, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`, "i"));
}

assert.match(normalized, /runtime_policy_ready\s+TINYINT\(1\)\s+NOT NULL\s+DEFAULT\s+0/i);
assert.match(normalized, /UNIQUE INDEX IF NOT EXISTS ux_agent_delegations_tenant_user_idempotency/i);
assert.match(normalized, /INDEX IF NOT EXISTS ix_agent_delegations_canonical_active/i);
assert.match(normalized, /INDEX IF NOT EXISTS ix_agent_delegations_plan_hash/i);
assert.match(normalized, /INDEX IF NOT EXISTS ix_agent_delegations_grant_hash/i);
assert.match(normalized, /INDEX IF NOT EXISTS ix_agent_delegations_approval_hold/i);

const requiredViewGuards = [
  "d.runtime_policy_ready = 1",
  "d.grant_schema_version = 'spec011-delegation-grant-v1'",
  "d.canonical_status = 'active'",
  "d.expires_at > UTC_TIMESTAMP(3)",
  "d.revoked_at IS NULL",
  "JSON_VALID(d.resource_scope_json) = 1",
  "JSON_LENGTH(d.resource_scope_json) > 0",
  "JSON_VALID(d.allowed_intents_json) = 1",
  "JSON_LENGTH(d.allowed_intents_json) > 0",
  "JSON_VALID(d.denied_intents_json) = 1",
  "d.consumed_mutations <= d.max_mutations",
  "d.consumed_retries <= d.max_retries",
  "d.consumed_pull_requests <= d.max_pull_requests",
  "d.require_readback = 1",
  "d.stop_on_drift = 1",
  "d.approved_at IS NOT NULL",
];
for (const guard of requiredViewGuards) {
  assert.ok(sql.includes(guard), `missing fail-closed view guard: ${guard}`);
}

const approvalModes = schema.properties.approval_mode.enum;
const approvalModeClause = normalized.match(/d\.approval_mode IN \(([^)]+)\)/i);
assert.ok(approvalModeClause, "missing effective-view approval mode clause");
const viewApprovalModes = [...approvalModeClause[1].matchAll(/'([^']+)'/g)]
  .map((match) => match[1]);
assert.deepEqual(
  [...viewApprovalModes].sort(),
  [...approvalModes].sort(),
  "effective view approval modes must exactly match the canonical delegation grant schema",
);

assert.ok(sql.includes("Legacy rows remain dispatch-ineligible"));
assert.ok(sql.includes("This migration is not applied by adding it to the repository"));

console.log("agent delegation persistence contract tests passed");
