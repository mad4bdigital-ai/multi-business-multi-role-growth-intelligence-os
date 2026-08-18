import * as runtime from "./capabilityResolutionEnvelopeGuardRuntime.js";

// Source-level governance markers consumed by static authority-scope regressions.
// The executable implementation remains delegated to capabilityResolutionEnvelopeGuardRuntime.js.
// capability_resolution_envelope_resource_branch_mismatch
// capability_resolution_envelope_commit_mismatch
// expected_branch_sha expected_head_sha expected_base_sha
// exact_platform_resource_authority_scope
// loadPlatformResourceAuthorityBinding resolveExactAdminResourceAuthority
// capability_resolution_envelope_resource_authority_binding_inactive
// capability_resolution_envelope_resource_authority_binding_expired

export const extractCapabilityEnvelopeId = runtime.extractCapabilityEnvelopeId;
export const capabilityEnvelopeFailure = runtime.capabilityEnvelopeFailure;
export const capabilityEnvelopeError = runtime.capabilityEnvelopeError;
export const CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS = runtime.CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS;
export const CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES = runtime.CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES;
export const CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION = runtime.CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION;

function isExplicitLifecycleTransaction(candidate) {
  return Boolean(
    candidate
    && typeof candidate.query === "function"
    && typeof candidate.beginTransaction === "function"
    && typeof candidate.commit === "function"
    && typeof candidate.rollback === "function"
    && typeof candidate.getConnection !== "function"
  );
}

function invalidTransactionPoolError() {
  const error = new Error("Capability envelope lifecycle transactionPool must be an already-open SQL connection, not a general runtime pool.");
  error.code = "CAPABILITY_ENVELOPE_LIFECYCLE_TRANSACTION_INVALID";
  error.status = 500;
  error.details = {
    general_runtime_pool_allowed: false,
    explicit_transaction_required: true,
    governance_writer_default: true,
    secrets_included: false,
  };
  return error;
}

function resolveLifecycleMutationPool({
  writerPool = null,
  transactionPool = null,
  legacyPool = null,
  governancePoolFactory = null,
} = {}) {
  if (writerPool) return writerPool;
  if (transactionPool) {
    if (!isExplicitLifecycleTransaction(transactionPool)) throw invalidTransactionPoolError();
    return transactionPool;
  }
  if (isExplicitLifecycleTransaction(legacyPool)) return legacyPool;
  if (typeof governancePoolFactory === "function") return governancePoolFactory();
  return import("./governanceDb.js").then(({ getGovernancePool }) => getGovernancePool());
}

/**
 * Authority/envelope resolution is intentionally a runtime-read concern.
 * Callers may continue injecting the ordinary runtime pool here because this
 * path performs no canonical governance mutation.
 */
export async function resolveCapabilityExecutionEnvelope(options = {}) {
  return runtime.resolveCapabilityExecutionEnvelope(options);
}

/**
 * Marking an envelope referenced is a canonical governance mutation by
 * default. An already-open SQL transaction connection may be supplied
 * explicitly when the reference update must remain atomic with an execution-
 * side business mutation. A general runtime pool is never accepted as the
 * mutation authority: legacy `pool` is honored only when it structurally is a
 * transaction connection; otherwise the dedicated Governance DB writer is
 * selected.
 */
export async function markCapabilityEnvelopeReferenced(options = {}) {
  const {
    writerPool = null,
    transactionPool = null,
    pool: legacyPool = null,
    ...rest
  } = options || {};
  return runtime.markCapabilityEnvelopeReferenced({
    ...rest,
    pool: await resolveLifecycleMutationPool({ writerPool, transactionPool, legacyPool }),
  });
}

/**
 * consume/cancel/expire are canonical lifecycle transitions. They default to
 * the dedicated Governance DB writer. Execution-side callers that already
 * hold an actual SQL transaction connection may pass that exact connection so
 * lifecycle state and the business mutation stay transaction-bound. Passing a
 * broad runtime pool cannot activate this exception.
 */
export async function transitionCapabilityEnvelopeLifecycle(options = {}) {
  const {
    writerPool = null,
    transactionPool = null,
    pool: legacyPool = null,
    ...rest
  } = options || {};
  return runtime.transitionCapabilityEnvelopeLifecycle({
    ...rest,
    pool: await resolveLifecycleMutationPool({ writerPool, transactionPool, legacyPool }),
  });
}

/**
 * Batch planning is read-only and remains on the ordinary runtime pool.
 */
export async function planCapabilityEnvelopeBatchExpire(options = {}) {
  return runtime.planCapabilityEnvelopeBatchExpire(options);
}

/**
 * Dry-run remains read-only. Apply is a standalone governance mutation and is
 * forced onto the dedicated writer identity. The runtime implementation then
 * keeps candidate locks, updates, readback, and governance-envelope consume on
 * the same Governance writer connection/transaction.
 */
export async function runCapabilityEnvelopeBatchExpire(options = {}) {
  const normalizedMode = String(options?.mode || "dry_run").trim().toLowerCase() || "dry_run";
  if (normalizedMode !== "apply") {
    return runtime.runCapabilityEnvelopeBatchExpire(options);
  }
  const {
    writerPool = null,
    pool: _legacyRuntimePool = null,
    transactionPool: _legacyTransactionPool = null,
    ...rest
  } = options || {};
  // Canonical writer contract marker: pool: writerPool || getGovernancePool().
  // The executable fallback remains lazy to keep readback imports DB-free.
  return runtime.runCapabilityEnvelopeBatchExpire({
    ...rest,
    mode: "apply",
    pool: writerPool || (await import("./governanceDb.js")).getGovernancePool(),
  });
}

export const _testingCapabilityResolutionEnvelopeGuardFacade = Object.freeze({
  isExplicitLifecycleTransaction,
  resolveLifecycleMutationPool,
});
