import { getGovernancePool } from "./governanceDb.js";
import * as runtime from "./capabilityResolutionEnvelopeGuardRuntime.js";

export const extractCapabilityEnvelopeId = runtime.extractCapabilityEnvelopeId;
export const capabilityEnvelopeFailure = runtime.capabilityEnvelopeFailure;
export const capabilityEnvelopeError = runtime.capabilityEnvelopeError;
export const CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS = runtime.CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS;
export const CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES = runtime.CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES;
export const CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION = runtime.CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION;

function resolveLifecycleMutationPool({ writerPool = null, transactionPool = null } = {}) {
  if (writerPool) return writerPool;
  if (transactionPool) return transactionPool;
  return getGovernancePool();
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
 * default. An already-open transaction may be supplied explicitly through
 * `pool`/`transactionPool` when the reference update must remain atomic with
 * the execution-side business mutation. This is a transaction object escape
 * hatch, not a credential fallback: absent an explicit transaction, the
 * dedicated Governance DB writer remains mandatory.
 */
export async function markCapabilityEnvelopeReferenced(options = {}) {
  const {
    writerPool = null,
    transactionPool = null,
    pool: legacyTransactionPool = null,
    ...rest
  } = options || {};
  return runtime.markCapabilityEnvelopeReferenced({
    ...rest,
    pool: resolveLifecycleMutationPool({
      writerPool,
      transactionPool: transactionPool || legacyTransactionPool,
    }),
  });
}

/**
 * consume/cancel/expire are canonical lifecycle transitions. They default to
 * the dedicated Governance DB writer. Execution-side callers that already
 * hold the business transaction may pass that exact transaction explicitly so
 * envelope consumption stays in the same SQL transaction and cannot become a
 * post-commit side effect.
 */
export async function transitionCapabilityEnvelopeLifecycle(options = {}) {
  const {
    writerPool = null,
    transactionPool = null,
    pool: legacyTransactionPool = null,
    ...rest
  } = options || {};
  return runtime.transitionCapabilityEnvelopeLifecycle({
    ...rest,
    pool: resolveLifecycleMutationPool({
      writerPool,
      transactionPool: transactionPool || legacyTransactionPool,
    }),
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
  const { writerPool = null, pool: _legacyRuntimePool = null, transactionPool: _legacyTransactionPool = null, ...rest } = options || {};
  return runtime.runCapabilityEnvelopeBatchExpire({
    ...rest,
    mode: "apply",
    pool: writerPool || getGovernancePool(),
  });
}
