import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMigrationPreflight,
  buildEnvironmentAttestation,
  buildReadbackContract,
  buildRollbackMatrix,
  buildTrackBManifest,
  destructiveFindings,
} from "./databaseLifecycleReadiness.js";

const SQL = "CREATE TABLE IF NOT EXISTS `track_b_probe` (id BIGINT PRIMARY KEY);";

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

test("manifest explicitly declares all forbidden side effects as false", () => {
  const manifest = buildTrackBManifest();
  assert.equal(manifest.migration_applied, false);
  assert.equal(manifest.database_mutated, false);
  assert.equal(manifest.runtime_consumer_enabled, false);
  assert.equal(manifest.provider_called, false);
  assert.equal(manifest.production_promotion_authorized, false);
  assert.equal(manifest.secrets_included, false);
});
