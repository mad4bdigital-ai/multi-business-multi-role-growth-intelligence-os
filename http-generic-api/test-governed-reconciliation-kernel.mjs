import assert from "node:assert/strict";
import {
  OUTCOME_CLASSIFICATIONS,
  assertReadBeforeRetry,
  classifyMutationOutcome,
  createDeploymentParityReconciler,
  createGovernedReconciliationKernel,
  createMigrationLedgerReconciler,
  createProviderAdapterReconciler,
  createRepositoryPrReconciler,
  runDuplicateMutationFaultInjection,
} from "./governedReconciliationKernel.js";

const hash = "a".repeat(64);
const operationId = "operation-phase4-1";

function readback(overrides = {}) {
  return {
    source: "provider",
    status: "readback_verified",
    required: true,
    read_performed: true,
    match: true,
    exists: true,
    fingerprint: hash,
    operation_id: operationId,
    evidence_operation_id: operationId,
    evidence_verified: true,
    ...overrides,
  };
}

const matchingReadbacks = [
  readback({ source: "provider" }),
  readback({ source: "internal_ledger" }),
];

const success = classifyMutationOutcome({
  dispatch: { status: "completed", dispatched: true },
  receipt: { state: "succeeded", outcome_classification: "verified_success" },
  readbacks: matchingReadbacks,
});
assert.equal(success.classification, OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS);
assert.equal(success.retry_allowed, false);
assert.equal(success.evidence.readback_complete, true);
assert.equal(success.evidence.same_operation_complete, true);

const successWithOptionalObserver = classifyMutationOutcome({
  dispatch: { status: "completed", dispatched: true },
  receipt: { state: "succeeded", outcome_classification: "verified_success" },
  readbacks: [
    ...matchingReadbacks,
    readback({
      source: "optional_observer",
      required: false,
      status: "not_applied",
      match: false,
      exists: false,
      absence_proven: true,
    }),
  ],
});
assert.equal(
  successWithOptionalObserver.classification,
  OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS,
  "optional readback failure markers must not alter required-source classification",
);

const wrongOperation = classifyMutationOutcome({
  dispatch: { status: "completed", dispatched: true },
  receipt: { state: "succeeded", outcome_classification: "verified_success" },
  readbacks: [
    readback({ evidence_operation_id: "another-operation" }),
  ],
});
assert.equal(wrongOperation.classification, OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED);
assert.equal(wrongOperation.reason_code, "RECONCILIATION_SAME_OPERATION_EVIDENCE_REQUIRED");

const splitOperationReadbacks = [
  readback({ source: "provider", operation_id: "operation-a", evidence_operation_id: "operation-a" }),
  readback({ source: "internal_ledger", operation_id: "operation-b", evidence_operation_id: "operation-b" }),
];
const splitOperation = classifyMutationOutcome({
  dispatch: { status: "completed", dispatched: true },
  receipt: { state: "succeeded", outcome_classification: "verified_success" },
  readbacks: splitOperationReadbacks,
});
assert.equal(splitOperation.classification, OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED);
assert.equal(splitOperation.reason_code, "RECONCILIATION_SAME_OPERATION_EVIDENCE_REQUIRED");
assert.equal(splitOperation.evidence.same_operation_complete, false);

const failureReadbacks = [
  readback({ source: "provider", status: "not_applied", match: false, exists: false, absence_proven: true }),
  readback({ source: "internal_ledger", status: "not_applied", match: false, exists: false, absence_proven: true }),
];
const failure = classifyMutationOutcome({
  dispatch: { status: "failed_before_dispatch", dispatched: false },
  receipt: { state: "reconciled", outcome_classification: "confirmed_failure" },
  readbacks: failureReadbacks,
});
assert.equal(failure.classification, OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE);
assert.equal(failure.retry_allowed, true);

const splitOperationFailure = classifyMutationOutcome({
  dispatch: { status: "failed_before_dispatch", dispatched: false },
  receipt: { state: "reconciled", outcome_classification: "confirmed_failure" },
  readbacks: [
    readback({ source: "provider", status: "not_applied", match: false, exists: false, absence_proven: true, operation_id: "operation-a", evidence_operation_id: "operation-a" }),
    readback({ source: "internal_ledger", status: "not_applied", match: false, exists: false, absence_proven: true, operation_id: "operation-b", evidence_operation_id: "operation-b" }),
  ],
});
assert.equal(splitOperationFailure.classification, OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED);
assert.equal(splitOperationFailure.retry_allowed, false);

const unknown = classifyMutationOutcome({
  dispatch: { status: "transport_failed", dispatched: true },
  receipt: { state: "pending", outcome_classification: "pending" },
  readbacks: [
    readback({ status: "pending", read_performed: false, match: false, exists: false }),
  ],
});
assert.equal(unknown.classification, OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME);
assert.equal(unknown.retry_allowed, false);

const conflict = classifyMutationOutcome({
  dispatch: { status: "completed", dispatched: true },
  receipt: { state: "succeeded", outcome_classification: "verified_success" },
  readbacks: [readback({ status: "conflict", match: false, conflict: true })],
});
assert.equal(conflict.classification, OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED);
assert.equal(conflict.reason_code, "RECONCILIATION_EVIDENCE_CONFLICT");

assert.throws(
  () => assertReadBeforeRetry({
    priorOutcome: OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME,
    reconciliation: success,
    idempotencyKey: "stable-retry-key",
  }),
  (error) => error?.code === "RECONCILIATION_READ_BEFORE_RETRY_REQUIRED" && error?.status === 409,
);

assert.throws(
  () => assertReadBeforeRetry({
    priorOutcome: OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME,
    reconciliation: splitOperationFailure,
    idempotencyKey: "stable-retry-key",
  }),
  (error) => error?.code === "RECONCILIATION_READ_BEFORE_RETRY_REQUIRED" && error?.status === 409,
);

const retryGate = assertReadBeforeRetry({
  priorOutcome: OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME,
  reconciliation: failure,
  idempotencyKey: "stable-retry-key",
});
assert.equal(retryGate.retry_allowed, true);
assert.equal(retryGate.readback_verified, true);
assert.equal(retryGate.automatic_retry_performed, false);

const expectedRepository = { head_sha: "1".repeat(40), base_sha: "2".repeat(40) };
const expectedPullRequest = { number: 42, state: "open", head_sha: "1".repeat(40) };
const expectedSchema = { checksum: hash, applied: true };
const expectedLedger = { checksum: hash, status: "applied" };
const expectedDeployment = { commit_sha: "3".repeat(40), status: "deployed" };
const expectedRuntime = { commit_sha: "3".repeat(40), healthy: true };
const expectedProvider = { object_id: "provider-1", state: "active" };
const expectedInternalLedger = { object_id: "provider-1", state: "active" };

const kernel = createGovernedReconciliationKernel({
  clock: () => new Date("2026-07-31T10:00:00.000Z"),
  adapters: {
    repository_pr: createRepositoryPrReconciler({
      inspectRepository: async () => expectedRepository,
      inspectPullRequest: async () => expectedPullRequest,
    }),
    migration_ledger: createMigrationLedgerReconciler({
      inspectSchema: async () => expectedSchema,
      inspectLedger: async () => expectedLedger,
    }),
    deployment_parity: createDeploymentParityReconciler({
      inspectDeployment: async () => expectedDeployment,
      inspectRuntime: async () => expectedRuntime,
    }),
    provider_adapter: createProviderAdapterReconciler({
      inspectProvider: async () => expectedProvider,
      inspectInternalLedger: async () => expectedInternalLedger,
    }),
  },
});

assert.equal(kernel.status().all_required_domains_registered, true);
assert.deepEqual(kernel.status().registered_domains, [
  "deployment_parity",
  "migration_ledger",
  "provider_adapter",
  "repository_pr",
]);

const cases = [
  ["repository_pr", { expected_repository: expectedRepository, expected_pull_request: expectedPullRequest }],
  ["migration_ledger", { expected_schema: expectedSchema, expected_ledger: expectedLedger }],
  ["deployment_parity", { expected_deployment: expectedDeployment, expected_runtime: expectedRuntime }],
  ["provider_adapter", { expected_provider: expectedProvider, expected_internal_ledger: expectedInternalLedger }],
];

for (const [domain, expected] of cases) {
  const result = await kernel.reconcile({
    domain,
    input: {
      ...expected,
      operation_id: operationId,
      evidence_operation_id: operationId,
      evidence_verified: true,
      dispatch: { status: "completed", dispatched: true },
      receipt: { state: "succeeded", outcome_classification: "verified_success" },
    },
  });
  assert.equal(result.classification, OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS, domain);
  assert.equal(result.mutation_performed, false);
  assert.equal(result.provider_dispatch_performed, false);
  assert.equal(result.secrets_included, false);
}

await assert.rejects(
  () => kernel.reconcile({
    domain: "provider_adapter",
    input: {
      expected_provider: expectedProvider,
      operation_id: operationId,
      evidence_operation_id: operationId,
      evidence_verified: true,
    },
  }),
  (error) => error?.code === "RECONCILIATION_EXPECTED_STATE_REQUIRED" && error?.status === 400,
);

await assert.rejects(
  () => kernel.reconcile({ domain: "provider_adapter", input: { access_token: "forbidden" } }),
  (error) => error?.code === "RECONCILIATION_SECRET_FIELD_REJECTED",
);

const deeplyNestedObserved = {};
let nestedCursor = deeplyNestedObserved;
for (let depth = 0; depth < 14; depth += 1) {
  nestedCursor.next = {};
  nestedCursor = nestedCursor.next;
}
nestedCursor.access_token = "must-never-be-copied";

const deepEvidenceKernel = createGovernedReconciliationKernel({
  adapters: {
    provider_adapter: {
      inspect: async () => ({
        domain: "provider_adapter",
        dispatch: {},
        receipt: {},
        readbacks: [readback({ observed: deeplyNestedObserved })],
        mutation_performed: false,
      }),
    },
  },
});
await assert.rejects(
  () => deepEvidenceKernel.reconcile({ domain: "provider_adapter" }),
  (error) => error?.code === "RECONCILIATION_EVIDENCE_DEPTH_EXCEEDED" && error?.status === 400,
);

const mutatingKernel = createGovernedReconciliationKernel({
  adapters: {
    provider_adapter: {
      inspect: async () => ({
        domain: "provider_adapter",
        dispatch: {},
        receipt: {},
        readbacks: [readback()],
        mutation_performed: true,
      }),
    },
  },
});
await assert.rejects(
  () => mutatingKernel.reconcile({ domain: "provider_adapter" }),
  (error) => error?.code === "RECONCILIATION_READ_PATH_MUTATED",
);

let appliedCount = 0;
const seenKeys = new Set();
const faultResult = await runDuplicateMutationFaultInjection({
  idempotencyKey: "duplicate-protection-key",
  dispatchMutation: async ({ idempotency_key: key, attempt, inject_transport_failure_after_apply: inject }) => {
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      appliedCount += 1;
    }
    if (attempt === 1 && inject) {
      const error = new Error("transport failed after apply");
      error.unknown_outcome = true;
      throw error;
    }
    return { ok: true };
  },
  reconcile: async () => ({
    ...success,
    applied_count: appliedCount,
    evidence: { ...success.evidence, applied_count: appliedCount },
  }),
});
assert.equal(faultResult.unknown_outcome_injected, true);
assert.equal(faultResult.retry_attempted, false);
assert.equal(faultResult.applied_count, 1);
assert.equal(faultResult.duplicate_prevented, true);
assert.equal(appliedCount, 1);

console.log("governed reconciliation kernel: ok");