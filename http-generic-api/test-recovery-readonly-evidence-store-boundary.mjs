import assert from "node:assert/strict";
import test from "node:test";

import { _testingProductionRecoveryCompositionFactory } from "./productionRecoveryCompositionFactory.js";

const { buildReadOnlyEvidenceStore, READ_ONLY_EVIDENCE_STORE_METHODS } = _testingProductionRecoveryCompositionFactory;

function method() {
  return async () => true;
}

function makeStore(overrides = {}) {
  const store = {
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    shared_replica_safe: true,
    schema_auto_apply: false,
    provider_accessed: false,
    ...Object.fromEntries(READ_ONLY_EVIDENCE_STORE_METHODS.map((name) => [name, method()])),
    claimExecution: method(),
    reserveApproval: method(),
    putExecutionTicket: method(),
    ...overrides,
  };
  return store;
}

test("read-only Recovery store is projected to evidence methods only", () => {
  const source = makeStore();
  const projected = buildReadOnlyEvidenceStore(source);
  assert.ok(projected);
  assert.notEqual(projected, source);
  assert.equal(projected.evidence_authority_only, true);
  assert.equal(projected.mutation_authority, false);
  assert.equal(projected.shared_replica_safe, true);
  assert.equal(projected.schema_auto_apply, false);
  for (const name of READ_ONLY_EVIDENCE_STORE_METHODS) assert.equal(typeof projected[name], "function");
  for (const name of ["claimExecution", "reserveApproval", "putExecutionTicket"]) assert.equal(projected[name], undefined);
});

test("read-only Recovery store rejects unsafe persistence boundaries", () => {
  assert.equal(buildReadOnlyEvidenceStore(makeStore({ independent_of_target_databases: false })), null);
  assert.equal(buildReadOnlyEvidenceStore(makeStore({ target_database_binding: "runtime_persistence" })), null);
  assert.equal(buildReadOnlyEvidenceStore(makeStore({ shared_replica_safe: false })), null);
  assert.equal(buildReadOnlyEvidenceStore(makeStore({ schema_auto_apply: true })), null);
  assert.equal(buildReadOnlyEvidenceStore(makeStore({ provider_accessed: true })), null);
});

console.log(JSON.stringify({
  ok: true,
  evidence_projection_only: true,
  unsafe_boundaries_rejected: true,
  mutation_authority_exposed: false,
  secrets_included: false
}, null, 2));
