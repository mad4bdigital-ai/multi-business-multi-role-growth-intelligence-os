import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMigrationPreflight,
  buildEnvironmentAttestation,
  buildReadbackContract,
  buildRollbackMatrix,
  buildTrackBManifest,
  destructiveFindings,
  assessMutationReadiness,
  reconcileMutationReceipt,
  validateApprovalBinding,
  validateAuthorityBinding,
  buildMigrationLedgerEntry,
  assessReadinessAggregate,
} from "./databaseLifecycleReadiness.js";

const SQL = "CREATE TABLE IF NOT EXISTS `track_b_probe` (id BIGINT PRIMARY KEY);";
const NOW = new Date("2026-08-14T00:00:00.000Z");
const AUTHORITY = {
  authority_binding_id: "auth-1",
  resource_type: "database_table",
  resource_uri: "mysql://staging/app/response_chunks",
  recipe_key: "database.response_chunks.ttl",
  principal_id: "operator-1",
  expires_at: "2026-08-15T00:00:00.000Z",
  policy_revision: "policy-1",
};
const PLAN_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const APPROVAL = {
  approval_id: "approval-1",
  plan_id: "plan-1",
  plan_fingerprint: PLAN_FINGERPRINT,
  resource_uri: AUTHORITY.resource_uri,
  recipe_key: AUTHORITY.recipe_key,
  approved_by: "reviewer-1",
  approved_at: "2026-08-14T00:00:00.000Z",
  expires_at: "2026-08-15T00:00:00.000Z",
  risk_class: "plan_only",
};

test("preflight binds checksum and statement count without applying", () => {
  const result = assessMigrationPreflight({ file: "probe.sql", sql: SQL, expectedTables: ["track_b_probe"] });
  assert.equal(result.readiness_status, "ready_for_governed_preflight");
  assert.equal(result.statement_count, 1);
  assert.equal(result.migration_applied, false);
  assert.equal(result.database_mutated, false);
  assert.equal(result.apply_authorized, false);
  assert.equal(result.secrets_included, false);
});

test("production preflight is blocked even for clean SQL", () => {
  const result = assessMigrationPreflight({ file: "probe.sql", sql: SQL, expectedTables: ["track_b_probe"], environment: "Production" });
  assert.equal(result.readiness_status, "blocked");
  assert.equal(result.database_mutated, false);
});

test("destructive SQL is blocked", () => {
  assert.deepEqual(destructiveFindings("DROP TABLE x; DELETE FROM y;"), ["drop_statement", "delete_statement"]);
});

test("same-cycle readback requires exact checksum and statement count", () => {
  const migration = assessMigrationPreflight({ file: "probe.sql", sql: SQL, expectedTables: ["track_b_probe"] });
  assert.equal(buildReadbackContract({ migration, observed: { checksum_sha256: migration.checksum_sha256, statement_count: migration.statement_count } }).readback_status, "verified");
  assert.equal(buildReadbackContract({ migration, observed: { checksum_sha256: "stale", statement_count: 1 } }).readback_status, "blocked");
});

test("environment attestation remains blocked on SHA mismatch or open break-glass", () => {
  const result = buildEnvironmentAttestation({ environment: "staging", branch: "main", expectedSha: "a", deployedSha: "b", breakGlass: [{ reconciliation_status: "open" }] });
  assert.equal(result.readiness_status, "blocked");
  assert.equal(result.production_promotion_authorized, false);
});

test("rollback matrix is evidence-first and non-mutating", () => {
  const [entry] = buildRollbackMatrix([{ operation: "context_ownership_additive_migration" }]);
  assert.equal(entry.pre_change_evidence_required, true);
  assert.equal(entry.rollback_status, "not_executed");
  assert.equal(entry.database_mutated, false);
});

test("exact authority and typed approval validate against the same resource and recipe", () => {
  assert.equal(validateAuthorityBinding(AUTHORITY, { now: NOW, recipeAllowlist: [AUTHORITY.recipe_key] }).valid, true);
  assert.equal(validateApprovalBinding(APPROVAL, { authority: AUTHORITY, planFingerprint: PLAN_FINGERPRINT, now: NOW, recipeAllowlist: [AUTHORITY.recipe_key] }).valid, true);
});

test("mutation readiness fails closed when receipt readback is unavailable", () => {
  const result = assessMutationReadiness({ authority: AUTHORITY, approval: APPROVAL, planFingerprint: PLAN_FINGERPRINT, capability: { enabled: true }, lease: { status: "active", expires_at: "2026-08-15T00:00:00.000Z" }, receiptReadback: { available: false }, now: NOW, recipeAllowlist: [AUTHORITY.recipe_key] });
  assert.equal(result.ready, false);
  assert.ok(result.errors.includes("receipt_readback_unavailable"));
  assert.equal(result.mutation_enabled, false);
  assert.equal(result.database_mutated, false);
});

test("authority rejects path traversal and wildcard resource selectors", () => {
  const unsafe = { ...AUTHORITY, resource_uri: "mysql://staging/app/../secrets/*" };
  assert.equal(validateAuthorityBinding(unsafe, { now: NOW, recipeAllowlist: [AUTHORITY.recipe_key] }).valid, false);
});

test("receipt reconciliation rejects replay or mismatched idempotency", () => {
  const receipt = { plan_id: "plan-1", plan_fingerprint: PLAN_FINGERPRINT, idempotency_key: "idem-1" };
  assert.equal(reconcileMutationReceipt({ receipt, readback: { ...receipt, status: "matched" } }).reconciliation_status, "reconciled");
  assert.equal(reconcileMutationReceipt({ receipt, readback: { ...receipt, idempotency_key: "idem-2", status: "matched" } }).reconciliation_status, "blocked");
});

test("migration ledger remains preflight-only without explicit apply authorization", () => {
  const migration = assessMigrationPreflight({ file: "probe.sql", sql: SQL, expectedTables: ["track_b_probe"] });
  const ledger = buildMigrationLedgerEntry({ migration, authorization: { status: "approved", environment: "non-production", apply_authorized: true, authorization_id: "auth-1" }, environment: "non-production", readback: { checksum_sha256: migration.checksum_sha256, statement_count: migration.statement_count } });
  assert.equal(ledger.ledger_entry_status, "preflight_authorized");
  assert.equal(ledger.apply_authorized, false);
  assert.equal(ledger.readback_status, "verified");
  assert.equal(ledger.migration_applied, false);
  assert.equal(ledger.database_mutated, false);
});

test("readiness aggregate blocks production and failed checks", () => {
  const staging = assessReadinessAggregate({ checks: { checksum: true, authorization: true, readback: true }, environment: "staging" });
  assert.equal(staging.readiness_status, "ready_for_review");
  const production = assessReadinessAggregate({ checks: { checksum: true, authorization: true, readback: true }, environment: "production" });
  assert.equal(production.readiness_status, "blocked");
  assert.ok(production.blocking_reasons.includes("production_apply_disabled"));
});

test("readiness evidence payloads contain no credential-bearing fields", () => {
  const migration = assessMigrationPreflight({ file: "probe.sql", sql: SQL, expectedTables: ["track_b_probe"] });
  const ledger = buildMigrationLedgerEntry({ migration, authorization: {}, readback: {} });
  const aggregate = assessReadinessAggregate({ checks: { checksum: true }, environment: "staging" });
  const serialized = JSON.stringify({ migration, ledger, aggregate });
  for (const forbidden of ["password", "client_secret", "access_token", "refresh_token", "private_key"]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden field found: ${forbidden}`);
  }
});

test("manifest explicitly declares all forbidden side effects as false", () => {
  const manifest = buildTrackBManifest();
  assert.equal(manifest.migration_applied, false);
  assert.equal(manifest.database_mutated, false);
  assert.equal(manifest.runtime_consumer_enabled, false);
  assert.equal(manifest.provider_called, false);
  assert.equal(manifest.production_promotion_authorized, false);
  assert.equal(manifest.secrets_included, false);
});
