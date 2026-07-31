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
const matchingReadbacks = [
  { source: "provider", status: "readback_verified", required: true, read_performed: true, match: true, exists: true, fingerprint: hash },
  { source: "ledger", status: "readback_verified", required: true, read_performed: true, match: true, exists: true, fingerprint: hash },
];

const success = classifyMutationOutcome({
  dispatch: { status: "completed", dispatched: true },
  receipt: { state: "reconciled", outcome_classification: "verified_success" },
  readbacks: matchingReadbacks,
});
assert.equal(success.classification, OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS);
assert.equal(success.retry_allowed, false);
assert.equal(success.evidence.readback_complete, true);

const failure = classifyMutationOutcome({
  dispatch: { status: "failed_before_dispatch", dispatched: false },
  receipt: { state: "reconciled", outcome_classification: "confirmed_failure" },
  readbacks: [
    { source: "provider", status: "not_applied", required: true, read_performed: true, absence_proven: true, exists: false, fingerprint: hash },
    { source: "ledger", status: "not_applied", required: true, read_performed: true, absence_proven: true, exists: false, fingerprint: hash },
  ],
});
assert.equal(failure.classification, OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE);
assert.equal(failure.retry_allowed, true);

const unknown = classifyMutationOutcome({
  dispatch: { status: "transport_failed", dispatched: true },
  receipt: { state: "pending", outcome_classification: "pending" },
  readbacks: [
    { source: "provider", status: "pending", required: true, read_performed: false },
  ],
});
assert.equal(unknown.classification, OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME);
assert.equal(unknown.retry_allowed, false);

const conflict = classifyMutationOutcome({
  dispatch: { status: "completed", dispatched: true },
  receipt: { state: "reconciled", outcome_classification: "verified_success" },
  readbacks: [
    { source: "provider", status: "conflict", required: true, read_performed: true, conflict: true, exists: true, fingerprint: hash },
  ],
});
assert.equal(conflict.classification, OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED);

assert.throws(
  () => assertReadBeforeRetry({
    priorOutcome: OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME,
    reconciliation: success,
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
      dispatch: { status: "completed", dispatched: true },
      receipt: { state: "reconciled", outcome_classification: "verified_success" },
    },
  });
  assert.equal(result.classification, OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS, domain);
  assert.equal(result.mutation_performed, false);
  assert.equal(result.provider_dispatch_performed, false);
  assert.equal(result.secrets_included, false);
}

await assert.rejects(
  () => kernel.reconcile({ domain: "provider_adapter", input: { access_token: "forbidden" } }),
  (error) => error?.code === "RECONCILIATION_SECRET_FIELD_REJECTED",
);

const mutatingKernel = createGovernedReconciliationKernel({
  adapters: {
    provider_adapter: {
      inspect: async () => ({
        domain: "provider_adapter",
        dispatch: {},
        receipt: {},
        readbacks: [{ source: "provider", required: true, read_performed: true, match: true, exists: true }],
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
