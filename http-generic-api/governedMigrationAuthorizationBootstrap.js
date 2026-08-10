import { getPool } from "./db.js";
import { getGovernancePool } from "./governanceDb.js";
import {
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import * as runtime from "./governedMigrationAuthorizationBootstrapRuntime.js";

export const governedMigrationAuthorizationConfirmation = runtime.governedMigrationAuthorizationConfirmation;
export const inspectGovernedMigrationAuthorizationCandidate = runtime.inspectGovernedMigrationAuthorizationCandidate;

/**
 * The migration bootstrap has two deliberately separate authorities:
 * - readPool: capability-envelope/authority resolution only;
 * - writerPool: governed migration authorization, apply-policy, dispatch
 *   certification and envelope lifecycle mutations/readback.
 *
 * A legacy deps.pool is intentionally not accepted as writer authority. Tests
 * and internal same-cycle callers must inject deps.writerPool explicitly.
 */
export async function bootstrapGovernedMigrationAuthorization(input = {}, deps = {}) {
  const readPool = deps.readPool || getPool();
  const writerPool = deps.writerPool || getGovernancePool();
  const resolveEnvelope = deps.resolveEnvelope || resolveCapabilityExecutionEnvelope;
  const markReferenced = deps.markReferenced || markCapabilityEnvelopeReferenced;

  const resolveWithRuntimeAuthority = async (options = {}) => resolveEnvelope({
    ...options,
    pool: readPool,
  });
  const markWithGovernanceWriter = async (options = {}) => markReferenced({
    ...options,
    pool: undefined,
    writerPool,
  });

  return runtime.bootstrapGovernedMigrationAuthorization(input, {
    ...deps,
    pool: writerPool,
    resolveEnvelope: resolveWithRuntimeAuthority,
    markReferenced: markWithGovernanceWriter,
  });
}
