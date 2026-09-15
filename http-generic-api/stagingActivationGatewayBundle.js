import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(here, "..");
const SHA_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function moduleSpecifier(fromFile, toFile) {
  const relative = path.relative(path.dirname(fromFile), toFile).replaceAll(path.sep, "/");
  return JSON.stringify(relative.startsWith(".") ? relative : `./${relative}`);
}

function assertLifetimeHours(value) {
  const hours = Number(value ?? 168);
  assert.ok(Number.isInteger(hours) && hours >= 1 && hours <= 720, "attestation lifetime must be 1..720 hours");
  return hours;
}

export async function buildStagingActivationGatewayBundle({
  sourceSha,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  lifetimeHours = 168,
  now = () => Date.now(),
} = {}) {
  const normalizedSourceSha = String(sourceSha || "").trim().toLowerCase();
  assert.match(normalizedSourceSha, SHA_RE, "source SHA must be an exact 40-character commit");
  const normalizedLifetimeHours = assertLifetimeHours(lifetimeHours);
  const root = path.resolve(repositoryRoot);
  const sourceDir = path.join(root, "edge", "activation-gateway", "src");
  const workerPath = path.join(sourceDir, "worker-staging.mjs");
  const gatewayPath = path.join(sourceDir, "gateway.mjs");
  const policyPath = path.join(root, "edge", "activation-gateway", "generated", "route-policy.staging.json");
  const [workerTemplate, gateway, policyText] = await Promise.all([
    fs.readFile(workerPath, "utf8"),
    fs.readFile(gatewayPath, "utf8"),
    fs.readFile(policyPath, "utf8"),
  ]);
  const policy = JSON.parse(policyText);

  assert.equal(policy.policy_key, "activation_gateway_staging");
  assert.equal(policy.public_host, "activation-dev.mad4b.com");
  assert.match(policy.content_hash_sha256, SHA256_RE);

  const graphDigest = crypto.createHash("sha256")
    .update("mad4b.activation-gateway-staging.bundle.v1\0")
    .update(workerTemplate).update("\0")
    .update(gateway).update("\0")
    .update(policyText)
    .digest("hex");
  const workerBuildIdentity = Object.freeze({ source_sha: normalizedSourceSha, bundle_sha256: graphDigest });
  const marker = "/* WORKER_BUILD_IDENTITY */ null";
  const sourcePolicySpecifier = moduleSpecifier(workerPath, policyPath);
  const builtPolicyPath = path.join(root, ".artifacts", "activation-gateway-staging", "route-policy.staging.json");
  const builtWorkerPath = path.join(root, ".artifacts", "activation-gateway-staging", "worker-staging.mjs");
  const builtPolicySpecifier = moduleSpecifier(builtWorkerPath, builtPolicyPath);

  assert.equal(workerTemplate.split(marker).length, 2, "worker identity marker must occur exactly once");
  assert.equal(workerTemplate.split(sourcePolicySpecifier).length, 2, "staging policy import must occur exactly once");
  const builtWorker = workerTemplate
    .replace(sourcePolicySpecifier, builtPolicySpecifier)
    .replace(marker, JSON.stringify(workerBuildIdentity));
  assert.equal(builtWorker.includes(sourcePolicySpecifier), false, "deployment artifact must not depend on source-tree policy topology");
  assert.equal(builtWorker.includes(builtPolicySpecifier), true, "deployment artifact must import its co-located policy");

  const issuedAt = Number(now());
  const deploymentId = `activation-staging-${normalizedSourceSha.slice(0, 12)}-${issuedAt}`;
  const expiresAt = new Date(issuedAt + normalizedLifetimeHours * 60 * 60 * 1000).toISOString();
  const unsigned = {
    content_hash_sha256: policy.content_hash_sha256,
    deployment_id: deploymentId,
    expires_at: expiresAt,
    source_commit: normalizedSourceSha,
    surface_registry_version: Number(policy.surface_registry_version),
    worker_build_sha: normalizedSourceSha,
    worker_bundle_sha256: graphDigest,
  };
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const signature = crypto.sign(null, Buffer.from(stableJson(unsigned)), privateKey).toString("base64url");
  const attestation = { ...unsigned, signature_b64url: signature };
  const publicJwk = publicKey.export({ format: "jwk" });

  const { privateKey: ingressPrivateKey, publicKey: ingressPublicKey } = crypto.generateKeyPairSync("ed25519");
  const ingressPrivateJwk = ingressPrivateKey.export({ format: "jwk" });
  const ingressPublicJwk = ingressPublicKey.export({ format: "jwk" });
  const ingressPublicPem = ingressPublicKey.export({ type: "spki", format: "pem" }).replaceAll("\r", "");
  const ingressFingerprint = sha256(JSON.stringify(ingressPublicJwk)).slice(0, 16);
  const ingressKeyId = `activation-staging-${normalizedSourceSha.slice(0, 12)}-${ingressFingerprint}`;
  const originTrust = Object.freeze({
    contract: "mad4b.staging.activation-recovery-origin-trust.v2",
    source_commit: normalizedSourceSha,
    deployment_sha: normalizedSourceSha,
    worker_build_sha: normalizedSourceSha,
    worker_bundle_sha256: graphDigest,
    policy_hash: policy.content_hash_sha256,
    gateway_host: policy.public_host,
    canonical_host: policy.public_host,
    audience: policy.upstream_origin,
    issuer: `https://${policy.public_host}`,
    key_id: ingressKeyId,
    public_key: ingressPublicPem,
    public_key_pem_escaped: ingressPublicPem.replaceAll("\n", "\\n"),
    trusted_ingress_mode: "signature",
    strip_caller_headers: true,
    replay_store_scope: "single_filesystem",
    provider_credentials_included: false,
    production_deploy: false,
    database_mutation: false,
    secrets_included: false,
  });

  const workerSecrets = Object.freeze({
    ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON: JSON.stringify(attestation),
    ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
    ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK: JSON.stringify(ingressPrivateJwk),
    ACTIVATION_GATEWAY_INGRESS_KEY_ID: ingressKeyId,
    ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_PEM: ingressPublicPem,
  });

  return Object.freeze({
    contract: "mad4b.staging.activation-gateway-server-bundle.v1",
    source_sha: normalizedSourceSha,
    deployment_id: deploymentId,
    expires_at: expiresAt,
    policy,
    policy_hash: policy.content_hash_sha256,
    worker_build_identity: workerBuildIdentity,
    worker_bundle_sha256: graphDigest,
    files: Object.freeze([
      Object.freeze({ name: "worker-staging.mjs", type: "application/javascript+module", content: builtWorker }),
      Object.freeze({ name: "gateway.mjs", type: "application/javascript+module", content: gateway }),
      Object.freeze({ name: "route-policy.staging.json", type: "application/json", content: policyText }),
    ]),
    worker_secrets: workerSecrets,
    worker_secret_names: Object.freeze(Object.keys(workerSecrets)),
    origin_trust: originTrust,
    deployment_evidence: Object.freeze({
      contract: "mad4b.activation-gateway-staging-deployment-evidence.v2",
      deployment_id: deploymentId,
      expires_at: expiresAt,
      policy_hash: policy.content_hash_sha256,
      public_host: policy.public_host,
      source_commit: normalizedSourceSha,
      worker_bundle_sha256: graphDigest,
      recovery_ingress_key_id: ingressKeyId,
      recovery_origin_trust_contract: originTrust.contract,
      provider_credentials_included: false,
      production_deploy: false,
      database_mutation: false,
      secrets_included: false,
    }),
    secrets_included: false,
  });
}

export async function writeStagingActivationGatewayBundle({ outputDir, ...options } = {}) {
  if (!outputDir) throw new Error("outputDir is required");
  const bundle = await buildStagingActivationGatewayBundle(options);
  const directory = path.resolve(outputDir);
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
  const fileWrites = bundle.files.map((file) => fs.writeFile(path.join(directory, file.name), file.content, { flag: "wx" }));
  await Promise.all(fileWrites);
  await Promise.all([
    fs.writeFile(path.join(directory, "deployment-secrets.json"), JSON.stringify(bundle.worker_secrets, null, 2), { flag: "wx" }),
    fs.writeFile(path.join(directory, "origin-trust.json"), stableJson(bundle.origin_trust), { flag: "wx" }),
    fs.writeFile(path.join(directory, "deployment-evidence.json"), stableJson(bundle.deployment_evidence), { flag: "wx" }),
  ]);
  return bundle;
}
