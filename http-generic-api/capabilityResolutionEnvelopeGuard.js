import { getGovernancePool } from "./governanceDb.js";
import * as runtime from "./capabilityResolutionEnvelopeGuardRuntime.js";

export const extractCapabilityEnvelopeId = runtime.extractCapabilityEnvelopeId;
export const capabilityEnvelopeFailure = runtime.capabilityEnvelopeFailure;
export const capabilityEnvelopeError = runtime.capabilityEnvelopeError;
export const CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS = runtime.CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS;
export const CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES = runtime.CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES;
export const CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION = runtime.CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION;

/**
 * Authority/envelope resolution is intentionally a runtime-read concern.
 * Callers may continue injecting the ordinary runtime pool here because this
 * path performs no canonical governance mutation.
 */
export async function resolveCapabilityExecutionEnvelope(options = {}) {
  return runtime.resolveCapabilityExecutionEnvelope(options);
}

/**
 * Marking an envelope referenced is a canonical governance mutation.
 * A legacy `pool` supplied by callers is deliberately ignored so a broad
 * runtime identity can never become the mutation authority by accident.
 */
export async function markCapabilityEnvelopeReferenced(options = {}) {
  const { writerPool = null, pool: _legacyRuntimePool = null, ...rest } = options || {};
  return runtime.markCapabilityEnvelopeReferenced({
    ...rest,
    pool: writerPool || getGovernancePool(),
  });
}

/**
 * consume/cancel/expire are canonical lifecycle transitions. They always use
 * the dedicated writer identity unless an explicit writerPool is injected
 * (for a same-cycle transaction or a unit test).
 */
export async function transitionCapabilityEnvelopeLifecycle(options = {}) {
  const { writerPool = null, pool: _legacyRuntimePool = null, ...rest } = options || {};
  return runtime.transitionCapabilityEnvelopeLifecycle({
    ...rest,
    pool: writerPool || getGovernancePool(),
  });
}

/**
 * Batch planning is read-only and remains on the ordinary runtime pool.
 */
export async function planCapabilityEnvelopeBatchExpire(options = {}) {
  return runtime.planCapabilityEnvelopeBatchExpire(options);
}

/**
 * Dry-run remains read-only. Apply is an internal governance mutation and is
 * forced onto the dedicated writer identity. The runtime implementation then
 * keeps candidate locks, updates, readback, and governance-envelope consume on
 * the same writer connection/transaction.
 */
export async function runCapabilityEnvelopeBatchExpire(options = {}) {
  const normalizedMode = String(options?.mode || "dry_run").trim().toLowerCase() || "dry_run";
  if (normalizedMode !== "apply") {
    return runtime.runCapabilityEnvelopeBatchExpire(options);
  }
  const { writerPool = null, pool: _legacyRuntimePool = null, ...rest } = options || {};
  return runtime.runCapabilityEnvelopeBatchExpire({
    ...rest,
    mode: "apply",
    pool: writerPool || getGovernancePool(),
  });
}
