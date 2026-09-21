import assert from "node:assert/strict";
import {
  createProductionRecoveryDurableEvidenceAdapters,
  createProductionRecoveryPartialReceiptStore,
  createProductionRecoveryRoleSelectionProofResolver,
} from "./productionRecoveryDurableEvidenceAdapters.js";

function makeStore() {
  const bindings = new Map();
  const records = new Map();
  return {
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    async putRun(value) {
      const existing = bindings.get(value.idempotency_key);
      if (existing && existing !== value.run_id) {
        const error = new Error("idempotency collision");
        error.code = "RECOVERY_CONTROL_STORE_IDEMPOTENCY_COLLISION";
        throw error;
      }
      bindings.set(value.idempotency_key, value.run_id);
      records.set(value.run_id, structuredClone(value));
      return { persisted: true };
    },
    async getRunByIdempotency(id) {
      const runId = bindings.get(id);
      return runId ? structuredClone(records.get(runId)) : null;
    },
  };
}

function makeReceipt() {
  return {
    contract: "mad4b.hostinger.partial-rebuild-receipt.v1",
    receipt_id: "partial:1234567890abcdef1234567890abcdef",
    status: "reconciliation_required",
    automatic_rerun_allowed: false,
    reconciliation_required: true,
    expected_sha: "a".repeat(40),
    target_key: "production-runtime",
    target_fingerprint: "b".repeat(64),
    plan_hash: "c".repeat(64),
    execution_ticket_id: "ticket:1234567890abcdef",
    execution_ticket_hash: "d".repeat(64),
    bundle_manifest_reference: "http-generic-api/config/runtime-bootstrap-contract.json",
    mutation_evidence: {
      mutation_state: "partial_possible",
      statements_attempted: 3,
      statements_confirmed: 2,
    },
    secrets_included: false,
  };
}

{
  const store = makeStore();
  const authority = createProductionRecoveryPartialReceiptStore({ recoveryStore: store });
  const receipt = makeReceipt();
  const first = await authority.putImmutablePartialRebuildReceipt(receipt);
  const replay = await authority.putImmutablePartialRebuildReceipt(receipt);
  assert.equal(first.persisted, true);
  assert.equal(first.durable, true);
  assert.equal(first.immutable_identity_binding, true);
  assert.equal(first.evidence_hash.length, 64);
  assert.equal(replay.evidence_hash, first.evidence_hash);

  await assert.rejects(
    () => authority.putImmutablePartialRebuildReceipt({
      ...receipt,
      target_fingerprint: "e".repeat(64),
    }),
    (error) => error?.code === "RECOVERY_CONTROL_STORE_IDEMPOTENCY_COLLISION",
  );

  await assert.rejects(
    () => authority.putImmutablePartialRebuildReceipt({
      ...receipt,
      mutation_evidence: { password: "forbidden" },
    }),
    (error) => error?.code === "RECOVERY_PRODUCTION_PARTIAL_RECEIPT_SENSITIVE_FIELD",
  );
}

{
  let captured = null;
  const resolver = createProductionRecoveryRoleSelectionProofResolver({
    resolver: async (input) => {
      captured = structuredClone(input);
      return {
        contract: "mad4b.host-breakglass-role-selection-proof.v1",
        source: "durable_full_inspection",
        expected_sha: input.expected_sha,
        target_key: input.target_key,
        inspection_run_id: input.inspection_run_id,
        workflow_run_id: input.inspection_run_id.split(":").at(-1),
        inspection_evidence_hash: "1".repeat(64),
        composite_target_fingerprint: "2".repeat(64),
        selection_hash: "3".repeat(64),
        finding_ids: ["finding:1234567890abcdef1234567890abcdef"],
        selected_roles: ["governance", "runtime_persistence"],
        role_database_object_counts: {
          governance: { total: 0 },
          runtime_persistence: { total: 0 },
        },
        role_database_object_classifications: {
          governance: "zero_objects",
          runtime_persistence: "zero_objects",
        },
        database_mutation_performed: false,
        secrets_included: false,
      };
    },
  });
  const proof = await resolver({
    expected_sha: "a".repeat(40),
    target_key: "production-runtime",
    operation_key: "database.rebuild_empty",
    action: "apply_migration",
    role_selection_proof: {
      inspection_run_id: "run:github:123456789",
      selected_roles: ["runtime"],
      composite_target_fingerprint: "f".repeat(64),
    },
  });
  assert.equal(captured.environment_key, "production_hostinger_autodeploy");
  assert.equal(captured.inspection_run_id, "run:github:123456789");
  assert.equal(Object.hasOwn(captured, "role_selection_proof"), false);
  assert.deepEqual(proof.selected_roles, ["governance", "runtime_persistence"]);
}

{
  const store = makeStore();
  let resolverCalls = 0;
  const adapters = createProductionRecoveryDurableEvidenceAdapters({
    recoveryStore: store,
    roleSelectionResolver: async (input) => {
      resolverCalls += 1;
      return {
        source: "durable_full_inspection",
        expected_sha: input.expected_sha,
        target_key: input.target_key,
        inspection_run_id: input.inspection_run_id,
        inspection_evidence_hash: "4".repeat(64),
        composite_target_fingerprint: "5".repeat(64),
        selection_hash: "6".repeat(64),
        selected_roles: ["governance"],
        database_mutation_performed: false,
        secrets_included: false,
      };
    },
  });
  assert.equal(adapters.production_live_enabled, false);
  assert.equal(adapters.activation_eligible, false);
  assert.deepEqual(
    adapters.deferred_components,
    ["mutationExecutor", "hostLocalMutationExecutor", "readbackVerifier", "migrationLedger"],
  );
  assert.equal(resolverCalls, 0);
  assert.equal(adapters.database_connection_performed_during_construction, false);
  assert.equal(adapters.provider_accessed_during_construction, false);
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.production-recovery-durable-evidence-adapters-regression.v1",
  partial_receipt_identity_immutable: true,
  caller_role_selection_ignored: true,
  production_live_enabled: false,
  secrets_included: false,
}));
