import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductionRecoveryBindingForEnv,
  _testingProductionRecoveryAuthorityBinding,
} from "./productionRecoveryAuthorityBinding.js";

const SHA = "2".repeat(40);
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const H3 = "c".repeat(64);
const H4 = "d".repeat(64);
const ROLE = "governance";

function fakeStore(verifier) {
  const fn = async () => null;
  return {
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    shared_replica_safe: true,
    schema_auto_apply: false,
    mutation_grade: true,
    payload_integrity_verified_on_read: true,
    executionTicketVerifier: verifier,
    putRun: fn, getRun: fn, putPlan: fn, getPlan: fn, putFinding: fn, getFinding: fn,
    getRunByIdempotency: fn, appendEvidenceEvent: fn, putIdempotencyReceipt: fn,
    putApproval: fn, getApprovalByPlanStep: fn, claimExecution: fn, reserveApproval: fn,
    getExecutionTicket: fn, putExecutionTicket: fn, reserveExecutionTicket: fn,
    releaseExecutionTicket: fn, finalizeExecutionTicket: fn, releaseExecutionClaim: fn,
    releaseApprovalReservation: fn,
  };
}

function completeAdapters() {
  const verifier = { verify: async () => true };
  const store = fakeStore(verifier);
  const fn = async () => null;
  const hostLocal = async () => ({ ok: true });
  return {
    deploymentIdentityProvider: { readAttestation: fn },
    recoveryStore: store,
    approvalIssuer: { createChallenge: fn },
    approvalVerifier: { verify: async () => true },
    approvalStore: { putChallenge: fn, getChallenge: fn, resolveApprovedExecutionApproval: fn },
    recoveryLock: { acquire: fn, heartbeat: fn, assertFence: fn, release: fn },
    mutationExecutor: { execute: hostLocal },
    hostLocalMutationExecutor: hostLocal,
    readbackVerifier: { verify: async () => ({ ok: true }), independent_authority: true, role_aware: true, mutation_authority: false },
    executionTicketSigner: { sign: async () => "sig" },
    executionTicketVerifier: verifier,
    partialReceiptStore: { putImmutablePartialRebuildReceipt: fn },
    proofResolver: async () => ({}),
    migrationLedger: { finalize: fn },
  };
}

function proof() {
  return {
    source: "durable_full_inspection",
    expected_sha: SHA,
    target_key: "production-runtime",
    selected_roles: [ROLE],
    inspection_run_id: "run:github:35946122811",
    inspection_evidence_hash: H1,
    finding_ids: ["finding:0123456789abcdef0123456789abcdef"],
    role_object_count_fingerprints: { [ROLE]: H2 },
    composite_target_fingerprint: H3,
    selection_hash: H4,
    database_mutation_performed: false,
    secrets_included: false,
  };
}

function bundle() {
  return {
    contract: "mad4b.role-bundle-binding.v1",
    role: ROLE,
    bundle_manifest_sha256: H1,
    role_bundle_sha256: H2,
    statement_count: 1,
    statement_fingerprints: [H3],
    binding_hash: H4,
    secrets_included: false,
  };
}

function execution() {
  const p = proof();
  const b = bundle();
  return {
    plan_id: "plan:0123456789abcdef0123456789abcdef",
    plan_hash: H1,
    step_id: "step:0123456789abcdef0123456789abcdef",
    step_hash: H2,
    capability_key: `${ROLE}.baseline.rebuild_empty`,
    operation: "database.rebuild_empty",
    target_role: ROLE,
    authority_ref: `${ROLE}.baseline.rebuild_empty`,
    expected_sha: SHA,
    target_key: "production-runtime",
    target_fingerprint: H3,
    idempotency_key: "recovery-production-baseline-test-001",
    execution_ticket_id: "ticket:0123456789abcdef0123456789abcdef",
    execution_ticket_hash: H4,
    lease_id: "lease:0123456789abcdef",
    fencing_token: "fence:0123456789abcdef",
    role_selection_proof_hash: p.selection_hash,
    role_selection_proof: p,
    selected_roles: [ROLE],
    deployment_attestation_hash: H1,
    role_bundle_binding: b,
    role_bundle_bindings: { [ROLE]: b },
    grant_binding_hash: null,
  };
}

test("Production binding is baseline-only and maps one approved role into local bootstrap", async () => {
  const calls = [];
  let operationalDeps = null;
  const adapters = completeAdapters();
  const env = {
    RECOVERY_PRODUCTION_EXECUTION_PRIVATE_JWK: JSON.stringify({ kty: "OKP", crv: "Ed25519", d: "server-only" }),
    RECOVERY_PRODUCTION_APPROVAL_HMAC_SECRET: "server-owned-approval-material-for-test-only-0123456789",
    RECOVERY_MUTATIONS_ENABLED: "true",
  };
  const envelope = createProductionRecoveryBindingForEnv({
    env,
    foundationFactory: () => ({ recoveryStore: adapters.recoveryStore }),
    controlStoreFactory: () => adapters.recoveryStore,
    durableEvidenceFactory: () => ({
      partialReceiptStore: { putImmutablePartialRebuildReceipt: async () => ({ persisted: true, durable: true, secrets_included: false }) },
      proofResolver: async () => ({ ...proof(), server_derived: true, durable: true }),
    }),
    operationalAdaptersFactory: (deps) => {
      operationalDeps = deps;
      return adapters;
    },
    bootstrapRunner: async ({ env: bootstrapEnv }) => {
      calls.push(structuredClone({
        mode: bootstrapEnv.BOOTSTRAP_MODE,
        source: bootstrapEnv.BOOTSTRAP_TARGET_SOURCE,
        role: bootstrapEnv.BOOTSTRAP_ROLE_SELECTION,
        plan_hash: bootstrapEnv.BOOTSTRAP_PLAN_SHA256,
        selection_hash: bootstrapEnv.BOOTSTRAP_ROLE_SELECTION_HASH,
        bindings: JSON.parse(bootstrapEnv.BOOTSTRAP_ROLE_BUNDLE_BINDINGS_JSON || "{}"),
        confirmation: bootstrapEnv.BOOTSTRAP_REBUILD_CONFIRMATION,
      }));
      if (bootstrapEnv.BOOTSTRAP_MODE === "dry_run") {
        return {
          status: "dry_run_complete",
          role_database_object_classifications: { [ROLE]: "nonempty_objects" },
          role_table_evidence: { [ROLE]: [{ table: "governed_migration_ledger", present: true }] },
          database_connection_performed: true,
          database_mutation_performed: false,
          migration_apply_performed: false,
          grant_mutation_performed: false,
          secrets_included: false,
        };
      }
      return {
        status: "baseline_rebuild_complete",
        operation: "database.rebuild_empty",
        database_connection_performed: true,
        database_mutation_performed: true,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        secrets_included: false,
      };
    },
  });

  assert.equal(envelope.binding_source, "server_managed");
  assert.equal(envelope.live_authorization.authorized, true);
  assert.equal(envelope.live_authorization.baseline_rebuild_only, true);
  assert.equal(envelope.live_authorization.ordinary_migration_enabled, false);
  assert.equal(envelope.live_authorization.grants_enabled, false);
  assert.equal(envelope.secrets_included, false);
  assert.ok(operationalDeps);

  const applied = await operationalDeps.executeDeploymentOwnedMutation(execution());
  assert.equal(applied.status, "baseline_rebuild_complete");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    mode: "apply_migration",
    source: "host_local_role_env",
    role: ROLE,
    plan_hash: H1,
    selection_hash: H4,
    bindings: { [ROLE]: bundle() },
    confirmation: `APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:${SHA}:production-runtime:${ROLE}`,
  });

  await assert.rejects(
    () => operationalDeps.executeDeploymentOwnedMutation({ ...execution(), capability_key: "governance.migration.apply", operation: "apply_migration" }),
    (error) => error?.code === "RECOVERY_PRODUCTION_BASELINE_EXECUTION_DENIED",
  );
  assert.equal(calls.length, 1);

  const readback = await operationalDeps.verifyIndependentReadback({
    expected_sha: SHA,
    target_role: ROLE,
    same_cycle: true,
    fencing_token: "fence:0123456789abcdef",
  });
  assert.equal(readback.verified, true);
  assert.equal(readback.mutation_authority, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].mode, "dry_run");
});

test("Production binding remains non-authorized while the mutation kill-switch is off", () => {
  const adapters = completeAdapters();
  const envelope = createProductionRecoveryBindingForEnv({
    env: {
      RECOVERY_PRODUCTION_EXECUTION_PRIVATE_JWK: "{}",
      RECOVERY_PRODUCTION_APPROVAL_HMAC_SECRET: "server-owned-approval-material-for-test-only-0123456789",
      RECOVERY_MUTATIONS_ENABLED: "false",
    },
    foundationFactory: () => ({ recoveryStore: adapters.recoveryStore }),
    durableEvidenceFactory: () => ({
      partialReceiptStore: { putImmutablePartialRebuildReceipt: async () => ({ persisted: true, durable: true, secrets_included: false }) },
      proofResolver: async () => ({ ...proof(), server_derived: true, durable: true }),
    }),
    operationalAdaptersFactory: () => adapters,
  });
  assert.equal(envelope.live_authorization.authorized, false);
  assert.equal(envelope.live_authorization.kill_switch_enabled, false);
  assert.equal(envelope.database_connection_performed, false);
  assert.equal(envelope.database_mutation_performed, false);
});

test("baseline execution rejects role-set or bundle drift before invoking a provider", () => {
  const base = execution();
  assert.throws(
    () => _testingProductionRecoveryAuthorityBinding.assertBaselineExecution({
      ...base,
      selected_roles: ["governance", "runtime_persistence"],
    }),
    (error) => error?.code === "RECOVERY_PRODUCTION_BASELINE_EXECUTION_DENIED",
  );
  assert.throws(
    () => _testingProductionRecoveryAuthorityBinding.assertBaselineExecution({
      ...base,
      role_bundle_bindings: {},
    }),
    (error) => error?.code === "RECOVERY_PRODUCTION_BASELINE_EXECUTION_DENIED",
  );
});
