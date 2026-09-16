import { createHash, createPublicKey } from "node:crypto";
import { buildTrustedIngressReadiness } from "./trustedIngressContract.js";

export const STAGING_TRUSTED_INGRESS_CERTIFICATION_EVIDENCE_CONTRACT =
  "mad4b.staging-trusted-ingress-certification-evidence.v1";

function text(value, max = 2048) {
  return String(value || "").trim().slice(0, max);
}

function canonicalPublicKeyPem(value) {
  const configured = String(value || "").trim();
  if (!configured) return "";
  const expanded = configured.includes("\\n") ? configured.replaceAll("\\n", "\n") : configured;
  const normalized = expanded.replaceAll("\r", "").trim();
  return normalized ? `${normalized}\n` : "";
}

function publicKeyEvidence(value) {
  const pem = canonicalPublicKeyPem(value);
  let ed25519 = false;
  if (pem) {
    try {
      ed25519 = createPublicKey(pem).asymmetricKeyType === "ed25519";
    } catch { }
  }
  return {
    configured: Boolean(pem),
    ed25519,
    sha256: pem ? createHash("sha256").update(pem, "utf8").digest("hex") : null,
  };
}

export function buildStagingTrustedIngressCertificationEvidence(env = process.env) {
  const readiness = buildTrustedIngressReadiness(env);
  const publicKey = publicKeyEvidence(env?.REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY);
  const keyId = text(env?.REMOTE_MCP_TRUSTED_INGRESS_KEY_ID, 128);
  const deploymentSha = text(env?.REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA || env?.GIT_COMMIT_FULL, 64).toLowerCase();
  const replayDirectory = text(env?.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY, 2048);
  const canonicalHosts = Array.isArray(readiness?.canonical_host_policy?.hosts)
    ? readiness.canonical_host_policy.hosts.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const available = readiness.environment === "staging";
  const configured = available
    && readiness.runtime_identity_ok === true
    && readiness.attestation_mode === "signature"
    && readiness.proxy_headers_enabled === true
    && readiness.caller_headers_stripped === true
    && readiness.canonical_host_policy?.valid === true
    && readiness.signed_attestation_configured === true
    && publicKey.ed25519
    && /^[A-Za-z0-9._:-]{16,128}$/u.test(keyId)
    && /^[0-9a-f]{40}$/u.test(deploymentSha)
    && Boolean(replayDirectory);

  return {
    contract: STAGING_TRUSTED_INGRESS_CERTIFICATION_EVIDENCE_CONTRACT,
    available,
    configured,
    environment: readiness.environment,
    runtime_identity_ok: readiness.runtime_identity_ok === true,
    observed: {
      attestation_mode: readiness.attestation_mode || null,
      proxy_headers_enabled: readiness.proxy_headers_enabled === true,
      caller_headers_stripped: readiness.caller_headers_stripped === true,
      canonical_host_policy_valid: readiness.canonical_host_policy?.valid === true,
      canonical_hosts: canonicalHosts,
      audience: text(env?.REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE, 512) || null,
      issuer: text(env?.REMOTE_MCP_TRUSTED_INGRESS_ISSUER, 512) || null,
      deployment_sha: /^[0-9a-f]{40}$/u.test(deploymentSha) ? deploymentSha : null,
      replay_directory: replayDirectory || null,
      key_id: keyId || null,
      key_id_valid: /^[A-Za-z0-9._:-]{16,128}$/u.test(keyId),
      public_key_configured: publicKey.configured,
      public_key_ed25519: publicKey.ed25519,
      public_key_sha256: publicKey.sha256,
      signed_attestation_configured: readiness.signed_attestation_configured === true,
    },
    read_only: true,
    raw_public_key_exposed: false,
    secrets_included: false,
  };
}
