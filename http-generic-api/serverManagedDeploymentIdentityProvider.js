import {
  RECOVERY_BRANCH,
  RECOVERY_REPOSITORY,
} from "./recoveryTrustModel.js";

export const SERVER_MANAGED_DEPLOYMENT_IDENTITY_PROVIDER_CONTRACT = "mad4b.recovery-server-managed-deployment-identity-provider.v1";

const SHA40 = /^[0-9a-f]{40}$/iu;
const SHA256 = /^[0-9a-f]{64}$/iu;

function providerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 412;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function sanitizeAttestation(value, environment = "production") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw providerError(
      "RECOVERY_SERVER_DEPLOYMENT_ATTESTATION_INVALID",
      "The server-derived deployment identity source returned an invalid attestation.",
    );
  }
  const repository = text(value.repository || value.deployment_repository, 200);
  const branch = text(value.branch || value.deployment_branch, 100);
  const sha = text(value.sha || value.deployment_sha || value.repository_sha || value.commit_sha, 64).toLowerCase();
  const manifestHash = text(value.recovery_manifest_hash || value.manifest_hash, 128).toLowerCase();
  const attestationHash = text(value.attestation_hash, 128).toLowerCase();
  const expectedBranch = environment === "staging" ? "main" : RECOVERY_BRANCH;
  if (!["staging", "production"].includes(environment) || (value.environment && value.environment !== environment)
    || repository !== RECOVERY_REPOSITORY || branch !== expectedBranch) {
    throw providerError(
      "RECOVERY_SERVER_DEPLOYMENT_IDENTITY_SCOPE_MISMATCH",
      "The server-derived deployment identity is not bound to the canonical Recovery repository and Production branch.",
      { repository, branch, expected_repository: RECOVERY_REPOSITORY, expected_branch: expectedBranch },
    );
  }
  if (!SHA40.test(sha) || !SHA256.test(manifestHash) || !SHA256.test(attestationHash)) {
    throw providerError(
      "RECOVERY_SERVER_DEPLOYMENT_IDENTITY_INCOMPLETE",
      "The server-derived deployment attestation must contain exact SHA, manifest hash, and attestation hash.",
    );
  }
  if (value.manifest_bound !== true || value.read_only_probe !== true || value.database_mutation_performed !== false || value.provider_mutation_performed !== false || value.secrets_included !== false) {
    throw providerError(
      "RECOVERY_SERVER_DEPLOYMENT_ATTESTATION_NOT_READ_ONLY",
      "Only a manifest-bound, read-only, non-mutating server attestation can enter Recovery composition.",
    );
  }
  const targetFingerprints = {};
  for (const role of ["runtime", "governance", "runtime_persistence"]) {
    const fingerprint = value.target_fingerprints?.[role];
    if (fingerprint === undefined) continue;
    if (typeof fingerprint !== "string" || !SHA256.test(fingerprint)) {
      throw providerError("RECOVERY_SERVER_DEPLOYMENT_TARGET_INVALID", "Role-specific deployment target fingerprints must be SHA256 digests.");
    }
    targetFingerprints[role] = fingerprint.toLowerCase();
  }
  return Object.freeze({
    repository,
    branch,
    environment,
    sha,
    target_fingerprint: text(value.target_fingerprint) || null,
    target_fingerprints: Object.freeze(targetFingerprints),
    repository_match: true,
    branch_match: true,
    sha_match: true,
    manifest_bound: true,
    read_only: true,
    deployment_sha: sha,
    repository_sha: sha,
    recovery_manifest_hash: manifestHash,
    attestation_hash: attestationHash,
    read_only_probe: true,
    database_connection_performed: value.database_connection_performed === true,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  });
}

export function createServerManagedDeploymentIdentityProvider({ readServerAttestation = null, environment = "production" } = {}) {
  if (typeof readServerAttestation !== "function") return null;
  return Object.freeze({
    contract: SERVER_MANAGED_DEPLOYMENT_IDENTITY_PROVIDER_CONTRACT,
    readAttestation: async (_callerContext = {}) => {
      let attestation;
      try {
        // No expected_sha or caller-supplied identity is forwarded. The source is server-derived.
        attestation = await readServerAttestation();
      } catch (error) {
        throw providerError(
          "RECOVERY_SERVER_DEPLOYMENT_ATTESTATION_READ_FAILED",
          "The server-derived deployment identity source failed closed.",
          { cause_code: error?.code || "server_attestation_read_failed" },
        );
      }
      return sanitizeAttestation(attestation, environment);
    },
  });
}

export function validateServerManagedDeploymentIdentityProvider(provider) {
  if (!provider || typeof provider.readAttestation !== "function") {
    return { adapter_present: false, attestation_capable: false, secrets_included: false };
  }
  return {
    adapter_present: true,
    attestation_capable: true,
    contract: SERVER_MANAGED_DEPLOYMENT_IDENTITY_PROVIDER_CONTRACT,
    secrets_included: false,
  };
}

export const _testingServerManagedDeploymentIdentityProvider = Object.freeze({
  sanitizeAttestation,
  SHA40,
  SHA256,
});
