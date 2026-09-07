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
import { wrapStagingRecoveryAdaptersForPhaseB } from "./stagingRecoveryPhaseBConcurrency.js";
import { loadStagingRecoveryCertificationPublicTrust } from "./stagingRecoveryCertificationPublicTrust.js";

export const STAGING_RECOVERY_PHASE_B_BINDING_CONTRACT = "mad4b.staging-recovery-phase-b-binding.v1";
export const STAGING_RECOVERY_PHASE_B_APPROVAL_TOKEN_CONTRACT = "mad4b.staging-recovery-phase-b-approval-token-handle.v1";

const TOKEN_RECORD_MAX_BYTES = 16 * 1024;
const tokenKey = (value) => createHash("sha256").update(String(value || "")).digest("hex");

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

export default createServerManagedRecoveryBinding;
