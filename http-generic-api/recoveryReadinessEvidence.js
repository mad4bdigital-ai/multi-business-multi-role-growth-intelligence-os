import { createHash, createPublicKey, verify } from "node:crypto";
import { open, mkdir, readFile } from "node:fs/promises";
import YAML from "yaml";
import path from "node:path";
import { constants } from "node:fs";
import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";

export const RECOVERY_READINESS_EVIDENCE_CONTRACT = "mad4b.recovery-readiness-evidence.v1";
export const RECOVERY_CERTIFICATION_STORE_CONTRACT = "mad4b.recovery-certification-evidence-store.v1";
export const RECOVERY_REPLAY_STORE_CONTRACT = "mad4b.recovery-ingress-replay-store.v1";
const MAX_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const authorities = new WeakSet();
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
export const readinessEvidencePayload = (v) => JSON.stringify(stable(v));
const hash = (v) => createHash("sha256").update(v).digest("hex");
function fail(code) { throw Object.assign(new Error(code), { code, status: 503 }); }

// Called only on manifests inside the verified signed evidence envelope. Rebuild
// the parity verdict from complete manifest entries; never trust a cached verdict.
export function producePromotionArtifactParity({ source, target } = {}) {
  function normalize(manifest, environment) {
    if (manifest?.environment !== environment || !SHA40.test(manifest.sha || "")
      || !manifest.target_fingerprint || !Array.isArray(manifest.artifacts) || !manifest.artifacts.length
      || manifest.generated_artifacts_verified !== true || !SHA256.test(manifest.manifest_hash || "")) return null;
    const files = manifest.artifacts.map((entry) => ({ path: entry.path, sha256: entry.sha256 })).sort((a, b) => String(a.path).localeCompare(String(b.path)));
    if (files.some((entry) => typeof entry.path !== "string" || !entry.path || entry.path.startsWith("/")
      || entry.path.includes("\\") || entry.path.split("/").some((part) => !part || part === "." || part === "..")
      || !SHA256.test(entry.sha256 || "")) || new Set(files.map((entry) => entry.path)).size !== files.length) return null;
    return { ...manifest, artifact_hash: hash(readinessEvidencePayload(files)) };
  }
  const left = normalize(source, "staging");
  const right = normalize(target, "production");
  if (!left || !right) return null;
  const equal = left.artifact_hash === right.artifact_hash && left.manifest_hash === right.manifest_hash;
  return {
    verified: equal, source_environment: "staging", target_environment: "production",
    source_sha: left.sha, target_sha: right.sha,
    source_target_fingerprint: left.target_fingerprint, target_target_fingerprint: right.target_fingerprint,
    source_artifact_set_hash: left.artifact_hash, target_artifact_set_hash: right.artifact_hash,
    source_manifest_hash: left.manifest_hash, target_manifest_hash: right.manifest_hash,
    generated_artifacts_verified: equal,
  };
}

// Deployment-owned, dedicated persistent directory only. No request chooses a path.
// O_EXCL claims are shared across processes on the SAME filesystem. Multi-host
// deployments must inject a shared atomic store with replayStore.scope=shared_deployment.
export function createFileRecoveryEvidenceStore({ directory } = {}) {
  if (!path.isAbsolute(directory || "")) fail("RECOVERY_EVIDENCE_DIRECTORY_INVALID");
  const root = path.resolve(directory);
  async function immutableWrite(name, bytes) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const handle = await open(path.join(root, name), "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    const directoryHandle = await open(root, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
  return Object.freeze({
    contract: RECOVERY_CERTIFICATION_STORE_CONTRACT,
    durability: "persistent_filesystem",
    scope: "single_filesystem",
    async putCertification(record) {
      const bytes = readinessEvidencePayload(record);
      if (Buffer.byteLength(bytes) > MAX_BYTES) fail("RECOVERY_EVIDENCE_TOO_LARGE");
      const id = hash(bytes);
      try { await immutableWrite(`cert-${id}.json`, bytes); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      return id;
    },
    async getCertification(id) {
      if (!SHA256.test(id || "")) fail("RECOVERY_EVIDENCE_ID_INVALID");
      const handle = await open(path.join(root, `cert-${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) fail("RECOVERY_EVIDENCE_TOO_LARGE");
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_BYTES) fail("RECOVERY_EVIDENCE_TOO_LARGE");
        const bytes = buffer.subarray(0, bytesRead).toString("utf8");
        if (hash(bytes) !== id) fail("RECOVERY_EVIDENCE_INTEGRITY_INVALID");
        return JSON.parse(bytes);
      } finally { await handle.close(); }
    },
    replayStore: Object.freeze({
      contract: RECOVERY_REPLAY_STORE_CONTRACT,
      scope: "single_filesystem",
      async claim({ issuer, key_id, jti, expires_at }) {
        if (!issuer || !key_id || !jti || !Number.isInteger(expires_at) || expires_at <= Date.now() / 1000) return false;
        const id = hash(readinessEvidencePayload([issuer, key_id, jti]));
        try { await immutableWrite(`ingress-${id}.json`, JSON.stringify({ expires_at })); return true; }
        catch (error) { if (error.code === "EEXIST") return false; throw error; }
      },
    }),
  });
}

export function createRecoveryReadinessAuthorities({
  evidenceStore, deploymentIdentityProvider, targetIdentityProvider,
  recordId, publicKey, keyId, issuer, env = process.env,
} = {}) {
  const runtime = resolveRuntimeEnvironmentStrict(env);
  if (!runtime.ok || !["staging", "production"].includes(runtime.environment_key)) fail("RECOVERY_EVIDENCE_RUNTIME_INVALID");
  if (evidenceStore?.contract !== RECOVERY_CERTIFICATION_STORE_CONTRACT
    || typeof evidenceStore.getCertification !== "function" || typeof evidenceStore.putCertification !== "function"
    || typeof deploymentIdentityProvider?.readAttestation !== "function"
    || typeof targetIdentityProvider?.readIdentity !== "function" || !SHA256.test(recordId || "")
    || !keyId || !issuer) fail("RECOVERY_EVIDENCE_AUTHORITY_INCOMPLETE");
  if (runtime.environment_key === "staging" && runtime.runtime_class !== "local_windows_docker"
    && evidenceStore.replayStore?.scope !== "shared_deployment") fail("RECOVERY_REPLAY_STORE_SCOPE_INSUFFICIENT");
  const verificationKey = createPublicKey(publicKey);
  if (verificationKey.asymmetricKeyType !== "ed25519") fail("RECOVERY_EVIDENCE_KEY_INVALID");
  async function readSnapshot() {
    const [record, attestation, target] = await Promise.all([
      evidenceStore.getCertification(recordId), deploymentIdentityProvider.readAttestation(), targetIdentityProvider.readIdentity(),
    ]);
    const payload = record?.payload;
    if (!payload || payload.contract !== RECOVERY_READINESS_EVIDENCE_CONTRACT
      || payload.issuer !== issuer || payload.key_id !== keyId || payload.secrets_included !== false
      || !Number.isFinite(Date.parse(payload.expires_at)) || Date.parse(payload.expires_at) <= Date.now()
      || !/^[A-Za-z0-9_-]{86}$/.test(record.signature || "")
      || !verify(null, Buffer.from(readinessEvidencePayload(payload)), verificationKey, Buffer.from(record.signature, "base64url"))) {
      fail("RECOVERY_EVIDENCE_SIGNATURE_OR_FRESHNESS_INVALID");
    }
    if (target?.environment !== runtime.environment_key || target?.runtime_class !== runtime.runtime_class
      || typeof target?.target_fingerprint !== "string" || !target.target_fingerprint
      || payload.environment !== runtime.environment_key || payload.target_fingerprint !== target.target_fingerprint
      || payload.deployment_sha !== attestation?.sha || attestation?.environment !== runtime.environment_key
      || attestation?.target_fingerprint !== target.target_fingerprint) fail("RECOVERY_EVIDENCE_TARGET_MISMATCH");
    return Object.freeze({
      stagingCertification: payload.stagingCertification || null,
      deploymentAttestation: attestation,
      candidateSha: attestation.sha,
      candidateTargetFingerprint: target.target_fingerprint,
      runtimeClass: runtime.runtime_class,
      promotionArtifactParity: producePromotionArtifactParity(payload.promotionManifests),
      adapterProvenance: payload.adapterProvenance?.environment === runtime.environment_key
        && payload.adapterProvenance?.deployment_sha === attestation.sha ? payload.adapterProvenance : null,
      registrationEvidence: payload.registrationEvidence || null,
      oauthEvidence: payload.oauthEvidence || null,
      networkEvidence: payload.networkEvidence || null,
      workerDeploymentEvidence: payload.workerDeploymentEvidence || null,
      unresolvedRecoveryIncidents: Array.isArray(payload.unresolvedRecoveryIncidents) ? payload.unresolvedRecoveryIncidents : ["incident_evidence_missing"],
      evidence_id: recordId,
      authenticity_verified: true,
    });
  }
  const authority = Object.freeze({ readSnapshot,
    readDeploymentAttestation: () => deploymentIdentityProvider.readAttestation(),
    readTargetFingerprint: async () => (await targetIdentityProvider.readIdentity())?.target_fingerprint || null,
    ingressReplayStore: evidenceStore.replayStore || null });
  authorities.add(authority);
  return authority;
}

export function recoveryReadinessRouteDependencies(authority = null) {
  if (authority !== null && !authorities.has(authority)) fail("RECOVERY_EVIDENCE_AUTHORITY_UNTRUSTED");
  const snapshot = authority ? () => authority.readSnapshot() : async () => null;
  return Object.freeze({
    recoveryReadinessEvidenceReader: snapshot,
    stagingCertificationReader: async () => (await snapshot())?.stagingCertification || null,
    deploymentAttestationReader: authority ? () => authority.readDeploymentAttestation() : async () => null,
    targetFingerprintReader: authority ? () => authority.readTargetFingerprint() : async () => null,
    ingressReplayStore: authority?.ingressReplayStore || null,
  });
}

export async function expectedStagingRegistration() {
  const bytes = await readFile(new URL("./openapi/openapi.custom-gpt.activation-admin.staging.yaml", import.meta.url));
  const schema = YAML.parse(bytes.toString("utf8"));
  const ids = Object.values(schema.paths || {}).flatMap((item) => Object.entries(item)
    .filter(([method]) => ["get", "post", "put", "patch", "delete", "head", "options"].includes(method))
    .map(([, operation]) => operation.operationId)).sort();
  return {
    registration_set: "admin_activation_staging", schema_sha256: hash(bytes), operation_count: ids.length,
    operation_ids_hash: hash(JSON.stringify(ids)), server: "https://activation-dev.mad4b.com", auth_profile: "admin_service",
  };
}

export async function expectedStagingGatewayDeployment() {
  const bytes = await readFile(new URL("./activation-gateway-runtime/generated/route-policy.staging.json", import.meta.url));
  const policy = JSON.parse(bytes.toString("utf8"));
  return {
    policy_hash: policy.content_hash_sha256,
    gateway_host: policy.public_host,
    upstream_origin: policy.upstream_origin,
  };
}

export async function evaluateExternalStagingEvidence(snapshot) {
  const expected = await expectedStagingRegistration();
  const gateway = await expectedStagingGatewayDeployment();
  const registration = snapshot?.registrationEvidence;
  const oauth = snapshot?.oauthEvidence;
  const network = snapshot?.networkEvidence;
  const worker = snapshot?.workerDeploymentEvidence;
  const bound = (evidence) => evidence?.deployment_sha === snapshot?.candidateSha
    && evidence?.target_fingerprint === snapshot?.candidateTargetFingerprint
    && SHA256.test(evidence?.evidence_hash || "")
    && Number.isFinite(Date.parse(evidence?.expires_at)) && Date.parse(evidence.expires_at) > Date.now();
  const checks = {
    signed_evidence_authority: snapshot?.authenticity_verified === true,
    actual_chatgpt_registration: registration?.observed_in === "chatgpt" && bound(registration)
      && Object.entries(expected).every(([key, value]) => registration[key] === value),
    oauth_browser_round_trip: bound(oauth) && oauth?.issuer === "https://dev.mad4b.com"
      && oauth?.resource === "https://activation-dev.mad4b.com"
      && ["authorize", "login_consent", "code", "callback", "token", "resource"].every((step) => oauth?.steps?.[step] === "pass"),
    origin_network_isolation: bound(network)
      && network?.environment === "staging"
      && network?.gateway_host === gateway.gateway_host
      && network?.upstream_origin === gateway.upstream_origin
      && network?.gateway_only === true
      && network?.signed_ingress_required === true
      && network?.network_restriction_verified === true
      && network?.direct_origin_publicly_reachable === false,
    deployed_worker_provenance: bound(worker)
      && worker?.observed_in === "cloudflare_workers"
      && worker?.deployment_verified === true
      && worker?.gateway_host === gateway.gateway_host
      && worker?.policy_hash === gateway.policy_hash
      && worker?.worker_build_sha === snapshot?.candidateSha
      && worker?.policy_source_sha === snapshot?.candidateSha
      && SHA256.test(worker?.worker_bundle_sha256 || "")
      && worker?.deployed_bundle_sha256 === worker?.worker_bundle_sha256,
  };
  return { ready: Object.values(checks).every(Boolean), checks, blocking_failures: Object.keys(checks).filter((key) => !checks[key]) };
}