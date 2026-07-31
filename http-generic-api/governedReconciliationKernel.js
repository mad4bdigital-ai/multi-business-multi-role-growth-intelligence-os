import { createHash } from "node:crypto";

export const GOVERNED_RECONCILIATION_KERNEL_VERSION = "spec011-governed-reconciliation-kernel-v1";

export const OUTCOME_CLASSIFICATIONS = Object.freeze({
  CONFIRMED_SUCCESS: "confirmed_success",
  CONFIRMED_FAILURE: "confirmed_failure",
  UNKNOWN_OUTCOME: "unknown_outcome",
  RECONCILIATION_REQUIRED: "reconciliation_required",
});

const DOMAINS = new Set([
  "repository_pr",
  "migration_ledger",
  "deployment_parity",
  "provider_adapter",
]);

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
]);

const FAILURE_MARKERS = new Set([
  "failed_before_dispatch",
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

const SECRET_PATTERN = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;

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

function lower(value, max = 191) {
  return compact(value, max).toLowerCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function assertSecretFree(value, path = "evidence", depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_PATTERN.test(key)) {
      throw reconciliationError(400, "RECONCILIATION_SECRET_FIELD_REJECTED", "Reconciliation evidence must not contain secret-like fields.", {
        path: `${path}.${key}`,
      });
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function normalizeReadback(entry = {}, index = 0) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw reconciliationError(400, "RECONCILIATION_READBACK_INVALID", "Each readback must be an object.", { index });
  }
  assertSecretFree(entry, `readbacks[${index}]`);
  const source = lower(entry.source, 64);
  if (!source) {
    throw reconciliationError(400, "RECONCILIATION_READBACK_SOURCE_REQUIRED", "Each readback requires source.", { index });
  }
  const status = lower(entry.status, 64);
  return {
    source,
    status,
    required: entry.required !== false,
    read_performed: entry.read_performed === true,
    match: entry.match === true,
    exists: entry.exists === true,
    absence_proven: entry.absence_proven === true,
    conflict: entry.conflict === true,
    fingerprint: /^[0-9a-f]{64}$/.test(lower(entry.fingerprint, 64)) ? lower(entry.fingerprint, 64) : null,
    evidence_ref: compact(entry.evidence_ref, 500) || null,
    observed: entry.observed === undefined ? null : stableValue(entry.observed),
    secrets_included: false,
  };
}

function markerSet({ dispatch = {}, receipt = {}, readbacks = [] } = {}) {
  const values = [
    dispatch.status,
    dispatch.outcome_classification,
    receipt.state,
    receipt.status,
    receipt.outcome_classification,
    ...readbacks.map((item) => item.status),
  ];
  return new Set(values.map((value) => lower(value, 64)).filter(Boolean));
}

export function classifyMutationOutcome({ dispatch = {}, receipt = {}, readbacks = [] } = {}) {
  assertSecretFree(dispatch, "dispatch");
  assertSecretFree(receipt, "receipt");
  const normalizedReadbacks = readbacks.map(normalizeReadback);
  const markers = markerSet({ dispatch, receipt, readbacks: normalizedReadbacks });
  const requiredReadbacks = normalizedReadbacks.filter((entry) => entry.required);
  const readbackComplete = requiredReadbacks.length > 0
    && requiredReadbacks.every((entry) => entry.read_performed && (entry.match || entry.absence_proven || entry.conflict));
  const conflicts = normalizedReadbacks.filter((entry) => entry.conflict);
  const matches = normalizedReadbacks.filter((entry) => entry.match);
  const absenceProofs = normalizedReadbacks.filter((entry) => entry.absence_proven);
  const hasSuccessMarker = [...markers].some((marker) => SUCCESS_MARKERS.has(marker));
  const hasFailureMarker = [...markers].some((marker) => FAILURE_MARKERS.has(marker));
  const hasUnknownMarker = [...markers].some((marker) => UNKNOWN_MARKERS.has(marker));

  let classification;
  let reasonCode;
  let retryAllowed = false;

  if (conflicts.length > 0 || (hasSuccessMarker && hasFailureMarker)) {
    classification = OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED;
    reasonCode = "RECONCILIATION_EVIDENCE_CONFLICT";
  } else if (hasSuccessMarker && readbackComplete && matches.length === requiredReadbacks.length) {
    classification = OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS;
    reasonCode = "RECONCILIATION_SUCCESS_READBACK_VERIFIED";
  } else if (hasFailureMarker && readbackComplete && absenceProofs.length === requiredReadbacks.length) {
    classification = OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE;
    reasonCode = "RECONCILIATION_NOT_APPLIED_PROVEN";
    retryAllowed = true;
  } else if (hasUnknownMarker || dispatch.dispatched === true || receipt.state === "pending") {
    classification = OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME;
    reasonCode = "RECONCILIATION_OUTCOME_STILL_UNKNOWN";
  } else {
    classification = OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED;
    reasonCode = requiredReadbacks.length === 0
      ? "RECONCILIATION_REQUIRED_READBACKS_MISSING"
      : "RECONCILIATION_READBACK_INCOMPLETE";
  }

  const evidence = {
    dispatch: stableValue(dispatch),
    receipt: stableValue(receipt),
    readbacks: normalizedReadbacks,
    readback_complete: readbackComplete,
    required_readback_count: requiredReadbacks.length,
    secrets_included: false,
  };

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
  const prior = lower(priorOutcome, 64);
  const key = compact(idempotencyKey, 191);
  if (!key) {
    throw reconciliationError(400, "RECONCILIATION_IDEMPOTENCY_KEY_REQUIRED", "A stable idempotency key is required before retry evaluation.");
  }
  if (![OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME, OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED].includes(prior)) {
    return Object.freeze({
      ok: true,
      retry_allowed: prior === OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE,
      read_before_retry_required: false,
      automatic_retry_performed: false,
      idempotency_key_fingerprint: sha256(key),
      secrets_included: false,
    });
  }
  if (!reconciliation || reconciliation.classification !== OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE) {
    throw reconciliationError(409, "RECONCILIATION_READ_BEFORE_RETRY_REQUIRED", "Unknown outcomes cannot be retried until governed readback proves the mutation was not applied.", {
      prior_outcome: prior,
      reconciliation_classification: reconciliation?.classification || null,
      automatic_retry_performed: false,
    });
  }
  const required = reconciliation.evidence?.readbacks?.filter((entry) => entry.required !== false) || [];
  if (required.length === 0 || !required.every((entry) => entry.read_performed === true && entry.absence_proven === true)) {
    throw reconciliationError(409, "RECONCILIATION_ABSENCE_PROOF_REQUIRED", "Retry requires complete required-source absence proof.", {
      automatic_retry_performed: false,
    });
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
  if (!DOMAINS.has(domain)) {
    throw reconciliationError(400, "RECONCILIATION_DOMAIN_INVALID", "Unsupported reconciliation domain.", { domain });
  }
  if (!adapter || typeof adapter.inspect !== "function") {
    throw reconciliationError(500, "RECONCILIATION_ADAPTER_INVALID", "A reconciliation adapter must expose inspect().", { domain });
  }
  return adapter;
}

function normalizeAdapterResult(domain, result = {}) {
  assertSecretFree(result, `${domain}.adapter_result`);
  if (result.domain && result.domain !== domain) {
    throw reconciliationError(409, "RECONCILIATION_ADAPTER_DOMAIN_MISMATCH", "Adapter returned a different domain.", {
      expected_domain: domain,
      observed_domain: result.domain,
    });
  }
  const readbacks = Array.isArray(result.readbacks) ? result.readbacks : [];
  if (readbacks.length === 0) {
    throw reconciliationError(409, "RECONCILIATION_ADAPTER_READBACK_REQUIRED", "Adapter must return at least one readback.", { domain });
  }
  return {
    domain,
    dispatch: result.dispatch || {},
    receipt: result.receipt || {},
    readbacks,
    adapter_version: compact(result.adapter_version, 64) || null,
    adapter_evidence_ref: compact(result.evidence_ref, 500) || null,
    mutation_performed: result.mutation_performed === true,
    secrets_included: false,
  };
}

export function createGovernedReconciliationKernel({ adapters = {}, clock = () => new Date() } = {}) {
  const registry = new Map();
  for (const [domain, adapter] of Object.entries(adapters)) {
    registry.set(domain, validateAdapter(domain, adapter));
  }
  if (typeof clock !== "function") {
    throw reconciliationError(500, "RECONCILIATION_CLOCK_INVALID", "clock must be a function.");
  }

  async function reconcile({ domain, input = {}, expectedEvidenceFingerprint = null } = {}) {
    const normalizedDomain = lower(domain, 64);
    const adapter = registry.get(normalizedDomain);
    if (!adapter) {
      throw reconciliationError(404, "RECONCILIATION_ADAPTER_NOT_REGISTERED", "No reconciler is registered for the requested domain.", {
        domain: normalizedDomain || null,
      });
    }
    assertSecretFree(input, "input");
    const result = normalizeAdapterResult(normalizedDomain, await adapter.inspect(stableValue(input)));
    if (result.mutation_performed) {
      throw reconciliationError(409, "RECONCILIATION_READ_PATH_MUTATED", "Reconciliation adapters must be read-only.", {
        domain: normalizedDomain,
      });
    }
    const classification = classifyMutationOutcome(result);
    if (expectedEvidenceFingerprint && lower(expectedEvidenceFingerprint, 64) !== classification.evidence_fingerprint) {
      throw reconciliationError(409, "RECONCILIATION_EVIDENCE_STALE", "Reconciliation evidence does not match the expected fingerprint.", {
        expected_evidence_fingerprint: lower(expectedEvidenceFingerprint, 64),
        observed_evidence_fingerprint: classification.evidence_fingerprint,
      });
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
      all_required_domains_registered: [...DOMAINS].every((domain) => registry.has(domain)),
      public_route_added: false,
      runtime_authority_changed: false,
      secrets_included: false,
    });
  }

  return Object.freeze({ reconcile, status });
}

function readback(source, value, expected) {
  const exists = value !== null && value !== undefined;
  const match = exists && expected !== undefined && expected !== null
    ? sha256(value) === sha256(expected)
    : exists;
  return {
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
    secrets_included: false,
  };
}

export function createRepositoryPrReconciler({ inspectRepository, inspectPullRequest } = {}) {
  if (typeof inspectRepository !== "function" || typeof inspectPullRequest !== "function") {
    throw reconciliationError(500, "REPOSITORY_PR_RECONCILER_PORT_INVALID", "Repository and pull-request inspection ports are required.");
  }
  return Object.freeze({
    async inspect(input = {}) {
      const [repository, pullRequest] = await Promise.all([
        inspectRepository(input),
        inspectPullRequest(input),
      ]);
      return {
        domain: "repository_pr",
        adapter_version: "repository-pr-reconciler-v1",
        dispatch: input.dispatch || {},
        receipt: input.receipt || {},
        readbacks: [
          readback("repository", repository, input.expected_repository),
          readback("pull_request", pullRequest, input.expected_pull_request),
        ],
        mutation_performed: false,
        secrets_included: false,
      };
    },
  });
}

export function createMigrationLedgerReconciler({ inspectSchema, inspectLedger } = {}) {
  if (typeof inspectSchema !== "function" || typeof inspectLedger !== "function") {
    throw reconciliationError(500, "MIGRATION_LEDGER_RECONCILER_PORT_INVALID", "Schema and migration-ledger inspection ports are required.");
  }
  return Object.freeze({
    async inspect(input = {}) {
      const [schema, ledger] = await Promise.all([inspectSchema(input), inspectLedger(input)]);
      return {
        domain: "migration_ledger",
        adapter_version: "migration-ledger-reconciler-v1",
        dispatch: input.dispatch || {},
        receipt: input.receipt || {},
        readbacks: [
          readback("schema", schema, input.expected_schema),
          readback("migration_ledger", ledger, input.expected_ledger),
        ],
        mutation_performed: false,
        secrets_included: false,
      };
    },
  });
}

export function createDeploymentParityReconciler({ inspectDeployment, inspectRuntime } = {}) {
  if (typeof inspectDeployment !== "function" || typeof inspectRuntime !== "function") {
    throw reconciliationError(500, "DEPLOYMENT_PARITY_RECONCILER_PORT_INVALID", "Deployment and runtime inspection ports are required.");
  }
  return Object.freeze({
    async inspect(input = {}) {
      const [deployment, runtime] = await Promise.all([inspectDeployment(input), inspectRuntime(input)]);
      return {
        domain: "deployment_parity",
        adapter_version: "deployment-parity-reconciler-v1",
        dispatch: input.dispatch || {},
        receipt: input.receipt || {},
        readbacks: [
          readback("deployment", deployment, input.expected_deployment),
          readback("runtime", runtime, input.expected_runtime),
        ],
        mutation_performed: false,
        secrets_included: false,
      };
    },
  });
}

export function createProviderAdapterReconciler({ inspectProvider, inspectInternalLedger } = {}) {
  if (typeof inspectProvider !== "function" || typeof inspectInternalLedger !== "function") {
    throw reconciliationError(500, "PROVIDER_RECONCILER_PORT_INVALID", "Provider and internal-ledger inspection ports are required.");
  }
  return Object.freeze({
    async inspect(input = {}) {
      const [provider, ledger] = await Promise.all([inspectProvider(input), inspectInternalLedger(input)]);
      return {
        domain: "provider_adapter",
        adapter_version: "provider-adapter-reconciler-v1",
        dispatch: input.dispatch || {},
        receipt: input.receipt || {},
        readbacks: [
          readback("provider", provider, input.expected_provider),
          readback("internal_ledger", ledger, input.expected_internal_ledger),
        ],
        mutation_performed: false,
        secrets_included: false,
      };
    },
  });
}

export async function runDuplicateMutationFaultInjection({
  dispatchMutation,
  reconcile,
  idempotencyKey,
  expectedAppliedCount = 1,
} = {}) {
  if (typeof dispatchMutation !== "function" || typeof reconcile !== "function") {
    throw reconciliationError(500, "DUPLICATE_MUTATION_FAULT_PORT_INVALID", "dispatchMutation and reconcile functions are required.");
  }
  const key = compact(idempotencyKey, 191);
  if (!key) throw reconciliationError(400, "DUPLICATE_MUTATION_IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required.");

  let firstError = null;
  try {
    await dispatchMutation({ idempotency_key: key, attempt: 1, inject_transport_failure_after_apply: true });
  } catch (error) {
    firstError = error;
  }
  if (!firstError?.unknown_outcome) {
    throw reconciliationError(409, "DUPLICATE_MUTATION_UNKNOWN_OUTCOME_NOT_INJECTED", "Fault injection must produce an unknown outcome after the first dispatch.");
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
    retryDecision = { retry_allowed: false, blocker: error.code };
  }

  if (retryDecision.retry_allowed === true) {
    await dispatchMutation({ idempotency_key: key, attempt: 2, inject_transport_failure_after_apply: false });
  }
  const final = await reconcile({ idempotency_key: key, final_readback: true });
  const appliedCount = Number(final.applied_count ?? final.evidence?.applied_count ?? 0);
  const duplicatePrevented = appliedCount === Number(expectedAppliedCount);
  if (!duplicatePrevented) {
    throw reconciliationError(409, "DUPLICATE_MUTATION_DETECTED", "Fault injection observed a duplicate mutation.", {
      expected_applied_count: Number(expectedAppliedCount),
      observed_applied_count: appliedCount,
    });
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
