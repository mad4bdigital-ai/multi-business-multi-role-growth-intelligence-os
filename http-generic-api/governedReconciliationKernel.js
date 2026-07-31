import { createHash } from "node:crypto";

export const GOVERNED_RECONCILIATION_KERNEL_VERSION = "spec011-governed-reconciliation-kernel-v2";
export const OUTCOME_CLASSIFICATIONS = Object.freeze({
  CONFIRMED_SUCCESS: "confirmed_success",
  CONFIRMED_FAILURE: "confirmed_failure",
  UNKNOWN_OUTCOME: "unknown_outcome",
  RECONCILIATION_REQUIRED: "reconciliation_required",
});

const DOMAINS = Object.freeze([
  "repository_pr",
  "migration_ledger",
  "deployment_parity",
  "provider_adapter",
]);
const DOMAIN_SET = new Set(DOMAINS);
const SUCCESS = new Set([
  "applied", "committed", "completed", "deployed", "merged",
  "readback_verified", "verified_success", "confirmed_applied",
  "confirmed_success", "succeeded",
]);
const FAILURE = new Set([
  "failed_before_dispatch", "failed_pre_dispatch", "failed_prewrite",
  "not_applied", "confirmed_not_applied", "confirmed_failure",
  "cancelled_before_apply",
]);
const UNKNOWN = new Set([
  "pending", "dispatching", "transport_failed", "unknown_provider_outcome",
  "unknown_outcome", "reconciliation_required",
]);
const SECRET_KEY = /(secret(?!s_included$)|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value, max = 191) {
  return text(value, max).toLowerCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertSecretFree(value, path = "evidence", depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw fail(400, "RECONCILIATION_SECRET_FIELD_REJECTED", "Reconciliation evidence must not contain secret-like fields.", { path: `${path}.${key}` });
    }
    assertSecretFree(item, `${path}.${key}`, depth + 1);
  }
}

function operationEvidence(value = {}) {
  return Object.freeze({
    operation_id: text(value.operation_id, 191) || null,
    evidence_operation_id: text(value.evidence_operation_id, 191) || null,
    evidence_verified: value.evidence_verified === true,
  });
}

function normalizeReadback(entry = {}, index = 0) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw fail(400, "RECONCILIATION_READBACK_INVALID", "Each readback must be an object.", { index });
  }
  assertSecretFree(entry, `readbacks[${index}]`);
  const source = lower(entry.source, 64);
  if (!source) {
    throw fail(400, "RECONCILIATION_READBACK_SOURCE_REQUIRED", "Each readback requires source.", { index });
  }
  return Object.freeze({
    source,
    status: lower(entry.status, 64),
    required: entry.required !== false,
    read_performed: entry.read_performed === true,
    match: entry.match === true,
    exists: entry.exists === true,
    absence_proven: entry.absence_proven === true,
    conflict: entry.conflict === true,
    fingerprint: /^[0-9a-f]{64}$/.test(lower(entry.fingerprint, 64)) ? lower(entry.fingerprint, 64) : null,
    evidence_ref: text(entry.evidence_ref, 500) || null,
    observed: entry.observed === undefined ? null : stable(entry.observed),
    ...operationEvidence(entry),
    secrets_included: false,
  });
}

function markers(dispatch, receipt, readbacks) {
  return new Set([
    dispatch.status,
    dispatch.outcome_classification,
    receipt.state,
    receipt.status,
    receipt.outcome_classification,
    ...readbacks.map((item) => item.status),
  ].map((item) => lower(item, 64)).filter(Boolean));
}

function includesMarker(source, catalog) {
  return [...source].some((item) => catalog.has(item));
}

export function classifyMutationOutcome({ dispatch = {}, receipt = {}, readbacks = [] } = {}) {
  assertSecretFree(dispatch, "dispatch");
  assertSecretFree(receipt, "receipt");
  if (!Array.isArray(readbacks)) {
    throw fail(400, "RECONCILIATION_READBACKS_INVALID", "readbacks must be an array.");
  }
  const normalized = readbacks.map(normalizeReadback);
  const required = normalized.filter((item) => item.required);
  const complete = required.length > 0 && required.every((item) => item.read_performed && (item.match || item.absence_proven || item.conflict));
  const sameOperation = required.length > 0 && required.every((item) => item.evidence_verified && item.operation_id && item.evidence_operation_id === item.operation_id);
  const requiredMatches = required.filter((item) => item.match);
  const requiredAbsence = required.filter((item) => item.absence_proven);
  const requiredConflicts = required.filter((item) => item.conflict);
  const evidenceMarkers = markers(dispatch, receipt, normalized);
  const success = includesMarker(evidenceMarkers, SUCCESS);
  const failure = includesMarker(evidenceMarkers, FAILURE);
  const unknown = includesMarker(evidenceMarkers, UNKNOWN);

  let classification = OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED;
  let reason = required.length === 0 ? "RECONCILIATION_REQUIRED_READBACKS_MISSING" : "RECONCILIATION_READBACK_INCOMPLETE";
  let retryAllowed = false;

  if (requiredConflicts.length || (success && failure)) {
    reason = "RECONCILIATION_EVIDENCE_CONFLICT";
  } else if (complete && !sameOperation) {
    reason = "RECONCILIATION_SAME_OPERATION_EVIDENCE_REQUIRED";
  } else if (success && complete && requiredMatches.length === required.length) {
    classification = OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS;
    reason = "RECONCILIATION_SUCCESS_READBACK_VERIFIED";
  } else if (failure && complete && requiredAbsence.length === required.length) {
    classification = OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE;
    reason = "RECONCILIATION_NOT_APPLIED_PROVEN";
    retryAllowed = true;
  } else if (unknown || dispatch.dispatched === true || lower(receipt.state, 64) === "pending") {
    classification = OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME;
    reason = "RECONCILIATION_OUTCOME_STILL_UNKNOWN";
  }

  const evidence = Object.freeze({
    dispatch: stable(dispatch),
    receipt: stable(receipt),
    readbacks: normalized,
    readback_complete: complete,
    same_operation_complete: sameOperation,
    required_readback_count: required.length,
    secrets_included: false,
  });
  return Object.freeze({
    ok: true,
    report_type: "governed_mutation_outcome_classification",
    kernel_version: GOVERNED_RECONCILIATION_KERNEL_VERSION,
    classification,
    reason_code: reason,
    retry_allowed: retryAllowed,
    automatic_retry_performed: false,
    evidence_fingerprint: digest(evidence),
    evidence,
    next_action: classification === OUTCOME_CLASSIFICATIONS.CONFIRMED_SUCCESS
      ? { action: "return_verified_readback", reason_code: reason }
      : classification === OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE
        ? { action: "prepare_new_idempotent_attempt", reason_code: reason }
        : { action: "perform_governed_reconciliation", reason_code: reason },
    secrets_included: false,
  });
}

export function assertReadBeforeRetry({ priorOutcome, reconciliation, idempotencyKey } = {}) {
  const prior = lower(priorOutcome, 64);
  const key = text(idempotencyKey, 191);
  if (!key) throw fail(400, "RECONCILIATION_IDEMPOTENCY_KEY_REQUIRED", "A stable idempotency key is required before retry evaluation.");
  const requiresReadback = [OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME, OUTCOME_CLASSIFICATIONS.RECONCILIATION_REQUIRED].includes(prior);
  if (!requiresReadback) {
    return Object.freeze({
      ok: true,
      retry_allowed: prior === OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE,
      read_before_retry_required: false,
      automatic_retry_performed: false,
      idempotency_key_fingerprint: digest(key),
      secrets_included: false,
    });
  }
  if (reconciliation?.classification !== OUTCOME_CLASSIFICATIONS.CONFIRMED_FAILURE) {
    throw fail(409, "RECONCILIATION_READ_BEFORE_RETRY_REQUIRED", "Unknown outcomes cannot be retried until governed readback proves the mutation was not applied.", {
      prior_outcome: prior,
      reconciliation_classification: reconciliation?.classification || null,
      automatic_retry_performed: false,
    });
  }
  const required = reconciliation.evidence?.readbacks?.filter((item) => item.required !== false) || [];
  const proven = required.length > 0 && required.every((item) => item.read_performed === true
    && item.absence_proven === true
    && item.evidence_verified === true
    && item.operation_id
    && item.evidence_operation_id === item.operation_id);
  if (!proven) {
    throw fail(409, "RECONCILIATION_ABSENCE_PROOF_REQUIRED", "Retry requires complete same-operation absence proof from every required source.", { automatic_retry_performed: false });
  }
  return Object.freeze({
    ok: true,
    retry_allowed: true,
    read_before_retry_required: true,
    readback_verified: true,
    automatic_retry_performed: false,
    idempotency_key_fingerprint: digest(key),
    reconciliation_fingerprint: reconciliation.evidence_fingerprint,
    secrets_included: false,
  });
}

function validateAdapter(domain, adapter) {
  if (!DOMAIN_SET.has(domain)) throw fail(400, "RECONCILIATION_DOMAIN_INVALID", "Unsupported reconciliation domain.", { domain });
  if (!adapter || typeof adapter.inspect !== "function") throw fail(500, "RECONCILIATION_ADAPTER_INVALID", "A reconciliation adapter must expose inspect().", { domain });
  return adapter;
}

export function createGovernedReconciliationKernel({ adapters = {}, clock = () => new Date() } = {}) {
  if (typeof clock !== "function") throw fail(500, "RECONCILIATION_CLOCK_INVALID", "clock must be a function.");
  const registry = new Map(Object.entries(adapters).map(([domain, adapter]) => [domain, validateAdapter(domain, adapter)]));
  async function reconcile({ domain, input = {}, expectedEvidenceFingerprint = null } = {}) {
    const key = lower(domain, 64);
    const adapter = registry.get(key);
    if (!adapter) throw fail(404, "RECONCILIATION_ADAPTER_NOT_REGISTERED", "No reconciler is registered for the requested domain.", { domain: key || null });
    assertSecretFree(input, "input");
    const result = await adapter.inspect(stable(input));
    assertSecretFree(result, `${key}.adapter_result`);
    if (result?.domain && result.domain !== key) throw fail(409, "RECONCILIATION_ADAPTER_DOMAIN_MISMATCH", "Adapter returned a different domain.", { expected_domain: key, observed_domain: result.domain });
    if (result?.mutation_performed === true) throw fail(409, "RECONCILIATION_READ_PATH_MUTATED", "Reconciliation adapters must be read-only.", { domain: key });
    if (!Array.isArray(result?.readbacks) || result.readbacks.length === 0) throw fail(409, "RECONCILIATION_ADAPTER_READBACK_REQUIRED", "Adapter must return at least one readback.", { domain: key });
    const classification = classifyMutationOutcome({ dispatch: result.dispatch || {}, receipt: result.receipt || {}, readbacks: result.readbacks });
    if (expectedEvidenceFingerprint && lower(expectedEvidenceFingerprint, 64) !== classification.evidence_fingerprint) {
      throw fail(409, "RECONCILIATION_EVIDENCE_STALE", "Reconciliation evidence does not match the expected fingerprint.", {
        expected_evidence_fingerprint: lower(expectedEvidenceFingerprint, 64),
        observed_evidence_fingerprint: classification.evidence_fingerprint,
      });
    }
    return Object.freeze({
      ...classification,
      report_type: "governed_reconciliation_result",
      domain: key,
      adapter_version: text(result.adapter_version, 64) || null,
      adapter_evidence_ref: text(result.evidence_ref, 500) || null,
      reconciled_at: clock().toISOString(),
      mutation_performed: false,
      provider_dispatch_performed: false,
      secrets_included: false,
    });
  }
  return Object.freeze({
    reconcile,
    status: () => Object.freeze({
      ok: true,
      report_type: "governed_reconciliation_kernel_status",
      kernel_version: GOVERNED_RECONCILIATION_KERNEL_VERSION,
      registered_domains: [...registry.keys()].sort(),
      all_required_domains_registered: DOMAINS.every((domain) => registry.has(domain)),
      public_route_added: false,
      runtime_authority_changed: false,
      secrets_included: false,
    }),
  });
}

function makeReadback(source, value, expected, operation) {
  const exists = value !== null && value !== undefined;
  const match = exists && expected !== undefined && expected !== null ? digest(value) === digest(expected) : exists;
  return Object.freeze({
    source,
    required: true,
    read_performed: true,
    match,
    exists,
    absence_proven: !exists,
    conflict: exists && expected !== undefined && expected !== null && !match,
    status: match ? "readback_verified" : !exists ? "not_applied" : "conflict",
    fingerprint: digest({ source, value, expected }),
    observed: value,
    ...operation,
    secrets_included: false,
  });
}

function twoSourceAdapter({ domain, version, first, second, inspectFirst, inspectSecond, expectedFirst, expectedSecond, errorCode }) {
  if (typeof inspectFirst !== "function" || typeof inspectSecond !== "function") throw fail(500, errorCode, `${domain} inspection ports are required.`);
  return Object.freeze({
    async inspect(input = {}) {
      const [firstValue, secondValue] = await Promise.all([inspectFirst(input), inspectSecond(input)]);
      const operation = operationEvidence(input);
      return {
        domain,
        adapter_version: version,
        dispatch: input.dispatch || {},
        receipt: input.receipt || {},
        readbacks: [
          makeReadback(first, firstValue, input[expectedFirst], operation),
          makeReadback(second, secondValue, input[expectedSecond], operation),
        ],
        mutation_performed: false,
        secrets_included: false,
      };
    },
  });
}

export function createRepositoryPrReconciler({ inspectRepository, inspectPullRequest } = {}) {
  return twoSourceAdapter({ domain: "repository_pr", version: "repository-pr-reconciler-v2", first: "repository", second: "pull_request", inspectFirst: inspectRepository, inspectSecond: inspectPullRequest, expectedFirst: "expected_repository", expectedSecond: "expected_pull_request", errorCode: "REPOSITORY_PR_RECONCILER_PORT_INVALID" });
}
export function createMigrationLedgerReconciler({ inspectSchema, inspectLedger } = {}) {
  return twoSourceAdapter({ domain: "migration_ledger", version: "migration-ledger-reconciler-v2", first: "schema", second: "migration_ledger", inspectFirst: inspectSchema, inspectSecond: inspectLedger, expectedFirst: "expected_schema", expectedSecond: "expected_ledger", errorCode: "MIGRATION_LEDGER_RECONCILER_PORT_INVALID" });
}
export function createDeploymentParityReconciler({ inspectDeployment, inspectRuntime } = {}) {
  return twoSourceAdapter({ domain: "deployment_parity", version: "deployment-parity-reconciler-v2", first: "deployment", second: "runtime", inspectFirst: inspectDeployment, inspectSecond: inspectRuntime, expectedFirst: "expected_deployment", expectedSecond: "expected_runtime", errorCode: "DEPLOYMENT_PARITY_RECONCILER_PORT_INVALID" });
}
export function createProviderAdapterReconciler({ inspectProvider, inspectInternalLedger } = {}) {
  return twoSourceAdapter({ domain: "provider_adapter", version: "provider-adapter-reconciler-v2", first: "provider", second: "internal_ledger", inspectFirst: inspectProvider, inspectSecond: inspectInternalLedger, expectedFirst: "expected_provider", expectedSecond: "expected_internal_ledger", errorCode: "PROVIDER_RECONCILER_PORT_INVALID" });
}

export async function runDuplicateMutationFaultInjection({ dispatchMutation, reconcile, idempotencyKey, expectedAppliedCount = 1 } = {}) {
  if (typeof dispatchMutation !== "function" || typeof reconcile !== "function") throw fail(500, "DUPLICATE_MUTATION_FAULT_PORT_INVALID", "dispatchMutation and reconcile functions are required.");
  const key = text(idempotencyKey, 191);
  if (!key) throw fail(400, "DUPLICATE_MUTATION_IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required.");
  let firstError = null;
  try {
    await dispatchMutation({ idempotency_key: key, attempt: 1, inject_transport_failure_after_apply: true });
  } catch (error) {
    firstError = error;
  }
  if (!firstError?.unknown_outcome) throw fail(409, "DUPLICATE_MUTATION_UNKNOWN_OUTCOME_NOT_INJECTED", "Fault injection must produce an unknown outcome after the first dispatch.");
  const reconciliation = await reconcile({ idempotency_key: key });
  let retryDecision;
  try {
    retryDecision = assertReadBeforeRetry({ priorOutcome: OUTCOME_CLASSIFICATIONS.UNKNOWN_OUTCOME, reconciliation, idempotencyKey: key });
  } catch (error) {
    retryDecision = { retry_allowed: false, blocker: error.code };
  }
  if (retryDecision.retry_allowed === true) {
    await dispatchMutation({ idempotency_key: key, attempt: 2, inject_transport_failure_after_apply: false });
  }
  const final = await reconcile({ idempotency_key: key, final_readback: true });
  const appliedCount = Number(final.applied_count ?? final.evidence?.applied_count ?? 0);
  if (appliedCount !== Number(expectedAppliedCount)) throw fail(409, "DUPLICATE_MUTATION_DETECTED", "Fault injection observed a duplicate mutation.", { expected_applied_count: Number(expectedAppliedCount), observed_applied_count: appliedCount });
  return Object.freeze({
    ok: true,
    report_type: "duplicate_mutation_fault_injection_certification",
    unknown_outcome_injected: true,
    retry_attempted: retryDecision.retry_allowed === true,
    retry_blocker: retryDecision.blocker || null,
    final_classification: final.classification || null,
    applied_count: appliedCount,
    duplicate_prevented: true,
    idempotency_key_fingerprint: digest(key),
    secrets_included: false,
  });
}

export const _testingGovernedReconciliationKernel = Object.freeze({ stable, digest, normalizeReadback, makeReadback });
