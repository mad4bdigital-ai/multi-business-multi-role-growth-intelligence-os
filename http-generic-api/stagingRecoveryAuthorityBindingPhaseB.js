import path from "node:path";
import {
  createServerManagedRecoveryBinding as createPhaseABinding,
  createRecoveryReadinessAuthorities as createPhaseAReadinessAuthorities,
  stagingRecoveryAuthorityInternals as phaseAInternals,
} from "./stagingRecoveryAuthorityBinding.js";
import {
  createFileRecoveryEvidenceStore,
  createRecoveryReadinessAuthorities as createCanonicalReadinessAuthority,
} from "./recoveryReadinessEvidence.js";
import { readDeploymentManifest } from "./deploymentManifest.js";
import { wrapStagingRecoveryAdaptersForPhaseB } from "./stagingRecoveryPhaseBConcurrency.js";
import { loadStagingRecoveryCertificationPublicTrust } from "./stagingRecoveryCertificationPublicTrust.js";

export const STAGING_RECOVERY_PHASE_B_BINDING_CONTRACT = "mad4b.staging-recovery-phase-b-binding.v1";
export const STAGING_PR_HEAD_READINESS_CONTRACT = "mad4b.staging-pr-head-recovery-readiness.v1";

const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const GOVERNED_PR_REF = /^(gpt|cert|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+$/u;

function phaseBError(code, message) {
  throw Object.assign(new Error(message), {
    code,
    status: 503,
    details: { secrets_included: false },
  });
}

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
  phaseAInternals.runtime(context, process.env, true);
  if (context.read_only !== true || context.production_live !== false) {
    throw Object.assign(new Error("Phase B readiness authority remains read-only and Production-disabled."), {
      code: "RECOVERY_PHASE_B_READINESS_CONTEXT_DENIED",
      status: 503,
      details: { secrets_included: false },
    });
  }
}

function prHeadReadinessContext(env = process.env) {
  const mode = String(env.STAGING_CERT_AUTHORITY_MODE || "").trim().toLowerCase();
  if (mode !== "pull_request_head") return null;

  const repository = String(env.STAGING_CERT_PR_REPOSITORY || "").trim();
  const prNumber = Number(String(env.STAGING_CERT_PR_NUMBER || "").trim());
  const ref = String(env.DEPLOY_BRANCH || "").trim();
  const sha = String(env.DEPLOY_COMMIT || env.DEPLOYMENT_EXPECTED_COMMIT_SHA || "").trim().toLowerCase();

  if (repository !== REPOSITORY) {
    phaseBError("RECOVERY_PR_HEAD_READINESS_REPOSITORY_INVALID", "PR-head readiness requires the canonical repository authority.");
  }
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    phaseBError("RECOVERY_PR_HEAD_READINESS_PR_NUMBER_INVALID", "PR-head readiness requires a positive pull-request number.");
  }
  if (!GOVERNED_PR_REF.test(ref) || ref === "main" || ref === "Production") {
    phaseBError("RECOVERY_PR_HEAD_READINESS_REF_INVALID", "PR-head readiness requires a governed non-protected work branch.");
  }
  if (!SHA40.test(sha)) {
    phaseBError("RECOVERY_PR_HEAD_READINESS_SHA_INVALID", "PR-head readiness requires an exact 40-character deployment SHA.");
  }

  return Object.freeze({
    contract: STAGING_PR_HEAD_READINESS_CONTRACT,
    repository,
    pr_number: prNumber,
    ref,
    sha,
    read_only: true,
    release_certification: false,
    production_authority_eligible: false,
    secrets_included: false,
  });
}

function prHeadDeploymentIdentityProvider(targetIdentityProvider, authority, env = process.env) {
  return Object.freeze({
    contract: "mad4b.staging-pr-head-readiness-deployment-identity.v1",
    async readAttestation() {
      const result = readDeploymentManifest(env);
      const manifest = result?.manifest;
      const commitSha = String(manifest?.commit_sha || "").trim().toLowerCase();
      if (!result?.ok
        || manifest?.repository !== authority.repository
        || manifest?.branch !== authority.ref
        || commitSha !== authority.sha
        || !SHA40.test(String(manifest?.tree_sha || "").trim().toLowerCase())
        || !SHA256.test(String(manifest?.context_file_set_sha256 || "").trim().toLowerCase())
        || manifest?.secrets_included !== false) {
        phaseBError(
          "RECOVERY_PR_HEAD_READINESS_DEPLOYMENT_MANIFEST_INVALID",
          "PR-head readiness requires an exact secret-free deployment manifest bound to the authorized PR head.",
        );
      }

      const target = await targetIdentityProvider.readIdentity();
      return Object.freeze({
        contract: "mad4b.recovery-runtime-attestation.v1",
        repository: authority.repository,
        branch: authority.ref,
        environment: "staging",
        sha: authority.sha,
        deployment_sha: authority.sha,
        repository_sha: authority.sha,
        tree_sha: String(manifest.tree_sha).trim().toLowerCase(),
        context_file_set_sha256: String(manifest.context_file_set_sha256).trim().toLowerCase(),
        target_fingerprint: target.target_fingerprint,
        repository_match: true,
        branch_match: false,
        sha_match: true,
        manifest_bound: true,
        read_only: true,
        read_only_probe: true,
        pr_head_certification_only: true,
        release_certification: false,
        production_authority_eligible: false,
        database_connection_performed: false,
        database_mutation_performed: false,
        provider_mutation_performed: false,
        secrets_included: false,
      });
    },
  });
}

function createPrHeadReadinessAuthorities(context, authority) {
  assertReadOnlyContext(context);
  const roots = phaseAInternals.roots(process.env);
  const target = phaseAInternals.targetIdentityProvider(roots.readiness);
  const deployment = prHeadDeploymentIdentityProvider(target, authority, process.env);
  const persistentEvidenceStore = createFileRecoveryEvidenceStore({
    directory: path.join(roots.readiness, "certification-evidence"),
    replayDirectory: roots.replay,
  });

  // PR-head live certification is deliberately not release certification. Ignore
  // any persisted main/release certification pointer while preserving the same
  // deployment-owned store and replay boundary for all other operations.
  const evidenceStore = Object.freeze({
    ...persistentEvidenceStore,
    getCurrentCertificationId: async () => null,
  });

  return createCanonicalReadinessAuthority({
    evidenceStore,
    deploymentIdentityProvider: deployment,
    targetIdentityProvider: target,
    publicKey: null,
    keyId: null,
    issuer: null,
    env: process.env,
    adapterProvenanceReader: async () => phaseAInternals.provenance((await deployment.readAttestation()).sha),
  });
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
  const prHeadAuthority = prHeadReadinessContext(process.env);
  if (prHeadAuthority) return createPrHeadReadinessAuthorities(context, prHeadAuthority);

  const trust = loadStagingRecoveryCertificationPublicTrust(process.env);
  if (!trust) return createPhaseAReadinessAuthorities(context);
  assertReadOnlyContext(context);
  const roots = phaseAInternals.roots(process.env);
  const base = phaseAInternals.adapters(roots.readiness, process.env);
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
    adapterProvenanceReader: async () => phaseAInternals.provenance((await base.deployment.readAttestation()).sha),
  });
}

export const _testingStagingRecoveryAuthorityBindingPhaseB = Object.freeze({
  prHeadReadinessContext,
  prHeadDeploymentIdentityProvider,
  createPrHeadReadinessAuthorities,
});

export default createServerManagedRecoveryBinding;
