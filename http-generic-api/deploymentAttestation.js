import crypto, { randomUUID } from "node:crypto";

export const DEPLOYMENT_ATTESTATION_CONTRACT = "mad4b.deployment-attestation.v1";
export const RUNTIME_INTEGRITY_STATES = Object.freeze([
  "verified_clean",
  "break_glass_active",
  "degraded_unreconciled_change",
  "verification_failed",
  "unknown",
]);
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function text(value = "", max = 1000) { return String(value ?? "").trim().slice(0, max); }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!value || typeof value !== "object") return value; return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: stable(value[key]) }), {}); }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function requireSha(value, field) { const resolved = text(value, 40).toLowerCase(); if (!SHA40.test(resolved)) { const error = new Error(`${field} must be a 40-character Git SHA.`); error.code = "deployment_attestation_sha_invalid"; throw error; } return resolved; }
function normalizeResourceHashes(value = []) {
  if (!Array.isArray(value)) throw Object.assign(new Error("canonical_resource_hashes must be an array."), { code: "deployment_attestation_resource_hashes_invalid" });
  return value.map((item) => {
    const resource_key = text(item?.resource_key, 191);
    const path = text(item?.path, 512);
    const sha256 = text(item?.sha256, 64).toLowerCase();
    if (!resource_key || !path || !SHA256.test(sha256)) throw Object.assign(new Error("Canonical resource hash evidence is incomplete."), { code: "deployment_attestation_resource_hash_invalid" });
    return { resource_key, path, sha256 };
  }).sort((a, b) => a.resource_key.localeCompare(b.resource_key));
}

export function buildDeploymentAttestation(input = {}) {
  const environmentKey = text(input.environment_key, 64) || "production";
  const sourceBranch = text(input.source_branch, 255);
  if (environmentKey === "production" && sourceBranch !== "Production") {
    const error = new Error("Production deployment attestation must be generated from the Production branch.");
    error.code = "deployment_attestation_production_branch_invalid";
    throw error;
  }
  const body = {
    contract: DEPLOYMENT_ATTESTATION_CONTRACT,
    attestation_id: text(input.attestation_id, 36) || randomUUID(),
    environment_key: environmentKey,
    repository_uri: text(input.repository_uri, 512),
    source_branch: sourceBranch,
    source_commit_sha: requireSha(input.source_commit_sha, "source_commit_sha"),
    build_id: text(input.build_id, 191),
    build_timestamp: new Date(input.build_timestamp || Date.now()).toISOString(),
    canonical_registry_revision: Math.max(0, Number(input.canonical_registry_revision || 0)),
    canonical_resource_hashes: normalizeResourceHashes(input.canonical_resource_hashes || []),
    generation_policy_version: text(input.generation_policy_version, 64) || "spec018-v1",
    secrets_included: false,
  };
  if (!body.repository_uri || !body.build_id) {
    const error = new Error("repository_uri and build_id are required for deployment attestation.");
    error.code = "deployment_attestation_identity_incomplete";
    throw error;
  }
  return { ...body, attestation_sha256: hash(body) };
}

export function evaluateRuntimeIntegrity({ attestation, runtime_readback: runtimeReadback = {}, break_glass: breakGlass = {} } = {}) {
  if (!attestation?.source_commit_sha) return { state: "unknown", ready: false, reason_code: "deployment_attestation_missing", secrets_included: false };
  const sourceSha = requireSha(attestation.source_commit_sha, "attestation.source_commit_sha");
  const runtimeSha = text(runtimeReadback.commit_sha || runtimeReadback.deployed_commit_sha, 40).toLowerCase();
  if (!SHA40.test(runtimeSha)) return { state: "unknown", ready: false, reason_code: "runtime_commit_readback_missing", secrets_included: false };
  if (breakGlass.active === true) return { state: "break_glass_active", ready: false, reason_code: "break_glass_active", source_commit_sha: sourceSha, runtime_commit_sha: runtimeSha, secrets_included: false };
  if (breakGlass.unreconciled === true || Number(runtimeReadback.unapproved_local_change_count || 0) > 0 || runtimeReadback.working_tree_clean === false) {
    return { state: "degraded_unreconciled_change", ready: false, reason_code: "runtime_dirty_unapproved", source_commit_sha: sourceSha, runtime_commit_sha: runtimeSha, secrets_included: false };
  }
  if (runtimeSha !== sourceSha) return { state: "verification_failed", ready: false, reason_code: "production_commit_mismatch", source_commit_sha: sourceSha, runtime_commit_sha: runtimeSha, secrets_included: false };
  if (runtimeReadback.readback_verified !== true || runtimeReadback.working_tree_clean !== true) {
    return { state: "verification_failed", ready: false, reason_code: "runtime_integrity_readback_failed", source_commit_sha: sourceSha, runtime_commit_sha: runtimeSha, secrets_included: false };
  }
  return { state: "verified_clean", ready: true, reason_code: null, source_commit_sha: sourceSha, runtime_commit_sha: runtimeSha, attestation_sha256: attestation.attestation_sha256 || null, secrets_included: false };
}
