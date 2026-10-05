import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

export const STAGING_RUNTIME_ARTIFACT_ATTESTATION_CONTRACT =
  "mad4b.staging-runtime-artifact-attestation.v1";
export const STAGING_RUNTIME_ARTIFACT_PAYLOAD_CONTRACT =
  "mad4b.staging-runtime-artifact-attestation-payload.v1";
export const STAGING_RUNTIME_ARTIFACT_TRUST_CONTRACT =
  "mad4b.staging-runtime-artifact-attestation-public-trust.v1";
export const STAGING_RUNTIME_ARTIFACT_SIGNING_AUTHORITY_CONTRACT =
  "mad4b.staging-runtime-artifact-github-signing-authority.v1";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{8,160}$/u;
const SIGNING_DOMAIN = "mad4b.staging-runtime-artifact-attestation.v1\n";
const MAX_TTL_MS = 2 * 60 * 60 * 1000;

function fail(code, message) {
  throw Object.assign(new Error(message), {
    code,
    status: 503,
    details: { secrets_included: false },
  });
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function stagingRuntimeArtifactCanonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function stagingRuntimeArtifactSigningPayload(payload) {
  return SIGNING_DOMAIN + stagingRuntimeArtifactCanonicalJson(payload);
}

function normalizePem(value) {
  const raw = String(value || "").trim();
  return raw.includes("\\n") ? raw.replaceAll("\\n", "\n") : raw;
}

function publicKeyFingerprint(key) {
  return createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("hex");
}

function normalizePublicKey(value, code) {
  let key;
  try {
    key = createPublicKey(value);
  } catch {
    fail(code, "Staging runtime artifact public key is invalid.");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    fail(code, "Staging runtime artifact trust must use Ed25519.");
  }
  return key;
}

function signerIdentity(env) {
  const issuer = String(
    env.RECOVERY_STAGING_CERTIFICATION_ISSUER || "",
  ).trim();
  const keyId = String(
    env.RECOVERY_STAGING_CERTIFICATION_KEY_ID || "",
  ).trim();
  if (!issuer || !SAFE_ID.test(keyId)) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SIGNER_IDENTITY_INVALID",
      "The governed Staging certification issuer and key ID are required.",
    );
  }
  return { issuer, keyId };
}

function privateSigningKey(env) {
  const pem = String(
    env.RECOVERY_STAGING_CERTIFICATION_PRIVATE_KEY || "",
  ).trim();
  if (!pem) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_PRIVATE_KEY_MISSING",
      "The GitHub-hosted Staging certification private key is unavailable.",
    );
  }
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    fail(
      "STAGING_RUNTIME_ARTIFACT_PRIVATE_KEY_INVALID",
      "The Staging certification private key is invalid.",
    );
  }
  if (key.asymmetricKeyType !== "ed25519") {
    fail(
      "STAGING_RUNTIME_ARTIFACT_PRIVATE_KEY_INVALID",
      "The Staging certification private key must use Ed25519.",
    );
  }
  return key;
}

function assertGitHubMainAuthority(env, deploymentSha) {
  if (
    String(env.GITHUB_ACTIONS || "").toLowerCase() !== "true" ||
    String(env.RUNNER_ENVIRONMENT || "").toLowerCase() !== "github-hosted"
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SIGNER_RUNTIME_DENIED",
      "Runtime artifact signing is restricted to GitHub-hosted Actions.",
    );
  }
  if (env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REF_NAME !== "main") {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SIGNER_REF_DENIED",
      "Runtime artifact signing is restricted to the exact main workflow authority.",
    );
  }
  if (!SHA40.test(String(env.GITHUB_SHA || "")) || env.GITHUB_SHA !== deploymentSha) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SIGNER_SHA_MISMATCH",
      "Runtime artifact signing must execute at the same exact main SHA.",
    );
  }
}

function assertFreshness(payload, now = Date.now()) {
  const generated = Date.parse(payload.generated_at);
  const expires = Date.parse(payload.expires_at);
  if (
    !Number.isFinite(generated) ||
    !Number.isFinite(expires) ||
    generated > now + 60_000 ||
    expires <= now ||
    expires <= generated ||
    expires - generated > MAX_TTL_MS
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_FRESHNESS_INVALID",
      "Runtime artifact attestation freshness is invalid.",
    );
  }
}

function assertPayload(payload, {
  expectedSha = null,
  expectedTree = null,
  expectedContextFileSetSha256 = null,
  expectedPolicyHash = null,
  issuer = null,
  keyId = null,
  now = Date.now(),
} = {}) {
  if (
    payload?.contract !== STAGING_RUNTIME_ARTIFACT_PAYLOAD_CONTRACT ||
    payload.environment !== "staging" ||
    payload.branch !== "main" ||
    payload.secrets_included !== false
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_PAYLOAD_INVALID",
      "Runtime artifact payload must be canonical Staging/main no-secret evidence.",
    );
  }

  if (!SHA40.test(payload.deployment_sha || "")) {
    fail("STAGING_RUNTIME_ARTIFACT_SHA_INVALID", "Deployment SHA is invalid.");
  }
  if (expectedSha && payload.deployment_sha !== expectedSha) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SHA_MISMATCH",
      "Runtime artifact deployment SHA does not match the expected release cut.",
    );
  }
  if (!SHA40.test(payload.tree_sha || "")) {
    fail("STAGING_RUNTIME_ARTIFACT_TREE_INVALID", "Tree SHA is invalid.");
  }
  if (expectedTree && payload.tree_sha !== expectedTree) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_TREE_MISMATCH",
      "Runtime artifact tree SHA does not match the expected release cut.",
    );
  }
  if (!SHA256.test(payload.context_file_set_sha256 || "")) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_CONTEXT_INVALID",
      "Context file-set digest is invalid.",
    );
  }
  if (
    expectedContextFileSetSha256 &&
    payload.context_file_set_sha256 !== expectedContextFileSetSha256
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_CONTEXT_MISMATCH",
      "Runtime artifact context file-set digest does not match.",
    );
  }
  if (!IMAGE_DIGEST.test(payload.app_image_digest || "")) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_IMAGE_INVALID",
      "Running Staging app image digest is invalid.",
    );
  }

  const gateway = payload.activation_gateway;
  if (
    gateway?.source_commit !== payload.deployment_sha ||
    gateway?.worker_build_sha !== payload.deployment_sha ||
    gateway?.upstream_source_commit !== payload.deployment_sha ||
    !SHA256.test(gateway?.worker_bundle_sha256 || "") ||
    !SHA256.test(gateway?.policy_hash || "") ||
    gateway?.upstream_ready !== true ||
    gateway?.upstream_evidence_verified !== true ||
    gateway?.stale !== false
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_GATEWAY_INVALID",
      "Runtime artifact attestation requires exact healthy Gateway and upstream identity.",
    );
  }
  if (expectedPolicyHash && gateway.policy_hash !== expectedPolicyHash) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_POLICY_MISMATCH",
      "Gateway policy hash does not match the repository-owned Staging policy.",
    );
  }

  if (
    payload.runtime_integrity_verified !== true ||
    payload.production_mutation_performed !== false ||
    payload.provider_mutation_performed !== false ||
    payload.database_mutation_performed !== false
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SAFETY_INVALID",
      "Runtime artifact attestation crossed an integrity or mutation boundary.",
    );
  }

  if (issuer && payload.issuer !== issuer) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_ISSUER_MISMATCH",
      "Runtime artifact signer issuer mismatch.",
    );
  }
  if (keyId && payload.key_id !== keyId) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_KEY_ID_MISMATCH",
      "Runtime artifact signer key ID mismatch.",
    );
  }
  if (!SAFE_ID.test(payload.key_id || "") || !payload.issuer) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SIGNER_IDENTITY_INVALID",
      "Runtime artifact signer identity is invalid.",
    );
  }

  assertFreshness(payload, now);
}

export function loadStagingRuntimeArtifactAttestationTrust(env = process.env) {
  const publicKeyPem = normalizePem(
    env.RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY,
  );
  const { issuer, keyId } = signerIdentity(env);
  if (!publicKeyPem) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_TRUST_MISSING",
      "Staging certification public key is required for runtime artifact verification.",
    );
  }

  const publicKey = normalizePublicKey(
    publicKeyPem,
    "STAGING_RUNTIME_ARTIFACT_PUBLIC_KEY_INVALID",
  );
  const signingFingerprint = publicKeyFingerprint(publicKey);
  const ingressFingerprint = String(
    env.ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_SHA256 || "",
  )
    .trim()
    .toLowerCase();

  if (!SHA256.test(ingressFingerprint)) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_INGRESS_TRUST_MISSING",
      "Activation Gateway ingress public-key fingerprint is required.",
    );
  }
  if (signingFingerprint === ingressFingerprint) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_KEY_REUSE_FORBIDDEN",
      "Runtime artifact signing key must remain distinct from Gateway ingress trust.",
    );
  }

  return Object.freeze({
    contract: STAGING_RUNTIME_ARTIFACT_TRUST_CONTRACT,
    publicKey: publicKeyPem,
    issuer,
    keyId,
    public_key_sha256: signingFingerprint,
    activation_gateway_ingress_public_key_sha256: ingressFingerprint,
    separate_from_activation_gateway_ingress: true,
    secrets_included: false,
  });
}

export function signStagingRuntimeArtifactAttestation({
  payload,
  env = process.env,
} = {}) {
  const { issuer, keyId } = signerIdentity(env);
  assertPayload(payload, { issuer, keyId });
  assertGitHubMainAuthority(env, payload.deployment_sha);

  const privateKey = privateSigningKey(env);
  const publicKey = createPublicKey(privateKey);
  const signingFingerprint = publicKeyFingerprint(publicKey);
  const ingressFingerprint = String(
    env.ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_SHA256 || "",
  )
    .trim()
    .toLowerCase();

  if (!SHA256.test(ingressFingerprint)) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_INGRESS_TRUST_MISSING",
      "Activation Gateway ingress public-key fingerprint is required before signing.",
    );
  }
  if (signingFingerprint === ingressFingerprint) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_KEY_REUSE_FORBIDDEN",
      "Runtime artifact signing key must remain distinct from Gateway ingress trust.",
    );
  }

  const encoded = stagingRuntimeArtifactSigningPayload(payload);
  const signature = sign(null, Buffer.from(encoded), privateKey).toString("base64url");

  return Object.freeze({
    contract: STAGING_RUNTIME_ARTIFACT_ATTESTATION_CONTRACT,
    authority_contract: STAGING_RUNTIME_ARTIFACT_SIGNING_AUTHORITY_CONTRACT,
    payload,
    payload_sha256: createHash("sha256").update(encoded).digest("hex"),
    signature,
    signing_public_key_sha256: signingFingerprint,
    signer_runtime: "github_hosted_actions",
    secrets_included: false,
  });
}

export function verifyStagingRuntimeArtifactAttestation(
  record,
  {
    trust,
    expectedSha,
    expectedTree,
    expectedContextFileSetSha256,
    expectedPolicyHash,
    now = Date.now(),
  } = {},
) {
  if (
    !trust ||
    trust.contract !== STAGING_RUNTIME_ARTIFACT_TRUST_CONTRACT ||
    trust.separate_from_activation_gateway_ingress !== true
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_TRUST_UNAVAILABLE",
      "Runtime artifact public trust is unavailable.",
    );
  }
  if (
    record?.contract !== STAGING_RUNTIME_ARTIFACT_ATTESTATION_CONTRACT ||
    record?.authority_contract !==
      STAGING_RUNTIME_ARTIFACT_SIGNING_AUTHORITY_CONTRACT ||
    record?.signer_runtime !== "github_hosted_actions" ||
    record?.secrets_included !== false
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_RECORD_INVALID",
      "Signed runtime artifact record is invalid.",
    );
  }

  const payload = record.payload;
  assertPayload(payload, {
    expectedSha,
    expectedTree,
    expectedContextFileSetSha256,
    expectedPolicyHash,
    issuer: trust.issuer,
    keyId: trust.keyId,
    now,
  });

  if (!/^[A-Za-z0-9_-]{86}$/u.test(record.signature || "")) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SIGNATURE_INVALID",
      "Runtime artifact signature encoding is invalid.",
    );
  }

  const key = normalizePublicKey(
    trust.publicKey,
    "STAGING_RUNTIME_ARTIFACT_PUBLIC_KEY_INVALID",
  );
  const encoded = stagingRuntimeArtifactSigningPayload(payload);
  const signatureValid = verify(
    null,
    Buffer.from(encoded),
    key,
    Buffer.from(record.signature, "base64url"),
  );
  if (!signatureValid) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_SIGNATURE_INVALID",
      "Runtime artifact signature is invalid.",
    );
  }

  const payloadSha256 = createHash("sha256").update(encoded).digest("hex");
  if (
    record.payload_sha256 !== payloadSha256 ||
    record.signing_public_key_sha256 !== trust.public_key_sha256
  ) {
    fail(
      "STAGING_RUNTIME_ARTIFACT_BINDING_MISMATCH",
      "Runtime artifact payload or signing-key binding mismatch.",
    );
  }

  return Object.freeze({
    valid: true,
    payload,
    payload_sha256: payloadSha256,
    public_key_sha256: trust.public_key_sha256,
    ingress_key_separation_verified: true,
    secrets_included: false,
  });
}

export const _testingStagingRuntimeArtifactAttestation = Object.freeze({
  MAX_TTL_MS,
  publicKeyFingerprint,
});
