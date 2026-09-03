import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { certifyStagingRecovery } from "./stagingRecoveryCertification.js";
import { createRecoveryReadinessAuthorities } from "./stagingRecoveryAuthorityBinding.js";
import { expectedStagingGatewayDeployment, expectedStagingRegistration } from "./recoveryReadinessEvidence.js";

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const CONTEXT = "c".repeat(64);
const ENV_KEYS = [
  "NODE_ENV", "DEPLOYMENT_ENVIRONMENT", "REMOTE_MCP_ENVIRONMENT", "RECOVERY_SERVER_MANAGED_BINDING_MODE",
  "RECOVERY_STAGING_READINESS_DIRECTORY", "RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY",
  "RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY_PEM_ESCAPED", "RECOVERY_STAGING_CERTIFICATION_KEY_ID",
  "RECOVERY_STAGING_CERTIFICATION_ISSUER", "DEPLOYMENT_MANIFEST_JSON",
];

function restore(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function configure(root, publicKeyPem) {
  process.env.NODE_ENV = "staging";
  process.env.DEPLOYMENT_ENVIRONMENT = "staging_local_windows_docker";
  process.env.REMOTE_MCP_ENVIRONMENT = "staging";
  process.env.RECOVERY_SERVER_MANAGED_BINDING_MODE = "injected_non_live";
  process.env.RECOVERY_STAGING_READINESS_DIRECTORY = path.join(root, "recovery-readiness");
  process.env.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY = path.join(root, "recovery-ingress");
  process.env.RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY_PEM_ESCAPED = publicKeyPem.replaceAll("\n", "\\n");
  process.env.RECOVERY_STAGING_CERTIFICATION_KEY_ID = "staging-recovery-certification-test-key";
  process.env.RECOVERY_STAGING_CERTIFICATION_ISSUER = "https://staging-recovery-certification.test.mad4b.invalid";
  process.env.DEPLOYMENT_MANIFEST_JSON = JSON.stringify({
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "main",
    commit_sha: SHA,
    tree_sha: TREE,
    context_file_set_sha256: CONTEXT,
    build_source: "portable_staging_docker_build",
    secrets_included: false,
  });
}

test("Phase B runs the durable canary, complete negative suite, external Ed25519 signing and atomic pointer promotion", async () => {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-certification-"));
  const pair = generateKeyPairSync("ed25519");
  const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" });
  try {
    configure(root, publicKeyPem);
    const registration = await expectedStagingRegistration();
    const gateway = await expectedStagingGatewayDeployment();
    const registrationEvidence = { ...registration, observed_in: "chatgpt", observed_at: new Date().toISOString() };
    const oauthEvidence = {
      issuer: "https://dev.mad4b.com",
      resource: "https://activation-dev.mad4b.com",
      observed_at: new Date().toISOString(),
      steps: { authorize: "pass", login_consent: "pass", code: "pass", callback: "pass", token: "pass", resource: "pass" },
    };
    const networkEvidence = {
      environment: "staging",
      gateway_host: gateway.gateway_host,
      upstream_origin: gateway.upstream_origin,
      gateway_only: true,
      signed_ingress_required: true,
      network_restriction_verified: true,
      direct_origin_publicly_reachable: false,
      gateway_health_status: 200,
      direct_origin_status: 404,
    };
    const bundle = "d".repeat(64);
    const workerDeploymentEvidence = {
      observed_in: "cloudflare_workers",
      deployment_verified: true,
      gateway_host: gateway.gateway_host,
      policy_hash: gateway.policy_hash,
      worker_build_sha: SHA,
      policy_source_sha: SHA,
      worker_bundle_sha256: bundle,
      release_bundle_sha256: bundle,
      deployed_bundle_sha256: bundle,
      deployment_id: "test-deployment",
    };

    const result = await certifyStagingRecovery({ privateKeyPem, registrationEvidence, oauthEvidence, networkEvidence, workerDeploymentEvidence });
    assert.equal(result.status, "promoted_pending_public_readback");
    assert.equal(result.deployment_sha, SHA);
    assert.match(result.target_fingerprint, /^[a-f0-9]{64}$/u);
    assert.equal(result.negative_tests.all_passed, true);
    assert.equal(Object.keys(result.negative_tests.cases).length, 20);
    assert.equal(Object.values(result.lifecycle_trace).every((entry) => entry.status === "pass"), true);
    assert.equal(result.production_mutation_performed, false);
    assert.equal(result.database_mutation_performed, false);
    assert.equal(result.provider_mutation_performed, false);

    const authority = createRecoveryReadinessAuthorities({ environment: "staging", runtime_class: "local_windows_docker", read_only: true, production_live: false });
    const promoted = await authority.readSnapshot();
    assert.equal(promoted.authenticity_verified, true);
    assert.equal(promoted.evidence_id, result.evidence_id);
    assert.equal(promoted.stagingCertification.status, "passed");
    assert.equal(promoted.stagingCertification.negative_tests.all_passed, true);
    const pointer = (await readFile(path.join(root, "recovery-readiness", "certification-evidence", "current-certification"), "utf8")).trim();
    assert.equal(pointer, result.evidence_id);
  } finally {
    restore(snapshot);
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase B fails closed when the external private key does not match the Staging public trust anchor", async () => {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-certification-key-mismatch-"));
  const trusted = generateKeyPairSync("ed25519");
  const wrong = generateKeyPairSync("ed25519");
  try {
    configure(root, trusted.publicKey.export({ type: "spki", format: "pem" }));
    await assert.rejects(
      certifyStagingRecovery({ privateKeyPem: wrong.privateKey.export({ type: "pkcs8", format: "pem" }) }),
      (error) => error?.code === "RECOVERY_STAGING_CERTIFICATION_KEY_MISMATCH",
    );
  } finally {
    restore(snapshot);
    await rm(root, { recursive: true, force: true });
  }
});
