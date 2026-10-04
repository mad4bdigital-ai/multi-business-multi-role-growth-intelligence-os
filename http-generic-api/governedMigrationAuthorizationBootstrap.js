import { getGovernancePool } from "./governanceDb.js";
import {
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import * as runtime from "./governedMigrationAuthorizationBootstrapRuntime.js";

export const governedMigrationAuthorizationConfirmation = runtime.governedMigrationAuthorizationConfirmation;
export const inspectGovernedMigrationAuthorizationCandidate = runtime.inspectGovernedMigrationAuthorizationCandidate;

/**
 * The migration bootstrap has two deliberately separate concerns on the
 * dedicated Governance store:
 * - envelopeReadPool: read-only resolution of the just-created capability envelope;
 * - writerPool: governed migration authorization, apply-policy, dispatch
 *   certification and envelope lifecycle mutations/readback.
 *
 * Runtime authority data may still be consulted while building the envelope,
 * before it is persisted. Once persisted, migration authorization must resolve
 * that exact envelope from the canonical Governance store; falling back to the
 * ordinary Runtime DB would create a split-store envelope_not_found failure.
 *
 * A legacy deps.pool is intentionally not accepted as writer or envelope-read
 * authority. Tests/internal callers may inject deps.envelopeReadPool or deps.writerPool explicitly.
 * A generic deps.readPool alias is intentionally ignored so Runtime DB cannot
 * become a fallback for persisted migration envelopes.
 */
export async function bootstrapGovernedMigrationAuthorization(input = {}, deps = {}) {
  const envelopeReadPool = deps.envelopeReadPool || getGovernancePool();
  const writerPool = deps.writerPool || getGovernancePool();
  const resolveEnvelope = deps.resolveEnvelope || resolveCapabilityExecutionEnvelope;
  const markReferenced = deps.markReferenced || markCapabilityEnvelopeReferenced;

  const resolveWithGovernanceEnvelope = async (options = {}) => resolveEnvelope({
    ...options,
    pool: envelopeReadPool,
  });
  const markWithGovernanceWriter = async (options = {}) => markReferenced({
    ...options,
    pool: undefined,
    writerPool,
  });

  return runtime.bootstrapGovernedMigrationAuthorization(input, {
    ...deps,
    pool: writerPool,
    resolveEnvelope: resolveWithGovernanceEnvelope,
    markReferenced: markWithGovernanceWriter,
  });
}
