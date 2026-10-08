import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { classifyDatabaseSchemaRecovery as classifyFromSource } from "./databaseSchemaRecoveryTriage.js";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";
// Synthetic unit-test-only trusted server fixture; the live Production
// application intentionally does not ship a trusted verifier yet.
const classifyDatabaseSchemaRecovery = (input) => classifyFromSource({
  trustedPhysicalCensusVerifier: () => true, ...input,
});
const sha = "a".repeat(40);
const databaseKey = "governance";
const base = { role: "governance", databaseKey, expectedDeployedSha: sha,
  principalSchemaReadiness: { ready: false, required_table_count: 17,
    observed_required_table_count: 0, missing_required_table_count: 17 } };
const baseline = readRuntimeBootstrapContract().baseline_bundle;
const expectedTableNames = {
  runtime: baseline.required_runtime_tables,
  governance: baseline.required_governance_tables,
  runtime_persistence: baseline.required_runtime_persistence_tables,
};
const census = (overrides = {}) => {
  const role = overrides.role || "governance";
  const tables = expectedTableNames[role] || [];
  const present = overrides.required_tables_present ?? 0;
  const requiredEvidence = overrides.required_table_evidence
    || tables.map((table, index) => ({ table, present: index < present }));
  return {
    contract: "mad4b.database-physical-object-inspection.v1",
    read_only: true, privileged_inventory_verified: true,
    role, database_key: databaseKey, exact_deployed_sha: sha,
    database_identity_verified: true, independent_recovery_store_verified: true,
    privileges_sufficient_to_enumerate_all_objects: true,
    census_complete: true, census_error_count: 0, role_boundary_verified: true,
    inspection_run_id: "run:durable:171", inspection_evidence_sha256: "b".repeat(64),
    object_counts: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 },
    required_objects_physically_checked: true,
    required_tables_present: present,
    required_tables_missing: tables.length - present,
    required_tables_expected: tables.length,
    ...overrides,
    required_table_evidence: requiredEvidence,
  };
};

const assertSafe = (output) => {
  assert.equal(output.auto_apply_allowed, false);
  assert.equal(output.operation_authorized, false);
  assert.equal(output.caller_supplied_sql_allowed, false);
  assert.equal(output.automatic_retry_allowed, false);
  assert.equal(output.mutation_performed, false);
  assert.equal(output.secrets_included, false);
};
test("self-attested complete census cannot authorize candidate without trusted server verifier", () => {
  const raw = classifyFromSource({ ...base, privilegedCensus: census() });
  assert.equal(raw.classification, "visibility_unverified");
  assert.equal(raw.authority_candidate, null);
  assertSafe(raw);
  const rejectedByServer = classifyFromSource({
    ...base, privilegedCensus: census(),
    trustedPhysicalCensusVerifier: () => false,
  });
  assert.equal(rejectedByServer.classification, "visibility_unverified");
  assert.equal(rejectedByServer.authority_candidate, null);
  assertSafe(rejectedByServer);
});

test("17 required / 0 visible via app principal cannot certify an empty physical database", () => {
  const result = classifyDatabaseSchemaRecovery(base);
  assert.equal(result.classification, "visibility_unverified");
  assert.equal(result.issue, "PHYSICAL_ABSENCE_NOT_PROVEN");
  assert.equal(result.next, "database_full_inspection_read_only");
  assert.equal(result.authority_candidate, null);
  assertSafe(result);
});
test("independent comprehensive zero-object proof identifies only a governed rebuild candidate", () => {
  const result = classifyDatabaseSchemaRecovery({ ...base, privilegedCensus: census() });
  assert.equal(result.classification, "confirmed_zero_objects");
  assert.equal(result.next, "governed_baseline_rebuild_plan_only");
  assert.equal(result.authority_candidate, "governance.baseline.rebuild_empty");
  assertSafe(result);
});
test("17 physically missing tables amid other objects blocks empty rebuild", () => {
  const result = classifyDatabaseSchemaRecovery({ ...base, privilegedCensus: census({
    object_counts: { tables: 0, views: 1, triggers: 0, routines: 0, events: 0, total: 1 },
  }) });
  assert.equal(result.classification, "confirmed_partial_schema");
  assert.equal(result.authority_candidate, null);
  assert.equal(result.next, "prepare_registered_schema_migration_review");
  assertSafe(result);
});
test("physically partial nonempty governance requires independent registered migration", () => {
  const result = classifyDatabaseSchemaRecovery({ ...base, privilegedCensus: census({
    object_counts: { tables: 5, views: 0, triggers: 0, routines: 0, events: 0, total: 5 },
    required_tables_present: 5, required_tables_missing: 12,
  }) });
  assert.equal(result.classification, "confirmed_partial_schema");
  assert.equal(result.authority_candidate, null);
  assertSafe(result);
});
test("physically complete but invisible to app principal is grant drift, not schema repair", () => {
  const result = classifyDatabaseSchemaRecovery({ ...base, privilegedCensus: census({
    object_counts: { tables: 17, views: 0, triggers: 0, routines: 0, events: 0, total: 17 },
    required_tables_present: 17, required_tables_missing: 0,
  }) });
  assert.equal(result.classification, "grant_or_visibility_drift");
  assert.equal(result.next, "read_only_exact_principal_privilege_audit");
  assertSafe(result);
});
test("complete app and physical schema requires separate privileges and functional verification", () => {
  const result = classifyDatabaseSchemaRecovery({ ...base,
    principalSchemaReadiness: { ready: true },
    privilegedCensus: census({
      object_counts: { tables: 17, views: 0, triggers: 0, routines: 0, events: 0, total: 17 },
      required_tables_present: 17, required_tables_missing: 0,
    }),
  });
  assert.equal(result.classification, "confirmed_schema_present");
  assert.equal(result.next, "complete_exact_principal_grants_and_behavioral_readback");
  assertSafe(result);
});
test("definition drift is distinct from absent tables", () => {
  const result = classifyDatabaseSchemaRecovery({ ...base,
    principalSchemaReadiness: { ready: true },
    privilegedCensus: census({
      object_counts: { tables: 17, views: 0, triggers: 0, routines: 0, events: 0, total: 17 },
      required_tables_present: 17, required_tables_missing: 0,
      structural_drift_verified: true,
    }),
  });
  assert.equal(result.classification, "confirmed_structural_drift");
  assertSafe(result);
});
test("untrusted, incomplete, stale or role-swapped census fails closed for every role", () => {
  for (const overrides of [
    { privileged_inventory_verified: false },
    { census_complete: false },
    { census_error_count: 1 },
    { database_identity_verified: false },
    { independent_recovery_store_verified: false },
    { privileges_sufficient_to_enumerate_all_objects: false },
    { role_boundary_verified: false },
    { exact_deployed_sha: "c".repeat(40) },
    { database_key: "runtime" },
    { role: "runtime" },
    { inspection_evidence_sha256: "malformed" },
    { object_counts: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 1 } },
    { required_tables_present: 1, required_tables_missing: 17, required_tables_expected: 17 },
    { required_objects_physically_checked: false },
    { required_tables_expected: 18, required_tables_missing: 18 },
    { required_table_evidence: expectedTableNames.governance.map((table) => ({ table, present: false })).slice(1) },
    { required_table_evidence: expectedTableNames.governance.map((table) => ({ table, present: false })).map((entry, index) => index === 0 ? { table: "wrong_role_table", present: false } : entry) },
    { required_table_evidence: expectedTableNames.governance.map((table) => ({ table, present: false })).map((entry, index) => index === 1 ? { table: expectedTableNames.governance[0], present: false } : entry) },
    { required_table_evidence: expectedTableNames.governance.map((table) => ({ table, present: false })).map((entry, index) => index === 2 ? { ...entry, present: "false" } : entry) },

  ]) {
    const result = classifyDatabaseSchemaRecovery({ ...base, privilegedCensus: census(overrides) });
    assert.equal(result.classification, "visibility_unverified", JSON.stringify(overrides));
    assertSafe(result);
  }
});
test("do not route mismatched physical counts or missing exact binding to repair", () => {
  for (const request of [
    { ...base, expectedDeployedSha: null, privilegedCensus: census() },
    { ...base, databaseKey: "", privilegedCensus: census() },
    { ...base, role: "other", privilegedCensus: census() },
    { ...base, privilegedCensus: census({
      object_counts: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 },
      required_tables_present: 0, required_tables_missing: 0, required_tables_expected: 0,
    }) },
  ]) {
    const result = classifyDatabaseSchemaRecovery(request);
    assert.notEqual(result.operation_authorized, true);
    assert.notEqual(result.auto_apply_allowed, true);
    assertSafe(result);
  }
});
test("same bounded logic covers all database roles but grants no authority", () => {
  for (const role of ["runtime", "governance", "runtime_persistence"]) {
    const result = classifyDatabaseSchemaRecovery({
      ...base, role, databaseKey: role,
      privilegedCensus: census({ role, database_key: role }),
    });
    assert.equal(result.authority_candidate, role + ".baseline.rebuild_empty");
    assertSafe(result);
  }
});
const source = readFileSync(new URL("./databaseSchemaRecoveryTriage.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /\b(?:GRANT|REVOKE|DROP|ALTER)\s+(?:TABLE|DATABASE|USER|ON|ALL|PRIVILEGES)\b/i);
console.log(JSON.stringify({contract: "mad4b.database-schema-recovery-triage-regression.v1",
  coverage: ["visibility_unverified", "zero_objects", "partial_schema", "grant_drift",
    "structural_drift", "untrusted_census", "role_isolation"], database_mutation: false, secrets_included: false}));
