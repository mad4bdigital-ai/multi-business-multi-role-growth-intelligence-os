import assert from "node:assert/strict";
import {
  callSystemLayerTool,
  resolveSystemRecoveryStores,
} from "./routes/systemLayerRoutes.js";
import {
  getRecoveryRun,
  _testingRecoveryKernel,
} from "./recoveryKernel.js";
import {
  isDurableInspectionStore,
  isMutationGradeRecoveryStore,
} from "./recoveryDurableStoreContract.js";
import { resolveRecoveryRouteStores } from "./routes/recoveryKernelRoutes.js";

const ADMIN = Object.freeze({ is_admin: true, user_id: "test:recovery-authority", tenant_id: null });
const PRODUCTION_ENV = Object.freeze({ NODE_ENV: "production" });
const FINDING_ID = `finding:${"a".repeat(16)}`;
const PLAN_ID = `plan:${"b".repeat(16)}`;
const STEP_ID = `step:${"c".repeat(16)}`;
const PLAN_HASH = "d".repeat(64);

function readyReadiness(overrides = {}) {
  return {
    contract: "mad4b.recovery-control-store-readiness.v1",
    ready: true,
    scope: "durable_inspection",
    database_mutation_performed: false,
    schema_auto_apply: false,
    secrets_included: false,
    ...overrides,
  };
}

function inspectionStore(overrides = {}) {
  return {
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    shared_replica_safe: true,
    schema_auto_apply: false,
    provider_accessed: false,
    payload_integrity_verified_on_read: true,
    async getReadiness() { return readyReadiness(); },
    async putRun() {},
    async getRun() { return null; },
    async putPlan() {},
    async getPlan() { return null; },
    async putFinding() {},
    async getFinding() { return null; },
    async getRunByIdempotency() { return null; },
    async appendEvidenceEvent() {},
    async putIdempotencyReceipt() {},
    ...overrides,
  };
}

function mutationStore(overrides = {}) {
  return inspectionStore({
    async claimExecution() { return true; },
    async reserveApproval() { return true; },
    async getExecutionTicket() { return null; },
    async putExecutionTicket() {},
    async reserveExecutionTicket() { return true; },
    async releaseExecutionTicket() {},
    async finalizeExecutionTicket() {},
    async releaseExecutionClaim() {},
    async releaseApprovalReservation() {},
    async finalizeApproval() {},
    async putApproval() {},
    async getApprovalByPlanStep() { return null; },
    executionTicketVerifier: { verify() { return true; } },
    ...overrides,
  });
}

{
  const evidence = inspectionStore();
  const mutation = mutationStore();
  const methodShapeOnly = {
    ...inspectionStore(),
    shared_replica_safe: undefined,
    schema_auto_apply: undefined,
    payload_integrity_verified_on_read: undefined,
  };
  assert.equal(isDurableInspectionStore(evidence), true);
  assert.equal(isMutationGradeRecoveryStore(evidence), false);
  assert.equal(isDurableInspectionStore(mutation), true);
  assert.equal(isMutationGradeRecoveryStore(mutation), true);
  assert.equal(isDurableInspectionStore(methodShapeOnly), false, "method shape alone must not produce durability proof");
}

{
  const legacy = { marker: "legacy" };
  const inherited = resolveSystemRecoveryStores({ recoveryStore: legacy });
  assert.equal(inherited.readOnlyRecoveryStore, legacy);
  assert.equal(inherited.mutationRecoveryStore, legacy);

  const explicitNull = resolveSystemRecoveryStores({
    recoveryStore: legacy,
    readOnlyRecoveryStore: null,
    mutationRecoveryStore: null,
  });
  assert.equal(explicitNull.readOnlyRecoveryStore, null);
  assert.equal(explicitNull.mutationRecoveryStore, null);
  assert.equal(explicitNull.explicit_read_only_boundary, true);
  assert.equal(explicitNull.explicit_mutation_boundary, true);

  const routeNull = resolveRecoveryRouteStores({
    recoveryStore: legacy,
    readOnlyRecoveryStore: null,
    mutationRecoveryStore: null,
  }, legacy);
  assert.equal(routeNull.readOnlyRecoveryStore, null);
  assert.equal(routeNull.mutationRecoveryStore, null);
}

{
  let readCalls = 0;
  let readinessCalls = 0;
  let legacyCalls = 0;
  const readOnlyRecoveryStore = inspectionStore({
    async getReadiness() {
      readinessCalls += 1;
      return readyReadiness();
    },
    async getFinding(id) {
      readCalls += 1;
      return { finding_id: id, source: "evidence_store", severity: "info" };
    },
  });
  const recoveryStore = inspectionStore({
    async getFinding() {
      legacyCalls += 1;
      throw Object.assign(new Error("legacy alias selected"), { code: "LEGACY_STORE_SELECTED" });
    },
  });

  const result = await callSystemLayerTool(
    "recovery_kernel_call",
    { capability_key: "finding_details", input: { finding_id: FINDING_ID } },
    ADMIN,
    {
      recoveryKernelEnv: PRODUCTION_ENV,
      recoveryStore,
      readOnlyRecoveryStore,
      mutationRecoveryStore: null,
    },
  );
  assert.equal(result.finding.source, "evidence_store");
  assert.equal(result.durable_read, true);
  assert.equal(result.durability.inspection_durable, true);
  assert.equal(result.durability.mutation_grade_durable, false);
  assert.equal(result.durability.readiness_observed, true);
  assert.equal(result.durability.store_ready, true);
  assert.equal(readinessCalls, 1, "durable fixed-admin read must observe readiness in the same request");
  assert.equal(readCalls, 1);
  assert.equal(legacyCalls, 0, "fixed read bridge must not touch legacy recoveryStore when readOnlyRecoveryStore is explicit");
}

{
  let legacyCalls = 0;
  let mutationCalls = 0;
  const legacy = mutationStore({
    async getPlan() {
      legacyCalls += 1;
      throw Object.assign(new Error("legacy alias selected"), { code: "LEGACY_STORE_SELECTED" });
    },
  });
  const mutationRecoveryStore = mutationStore({
    async getPlan() {
      mutationCalls += 1;
      throw Object.assign(new Error("mutation authority selected"), { code: "MUTATION_STORE_SELECTED" });
    },
  });

  await assert.rejects(
    () => callSystemLayerTool(
      "recovery_kernel_execute_approved_step",
      {
        plan_id: PLAN_ID,
        plan_hash: PLAN_HASH,
        step_id: STEP_ID,
        approval_token: "approval-token-123456",
        idempotency_key: "idem-authority-separation",
      },
      ADMIN,
      {
        recoveryKernelEnv: PRODUCTION_ENV,
        recoveryStore: legacy,
        readOnlyRecoveryStore: inspectionStore(),
        mutationRecoveryStore,
      },
    ),
    (error) => error?.code === "MUTATION_STORE_SELECTED",
  );
  assert.equal(mutationCalls, 1);
  assert.equal(legacyCalls, 0, "execute bridge must use mutationRecoveryStore only");
}

{
  let legacyCalls = 0;
  const legacy = mutationStore({
    async getPlan() {
      legacyCalls += 1;
      throw Object.assign(new Error("legacy alias selected"), { code: "LEGACY_STORE_SELECTED" });
    },
  });
  await assert.rejects(
    () => callSystemLayerTool(
      "recovery_kernel_execute_approved_step",
      {
        plan_id: PLAN_ID,
        plan_hash: PLAN_HASH,
        step_id: STEP_ID,
        approval_token: "approval-token-123456",
        idempotency_key: "idem-explicit-null",
      },
      ADMIN,
      {
        recoveryKernelEnv: PRODUCTION_ENV,
        recoveryStore: legacy,
        readOnlyRecoveryStore: inspectionStore(),
        mutationRecoveryStore: null,
      },
    ),
    (error) => error?.code !== "LEGACY_STORE_SELECTED",
  );
  assert.equal(legacyCalls, 0, "explicit mutationRecoveryStore=null must remain fail-closed");
}

{
  let legacyCalls = 0;
  const legacy = mutationStore({
    async getPlan() {
      legacyCalls += 1;
      throw Object.assign(new Error("legacy alias selected"), { code: "LEGACY_STORE_SELECTED" });
    },
  });
  await assert.rejects(
    () => callSystemLayerTool(
      "recovery_kernel_create_approval_challenge",
      { plan_id: PLAN_ID, plan_hash: PLAN_HASH, step_id: STEP_ID },
      ADMIN,
      {
        recoveryKernelEnv: PRODUCTION_ENV,
        recoveryStore: legacy,
        readOnlyRecoveryStore: inspectionStore(),
        mutationRecoveryStore: null,
        approvalIssuer: { async createChallenge() { throw new Error("must not reach issuer without mutation authority"); } },
        approvalStore: { async putChallenge() {}, async getChallenge() { return null; } },
      },
    ),
    (error) => error?.code !== "LEGACY_STORE_SELECTED",
  );
  assert.equal(legacyCalls, 0, "approval challenge must preserve explicit-null mutation authority");
}

{
  await assert.rejects(
    () => callSystemLayerTool(
      "recovery_kernel_call",
      { capability_key: "approval_challenge_create", input: {} },
      ADMIN,
      {
        recoveryKernelEnv: PRODUCTION_ENV,
        readOnlyRecoveryStore: inspectionStore(),
        mutationRecoveryStore: mutationStore(),
      },
    ),
    (error) => error?.code === "recovery_kernel_private_surface_required",
  );
}

{
  const runId = `run:${"e".repeat(16)}`;
  let durableReads = 0;
  _testingRecoveryKernel.RUNS.set(runId, {
    run_id: runId,
    status: "observed",
    phase: "observed",
    evidence: {},
    findings: [],
  });
  const notReady = inspectionStore({
    async getReadiness() {
      return readyReadiness({ ready: false });
    },
    async getRun() {
      durableReads += 1;
      throw new Error("unready durable store must not be read");
    },
  });

  try {
    const result = await getRecoveryRun({ run_id: runId }, { recoveryStore: notReady });
    assert.equal(durableReads, 0);
    assert.equal(result.durability.durable, false);
    assert.equal(result.durability.inspection_durable, false);
    assert.equal(result.durability.store_ready, false);
    assert.equal(result.durability.readiness_observed, true);
    assert.equal(result.durability.mode, "degraded_memory_only_store_not_ready_or_unqualified");
  } finally {
    _testingRecoveryKernel.RUNS.delete(runId);
  }
}

{
  const runId = `run:${"f".repeat(16)}`;
  _testingRecoveryKernel.RUNS.set(runId, {
    run_id: runId,
    status: "observed",
    phase: "observed",
    evidence: {},
    findings: [],
  });
  let reads = 0;
  const structurallyQualifiedButUnobserved = inspectionStore({
    getReadiness: undefined,
    async getRun() {
      reads += 1;
      throw new Error("unobserved store must not be trusted as durable");
    },
  });
  try {
    const result = await getRecoveryRun({ run_id: runId }, { recoveryStore: structurallyQualifiedButUnobserved });
    assert.equal(reads, 0);
    assert.equal(result.durability.durable, false);
    assert.equal(result.durability.readiness_observed, false);
    assert.equal(result.durability.store_ready, false);
  } finally {
    _testingRecoveryKernel.RUNS.delete(runId);
  }
}

console.log("Recovery fixed System Tool store authority separation checks passed.");
