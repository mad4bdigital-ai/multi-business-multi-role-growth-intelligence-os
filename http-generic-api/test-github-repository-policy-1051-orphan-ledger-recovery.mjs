import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MIGRATION,
  MIGRATION_BLOB_SHA,
  EXPECTED_STATEMENT_COUNT,
  RECORD_CONFIRM,
  RECONCILE_CONFIRM,
  RECONCILED_APPLY_CONFIRM,
  classifyLedgerState,
  validateMetadataReport,
} from "../.github/ops/github-repository-policy-1051-orphan-ledger-recovery.mjs";

const workflow = fs.readFileSync(new URL("../.github/workflows/github-repository-policy-1051-governed-rollout.yml", import.meta.url), "utf8");
const recovery = fs.readFileSync(new URL("../.github/ops/github-repository-policy-1051-orphan-ledger-recovery.mjs", import.meta.url), "utf8");

const metadata = {
  diagnostic_status: "captured",
  target_metadata_state: "complete",
  metadata_present: true,
  counts: {
    adapter: 1,
    readback_contract: 1,
    apply_policy: 1,
    capability_binding: 1,
    expected_policy_layers: 3,
    total_policy_layers: 3,
    migration_authorization: 1,
  },
  metadata: {
    adapter_status: "active",
    readback_status: "certified",
    apply_policy_status: "active",
    apply_runtime_surface: "system_layer",
    allow_external_write: 1,
    requires_typed_confirmation: 1,
    requires_same_cycle_dry_run: 1,
    capability_readiness: "ready",
    capability_policy_key: "github_repository_policy_controller_apply_v1",
    migration_authorization_status: "authorized",
    live_github_policy_apply: "false",
  },
};
assert.equal(validateMetadataReport(metadata).semantic_metadata_verified, true);
assert.throws(() => validateMetadataReport({ ...metadata, target_metadata_state: "partial" }));
assert.throws(() => validateMetadataReport({ ...metadata, metadata: { ...metadata.metadata, requires_typed_confirmation: 0 } }));
assert.throws(() => validateMetadataReport({ ...metadata, metadata: { ...metadata.metadata, live_github_policy_apply: "true" } }));

const checksum = "d5e82b75cd8eeff8a5fb4d76bca4b5ff607361066504237b03df10f3a8fa3fad";
const recordOnly = classifyLedgerState({
  readback_status: "pass",
  ledger: {
    found: true,
    migration_file: MIGRATION,
    migration_checksum_sha256: checksum,
    mode: "record_only",
    statement_count: EXPECTED_STATEMENT_COUNT,
    preflight_status: "pass",
    preflight_risk_count: 0,
  },
  expectations: { missing: { tables: [], columns: [], indexes: [], rule_conditions: [] } },
}, checksum, EXPECTED_STATEMENT_COUNT);
assert.equal(recordOnly.schema_complete, true);
assert.equal(recordOnly.record_only_ledger, true);
assert.equal(recordOnly.apply_ledger, false);

const apply = classifyLedgerState({
  readback_status: "pass",
  ledger: {
    found: true,
    migration_file: MIGRATION,
    migration_checksum_sha256: checksum,
    mode: "apply",
    statement_count: EXPECTED_STATEMENT_COUNT,
    preflight_status: "pass",
    preflight_risk_count: 0,
  },
  expectations: { missing: { tables: [], columns: [], indexes: [], rule_conditions: [] } },
}, checksum, EXPECTED_STATEMENT_COUNT);
assert.equal(apply.apply_ledger, true);
assert.equal(apply.record_only_ledger, false);

assert.match(MIGRATION_BLOB_SHA, /^[0-9a-f]{40}$/);
assert.equal(RECORD_CONFIRM, "RECORD_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY");
assert.equal(RECONCILE_CONFIRM, "RECONCILE_1051_GITHUB_REPOSITORY_POLICY_RECORD_ONLY_LEDGER");
assert.equal(RECONCILED_APPLY_CONFIRM, "APPLY_1051_GITHUB_REPOSITORY_POLICY_AFTER_RECORD_ONLY_RECONCILIATION");

assert.match(workflow, /RECONCILE_1051_GITHUB_REPOSITORY_POLICY_RECORD_ONLY_LEDGER/);
assert.match(workflow, /APPLY_1051_GITHUB_REPOSITORY_POLICY_AFTER_RECORD_ONLY_RECONCILIATION/);
assert.match(workflow, /RECOVERY_PHASE: record_only/);
assert.match(workflow, /RECOVERY_PHASE: verify_record_only/);
assert.match(workflow, /Capture Migration 225 and Governance writer readiness before orphan-ledger reconciliation/);
assert.match(workflow, /Create checksum-bound authorization and dry-run before record-only reconciliation/);
assert.match(workflow, /Verify exact record-only ledger before reconciled Apply/);
assert.match(workflow, /Execute metadata Apply only after certified record-only reconciliation/);
const reconcileGuard = workflow.indexOf("Capture Migration 225 and Governance writer readiness before orphan-ledger reconciliation");
const reconcileAuth = workflow.indexOf("Create checksum-bound authorization and dry-run before record-only reconciliation");
const reconcileMutation = workflow.indexOf("Record exact Migration 1051 ledger without replaying SQL");
assert.ok(reconcileGuard >= 0 && reconcileAuth > reconcileGuard && reconcileMutation > reconcileAuth);
const applyGuard = workflow.indexOf("Verify exact record-only ledger before reconciled Apply");
const applyExecute = workflow.indexOf("Execute metadata Apply only after certified record-only reconciliation");
assert.ok(applyGuard >= 0 && applyExecute > applyGuard);

assert.match(recovery, /alias: "migration_ledger_record_apply"/);
assert.match(recovery, /sql_applied_by_this_run/);
assert.match(recovery, /governed_migration_runner_backfill/);
assert.match(recovery, /provider_call_executed: false/);
assert.match(recovery, /external_write_executed: false/);
assert.match(recovery, /live_github_policy_apply: false/);
assert.match(recovery, /protected_ref_mutation: false/);
assert.match(recovery, /force_push: false/);
assert.match(recovery, /secrets_included: false/);

console.log(JSON.stringify({
  ok: true,
  test: "github_repository_policy_1051_orphan_ledger_recovery",
  record_only_reconciliation_proven: true,
  apply_requires_separate_confirmation: true,
  provider_call_executed: false,
  external_write_executed: false,
  secrets_included: false,
}));
