import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
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
    createPublicKey(ingressPair.publicKey).export({
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
    trusted_ingress: {
      key_id: "activation-staging-test-key",
      public_key_sha256: "7".repeat(64),
    },
    issuer: ISSUER,
    key_id: KEY_ID,
    generated_at: new Date(generated).toISOString(),
    expires_at: new Date(generated + 60 * 60 * 1000).toISOString(),
    production_mutation_performed: false,
    provider_mutation_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
    ...overrides,
  };
}

test("runtime artifact attestation signs and verifies exact Staging identity", () => {
  const runtimeEnv = env();
  const record = signStagingRuntimeArtifactAttestation({
    payload: payload(),
    env: runtimeEnv,
  });
  const trust = loadStagingRuntimeArtifactAttestationTrust(runtimeEnv);
  const verified = verifyStagingRuntimeArtifactAttestation(record, {
    trust,
    expectedSha: SHA,
    expectedTree: TREE,
    expectedContextFileSetSha256: CONTEXT,
    expectedPolicyHash: POLICY,
  });

  assert.equal(verified.valid, true);
  assert.equal(verified.payload.app_image_digest, IMAGE);
  assert.equal(verified.payload.activation_gateway.source_commit, SHA);
  assert.equal(verified.payload.production_mutation_performed, false);
  assert.equal(verified.payload.provider_mutation_performed, false);
  assert.equal(verified.payload.database_mutation_performed, false);
  assert.equal(verified.secrets_included, false);
});

test("runtime artifact attestation rejects cross-SHA verification", () => {
  const runtimeEnv = env();
  const record = signStagingRuntimeArtifactAttestation({
    payload: payload(),
    env: runtimeEnv,
  });
  const trust = loadStagingRuntimeArtifactAttestationTrust(runtimeEnv);

  assert.throws(
    () =>
      verifyStagingRuntimeArtifactAttestation(record, {
        trust,
        expectedSha: "8".repeat(40),
        expectedTree: TREE,
        expectedContextFileSetSha256: CONTEXT,
        expectedPolicyHash: POLICY,
      }),
    (error) => error.code === "STAGING_RUNTIME_ARTIFACT_SHA_MISMATCH",
  );
});

test("runtime artifact attestation rejects a tampered signed image digest", () => {
  const runtimeEnv = env();
  const record = signStagingRuntimeArtifactAttestation({
    payload: payload(),
    env: runtimeEnv,
  });
  const trust = loadStagingRuntimeArtifactAttestationTrust(runtimeEnv);
  const tampered = {
    ...record,
    payload: {
      ...record.payload,
      app_image_digest: "sha256:" + "9".repeat(64),
    },
  };

  assert.throws(
    () =>
      verifyStagingRuntimeArtifactAttestation(tampered, {
        trust,
        expectedSha: SHA,
        expectedTree: TREE,
        expectedContextFileSetSha256: CONTEXT,
        expectedPolicyHash: POLICY,
      }),
    (error) => error.code === "STAGING_RUNTIME_ARTIFACT_SIGNATURE_INVALID",
  );
});

test("runtime artifact signer refuses non-main GitHub authority", () => {
  assert.throws(
    () =>
      signStagingRuntimeArtifactAttestation({
        payload: payload(),
        env: env({ GITHUB_REF: "refs/heads/feature", GITHUB_REF_NAME: "feature" }),
      }),
    (error) => error.code === "STAGING_RUNTIME_ARTIFACT_SIGNER_REF_DENIED",
  );
});

test("runtime artifact signer refuses stale or oversized TTL", () => {
  const generated = Date.now() - 1_000;
  assert.throws(
    () =>
      signStagingRuntimeArtifactAttestation({
        payload: payload({
          generated_at: new Date(generated).toISOString(),
          expires_at: new Date(generated + 3 * 60 * 60 * 1000).toISOString(),
        }),
        env: env(),
      }),
    (error) => error.code === "STAGING_RUNTIME_ARTIFACT_FRESHNESS_INVALID",
  );
});

test("runtime artifact trust refuses reuse of Gateway ingress key", () => {
  const signingFingerprint = createHash("sha256")
    .update(
      createPublicKey(signingPair.publicKey).export({
        format: "der",
        type: "spki",
      }),
    )
    .digest("hex");

  assert.throws(
    () =>
      loadStagingRuntimeArtifactAttestationTrust(
        env({
          ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_SHA256: signingFingerprint,
        }),
      ),
    (error) => error.code === "STAGING_RUNTIME_ARTIFACT_KEY_REUSE_FORBIDDEN",
  );
});