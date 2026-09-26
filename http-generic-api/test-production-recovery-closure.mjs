import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateProductionRecoveryClosure,
  PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT,
  PRODUCTION_RECOVERY_CLOSURE_EVIDENCE_CONTRACT,
} from "./productionRecoveryClosure.js";

const SHA = "a".repeat(40);
const INSPECTION_HASH = "b".repeat(64);
const BACKUP_HASH = "c".repeat(64);
const MANIFEST_HASH = "d".repeat(64);
const TARGET_FINGERPRINT = "e".repeat(64);
const CYCLE_ID = "run:platform-recovery:closure-test";

function allGates(overrides = {}) {
  return {
    exact_source_sha_verified: true,
    durable_inspection_verified: true,
    governance_baseline_ready: true,
    runtime_persistence_baseline_ready: true,
    canonical_grants_ready: true,
    bootstrap_ledger_ready: true,
    mcp_catalog_schema_ready: true,
    admin_catalog_functional_readback: true,
    device_catalog_functional_readback: true,
    response_chunk_storage_smoke: true,
    production_activation_readiness: true,
    backup_evidence_verified: true,
    production_mutation_audited: true,
    connector_auth_ready: true,
    rate_limit_attribution_ready: true,
    ...overrides,
  };
}

function backup(overrides = {}) {
  return {
    contract: PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT,
    expected_sha: SHA,
    evidence_sha256: BACKUP_HASH,
    created_at: new Date().toISOString(),
    evidence_ref: "backup:evidence:closure-test",
    roles: ["runtime", "governance", "runtime_persistence"],
    verified: true,
    storage_readback_verified: true,
    restore_test_verified: true,
    artifact_manifest_hash: MANIFEST_HASH,
    target_fingerprint: TARGET_FINGERPRINT,
    cycle_id: CYCLE_ID,
    secrets_included: false,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  const base = {
    contract: PRODUCTION_RECOVERY_CLOSURE_EVIDENCE_CONTRACT,
    expected_sha: SHA,
    server_derived: true,
    durable: true,
    same_cycle: true,
    cycle_id: CYCLE_ID,
    target_fingerprint: TARGET_FINGERPRINT,
    inspection_run_id: "run:inspection:closure-test",
    inspection_evidence_hash: INSPECTION_HASH,
    gates: allGates(),
    backup_evidence: backup(),
    unknown_outcome: false,
    secrets_included: false,
  };
  return {
    ...base,
    ...overrides,
    gates: overrides.gates || base.gates,
    backup_evidence: overrides.backup_evidence || base.backup_evidence,
  };
}

test("fully verified exact-cycle evidence deterministically derives recovered", () => {
  const first = evaluateProductionRecoveryClosure({ expectedSha: SHA, evidence: evidence() });
  const second = evaluateProductionRecoveryClosure({ expectedSha: SHA, evidence: evidence({
    backup_evidence: backup({ created_at: first.backup_evidence.created_at }),
  }) });

  assert.equal(first.status, "recovered");
  assert.equal(first.ok, true);
  assert.equal(first.core_recovered, true);
  assert.equal(first.unknown_outcome, false);
  assert.equal(first.non_db_gaps.length, 0);
  assert.match(first.closure_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(second.status, "recovered");
  assert.equal(second.closure_sha256, first.closure_sha256);
  assert.equal(first.production_mutation_performed, false);
  assert.equal(first.provider_mutation_performed, false);
  assert.equal(first.secrets_included, false);
});

test("unknown outcome dominates otherwise complete recovery evidence", () => {
  const result = evaluateProductionRecoveryClosure({
    expectedSha: SHA,
    evidence: evidence({ unknown_outcome: true }),
  });
  assert.equal(result.status, "unknown_outcome");
  assert.equal(result.ok, false);
  assert.equal(result.reconciliation_required, true);
  assert.equal(result.automatic_retry_allowed, false);
  assert.ok(result.problems.includes("unknown_outcome_requires_reconciliation"));
});

test("non-DB connector gap is degraded and never reported recovered", () => {
  const result = evaluateProductionRecoveryClosure({
    expectedSha: SHA,
    evidence: evidence({
      gates: allGates({ connector_auth_ready: false }),
    }),
  });
  assert.equal(result.status, "degraded_non_db");
  assert.equal(result.core_recovered, true);
  assert.deepEqual(result.non_db_gaps, ["connector_auth_ready"]);
  assert.equal(result.ok, false);
});

test("stale backup evidence blocks closure", () => {
  const result = evaluateProductionRecoveryClosure({
    expectedSha: SHA,
    evidence: evidence({
      backup_evidence: backup({
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      }),
    }),
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.backup_evidence_verified, false);
  assert.ok(result.problems.includes("backup_evidence_stale"));
});

test("backup restore/storage proof is mandatory", () => {
  for (const mutation of [
    { restore_test_verified: false },
    { storage_readback_verified: false },
    { artifact_manifest_hash: "invalid" },
  ]) {
    const result = evaluateProductionRecoveryClosure({
      expectedSha: SHA,
      evidence: evidence({ backup_evidence: backup(mutation) }),
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.ok, false);
  }
});

test("cycle and target fingerprint mismatches fail closed", () => {
  const wrongCycle = evaluateProductionRecoveryClosure({
    expectedSha: SHA,
    evidence: evidence({ backup_evidence: backup({ cycle_id: "run:other-cycle" }) }),
  });
  assert.equal(wrongCycle.status, "blocked");
  assert.ok(wrongCycle.problems.includes("closure_cycle_id_mismatch"));

  const wrongTarget = evaluateProductionRecoveryClosure({
    expectedSha: SHA,
    evidence: evidence({ backup_evidence: backup({ target_fingerprint: "f".repeat(64) }) }),
  });
  assert.equal(wrongTarget.status, "blocked");
  assert.ok(wrongTarget.problems.includes("closure_target_fingerprint_mismatch"));
});

test("missing core gate cannot be masked by healthy non-DB evidence", () => {
  const result = evaluateProductionRecoveryClosure({
    expectedSha: SHA,
    evidence: evidence({
      gates: allGates({ canonical_grants_ready: false }),
    }),
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.core_recovered, false);
  assert.ok(result.problems.includes("core_gate_not_ready:canonical_grants_ready"));
});
