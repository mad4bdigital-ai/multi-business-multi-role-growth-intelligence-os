import path from "node:path";
import {
  createServerManagedRecoveryBinding as createPhaseABinding,
  createRecoveryReadinessAuthorities as createPhaseAReadinessAuthorities,
  _testingStagingRecoveryAuthorityBinding as phaseATesting,
} from "./stagingRecoveryAuthorityBinding.js";
import {
  createFileRecoveryEvidenceStore,
  createRecoveryReadinessAuthorities as createCanonicalReadinessAuthority,
} from "./recoveryReadinessEvidence.js";
import { wrapStagingRecoveryAdaptersForPhaseB } from "./stagingRecoveryPhaseBConcurrency.js";
import { loadStagingRecoveryCertificationPublicTrust } from "./stagingRecoveryCertificationPublicTrust.js";

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

function assertReadOnlyContext(context = {}) {
  phaseATesting.runtime(context, process.env, true);
  if (context.read_only !== true || context.production_live !== false) {
    throw Object.assign(new Error("Phase B readiness authority remains read-only and Production-disabled."), {
      code: "RECOVERY_PHASE_B_READINESS_CONTEXT_DENIED",
      status: 503,
      details: { secrets_included: false },
    });
  }
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
  const trust = loadStagingRecoveryCertificationPublicTrust(process.env);
  if (!trust) return createPhaseAReadinessAuthorities(context);
  assertReadOnlyContext(context);
  const roots = phaseATesting.roots(process.env);
  const base = phaseATesting.adapters(roots.readiness, process.env);
  const evidenceStore = createFileRecoveryEvidenceStore({
    directory: path.join(roots.readiness, "certification-evidence"),
    replayDirectory: roots.replay,
  });
  return createCanonicalReadinessAuthority({
    evidenceStore,
    deploymentIdentityProvider: base.deployment,
    targetIdentityProvider: base.target,
    publicKey: trust.publicKey,
    keyId: trust.keyId,
    issuer: trust.issuer,
    env: process.env,
    adapterProvenanceReader: async () => phaseATesting.provenance((await base.deployment.readAttestation()).sha),
  });
}

export default createServerManagedRecoveryBinding;
