import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
} from "node:crypto";
import test from "node:test";
import {
  loadStagingRuntimeArtifactAttestationTrust,
  signStagingRuntimeArtifactAttestation,
  verifyStagingRuntimeArtifactAttestation,
} from "./stagingRuntimeArtifactAttestation.js";

const SHA = "1".repeat(40);
const TREE = "2".repeat(40);
const CONTEXT = "3".repeat(64);
const POLICY = "4".repeat(64);
const BUNDLE = "5".repeat(64);
const IMAGE = "sha256:" + "6".repeat(64);
const ISSUER = "mad4b://staging-recovery-certification";
const KEY_ID = "staging-certification-test-key";

const signingPair = generateKeyPairSync("ed25519");
const ingressPair = generateKeyPairSync("ed25519");
const privatePem = signingPair.privateKey.export({
  format: "pem",
  type: "pkcs8",
});
const publicPem = signingPair.publicKey.export({
  format: "pem",
  type: "spki",
});
const ingressFingerprint = createHash("sha256")
  .update(
    ingressPair.publicKey.export({
      format: "der",
      type: "spki",
    }),
  )
  .digest("hex");

function env(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_NAME: "main",
    GITHUB_SHA: SHA,
    RECOVERY_STAGING_CERTIFICATION_PRIVATE_KEY: privatePem,
    RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY: publicPem,
    RECOVERY_STAGING_CERTIFICATION_ISSUER: ISSUER,
    RECOVERY_STAGING_CERTIFICATION_KEY_ID: KEY_ID,
    ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_SHA256: ingressFingerprint,
    ...overrides,
  };
}

function payload(overrides = {}) {
  const generated = Date.now() - 1_000;
  return {
    contract: "mad4b.staging-runtime-artifact-attestation-payload.v1",
    environment: "staging",
    branch: "main",
    deployment_sha: SHA,
    tree_sha: TREE,
    context_file_set_sha256: CONTEXT,
    app_image_digest: IMAGE,
    local_runtime_evidence_sha256: "a".repeat(64),
    app_container_identity_sha256: "b".repeat(64),
    runtime_integrity_verified: true,
    activation_gateway: {
      source_commit: SHA,
      worker_build_sha: SHA,
      worker_bundle_sha256: BUNDLE,
      policy_hash: POLICY,
      upstream_source_commit: SHA,
      upstream_ready: true,
      upstream_evidence_verified: true,
      stale: false,
    },