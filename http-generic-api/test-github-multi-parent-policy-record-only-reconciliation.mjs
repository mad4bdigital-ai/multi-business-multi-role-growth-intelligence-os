import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyMigrationReconciliationDecision,
  parseRuleCondition,
} from "./governedMigrationReconciliationPolicy.mjs";

const checksum = "84ff6a7a767223389b3202b4bd3388d510c04e3b0e0074ab53cd8bcb3f1cdbe0";
const policyState = {
  available: true,
  missing: [],
  policy: {
    require_validators: 1,
    approval_required_min_risk: "high",
  },
};
const baseRule = {
  strategy_key: "governed_migration_record_only",
  strategy_status: "active",
  executes_dynamic_code: 0,
  auto_execute: 1,
  approval_required: 0,
  condition_json: JSON.stringify({
    required_schema_state: "not_applicable",
    policy_only_record_only: true,
    registry_only: true,
    expected_checksum_sha256: checksum,
  }),
};
const baseAuthorization = {
  authorization_status: "authorized",
  risk_tier: "low",
  allow_record_only: 1,
  allow_apply: 0,
};
const preflight = { status: "pass" };

assert.deepEqual(parseRuleCondition(baseRule.condition_json), {
  required_schema_state: "not_applicable",
  policy_only_record_only: true,
  registry_only: true,
  expected_checksum_sha256: checksum,
});

assert.deepEqual(
  classifyMigrationReconciliationDecision({
    policyState,
    rule: baseRule,
    authorization: baseAuthorization,
    ledger: null,
    preflight,
    required: [],
    existing: [],
    checksum,
  }),
  {
    action: "record_only",
    status: "ready",
    reason: "explicit_rule_and_checksum_bound_policy_only_contract",
  },
);

assert.equal(
  classifyMigrationReconciliationDecision({
    policyState,
    rule: { ...baseRule, condition_json: JSON.stringify({ required_schema_state: "not_applicable" }) },
    authorization: baseAuthorization,
    ledger: null,
    preflight,
    required: [],
    existing: [],
    checksum,
  }).reason,
  "record_only_requires_explicit_policy_only_contract",
);

assert.equal(
  classifyMigrationReconciliationDecision({
    policyState,
    rule: baseRule,
    authorization: { ...baseAuthorization, allow_apply: 1 },
    ledger: null,
    preflight,
    required: [],
    existing: [],
    checksum,
  }).reason,
  "policy_only_record_only_apply_must_be_disabled",
);

assert.equal(
  classifyMigrationReconciliationDecision({
    policyState,
    rule: baseRule,
    authorization: baseAuthorization,
    ledger: null,
    preflight,
    required: [],
    existing: [],
    checksum: "0".repeat(64),
  }).reason,
  "policy_only_record_only_checksum_mismatch",
);

assert.deepEqual(
  classifyMigrationReconciliationDecision({
    policyState,
    rule: {
      ...baseRule,
      condition_json: JSON.stringify({ required_schema_state: "complete" }),
    },
    authorization: baseAuthorization,
    ledger: null,
    preflight,
    required: ["example_table"],
    existing: ["example_table"],
    checksum,
  }),
  {
    action: "record_only",
    status: "ready",
    reason: "explicit_rule_and_complete_schema_evidence",
  },
);

const migration = readFileSync(
  "migrations/1019_sprint69_github_multi_parent_policy_record_only_authorization.sql",
  "utf8",
);
for (const token of [
  "migration_reconcile_1014_github_multi_parent_policy_record_only",
  "1014_sprint69_github_branch_multi_parent_merge_commit_policy.sql",
  "governed_migration_record_only",
  "policy_only_record_only",
  "required_schema_state', 'not_applicable",
  checksum,
  "allow_record_only",
  "allow_apply",
  "no_provider_call",
  "no_credential_payload_read",
  "no_raw_secrets",
  "no_external_send",
  "no_external_write",
  "secrets_included=false",
]) {
  assert(migration.includes(token), `migration must include ${token}`);
}
assert.match(
  migration,
  /'1014_sprint69_github_branch_multi_parent_merge_commit_policy\.sql'[\s\S]*?'low'[\s\S]*?1,[\s\S]*?1,[\s\S]*?1,[\s\S]*?0,/,
  "target authorization must allow record-only and forbid apply",
);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

console.log("GitHub multi-parent policy record-only reconciliation tests passed");
