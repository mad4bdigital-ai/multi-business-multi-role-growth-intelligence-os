import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createRecoveryReadinessAuthorities,
  createServerManagedRecoveryBinding,
  _testingStagingRecoveryAuthorityBinding,
} from "./stagingRecoveryAuthorityBinding.js";
import { createFileRecoveryEvidenceStore } from "./recoveryReadinessEvidence.js";
import { getRecoveryCompositionRouteDependencies } from "./recoveryComposition.js";
import { createProductionRecoveryComposition } from "./productionRecoveryCompositionFactory.js";
import { buildStagingRecoveryAdminReadiness } from "./routes/stagingRecoveryAdminRoutes.js";

const dockerfile = readFileSync(new URL("./Dockerfile.staging", import.meta.url), "utf8");
assert.match(dockerfile, /RECOVERY_SERVER_MANAGED_BINDING_MODE=injected_non_live/u);
assert.match(dockerfile, /RECOVERY_SERVER_MANAGED_BINDING_MODULE=\.\/stagingRecoveryAuthorityBinding\.js/u);
assert.match(dockerfile, /RECOVERY_STAGING_READINESS_DIRECTORY=\/app\/data\/recovery-readiness/u);
assert.match(dockerfile, /RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=\/app\/data\/recovery-ingress/u);

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const CONTEXT = "c".repeat(64);
const ENV_KEYS = [
  "NODE_ENV",
  "DEPLOYMENT_ENVIRONMENT",
  "REMOTE_MCP_ENVIRONMENT",
  "RECOVERY_SERVER_MANAGED_BINDING_MODE",
  "RECOVERY_SERVER_MANAGED_BINDING_MODULE",
  "RECOVERY_STAGING_READINESS_DIRECTORY",
  "RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY",
  "RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY_PEM_ESCAPED",
  "RECOVERY_STAGING_CERTIFICATION_KEY_ID",
  "RECOVERY_STAGING_CERTIFICATION_ISSUER",
  "DEPLOYMENT_MANIFEST_JSON",
];

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function setStagingEnv(root) {
  process.env.NODE_ENV = "staging";
  process.env.DEPLOYMENT_ENVIRONMENT = "staging_local_windows_docker";
  process.env.REMOTE_MCP_ENVIRONMENT = "staging";
  process.env.RECOVERY_SERVER_MANAGED_BINDING_MODE = "injected_non_live";
  process.env.RECOVERY_SERVER_MANAGED_BINDING_MODULE = "./stagingRecoveryAuthorityBinding.js";
  process.env.RECOVERY_STAGING_READINESS_DIRECTORY = path.join(root, "recovery-readiness");
  process.env.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY = path.join(root, "recovery-ingress");
  delete process.env.RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY_PEM_ESCAPED;
  delete process.env.RECOVERY_STAGING_CERTIFICATION_KEY_ID;
  delete process.env.RECOVERY_STAGING_CERTIFICATION_ISSUER;
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

test("Phase A binds a complete durable Staging Recovery graph and remains certification-blocked", async () => {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-authority-"));
  try {
    setStagingEnv(root);
    const envelope = createServerManagedRecoveryBinding({
      environment: "staging",
      requested_mode: "injected_non_live",
      production_live: false,
    });
    assert.equal(envelope.binding_source, "server_managed");
    assert.equal(envelope.capabilities.durability_capable, true);
    assert.equal(envelope.capabilities.attestation_capable, true);
    assert.equal(envelope.provider_accessed, false);
    assert.equal(envelope.database_connection_performed, false);
    assert.equal(envelope.database_mutation_performed, false);
    assert.equal(envelope.secrets_included, false);
    assert.deepEqual(Object.keys(envelope.adapters).sort(), [
      "approvalIssuer", "approvalStore", "approvalVerifier", "deploymentIdentityProvider",
      "executionTicketSigner", "executionTicketVerifier", "hostLocalMutationExecutor", "migrationLedger",
      "mutationExecutor", "partialReceiptStore", "proofResolver", "readbackVerifier", "recoveryLock", "recoveryStore",
    ].sort());
    assert.equal(envelope.adapters.recoveryStore.executionTicketVerifier, envelope.adapters.executionTicketVerifier);

    const composition = createProductionRecoveryComposition({
      mode: "injected_non_live",
      serverManagedBindingProvider: () => envelope,
      source: "staging_phase_a_test",
    });
    assert.equal(composition.mode, "injected_non_live");
    assert.equal(composition.configured, true);
    assert.equal(composition.live_activation, false);
    assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.durability_capable, true);
    assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.attestation_capable, true);

    const authority = createRecoveryReadinessAuthorities({
      environment: "staging",
      runtime_class: "local_windows_docker",
      read_only: true,
      production_live: false,
    });
    const deps = getRecoveryCompositionRouteDependencies(composition, authority);
    const readinessSnapshot = await deps.recoveryReadinessEvidenceReader();
    assert.equal(readinessSnapshot.pre_certification, true);
    assert.equal(readinessSnapshot.authenticity_verified, false);
    assert.equal(readinessSnapshot.stagingCertification, null);
    assert.equal(readinessSnapshot.candidateSha, SHA);
    assert.match(readinessSnapshot.candidateTargetFingerprint, /^[a-f0-9]{64}$/u);
    assert.equal(readinessSnapshot.adapterProvenance.contract, "mad4b.recovery-adapter-provenance.v1");
    assert.equal(readinessSnapshot.adapterProvenance.deployment_sha, SHA);
    for (const component of Object.values(readinessSnapshot.adapterProvenance.components)) {
      assert.equal(component.authority_class, "server_managed");
      assert.match(component.artifact_sha256, /^[a-f0-9]{64}$/u);
      assert.ok(["durable", "stateless"].includes(component.storage_class));
    }

    const readiness = await buildStagingRecoveryAdminReadiness({
      recoveryComposition: composition,
      ...deps,
      ingressBuildIdentity: null,
    });
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.ready, false);
    assert.equal(readiness.authority_graph.ready, true);
    assert.deepEqual(readiness.authority_graph.blocking_reasons, []);
    assert.equal(readiness.certification.valid, false);
    assert.equal(readiness.external_evidence.ready, false);
    assert.equal(readiness.production_mutation_performed, false);
    assert.equal(readiness.production_live.enabled, false);

    const directories = _testingStagingRecoveryAuthorityBinding.roots(process.env);
    assert.notEqual(directories.readiness, directories.replay);
    const evidence = createFileRecoveryEvidenceStore({
      directory: path.join(directories.readiness, "certification-evidence"),
      replayDirectory: directories.replay,
    });
    assert.notEqual(evidence.certification_root, evidence.replay_root);
    const claim = { issuer: "test-gateway", key_id: "phase-a", jti: "phase-a-jti", expires_at: Math.floor(Date.now() / 1000) + 60 };
    assert.equal(await evidence.replayStore.claim(claim), true);
    assert.equal(await evidence.replayStore.claim(claim), false);

    const unsignedId = await evidence.putCertification({ payload: { contract: "unsigned" }, signature: "invalid" });
    await evidence.setCurrentCertification(unsignedId);
    await assert.rejects(authority.readSnapshot(), (error) => error.code === "RECOVERY_EVIDENCE_SIGNING_TRUST_UNAVAILABLE");
  } finally {
    restoreEnv(snapshot);
    await rm(root, { recursive: true, force: true });
  }
});

test("deployment-owned Staging binding fails closed for Production, unknown and mixed runtimes", () => {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    process.env.RECOVERY_SERVER_MANAGED_BINDING_MODE = "injected_non_live";
    for (const env of [
      { NODE_ENV: "production", DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy", REMOTE_MCP_ENVIRONMENT: "production" },
      { NODE_ENV: "garbage", DEPLOYMENT_ENVIRONMENT: "garbage", REMOTE_MCP_ENVIRONMENT: "garbage" },
      { NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker", REMOTE_MCP_ENVIRONMENT: "production" },
    ]) {
      Object.assign(process.env, env);
      assert.throws(() => createServerManagedRecoveryBinding({ requested_mode: "injected_non_live" }), (error) => error.code === "RECOVERY_STAGING_AUTHORITY_RUNTIME_DENIED");
    }
  } finally { restoreEnv(snapshot); }
});
