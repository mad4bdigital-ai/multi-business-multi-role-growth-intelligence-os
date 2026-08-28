import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileRecoveryEvidenceStore, createRecoveryReadinessAuthorities, readinessEvidencePayload, producePromotionArtifactParity, RECOVERY_READINESS_EVIDENCE_CONTRACT } from "./recoveryReadinessEvidence.js";
import { getRecoveryCompositionRouteDependencies, createRecoveryComposition } from "./recoveryComposition.js";
import {
  createProductionRecoveryComposition,
} from "./productionRecoveryCompositionFactory.js";
import {
  createServerManagedRecoveryBindingProvider,
  getServerManagedRecoveryBindingMode,
  getServerManagedRecoveryBindingStatus,
} from "./serverManagedRecoveryBindingProvider.js";
import {
  createServerManagedRecoveryAuthorityBinding,
  createServerManagedRecoveryBindingEnvelope,
  evaluateServerManagedRecoveryBindingReadiness,
} from "./serverManagedRecoveryAuthorityBinding.js";
import {
  createServerManagedDeploymentIdentityProvider,
} from "./serverManagedDeploymentIdentityProvider.js";
import { validateDeploymentIdentityAttestation } from "./recoveryExecutionBinding.js";
import {
  RECOVERY_BRANCH,
  RECOVERY_REPOSITORY,
} from "./recoveryTrustModel.js";

const STORE_METHODS = [
  "putRun", "getRun", "putPlan", "getPlan", "putFinding", "getFinding", "getRunByIdempotency",
  "appendEvidenceEvent", "putIdempotencyReceipt", "putApproval", "getApprovalByPlanStep", "claimExecution",
  "reserveApproval", "getExecutionTicket", "putExecutionTicket", "reserveExecutionTicket",
  "releaseExecutionTicket", "finalizeExecutionTicket", "releaseExecutionClaim", "releaseApprovalReservation",
];

function createTestAdapters() {
  const calls = [];
  const verifier = { verify: () => ({ ok: true }) };
  const store = Object.fromEntries(STORE_METHODS.map((method) => [method, (...args) => { calls.push([method, args]); return null; }]));
  store.executionTicketVerifier = verifier;
  const adapters = {
    deploymentIdentityProvider: { readAttestation: async () => ({}) },
    recoveryStore: store,
    approvalIssuer: { createChallenge: () => ({}) },
    approvalVerifier: { verify: () => ({ ok: true }) },
    approvalStore: { putChallenge: () => null, getChallenge: () => null },
    recoveryLock: { acquire: () => ({}), heartbeat: () => ({}), assertFence: () => true, release: () => true },
    mutationExecutor: { execute: () => ({}) },
    hostLocalMutationExecutor: () => ({}),
    readbackVerifier: { verify: () => ({ ok: true }) },
    executionTicketSigner: { sign: () => "signature" },
    executionTicketVerifier: verifier,
    partialReceiptStore: { putImmutablePartialRebuildReceipt: () => null },
    proofResolver: () => ({}),
    migrationLedger: { finalize: () => ({}) },
  };
  return { adapters, calls };
}

function createValidEnvelope() {
  const { adapters } = createTestAdapters();
  const binding = createServerManagedRecoveryAuthorityBinding({
    adapters,
    adapterOrigin: "server_managed_concrete",
    capabilities: {
      adapter_present: true,
      durability_capable: true,
      attestation_capable: true,
    },
    authorityHandles: { handles_are_opaque: true },
  });
  return createServerManagedRecoveryBindingEnvelope({ binding });
}

function validAttestation(sha = "a".repeat(40)) {
  return {
    contract: "mad4b.recovery-runtime-attestation.v1",
    repository: RECOVERY_REPOSITORY,
    branch: RECOVERY_BRANCH,
    deployment_sha: sha,
    repository_sha: sha,
    recovery_manifest_hash: "b".repeat(64),
    attestation_hash: "c".repeat(64),
    manifest_bound: true,
    read_only_probe: true,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

test("deployment normalization preserves role bindings and strips arbitrary source fields", async () => {
  const provider = createServerManagedDeploymentIdentityProvider({ readServerAttestation: async () => ({
    ...validAttestation(), target_fingerprints: { runtime: "d".repeat(64), governance: "e".repeat(64) },
    unrelated_internal_data: "not-public",
  }) });
  const attestation = await provider.readAttestation();
  assert.equal(attestation.target_fingerprints.runtime, "d".repeat(64));
  assert.equal(attestation.target_fingerprints.governance, "e".repeat(64));
  assert.equal(Object.hasOwn(attestation, "unrelated_internal_data"), false);
  assert.equal(validateDeploymentIdentityAttestation({ attestation, expectedSha: "a".repeat(40),
    expectedManifestHash: "b".repeat(64), expectedTargetRole: "runtime", expectedTargetFingerprint: "d".repeat(64) }).ok, true);
});

test("signed durable evidence reaches real composition dependencies without enabling mutation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recovery-evidence-"));
  try {
    const store = createFileRecoveryEvidenceStore({ directory });
    const keys = generateKeyPairSync("ed25519");
    const target = { environment: "staging", runtime_class: "staging_hosted", target_fingerprint: "target:server-owned" };
    const deploymentIdentityProvider = createServerManagedDeploymentIdentityProvider({ environment: "staging",
      readServerAttestation: async () => ({ ...validAttestation(), environment: "staging", branch: "main", target_fingerprint: target.target_fingerprint }),
    });
    const payload = {
      contract: RECOVERY_READINESS_EVIDENCE_CONTRACT, issuer: "certification-workflow", key_id: "test-signing-key",
      environment: "staging", deployment_sha: "a".repeat(40), target_fingerprint: target.target_fingerprint,
      expires_at: new Date(Date.now() + 60000).toISOString(), stagingCertification: { certification_id: "not-a-live-certificate" },
      promotionManifests: { source: { environment: "staging", sha: "a".repeat(40), target_fingerprint: target.target_fingerprint,
        artifacts: [{ path: "server.js", sha256: "d".repeat(64) }], manifest_hash: "e".repeat(64), generated_artifacts_verified: true },
        target: { environment: "production", sha: "b".repeat(40), target_fingerprint: "production-target",
        artifacts: [{ path: "server.js", sha256: "d".repeat(64) }], manifest_hash: "e".repeat(64), generated_artifacts_verified: true } }, adapterProvenance: { contract: "explicit-evidence", environment: "staging", deployment_sha: "a".repeat(40) },
      unresolvedRecoveryIncidents: [], secrets_included: false,
    };
    const record = { payload, signature: sign(null, Buffer.from(readinessEvidencePayload(payload)), keys.privateKey).toString("base64url") };
    const recordId = await store.putCertification(record);
    assert.equal(await store.putCertification(record), recordId);
    const reopened = createFileRecoveryEvidenceStore({ directory });
    assert.deepEqual(await reopened.getCertification(recordId), record);
    const options = { evidenceStore: reopened, deploymentIdentityProvider, targetIdentityProvider: { readIdentity: async () => target },
      recordId, publicKey: keys.publicKey.export({ type: "spki", format: "pem" }), keyId: payload.key_id, issuer: payload.issuer, env: { NODE_ENV: "staging" } };
    const authority = createRecoveryReadinessAuthorities(options);
    const deps = getRecoveryCompositionRouteDependencies(createRecoveryComposition(), authority);
    assert.deepEqual(await deps.stagingCertificationReader(), payload.stagingCertification);
    assert.equal((await deps.deploymentAttestationReader()).branch, "main");
    assert.equal(await deps.targetFingerprintReader(), target.target_fingerprint);
    const snapshot = await deps.recoveryReadinessEvidenceReader();
    assert.equal(snapshot.promotionArtifactParity.verified, true);
    assert.notEqual(snapshot.promotionArtifactParity.source_sha, snapshot.promotionArtifactParity.target_sha);
    const drift = structuredClone(payload.promotionManifests);
    drift.target.artifacts[0].sha256 = "f".repeat(64);
    assert.equal(producePromotionArtifactParity(drift).verified, false);
    drift.target.artifacts.push(drift.target.artifacts[0]);
    assert.equal(producePromotionArtifactParity(drift), null);
    assert.deepEqual(snapshot.adapterProvenance, payload.adapterProvenance);
    assert.equal(snapshot.authenticity_verified, true);
    assert.equal(deps.recoveryComposition.mode, "fail_closed", "read-only evidence never enables execution");
    assert.throws(() => getRecoveryCompositionRouteDependencies(createRecoveryComposition(), { readSnapshot: async () => ({ valid: true }) }), /UNTRUSTED/);
    for (const changes of [{ target_fingerprint: "wrong" }, { environment: "production" }, { expires_at: "2000-01-01T00:00:00.000Z" }]) {
      const modified = { ...payload, ...changes };
      const alteredId = await store.putCertification({ ...record, payload: modified });
      await assert.rejects(createRecoveryReadinessAuthorities({ ...options, recordId: alteredId }).readSnapshot(), /SIGNATURE_OR_FRESHNESS_INVALID/);
    }
    await assert.rejects(createRecoveryReadinessAuthorities({ ...options, targetIdentityProvider: { readIdentity: async () => ({ ...target, runtime_class: "local_windows_docker" }) } }).readSnapshot(), /TARGET_MISMATCH/);
    const claims = { issuer: "gateway", key_id: "test", jti: "race", expires_at: Math.floor(Date.now() / 1000) + 60 };
    const raced = await Promise.all(Array.from({ length: 8 }, () => reopened.replayStore.claim(claims)));
    assert.equal(raced.filter(Boolean).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("default server-managed mode remains disabled and exposes no binding", () => {
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "production", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "disabled");
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "unknown", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "disabled");
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "staging", REMOTE_MCP_ENVIRONMENT: "staging", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "injected_non_live");
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "injected_non_live");
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "production", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "disabled");
  assert.equal(getServerManagedRecoveryBindingMode({ DEPLOYMENT_ENVIRONMENT: "unknown", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "disabled");
  const status = getServerManagedRecoveryBindingStatus({ env: {} });
  assert.equal(status.module_configured, false);
  assert.equal(status.secrets_included, false);
});

test("valid concrete server-managed bundle becomes complete non-live composition", () => {
  let resolverCalls = 0;
  let resolverContext = null;
  const provider = createServerManagedRecoveryBindingProvider({ resolver: (context) => { resolverCalls += 1; resolverContext = context; return createValidEnvelope(); } });
  const composition = createProductionRecoveryComposition({ mode: "injected_non_live", serverManagedBindingProvider: provider, source: "test_server_root" });
  assert.equal(resolverCalls, 1);
  assert.equal(resolverContext.binding_source, "server_managed");
  assert.equal(resolverContext.caller_credentials_accepted, false);
  assert.equal(resolverContext.gpt_credentials_accepted, false);
  assert.equal(resolverContext.local_connector_accepted, false);
  assert.equal(resolverContext.provider_discovery, false);
  assert.equal(resolverContext.database_discovery, false);
  assert.equal(resolverContext.secrets_included, false);
  assert.equal(composition.configured, true);
  assert.equal(composition.live_activation, false);
  assert.equal(composition.provider_accessed, false);
  assert.equal(composition.database_connection_performed, false);
  assert.equal(composition.database_mutation_performed, false);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.all_required_components_configured, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.adapter_present, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.durability_capable, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.attestation_capable, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.live_ready, false);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.activation_eligible, false);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.secrets_included, false);
  assert.deepEqual(evaluateServerManagedRecoveryBindingReadiness({ binding: createValidEnvelope() }), {
    contract: "mad4b.recovery-server-managed-authority-readiness.v1",
    adapter_present: true,
    durability_capable: true,
    attestation_capable: true,
    live_ready: false,
    activation_eligible: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
});

test("every missing live authority fails closed and is reported", () => {
  const liveAuthorities = [
    "recoveryStore",
    "executionTicketSigner",
    "approvalVerifier",
    "recoveryLock",
    "readbackVerifier",
    "hostLocalMutationExecutor",
    "deploymentIdentityProvider",
  ];
  for (const component of liveAuthorities) {
    const envelope = createValidEnvelope();
    const missing = { ...envelope, adapters: { ...envelope.adapters, [component]: null } };
    const provider = createServerManagedRecoveryBindingProvider({ resolver: () => missing });
    assert.throws(
      () => createProductionRecoveryComposition({ mode: "injected_non_live", serverManagedBindingProvider: provider }),
      (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_ADAPTERS_INVALID"
        && error.details.missing_components.some((item) => item.component === component),
      component,
    );
  }
});

test("recoveryStore must retain the exact injected executionTicketVerifier object", () => {
  const envelope = createValidEnvelope();
  const wrongVerifier = { verify: () => ({ ok: true }) };
  const invalid = { ...envelope, adapters: { ...envelope.adapters, executionTicketVerifier: wrongVerifier } };
  const provider = createServerManagedRecoveryBindingProvider({ resolver: () => invalid });
  assert.throws(
    () => createProductionRecoveryComposition({ mode: "injected_non_live", serverManagedBindingProvider: provider }),
    (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_ADAPTERS_INVALID"
      && error.details.missing_components.some((item) => item.component === "recoveryStore.executionTicketVerifier"),
  );
});

test("caller/GPT/local connector inputs and credential-shaped fields are rejected", () => {
  const valid = createValidEnvelope();
  assert.throws(() => createServerManagedRecoveryBindingProvider({ resolver: () => ({ binding_source: "caller", secrets_included: false, adapters: valid.adapters }) })({}), (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_SOURCE_INVALID");
  assert.throws(() => createServerManagedRecoveryBindingProvider({ resolver: () => ({ ...valid, password: "must-not-appear" }) })({}), (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_SECRET_FIELD_FORBIDDEN");
  assert.throws(() => createServerManagedRecoveryBindingProvider({ resolver: () => ({ ...valid, local_connector: {} }) })({}), (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_CALLER_INPUT_FORBIDDEN");
  assert.throws(() => createServerManagedRecoveryBindingProvider({ resolver: () => ({ ...valid, raw_sql: "SELECT 1" }) })({}), (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_CALLER_INPUT_FORBIDDEN");
});

test("test or dummy adapter origins are rejected before binding", () => {
  const { adapters } = createTestAdapters();
  assert.throws(
    () => createServerManagedRecoveryAuthorityBinding({ adapters, adapterOrigin: "test_double", capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true } }),
    (error) => error.code === "RECOVERY_SERVER_MANAGED_CONCRETE_ORIGIN_INVALID",
  );
  assert.throws(
    () => createServerManagedRecoveryAuthorityBinding({ adapters, adapterOrigin: "mock", capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true } }),
    (error) => error.code === "RECOVERY_SERVER_MANAGED_CONCRETE_ORIGIN_INVALID",
  );
});

test("unresolved deployment identity cannot satisfy the authority binding", () => {
  const { adapters } = createTestAdapters();
  adapters.deploymentIdentityProvider = null;
  assert.throws(
    () => createServerManagedRecoveryAuthorityBinding({ adapters, capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true } }),
    (error) => error.code === "RECOVERY_COMPOSITION_INCOMPLETE",
  );
});

test("server-derived deployment identity ignores caller expected_sha and rejects scope or integrity drift", async () => {
  let receivedArguments = null;
  const provider = createServerManagedDeploymentIdentityProvider({
    readServerAttestation: (...args) => { receivedArguments = args; return validAttestation(); },
  });
  const attestation = await provider.readAttestation({ expected_sha: "f".repeat(40), target_key: "caller-controlled" });
  assert.deepEqual(receivedArguments, []);
  assert.equal(attestation.repository, RECOVERY_REPOSITORY);
  assert.equal(attestation.branch, RECOVERY_BRANCH);
  assert.equal(attestation.deployment_sha, "a".repeat(40));
  const mismatch = validateDeploymentIdentityAttestation({
    attestation,
    expectedSha: "d".repeat(40),
    expectedRepository: RECOVERY_REPOSITORY,
    expectedBranch: RECOVERY_BRANCH,
    expectedManifestHash: "b".repeat(64),
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.problems.includes("deployment_sha_mismatch"));
  await assert.rejects(
    () => createServerManagedDeploymentIdentityProvider({ readServerAttestation: () => validAttestation().constructor === Object ? { ...validAttestation(), branch: "main" } : null }).readAttestation(),
    (error) => error.code === "RECOVERY_SERVER_DEPLOYMENT_IDENTITY_SCOPE_MISMATCH",
  );
});

test("production_live remains explicitly hard-denied", () => {
  assert.throws(() => createProductionRecoveryComposition({ mode: "production_live", serverManagedBindingProvider: () => createValidEnvelope() }), (error) => error.code === "RECOVERY_PRODUCTION_LIVE_DISABLED");
});

test("readiness construction performs no adapter, provider, database, or mutation calls", () => {
  const { adapters, calls } = createTestAdapters();
  const envelope = createServerManagedRecoveryBindingEnvelope({
    binding: createServerManagedRecoveryAuthorityBinding({
      adapters,
      capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true },
    }),
  });
  assert.equal(calls.length, 0);
  assert.equal(envelope.provider_accessed, false);
  assert.equal(envelope.database_connection_performed, false);
  assert.equal(envelope.database_mutation_performed, false);
});
