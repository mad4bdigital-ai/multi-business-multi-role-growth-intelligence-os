import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
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
export const STAGING_RECOVERY_PHASE_B_APPROVAL_TOKEN_CONTRACT = "mad4b.staging-recovery-phase-b-approval-token-handle.v1";
export const STAGING_PR_HEAD_READINESS_CONTRACT = "mad4b.staging-pr-head-recovery-readiness.v1";

const TOKEN_RECORD_MAX_BYTES = 16 * 1024;
const tokenKey = (value) => createHash("sha256").update(String(value || "")).digest("hex");

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

function phaseBFailure(code, message) {
  throw Object.assign(new Error(message), {
    code,
    status: 503,
    details: { secrets_included: false },
  });
}

async function readTokenRecord(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > TOKEN_RECORD_MAX_BYTES) {
      phaseBFailure("RECOVERY_PHASE_B_APPROVAL_TOKEN_STATE_INVALID", "The internal Phase B approval-token state is invalid.");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function createIssuanceClaim(file, challenge) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const claim = {
    contract: STAGING_RECOVERY_PHASE_B_APPROVAL_TOKEN_CONTRACT,
    status: "issuing",
    approval_id: challenge.approval_id,
    plan_hash: challenge.plan_hash,
    step_id: challenge.step_id,
    created_at: new Date().toISOString(),
    token_not_returned: true,
  };
  try {
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(claim)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

function assertSameApprovalBinding(record, challenge) {
  if (record?.contract !== STAGING_RECOVERY_PHASE_B_APPROVAL_TOKEN_CONTRACT
    || record.approval_id !== challenge.approval_id
    || record.plan_hash !== challenge.plan_hash
    || record.step_id !== challenge.step_id) {
    phaseBFailure("RECOVERY_PHASE_B_APPROVAL_TOKEN_BINDING_MISMATCH", "An approval token handle cannot be rebound to a different plan step.");
  }
}

async function finalizeTokenRecord(file, challenge, issued) {
  if (typeof issued?.server_token !== "string" || issued.server_token.length < 16 || issued.server_token.length > 4096
    || !issued.expires_at || Date.parse(issued.expires_at) <= Date.now()) {
    phaseBFailure("RECOVERY_PHASE_B_APPROVAL_TOKEN_ISSUER_INVALID", "The server-managed Staging approval issuer failed closed.");
  }
  const record = {
    contract: STAGING_RECOVERY_PHASE_B_APPROVAL_TOKEN_CONTRACT,
    status: "issued",
    approval_id: challenge.approval_id,
    plan_hash: challenge.plan_hash,
    step_id: challenge.step_id,
    expires_at: issued.expires_at,
    server_token: issued.server_token,
    token_not_returned: true,
  };
  const handle = await open(file, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return record;
}

function phaseBApprovalIssuer(baseIssuer, root) {
  if (!baseIssuer || typeof baseIssuer.createChallenge !== "function") {
    phaseBFailure("RECOVERY_PHASE_B_APPROVAL_ISSUER_UNAVAILABLE", "Phase B requires the server-managed Staging approval issuer.");
  }
  const tokenRoot = path.join(root, "phase-b-approval-token-handles");
  return Object.freeze({
    async createChallenge(challenge) {
      const file = path.join(tokenRoot, `${tokenKey(challenge?.approval_id)}.json`);
      const claimed = await createIssuanceClaim(file, challenge);
      if (claimed) {
        try {
          const issued = await baseIssuer.createChallenge(challenge);
          const record = await finalizeTokenRecord(file, challenge, issued);
          return Object.freeze({ authority: "server_managed", expires_at: record.expires_at, server_token: record.server_token });
        } catch (error) {
          // A partially issued approval is never reissued. The caller must create a new
          // approval challenge so one approval id can never map to two server tokens.
          throw error;
        }
      }
      const record = await readTokenRecord(file);
      assertSameApprovalBinding(record, challenge);
      if (record.status === "issuing") {
        phaseBFailure("RECOVERY_PHASE_B_APPROVAL_ISSUANCE_IN_PROGRESS", "The approval token is still being issued; it will not be issued twice.");
      }
      if (record.status !== "issued"
        || typeof record.server_token !== "string"
        || record.server_token.length < 16
        || record.server_token.length > 4096
        || Date.parse(record.expires_at) <= Date.now()) {
        phaseBFailure("RECOVERY_PHASE_B_APPROVAL_TOKEN_UNAVAILABLE", "The single-issued approval token is unavailable or expired; a new approval challenge is required.");
      }
      return Object.freeze({ authority: "server_managed", expires_at: record.expires_at, server_token: record.server_token });
    },
  });
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
  const root = readinessRoot(process.env);
  const envelope = createPhaseABinding(context);
  const singleIssueAdapters = Object.freeze({
    ...envelope.adapters,
    approvalIssuer: phaseBApprovalIssuer(envelope.adapters.approvalIssuer, root),
  });
  const adapters = wrapStagingRecoveryAdaptersForPhaseB(singleIssueAdapters, { root });
  return Object.freeze({
    ...envelope,
    adapters,
    phase_b_concurrency_hardening: STAGING_RECOVERY_PHASE_B_BINDING_CONTRACT,
    phase_b_approval_single_issuance: true,
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

export const _testingStagingRecoveryPhaseB = Object.freeze({
  phaseBApprovalIssuer,
});

export const _testingStagingRecoveryAuthorityBindingPhaseB = Object.freeze({
  prHeadReadinessContext,
  prHeadDeploymentIdentityProvider,
  createPrHeadReadinessAuthorities,
});

export default createServerManagedRecoveryBinding;
