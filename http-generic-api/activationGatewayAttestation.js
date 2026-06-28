function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function policyPayload(policy) {
  return {
    manifest_version: policy.manifest_version,
    surface_registry_version: policy.surface_registry_version,
    policy_key: policy.policy_key,
    public_host: policy.public_host,
    upstream_origin: policy.upstream_origin,
    mutation_stale_policy: policy.mutation_stale_policy,
    read_stale_grace_seconds: policy.read_stale_grace_seconds,
    source_registry: policy.source_registry,
    source_surfaces: policy.source_surfaces,
    routes: policy.routes,
  };
}

export async function policyHash(policy, cryptoImpl = crypto) {
  const digest = await cryptoImpl.subtle.digest("SHA-256", utf8(stableJson(policyPayload(policy))));
  return hex(digest);
}

export async function verifyDeploymentAttestation(policy, env, { cryptoImpl = crypto, now = () => Date.now() } = {}) {
  const calculatedHash = await policyHash(policy, cryptoImpl);
  if (calculatedHash !== policy.content_hash_sha256) {
    return { ok: false, code: "GATEWAY_POLICY_HASH_MISMATCH", stale: true };
  }

  const rawAttestation = env?.ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON;
  const rawPublicKey = env?.ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK;
  if (!rawAttestation || !rawPublicKey) {
    return { ok: false, code: "GATEWAY_POLICY_ATTESTATION_MISSING", stale: true };
  }

  let attestation;
  let publicKeyJwk;
  try {
    attestation = JSON.parse(rawAttestation);
    publicKeyJwk = JSON.parse(rawPublicKey);
  } catch {
    return { ok: false, code: "GATEWAY_POLICY_ATTESTATION_INVALID", stale: true };
  }

  if (attestation.content_hash_sha256 !== policy.content_hash_sha256) {
    return { ok: false, code: "GATEWAY_POLICY_ATTESTATION_HASH_MISMATCH", stale: true };
  }
  if (!attestation.deployment_id || !attestation.source_commit || !attestation.expires_at || !attestation.signature_b64url) {
    return { ok: false, code: "GATEWAY_POLICY_ATTESTATION_INCOMPLETE", stale: true };
  }
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(String(attestation.source_commit))) {
    return { ok: false, code: "GATEWAY_POLICY_SOURCE_COMMIT_INVALID", stale: true };
  }
  if (Number(attestation.surface_registry_version) !== Number(policy.surface_registry_version)) {
    return { ok: false, code: "GATEWAY_POLICY_REGISTRY_VERSION_MISMATCH", stale: true };
  }

  try {
    const publicKey = await cryptoImpl.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signedPayload = stableJson({
      content_hash_sha256: attestation.content_hash_sha256,
      deployment_id: attestation.deployment_id,
      expires_at: attestation.expires_at,
      source_commit: attestation.source_commit,
      surface_registry_version: Number(attestation.surface_registry_version),
    });
    const verified = await cryptoImpl.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      base64UrlDecode(attestation.signature_b64url),
      utf8(signedPayload),
    );
    if (!verified) return { ok: false, code: "GATEWAY_POLICY_SIGNATURE_INVALID", stale: true };
  } catch {
    return { ok: false, code: "GATEWAY_POLICY_SIGNATURE_INVALID", stale: true };
  }

  const expiresAtMs = Date.parse(attestation.expires_at);
  if (!Number.isFinite(expiresAtMs)) return { ok: false, code: "GATEWAY_POLICY_EXPIRY_INVALID", stale: true };
  const nowMs = now();
  const stale = nowMs >= expiresAtMs;
  return {
    ok: true,
    stale,
    expiresAtMs,
    deploymentId: attestation.deployment_id,
    sourceCommit: attestation.source_commit,
    surfaceRegistryVersion: Number(attestation.surface_registry_version),
    attestation,
    code: stale ? "GATEWAY_POLICY_STALE" : null,
  };
}
