import { createHash } from "node:crypto";

export const GOVERNED_RECONCILIATION_KERNEL_VERSION = "spec011-governed-reconciliation-kernel-v2";

export const OUTCOME_CLASSIFICATIONS = Object.freeze({
  CONFIRMED_SUCCESS: "confirmed_success",
  CONFIRMED_FAILURE: "confirmed_failure",
  UNKNOWN_OUTCOME: "unknown_outcome",
  RECONCILIATION_REQUIRED: "reconciliation_required",
});

const SUPPORTED_DOMAINS = Object.freeze([
  "repository_pr",
  "migration_ledger",
  "deployment_parity",
  "provider_adapter",
]);
const DOMAIN_SET = new Set(SUPPORTED_DOMAINS);

const SUCCESS_MARKERS = new Set([
  "applied",
  "committed",
  "completed",
  "deployed",
  "merged",
  "readback_verified",
  "verified_success",
  "confirmed_applied",
  "confirmed_success",
  "succeeded",
  "reconciled",
]);

const FAILURE_MARKERS = new Set([
  "failed_before_dispatch",
  "failed_pre_dispatch",
  "failed_prewrite",
  "not_applied",
  "confirmed_not_applied",
  "confirmed_failure",
  "cancelled_before_apply",
]);

const UNKNOWN_MARKERS = new Set([
  "pending",
  "dispatching",
  "transport_failed",
  "unknown_provider_outcome",
  "unknown_outcome",
  "reconciliation_required",
]);

const SECRET_KEY_PATTERN = /(secret(?!s_included$)|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;

function reconciliationError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalized(value, max = 191) {
  return compact(value, max).toLowerCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function sha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function assertSecretFree(value, path = "evidence", depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw reconciliationError(
        400,
        "RECONCILIATION_SECRET_FIELD_REJECTED",
        "Reconciliation inputs and evidence must not contain secret-like fields.",
        { path: `${path}.${key}` },
      );
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function normalizeOperationEvidence(value = {}) {
  return Object.freeze({
    operation_id: compact(value.operation_id, 191) || null,
    evidence_operation_id: compact(value.evidence_operation_id, 191) || null,
    evidence_verified: value.evidence_verified === true,
  });
}

function normalizeReadback(entry = {}, index = 0) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw reconciliationError(
      400,
      "RECONCILIATION_READBACK_INVALID",
      "Each readback must be an object.",
      { index },
    );
  }
  assertSecretFree(entry, `readbacks[${index}]`);
  const source = normalized(entry.source, 64);
  if (!source) {
    throw reconciliationError(
      400,
      "RECONCILIATION_READBACK_SOURCE_REQUIRED",
      "Each readback requires a source.",
      { index },
    );
  }
  return Object.freeze({
    source,
    status: normalized(entry.status, 64),
    required: entry.required !== false,
    read_performed: entry.read_performed === true,
    match: entry.match === true,
    exists: entry.exists === true,
    absence_proven: entry.absence_proven === true,
    conflict: entry.conflict === true,
    fingerprint: /^[0-9a-f]{64}$/.test(normalized(entry.fingerprint, 64))
      ? normalized(entry.fingerprint, 64)
      : null,
    evidence_ref: compact(entry.evidence_ref, 500) || null,
    observed: entry.observed === undefined ? null : stableValue(entry.observed),
    ...normalizeOperationEvidence(entry),
    secrets_included: false,
  });
}

function markerSet({ dispatch = {}, receipt = {}, readbacks = [] } = {}) {
  return new Set([
    dispatch.status,
    dispatch.outcome_classification,
    receipt.state,
    receipt.status,
    receipt.outcome_classification,
    ...readbacks.map((entry) => entry.status),
  ].map((value) => normalized(value, 64)).filter(Boolean));
}

function hasMarker(markers, catalog) {
  return [...markers].some((marker) => catalog.has(marker));
}

export function classifyMutationOutcome({ dispatch = {}, receipt = {}, readbacks = [] } = {}) {
  assertSecretFree(dispatch, "dispatch");
  assertSecretFree(receipt, "receipt");
  if (!Array.isArray(readbacks)) {
    throw reconciliationError(
      400,
      "RECONCILIATION_READBACKS_INVALID",
      "readbacks must be an array.",
    );
  }

  const normalizedReadbacks = readbacks.map(normalizeReadback);
  const requiredReadbacks = normalizedReadbacks.filter((entry) => entry.required);
  const requiredConflicts = requiredReadbacks.filter((entry) => entry.conflict);
  const requiredMatches = requiredReadbacks.filter((entry) => entry.match);
  const requiredAbsenceProofs = requiredReadbacks.filter((entry) => entry.absence_proven);
  const readbackComplete = requiredReadbacks.length > 0
    && requiredReadbacks.every((entry) => (
      entry.read_performed
      && (entry.match || entry.absence_proven || entry.conflict)
    ));
  const sameOperationComplete = requiredReadbacks.length > 0
    && requiredReadbacks.every((entry) => (
      entry.evidence_verified
      && entry.operation_id
      && entry.evidence_operation_id === entry.operation_id
    ));

  const markers = markerSet({ dispatch, receipt, readbacks: normalizedReadbacks });
  const hasSuccessMarker = hasMarker(markers, SUCCESS_MARKERS);
  const hasFailureMarker = hasMarker(markers, FAILURE_MARKERS);
  const hasUnknownMarker = hasMarker(markers, UNKNOWN_MARKERS);

  let classification = OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED;
  let reasonCode = "RECONCILIATION_READBACK_INCOMPLETE";
  let retryAllowed = false;

  if (requiredConflicts.length > 0 || (hasSuccessMarker && hasFailureMarker)) {
    reasonCode = "RECONCILIATION_EVIDENCE_CONFLICT";
  } else if (readbackComplete && !sameOperationComplete) {
    reasonCode = "RECONCILIATION_SAME_OPERATION_EVIDENCE_REQUIRED";
  } else if (
    hasSuccessMarker
    && readbackComplete
    && requiredMatches.length === requiredReadbacks.length
  ) {
    classification = OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS;
    reasonCode = "RECONCILIATION_SUCCESS_READBACK_VERIFIED";
  } else if (
    hasFailureMarker
    && readbackComplete
    && requiredAbsenceProofs.length === requiredReadbacks.length
  ) {
    classification = OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE;
    reasonCode = "RECONCILIATION_NOT_APPLIED_PROVEN";
    retryAllowed = true;
  } else if (
    hasUnknownMarker
    || dispatch.dispatched === true
    || normalized(receipt.state, 64) === "pending"
  ) {
    classification = OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME;
    reasonCode = "RECONCILIATION_OUTCOME_STILL_UNKNOWN";
  } else if (requiredReadbacks.length === 0) {
    reasonCode = "RECONCILIATION_REQUIRED_READBACKS_MISSING";
  }

  const evidence = Object.freeze({
    dispatch: stableValue(dispatch),
    receipt: stableValue(receipt),
    readbacks: normalizedReadbacks,
    readback_complete: readbackComplete,
    same_operation_complete: sameOperationComplete,
    required_readback_count: requiredReadbacks.length,
    secrets_included: false,
  });

  return Object.freeze({
    ok: true,
    report_type: "governed_mutation_outcome_classification",
    kernel_version: GOVERNED_RECONCILIATION_KERNEL_VERSION,
    classification,
    reason_code: reasonCode,
    retry_allowed: retryAllowed,
    automatic_retry_performed: false,
    evidence_fingerprint: sha256(evidence),
    evidence,
    next_action: classification === OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS
      ? { action: "return_verified_readback", reason_code: reasonCode }
      : classification === OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE
        ? { action: "prepare_new_idempotent_attempt", reason_code: reasonCode }
        : { action: "perform_governed_reconciliation", reason_code: reasonCode },
    secrets_included: false,
  });
}

export function assertReadBeforeRetry({ priorOutcome, reconciliation, idempotencyKey } = {}) {
  const prior = normalized(priorOutcome, 64);
  const key = compact(idempotencyKey, 191);
  if (!key) {
    throw reconciliationError(
      400,
      "RECONCILIATION_IDEMPOTENCY_KEY_REQUIRED",
      "A stable idempotency key is required before retry evaluation.",
    );
  }

  const requiresReadback = [
    OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME,
    OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED,
  ].includes(prior);

  if (!requiresReadback) {
    return Object.freeze({
      ok: true,
      retry_allowed: prior === OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE,
      read_before_retry_required: false,
      automatic_retry_performed: false,
      idempotency_key_fingerprint: sha256(key),
      secrets_included: false,
    });
  }

  if (reconciliation?.classification !== OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE) {
    throw reconciliationError(
      409,
      "RECONCILIATION_READ_BEFORE_RETRY_REQUIRED",
      "Unknown outcomes cannot be retried until governed readback proves the mutation was not applied.",
      {
        prior_outcome: prior,
        reconciliation_classification: reconciliation?.classification || null,
        automatic_retry_performed: false,
      },
    );
  }

  const required = reconciliation.evidence?.readbacks?.filter((entry) => entry.required !== false) || [];
  const absenceProven = required.length > 0 && required.every((entry) => (
    entry.read_performed === true
    && entry.absence_proven === true
    && entry.evidence_verified === true
    && entry.operation_id
    && entry.evidence_operation_id === entry.operation_id
  ));
  if (!absenceProven) {
    throw reconciliationError(
      409,
      "RECONCILIATION_ABSENCE_PROOF_REQUIRED",
      "Retry requires complete same-operation absence proof from every required source.",
      { automatic_retry_performed: false },
    );
  }

  return Object.freeze({
    ok: true,
    retry_allowed: true,
    read_before_retry_required: true,
    readback_verified: true,
    automatic_retry_performed: false,
    idempotency_key_fingerprint: sha256(key),
    reconciliation_fingerprint: reconciliation.evidence_fingerprint,
    secrets_included: false,
  });
}

function validateAdapter(domain, adapter) {
  if (!DOMAIN_SET.has(domain)) {
    throw reconciliationError(
      400,
      "RECONCILIATION_DOMAIN_INVALID",
      "Unsupported reconciliation domain.",
      { domain },
    );
  }
  if (!adapter || typeof adapter.inspect !== "function") {
    throw reconciliationError(
      500,
      "RECONCILIATION_ADAPTER_INVALID",
      "A reconciliation adapter must expose inspect().",
      { domain },
    );
  }
  return adapter;
}

function normalizeAdapterResult(domain, result = {}) {
  assertSecretFree(result, `${domain}.adapter_result`);
  if (result.domain && result.domain !== domain) {
    throw reconciliationError(
      409,
      "RECONCILIATION_ADAPTER_DOMAIN_MISMATCH",
      "Adapter returned a different domain.",
      { expected_domain: domain, observed_domain: result.domain },
    );
  }
  const readbacks = Array.isArray(result.readbacks) ? result.readbacks : [];
  if (readbacks.length === 0) {
    throw reconciliationError(
      409,
      "RECONCILIATION_ADAPTER_READBACK_REQUIRED",
      "Adapter must return at least one readback.",
      { domain },
    );
  }
  return Object.freeze({
    domain,
    dispatch: result.dispatch || {},
    receipt: result.receipt || {},
    readbacks,
    adapter_version: compact(result.adapter_version, 64) || null,
    adapter_evidence_ref: compact(result.evidence_ref, 500) || null,
    mutation_performed: result.mutation_performed === true,
    secrets_included: false,
  });
}

export function createGovernedReconciliationKernel({ adapters = {}, clock = () => new Date() } = {}) {
  if (typeof clock !== "function") {
    throw reconciliationError(500, "RECONCILIATION_CLOCK_INVALID", "clock must be a function.");
  }
  const registry = new Map();
  for (const [domain, adapter] of Object.entries(adapters)) {
    registry.set(domain, validateAdapter(domain, adapter));
  }

  async function reconcile({ domain, input = {}, expectedEvidenceFingerprint = null } = {}) {
    const normalizedDomain = normalized(domain, 64);
    const adapter = registry.get(normalizedDomain);
    if (!adapter) {
      throw reconciliationError(
        404,
        "RECONCILIATION_ADAPTER_NOT_REGISTERED",
        "No reconciler is registered for the requested domain.",
        { domain: normalizedDomain || null },
      );
    }
    assertSecretFree(input, "input");
    const result = normalizeAdapterResult(
      normalizedDomain,
      await adapter.inspect(stableValue(input)),
    );
    if (result.mutation_performed) {
      throw reconciliationError(
        409,
        "RECONCILIATION_READ_PATH_MUTATED",
        "Reconciliation adapters must be read-only.",
        { domain: normalizedDomain },
      );
    }
    const classification = classifyMutationOutcome(result);
    if (
      expectedEvidenceFingerprint
      && normalized(expectedEvidenceFingerprint, 64) !== classification.evidence_fingerprint
    ) {
      throw reconciliationError(
        409,
        "RECONCILIATION_EVIDENCE_STALE",
        "Reconciliation evidence does not match the expected fingerprint.",
        {
          expected_evidence_fingerprint: normalized(expectedEvidenceFingerprint, 64),
          observed_evidence_fingerprint: classification.evidence_fingerprint,
        },
      );
    }
    return Object.freeze({
      ...classification,
      report_type: "governed_reconciliation_result",
      domain: normalizedDomain,
      adapter_version: result.adapter_version,
      adapter_evidence_ref: result.adapter_evidence_ref,
      reconciled_at: clock().toISOString(),
      mutation_performed: false,
      provider_dispatch_performed: false,
      secrets_included: false,
    });
  }

  function status() {
    return Object.freeze({
      ok: true,
      report_type: "governed_reconciliation_kernel_status",
      kernel_version: GOVERNED_RECONCILIATION_KERNEL_VERSION,
      registered_domains: [...registry.keys()].sort(),
      all_required_domains_registered: SUPPORTED_DOMAINS.every((domain) => registry.has(domain)),
      public_route_added: false,
      runtime_authority_changed: false,
      secrets_included: false,
    });
  }

  return Object.freeze({ reconcile, status });
}

function operationEvidence(input = {}) {
  return normalizeOperationEvidence(input);
}

function readback(source, value, expected, operation) {
  const exists = value !== null && value !== undefined;
  const match = exists && expected !== undefined && expected !== null
    ? sha256(value) === sha256(expected)
    : exists;
  return Object.freeze({
    source,
    required: true,
    read_performed: true,
    match,
    exists,
    absence_proven: !exists,
    conflict: exists && expected !== undefined && expected !== null && !match,
    status: match ? "readback_verified" : !exists ? "not_applied" : "conflict",
    fingerprint: sha256({ source, value, expected }),
    observed: value,
    ...operation,
    secrets_included: false,
  });
}

function createTwoSourceReconciler({
  domain,
  version,
  firstSource,
  secondSource,
  inspectFirst,
  inspectSecond,
  expectedFirst,
  expectedSecond,
  errorCode,
}) {
  if (typeof inspectFirst !== "function" || typeof inspectSecond !== "function") {
    throw reconciliationError(
      500,
      errorCode,
      `${domain} inspection ports are required.`,
    );
  }
  return Object.freeze({
    async inspect(input = {}) {
      const [first, second] = await Promise.all([
        inspectFirst(input),
        inspectSecond(input),
      ]);
      const operation = operationEvidence(input);
      return {
        domain,
        adapter_version: version,
        dispatch: input.dispatch || {},
        receipt: input.receipt || {},
        readbacks: [
          readback(firstSource, first, input[expectedFirst], operation),
          readback(secondSource, second, input[expectedSecond], operation),
        ],
        mutation_performed: false,
        secrets_included: false,
      };
    },
  });
}

export function createRepositoryPrReconciler({ inspectRepository, inspectPullRequest } = {}) {
  return createTwoSourceReconciler({
    domain: "repository_pr",
    version: "repository-pr-reconciler-v2",
    firstSource: "repository",
    secondSource: "pull_request",
    inspectFirst: inspectRepository,
    inspectSecond: inspectPullRequest,
    expectedFirst: "expected_repository",
    expectedSecond: "expected_pull_request",
    errorCode: "REPOSITORY_PR_RECONCILER_PORT_INVALID",
  });
}

export function createMigrationLedgerReconciler({ inspectSchema, inspectLedger } = {}) {
  return createTwoSourceReconciler({
    domain: "migration_ledger",
    version: "migration-ledger-reconciler-v2",
    firstSource: "schema",
    secondSource: "migration_ledger",
    inspectFirst: inspectSchema,
    inspectSecond: inspectLedger,
    expectedFirst: "expected_schema",
    expectedSecond: "expected_ledger",
    errorCode: "MIGRATION_LEDGER_RECONCILER_PORT_INVALID",
  });
}

export function createDeploymentParityReconciler({ inspectDeployment, inspectRuntime } = {}) {
  return createTwoSourceReconciler({
    domain: "deployment_parity",
    version: "deployment-parity-reconciler-v2",
    firstSource: "deployment",
    secondSource: "runtime",
    inspectFirst: inspectDeployment,
    inspectSecond: inspectRuntime,
    expectedFirst: "expected_deployment",
    expectedSecond: "expected_runtime",
    errorCode: "DEPLOYMENT_PARITY_RECONCILER_PORT_INVALID",
  });
}

export function createProviderAdapterReconciler({ inspectProvider, inspectInternalLedger } = {}) {
  return createTwoSourceReconciler({
    domain: "provider_adapter",
    version: "provider-adapter-reconciler-v2",
    firstSource: "provider",
    secondSource: "internal_ledger",
    inspectFirst: inspectProvider,
    inspectSecond: inspectInternalLedger,
    expectedFirst: "expected_provider",
    expectedSecond: "expected_internal_ledger",
    errorCode: "PROVIDER_RECONCILER_PORT_INVALID",
  });
}

export async function runDuplicateMutationFaultInjection({
  dispatchMutation,
  reconcile,
  idempotencyKey,
  expectedAppliedCount = 1,
} = {}) {
  if (typeof dispatchMutation !== "function" || typeof reconcile !== "function") {
    throw reconciliationError(
      500,
      "DUPLICATE_MUTATION_FAULT_PORT_INVALID",
      "dispatchMutation and reconcile functions are required.",
    );
  }
  const key = compact(idempotencyKey, 191);
  if (!key) {
    throw reconciliationError(
      400,
      "DUPLICATE_MUTATION_IDEMPOTENCY_KEY_REQUIRED",
      "idempotencyKey is required.",
    );
  }

  let firstError = null;
  try {
    await dispatchMutation({
      idempotency_key: key,
      attempt: 1,
      inject_transport_failure_after_apply: true,
    });
  } catch (error) {
    firstError = error;
  }
  if (!firstError?.unknown_outcome) {
    throw reconciliationError(
      409,
      "DUPLICATE_MUTATION_UNKNOWN_OUTCOME_NOT_INJECTED",
      "Fault injection must produce an unknown outcome after the first dispatch.",
    );
  }

  const reconciliation = await reconcile({ idempotency_key: key });
  let retryDecision;
  try {
    retryDecision = assertReadBeforeRetry({
      priorOutcome: OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME,
      reconciliation,
      idempotencyKey: key,
    });
  } catch (error) {
    retryDecision = Object.freeze({ retry_allowed: false, blocker: error.code });
  }

  if (retryDecision.retry_allowed === true) {
    await dispatchMutation({
      idempotency_key: key,
      attempt: 2,
      inject_transport_failure_after_apply: false,
    });
  }

  const final = await reconcile({ idempotency_key: key, final_readback: true });
  const appliedCount = Number(final.applied_count ?? final.evidence?.applied_count ?? 0);
  if (appliedCount !== Number(expectedAppliedCount)) {
    throw reconciliationError(
      409,
      "DUPLICATE_MUTATION_DETECTED",
      "Fault injection observed a duplicate mutation.",
      {
        expected_applied_count: Number(expectedAppliedCount),
        observed_applied_count: appliedCount,
      },
    );
  }

  return Object.freeze({
    ok: true,
    report_type: "duplicate_mutation_fault_injection_certification",
    unknown_outcome_injected: true,
    retry_attempted: retryDecision.retry_allowed === true,
    retry_blocker: retryDecision.blocker || null,
    final_classification: final.classification || null,
    applied_count: appliedCount,
    duplicate_prevented: true,
    idempotency_key_fingerprint: sha256(key),
    secrets_included: false,
  });
}

export const _testingGovernedReconciliationKernel = Object.freeze({
  stableValue,
  sha256,
  normalizeReadback,
  markerSet,
  readback,
});
