import path from "node:path";
import {
  createServerManagedRecoveryBinding as createPhaseABinding,
  createRecoveryReadinessAuthorities as createPhaseAReadinessAuthorities,
} from "./stagingRecoveryAuthorityBinding.js";
import { wrapStagingRecoveryAdaptersForPhaseB } from "./stagingRecoveryPhaseBConcurrency.js";

export const STAGING_RECOVERY_PHASE_B_BINDING_CONTRACT = "mad4b.staging-recovery-phase-b-binding.v1";

function readinessRoot(env = process.env) {
  const configured = String(env.RECOVERY_STAGING_READINESS_DIRECTORY || "/app/data/recovery-readiness").trim();
  if (!path.isAbsolute(configured)) {
    throw Object.assign(new Error("Phase B requires an absolute Staging readiness root."), {
      code: "RECOVERY_PHASE_B_READINESS_ROOT_INVALID",
      status: 503,
      details: { secrets_included: false },
    });
  }
  return path.resolve(configured);
}

export function createServerManagedRecoveryBinding(context = {}) {
  const envelope = createPhaseABinding(context);
  const adapters = wrapStagingRecoveryAdaptersForPhaseB(envelope.adapters, { root: readinessRoot(process.env) });
  return Object.freeze({
    ...envelope,
    adapters,
    phase_b_concurrency_hardening: STAGING_RECOVERY_PHASE_B_BINDING_CONTRACT,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
}

export function createRecoveryReadinessAuthorities(context = {}) {
  return createPhaseAReadinessAuthorities(context);
}

export default createServerManagedRecoveryBinding;
