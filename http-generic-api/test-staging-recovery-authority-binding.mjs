import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
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

function stagingEnv(root) {
  return {
    NODE_ENV: "staging",
    DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    REMOTE_MCP_ENVIRONMENT: "staging",
    RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live",
    RECOVERY_SERVER_MANAGED_BINDING_MODULE: "./stagingRecoveryAuthorityBinding.js",
    RECOVERY_STAGING_READINESS_DIRECTORY: path.join(root, "recovery-readiness"),
    RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: path.join(root, "recovery-ingress"),
    DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "main",
      commit_sha: SHA,
      tree_sha: TREE,
      context_file_set_sha256: CONTEXT,
      build_source: "portable_staging_docker_build",
      secrets_included: false,
    }),
  };
}

test("Phase A binds a complete durable Staging Recovery graph and remains certification-blocked", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-authority-"));
  try {
    const env = stagingEnv(root);
    const envelope = _testingStagingRecoveryAuthorityBinding.createServerManagedRecoveryBindingForEnv({
      environment: "staging",
      requested_mode: "injected_non_live",
      production_live: false,
    }, env);
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
    assert.equal(envelope.adapters.readbackVerifier.independent_authority, true);
    assert.equal(envelope.adapters.readbackVerifier.role_aware, true);
    assert.equal(envelope.adapters.readbackVerifier.mutation_authority, false);

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

    const authority = _testingStagingRecoveryAuthorityBinding.createRecoveryReadinessAuthoritiesForEnv({
      environment: "staging",
      runtime_class: "local_windows_docker",
      read_only: true,
      production_live: false,
    }, env);
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

    const directories = _testingStagingRecoveryAuthorityBinding.roots(env);
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
    await rm(root, { recursive: true, force: true });
  }
});

test("deployment-owned Staging binding fails closed for Production, unknown and mixed runtimes", () => {
  const root = path.join(os.tmpdir(), "staging-recovery-authority-negative");
  const base = stagingEnv(root);
  for (const env of [
    { ...base, NODE_ENV: "production", DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy", REMOTE_MCP_ENVIRONMENT: "production" },
    { ...base, NODE_ENV: "garbage", DEPLOYMENT_ENVIRONMENT: "garbage", REMOTE_MCP_ENVIRONMENT: "garbage" },
    { ...base, NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker", REMOTE_MCP_ENVIRONMENT: "production" },
  ]) {
    assert.throws(
      () => _testingStagingRecoveryAuthorityBinding.createServerManagedRecoveryBindingForEnv({ requested_mode: "injected_non_live" }, env),
      (error) => error.code === "RECOVERY_STAGING_AUTHORITY_RUNTIME_DENIED",
    );
  }
});

test("Phase A rejects relative evidence roots before path resolution", () => {
  const root = path.join(os.tmpdir(), "staging-recovery-relative-root");
  const env = stagingEnv(root);
  assert.throws(
    () => _testingStagingRecoveryAuthorityBinding.roots({ ...env, RECOVERY_STAGING_READINESS_DIRECTORY: "relative/recovery-readiness" }),
    (error) => error.code === "RECOVERY_STAGING_EVIDENCE_REPLAY_NOT_ISOLATED",
  );
  assert.throws(
    () => _testingStagingRecoveryAuthorityBinding.roots({ ...env, RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: "relative/recovery-ingress" }),
    (error) => error.code === "RECOVERY_STAGING_EVIDENCE_REPLAY_NOT_ISOLATED",
  );
});

test("Phase A readback proves exact canary identity and exact fencing token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-fence-readback-"));
  try {
    const env = stagingEnv(root);
    const directories = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(directories.readiness, env).adapters;
    const identity = { plan_hash: "plan-hash-a", step_id: "step:a", idempotency_key: "idem:a", operation: "staging_certification_canary" };
    const fence = "fence:exact:a";
    const result = await graph.mutationExecutor.execute({ ...identity, fencing_token: fence });
    assert.match(result.canary_id, /^[a-f0-9]{64}$/u);

    const verified = await graph.readbackVerifier.verify({
      plan: { plan_hash: identity.plan_hash },
      step: { step_id: identity.step_id, operation: identity.operation },
      run: { idempotency_key: identity.idempotency_key },
      fencing_token: fence,
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.verified, true);
    assert.equal(verified.same_fence, true);

    const wrongFence = await graph.readbackVerifier.verify({
      plan: { plan_hash: identity.plan_hash },
      step: { step_id: identity.step_id, operation: identity.operation },
      run: { idempotency_key: identity.idempotency_key },
      fencing_token: "fence:wrong",
    });
    assert.equal(wrongFence.ok, false);
    assert.equal(wrongFence.same_fence, false);

    const wrongIdentity = await graph.readbackVerifier.verify({
      plan: { plan_hash: identity.plan_hash },
      step: { step_id: "step:other", operation: identity.operation },
      run: { idempotency_key: identity.idempotency_key },
      fencing_token: fence,
    });
    assert.equal(wrongIdentity.ok, false);

    await assert.rejects(
      graph.mutationExecutor.execute({ ...identity, fencing_token: fence }),
      (error) => error.code === "RECOVERY_STAGING_CANARY_REPLAY_DENIED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase A approval reservation is single-owner across idempotency races", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-approval-race-"));
  try {
    const env = stagingEnv(root);
    const directories = _testingStagingRecoveryAuthorityBinding.roots(env);
    const store = _testingStagingRecoveryAuthorityBinding.adapters(directories.readiness, env).adapters.recoveryStore;
    const approval = { approval_id: "approval:phase-a-race", plan_id: "plan:phase-a-race", plan_hash: "plan-hash-race", step_id: "step:phase-a-race", used: false };
    await store.putApproval(approval);
    const contexts = ["idem:a", "idem:b", "idem:c", "idem:d"].map((idempotency_key) => ({ approval_id: approval.approval_id, plan_hash: approval.plan_hash, step_id: approval.step_id, idempotency_key }));
    const results = await Promise.all(contexts.map((context) => store.reserveApproval(context)));
    assert.equal(results.filter((result) => result.reserved === true).length, 1);
    const winner = contexts[results.findIndex((result) => result.reserved === true)];
    assert.ok(winner);
    assert.equal((await store.markApprovalUsed(approval.approval_id)).finalized, true);
    assert.equal((await store.reserveApproval({ ...winner, idempotency_key: "idem:after-used" })).reserved, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase A execution ticket reservation and finalization are immutable under races", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-ticket-race-"));
  try {
    const env = stagingEnv(root);
    const directories = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(directories.readiness, env).adapters;
    const store = graph.recoveryStore;
    const ticket = { ticket_id: "ticket:phase-a-race", ticket_hash: "d".repeat(64), plan_hash: "plan-hash-ticket", step_id: "step:ticket" };
    await store.putExecutionTicket(ticket);
    const contexts = ["idem:a", "idem:b", "idem:c", "idem:d"].map((idempotency_key) => ({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, plan_hash: ticket.plan_hash, step_id: ticket.step_id, idempotency_key }));
    const results = await Promise.all(contexts.map((context) => store.reserveExecutionTicket(context)));
    assert.equal(results.filter((result) => result.reserved === true).length, 1);
    const winner = contexts[results.findIndex((result) => result.reserved === true)];
    assert.equal((await store.finalizeExecutionTicket({ ...winner, provider_acknowledged: true, outcome: "verified" })).finalized, true);
    assert.equal((await store.reserveExecutionTicket({ ...winner, idempotency_key: "idem:replay" })).reserved, false);
    assert.equal((await store.releaseExecutionTicket(winner)).finalized, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase A expired-lock takeover elects at most one new fence and expired owners cannot heartbeat", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-lock-race-"));
  try {
    const env = stagingEnv(root);
    const directories = _testingStagingRecoveryAuthorityBinding.roots(env);
    const recoveryLock = _testingStagingRecoveryAuthorityBinding.adapters(directories.readiness, env).adapters.recoveryLock;
    const initial = await recoveryLock.acquire({ target_key: "target:phase-a-race", plan_hash: "plan-hash-lock", ttl_seconds: 0.01 });
    assert.equal(initial.acquired, true);
    await delay(30);
    const expiredHeartbeat = await recoveryLock.heartbeat({ target_key: "target:phase-a-race", lease_id: initial.lease_id, fencing_token: initial.fencing_token });
    assert.equal(expiredHeartbeat.valid, false);
    const takeoverAttempts = await Promise.all(Array.from({ length: 8 }, () => recoveryLock.acquire({ target_key: "target:phase-a-race", plan_hash: "plan-hash-lock", ttl_seconds: 30 })));
    assert.equal(takeoverAttempts.filter((result) => result.acquired === true).length, 1);
    assert.equal((await recoveryLock.assertFence({ target_key: "target:phase-a-race", lease_id: initial.lease_id, fencing_token: initial.fencing_token })).valid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase A concurrent key initialization always signs and verifies with one Ed25519 authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-key-race-"));
  try {
    const env = stagingEnv(root);
    const directories = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(directories.readiness, env).adapters;
    const ticket_hash = "e".repeat(64);
    const payload = { plan_hash: "plan-hash-key", step_id: "step:key" };
    const signatures = await Promise.all(Array.from({ length: 24 }, () => graph.executionTicketSigner.sign({ payload, ticket_hash })));
    const verified = await Promise.all(signatures.map((signature, index) => graph.executionTicketVerifier.verify({ ticket_hash, ticket: { ...payload, ticket_id: `ticket:key:${index}`, ticket_hash, signature } })));
    assert.equal(verified.every(Boolean), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
