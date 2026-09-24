import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createProductionRecoveryAuthorityFoundation } from "./productionRecoveryAuthorityFoundation.js";
import {
  createProductionRecoveryOperationalAdapters,
  createProductionRecoveryOperationalComposition,
} from "./productionRecoveryOperationalAdapters.js";

const exactSha = "a".repeat(40);
const hashA = "b".repeat(64);
const hashB = "c".repeat(64);
const hashC = "d".repeat(64);
const hashD = "e".repeat(64);

function completeStoreFactory(state = {}) {
  return ({ executionTicketVerifier } = {}) => {
    const generic = async () => null;
    const store = {
      recovery_store_contract: "mad4b.recovery-durable-store.v1",
      independent_of_target_databases: true,
      target_database_binding: "forbidden",
      shared_replica_safe: true,
      schema_auto_apply: false,
      mutation_grade: true,
      payload_integrity_verified_on_read: true,
      executionTicketVerifier,
      recoveryLock: Object.freeze({
        acquire: generic, heartbeat: generic, assertFence: generic, release: generic,
      }),
      putRun: generic, getRun: generic, putPlan: generic, getPlan: generic,
      putFinding: generic, getFinding: generic, getRunByIdempotency: generic,
      appendEvidenceEvent: generic, putIdempotencyReceipt: generic,
      putApproval: generic, getApprovalByPlanStep: generic, claimExecution: generic,
      reserveApproval: generic, getExecutionTicket: generic, putExecutionTicket: generic,
      reserveExecutionTicket: generic, releaseExecutionTicket: generic,
      finalizeExecutionTicket: generic, releaseExecutionClaim: generic,
      releaseApprovalReservation: generic,
      putEphemeralCapability: generic, getEphemeralCapability: generic,
    };
    state.store = store;
    return store;
  };
}

function foundation() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createProductionRecoveryAuthorityFoundation({
    recoveryStoreFactory: completeStoreFactory({}),
    approvalSecret: "server-owned-material-with-more-than-thirty-two-bytes",
    executionPrivateKeyJwk: privateKey.export({ format: "jwk" }),
    executionPublicKeyJwk: publicKey.export({ format: "jwk" }),
    readServerAttestation: async () => ({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "Production",
      environment: "production",
      sha: exactSha,
      recovery_manifest_hash: hashA,
      attestation_hash: hashB,
      manifest_bound: true,
      read_only_probe: true,
      database_connection_performed: false,
      database_mutation_performed: false,
      provider_mutation_performed: false,
      secrets_included: false,
    }),
  });
}

function deps(calls = {}) {
  calls.execute = 0; calls.readback = 0; calls.receipt = 0; calls.proof = 0; calls.ledger = 0;
  return {
    executeDeploymentOwnedMutation: async (input) => {
      calls.execute += 1;
      calls.execution = input;
      return { ok: true, status: "provider_acknowledged", database_mutation_performed: false, secrets_included: false };
    },
    verifyIndependentReadback: async (input) => {
      calls.readback += 1;
      calls.readbackInput = input;
      return { ok: true, verified: true, postconditions_passed: true, behavioral_probe_passed: true, evidence_hash: hashA, secrets_included: false };
    },
    persistImmutablePartialReceipt: async (input) => {
      calls.receipt += 1;
      calls.receiptInput = input;
      return { persisted: true, durable: true, evidence_hash: hashB, secrets_included: false };
    },
    resolveDurableInspectionProof: async () => {
      calls.proof += 1;
      return { source: "durable_full_inspection", server_derived: true, durable: true, selected_roles: ["governance"], proof_hash: hashC, secrets_included: false };
    },
    finalizeGovernanceMigrationLedger: async (input) => {
      calls.ledger += 1;
      calls.ledgerInput = input;
      return { finalized: true, durable: true, ledger_hash: hashD, secrets_included: false };
    },
  };
}

function executionPayload() {
  return {
    plan_id: "plan:1234567890abcdef",
    plan_hash: hashA,
    step_id: "step:1234567890abcdef",
    step_hash: hashB,
    capability_key: "database.rebuild_empty",
    operation: "database.rebuild_empty",
    authority_ref: "hostinger-runtime-baseline-rebuild",
    expected_sha: exactSha,
    target_key: "production-runtime",
    target_fingerprint: hashC,
    target_role: "governance",
    idempotency_key: "idempotency:1234567890abcdef",
    execution_ticket_id: "ticket:1234567890abcdef",
    execution_ticket_hash: hashD,
    lease_id: "lease:1234567890abcdef",
    fencing_token: "fence:1234567890abcdef",
    role_selection_proof_hash: hashA,
    role_selection_proof: {
      source: "durable_full_inspection",
      expected_sha: exactSha,
      target_key: "production-runtime",
      inspection_run_id: "run:github:123456789",
      inspection_evidence_hash: hashB,
      finding_ids: ["finding:1234567890abcdef"],
      selected_roles: ["governance"],
      role_object_count_fingerprints: { governance: hashC },
      composite_target_fingerprint: hashC,
      selection_hash: hashA,
      database_mutation_performed: false,
      secrets_included: false,
    },
    selected_roles: ["governance"],
    deployment_attestation_hash: hashB,
    role_bundle_binding: {
      contract: "mad4b.role-bundle-binding.v1",
      role: "governance",
      bundle_manifest_sha256: hashA,
      role_bundle_sha256: hashB,
      statement_count: 1,
      statement_fingerprints: [hashC],
      binding_hash: hashD,
      secrets_included: false,
    },
    role_bundle_bindings: {
      governance: {
        contract: "mad4b.role-bundle-binding.v1",
        role: "governance",
        bundle_manifest_sha256: hashA,
        role_bundle_sha256: hashB,
        statement_count: 1,
        statement_fingerprints: [hashC],
        binding_hash: hashD,
        secrets_included: false,
      },
    },
  };
}

{
  const calls = {};
  const graph = createProductionRecoveryOperationalAdapters({ foundation: foundation(), ...deps(calls) });
  assert.equal(typeof graph.hostLocalMutationExecutor, "function");
  assert.equal(graph.readbackVerifier.independent_authority, true);
  assert.equal(graph.readbackVerifier.role_aware, true);
  assert.equal(graph.readbackVerifier.mutation_authority, false);
  assert.equal(graph.migrationLedger.contract, "mad4b.governance-migration-ledger.v1");

  const receipt = await graph.hostLocalMutationExecutor(executionPayload());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.caller_routing_override_used, false);
  assert.equal(calls.execute, 1);
  assert.equal(calls.execution.plan_id, "plan:1234567890abcdef");
  assert.equal(calls.execution.step_hash, hashB);
  assert.equal(calls.execution.role_selection_proof.selection_hash, hashA);
  assert.deepEqual(calls.execution.selected_roles, ["governance"]);
  assert.equal(calls.execution.role_bundle_binding.role, "governance");
  assert.equal(calls.execution.role_bundle_bindings.governance.role, "governance");

  await assert.rejects(
    () => graph.hostLocalMutationExecutor({ ...executionPayload(), workflow: "caller-selected.yml" }),
    (error) => error?.code === "RECOVERY_PRODUCTION_CALLER_ROUTING_OVERRIDE_FORBIDDEN",
  );

  const verified = await graph.readbackVerifier.verify({
    plan: { expected_sha: exactSha, plan_hash: hashA },
    step: { target_role: "governance", step_id: "step:1234567890abcdef" },
    run: { run_id: "run:1234567890abcdef" },
    target_role: "governance",
    fencing_token: "fence:1234567890abcdef",
    same_cycle: true,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.mutation_authority, false);
  assert.equal(calls.readback, 1);

  const stored = await graph.partialReceiptStore.putImmutablePartialRebuildReceipt({
    contract: "mad4b.hostinger.partial-rebuild-receipt.v1",
    receipt_id: "partial:1234567890abcdef",
    expected_sha: exactSha,
  });
  assert.equal(stored.persisted, true);
  assert.equal(stored.automatic_rerun_allowed, false);
  assert.equal(calls.receipt, 1);

  const proof = await graph.proofResolver({ expected_sha: exactSha, target_key: "production-runtime" });
  assert.deepEqual(proof.selected_roles, ["governance"]);
  assert.equal(proof.mutation_authority, false);

  const ledger = await graph.migrationLedger.finalize({ migration_id: "1051", expected_sha: exactSha });
  assert.equal(ledger.finalized, true);
  assert.equal(calls.ledger, 1);
}

{
  const calls = {};
  const composition = createProductionRecoveryOperationalComposition({ foundation: foundation(), ...deps(calls) });
  assert.equal(composition.configured, true);
  assert.equal(composition.mode, "injected_non_live");
  assert.equal(composition.live_activation, false);
  assert.equal(composition.productionRecoveryCompositionFactory.mode, "injected_non_live");
  assert.equal(composition.productionRecoveryCompositionFactory.live_activation, false);
  assert.equal(composition.operational_authority.complete_adapter_graph, true);
  assert.equal(composition.operational_authority.production_live_enabled, false);
  assert.equal(composition.operational_authority.activation_eligible, false);
  assert.equal(calls.execute, 0);
  assert.equal(calls.readback, 0);
  assert.equal(calls.receipt, 0);
  assert.equal(calls.proof, 0);
  assert.equal(calls.ledger, 0);
}

{
  const broken = deps({});
  broken.verifyIndependentReadback = async () => ({ ok: false, secrets_included: false });
  const graph = createProductionRecoveryOperationalAdapters({ foundation: foundation(), ...broken });
  await assert.rejects(
    () => graph.readbackVerifier.verify({ plan: { expected_sha: exactSha }, step: { target_role: "governance" }, target_role: "governance" }),
    (error) => error?.code === "RECOVERY_PRODUCTION_READBACK_FAILED",
  );
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.production-recovery-operational-adapters-regression.v1",
  complete_adapter_graph: true,
  production_live_enabled: false,
  activation_eligible: false,
  provider_accessed_during_construction: false,
  database_connection_performed: false,
  database_mutation_performed: false,
  secrets_included: false,
}));
