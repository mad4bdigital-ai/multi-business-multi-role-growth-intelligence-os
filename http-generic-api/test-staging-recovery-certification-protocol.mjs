import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { expectedStagingGatewayDeployment, expectedStagingRegistration, recoveryExternalEvidenceHash,
  verifyRecoveryExternalEvidenceIntegrity, RECOVERY_EXTERNAL_EVIDENCE_CONTRACT } from "./recoveryReadinessEvidence.js";
import { _testingStagingRecoveryAuthorityBinding } from "./stagingRecoveryAuthorityBinding.js";
import {
  STAGING_RECOVERY_REQUIRED_NEGATIVE_TESTS,
  buildRecoveryReadinessSigningPayload,
  independentlyVerifyStagingRecoveryCanaryEvidence,
  produceGenuineStagingRecoveryCanaryEvidence,
  runGenuineStagingRecoveryCanary,
} from "./stagingRecoveryCertificationProtocol.js";

const SHA = "a".repeat(40); const TARGET = "b".repeat(64); const H = "c".repeat(64); const IMAGE = "sha256:" + "d".repeat(64);
function artifacts() {
  const step = { step_id: "step:" + "1".repeat(32), step_hash: "2".repeat(64), operation: "staging.certification.canary" };
  const plan = { contract: "mad4b.recovery-remediation-plan.v1", plan_id: "plan:" + "3".repeat(32), plan_hash: "4".repeat(64), steps: [step] };
  const approval = { contract: "mad4b.recovery-approval-challenge.v1", approval_id: "approval:" + "5".repeat(32), challenge_hash: "6".repeat(64), plan_hash: plan.plan_hash, step_id: step.step_id, step_hash: step.step_hash };
  const ticket = { ticket_id: "ticket:" + "7".repeat(32), ticket_hash: "8".repeat(64), approval_hash: "6".repeat(64), approval_version: "v1", plan_hash: plan.plan_hash, step_id: step.step_id, step_hash: step.step_hash, approval_id: approval.approval_id };
  const run = { run_id: "run:" + "9".repeat(32), plan_hash: plan.plan_hash, step_id: step.step_id, phase: "recovered", status: "recovered", events: ["created", "planned", "awaiting_approval", "approval_granted", "locked", "executing", "provider_acknowledged", "readback_pending", "verifying", "verified", "recovered"].map((phase, i) => ({ phase, evidence_hash: String((i % 9) + 1).repeat(64) })) };
  const receipt = { contract: "mad4b.recovery-remediation-execution-receipt.v1", plan_hash: plan.plan_hash, step_id: step.step_id, execution_ticket_id: ticket.ticket_id, run_id: run.run_id, phase: "recovered", status: "recovered", mutation_attestation: { database_mutation_performed: false, provider_mutation_performed: false, deployment_performed: false }, secrets_included: false };
  return { plan, approval, ticket, receipt, run };
}
function negativeEvidence(exactSha = SHA, status = "pass") {
  return {
    contract: "mad4b.staging-recovery-negative-test-evidence.v1",
    all_passed: status === "pass",
    exact_sha: exactSha,
    generated_at: new Date().toISOString(),
    cases: Object.fromEntries(STAGING_RECOVERY_REQUIRED_NEGATIVE_TESTS.map((key) => [key, { status, suite: "exact-sha-test", evidence_hash: H }])),
    secrets_included: false,
  };
}
function seal(kind, payload, targetFingerprint = TARGET) {
  const source = { registration: "chatgpt_live_readback", oauth: "oauth_server_correlation",
    network: "independent_network_probe" }[kind];
  const evidence_kind = { registration: "chatgpt_registration", oauth: "oauth_browser_round_trip",
    network: "origin_network_isolation" }[kind];
  const base = { ...payload, contract: RECOVERY_EXTERNAL_EVIDENCE_CONTRACT, evidence_kind,
    source_provenance: { source, observation_id: `test-${kind}-observation` }, deployment_sha: SHA,
    target_fingerprint: targetFingerprint, observed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(), secrets_included: false };
  return { ...base, evidence_hash: recoveryExternalEvidenceHash(base) };
}
async function input(targetFingerprint = TARGET) {
  const registration = await expectedStagingRegistration(); const gateway = await expectedStagingGatewayDeployment();
  const bound = { deployment_sha: SHA, target_fingerprint: targetFingerprint, evidence_hash: H, expires_at: new Date(Date.now() + 60_000).toISOString() };
  return { deploymentAttestation: { environment: "staging", sha: SHA, target_fingerprint: targetFingerprint, attestation_hash: H }, targetIdentity: { environment: "staging", target_fingerprint: targetFingerprint }, ...artifacts(), registrationEvidence: seal("registration", { ...registration, observed_in: "chatgpt" }, targetFingerprint), oauthEvidence: seal("oauth", { issuer: "https://dev.mad4b.com", resource: "https://activation-dev.mad4b.com", steps: Object.fromEntries(["authorize", "login_consent", "code", "callback", "token", "resource"].map((v) => [v, "pass"])) }, targetFingerprint), networkEvidence: seal("network", { environment: "staging", gateway_host: gateway.gateway_host, upstream_origin: gateway.upstream_origin, gateway_only: true, signed_ingress_required: true, network_restriction_verified: true, direct_recovery_surface_bypass_denied: true, request_method: "GET", request_body_sha256: createHash("sha256").update("").digest("hex"), direct_recovery_surface_status: 403, direct_recovery_surface_reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED", direct_recovery_surface_path: "/admin/recovery/staging/contract", signed_gateway_recovery_path: "/admin/recovery/staging/contract", signed_gateway_recovery_method: "GET", signed_gateway_recovery_body_sha256: createHash("sha256").update("").digest("hex"), signed_gateway_recovery_status: 200, public_health_status: 200 }, targetFingerprint), workerDeploymentEvidence: { ...bound, observed_in: "cloudflare_workers", deployment_verified: true, gateway_host: gateway.gateway_host, policy_hash: gateway.policy_hash, worker_build_sha: SHA, policy_source_sha: SHA, worker_bundle_sha256: H, release_bundle_sha256: H, deployed_bundle_sha256: H }, ingressBuildIdentity: { deployment_sha: SHA, worker_build_sha: SHA, worker_bundle_sha256: H, policy_hash: gateway.policy_hash, gateway_host: gateway.gateway_host, expires_at: Math.floor(Date.now() / 1000) + 60 }, artifactIntegrity: { valid: true, manifest_sha256: H, app_image_digest: IMAGE }, nonce: "nonce:protocol-test", certificationRunId: "cert-run:protocol-test" };
}

test("runner rejects self-asserted provenance before creating Kernel state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-genuine-runner-"));
  try {
    const env = { NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker", REMOTE_MCP_ENVIRONMENT: "staging", RECOVERY_STAGING_READINESS_DIRECTORY: path.join(root, "readiness"), RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: path.join(root, "replay"), DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", branch: "main", commit_sha: SHA, tree_sha: "d".repeat(40), context_file_set_sha256: "e".repeat(64), build_source: "test", secrets_included: false }) };
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const adapters = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;
    const attestation = await adapters.deploymentIdentityProvider.readAttestation(); const source = await input(attestation.target_fingerprint);
    const forgedRegistration = { ...source.registrationEvidence, source_authenticity_verified: true };
    forgedRegistration.evidence_hash = recoveryExternalEvidenceHash(forgedRegistration);
    for (const externalEvidence of [
      { registrationEvidence: source.registrationEvidence, oauthEvidence: source.oauthEvidence, networkEvidence: source.networkEvidence },
      { registrationEvidence: forgedRegistration, oauthEvidence: source.oauthEvidence, networkEvidence: source.networkEvidence },
    ]) {
      await assert.rejects(() => runGenuineStagingRecoveryCanary({ expectedSha: SHA, externalEvidence, artifactIntegrity: source.artifactIntegrity }, { env, adapters }),
        (error) => error.code === "RECOVERY_CANARY_SOURCE_AUTHENTICITY_UNAVAILABLE");
    }
    assert.deepEqual(await readdir(roots.readiness), ["identity"], "only the read-only deployment identity may be observed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("genuine producer derives lifecycle and server identity bindings only from complete Kernel artifacts", async () => {
  const source = await input(); const envelope = produceGenuineStagingRecoveryCanaryEvidence(source);
  assert.equal(envelope.kernel.run_id, source.run.run_id); assert.equal(envelope.kernel.lifecycle_phases.at(-1), "recovered"); assert.equal(envelope.server_identity_fingerprint, H);
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, run: { ...source.run, events: source.run.events.slice(0, -1) } }), (e) => e.code === "RECOVERY_CANARY_LIFECYCLE_INVALID");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, deploymentAttestation: { ...source.deploymentAttestation, attestation_hash: null } }), (e) => e.code === "RECOVERY_CANARY_TARGET_BINDING_INVALID");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, receipt: { ...source.receipt, mutation_attestation: { ...source.receipt.mutation_attestation, database_mutation_performed: true } } }), (e) => e.code === "RECOVERY_CANARY_SAFETY_BOUNDARY_INVALID");
});

test("artifact integrity requires exact Staging app image digest", async () => {
  const source = await input();
  assert.throws(
    () => produceGenuineStagingRecoveryCanaryEvidence({
      ...source,
      artifactIntegrity: { valid: true, manifest_sha256: H },
    }),
    (error) => error.code === "RECOVERY_CANARY_ARTIFACT_INTEGRITY_INVALID",
  );
  assert.throws(
    () => produceGenuineStagingRecoveryCanaryEvidence({
      ...source,
      artifactIntegrity: { valid: true, manifest_sha256: H, app_image_digest: "sha256:not-a-digest" },
    }),
    (error) => error.code === "RECOVERY_CANARY_ARTIFACT_INTEGRITY_INVALID",
  );
});

test("external evidence integrity rejects mutations, fabricated hashes, stale or secret-bearing observations", async () => {
  const source = await input();
  const valid = source.registrationEvidence;
  const check = (e, kind = "registration", target = TARGET) => verifyRecoveryExternalEvidenceIntegrity(e,
    { kind, expectedSha: SHA, expectedTargetFingerprint: target });
  assert.equal(check(valid), true);
  assert.equal(check({ ...valid, operation_count: 999 }), false);
  assert.equal(check({ ...valid, evidence_hash: "f".repeat(64) }), false);
  assert.equal(check(valid, "registration", "d".repeat(64)), false);
  assert.equal(verifyRecoveryExternalEvidenceIntegrity(valid, { kind: "registration", expectedSha: "d".repeat(40), expectedTargetFingerprint: TARGET }), false);
  for (const altered of [
    { contract: "wrong" }, { evidence_kind: "oauth_browser_round_trip" },
    { source_provenance: { source: "caller_flags", observation_id: "fake-observation" } },
    { expires_at: new Date(Date.now() - 1).toISOString() },
    { access_token: "never-persist-token" }, { nested: { client_secret: "no" } },
    { nested: { clientSecret: "no" } },
    { secrets_included: true },
  ]) {
    const candidate = { ...valid, ...altered };
    candidate.evidence_hash = recoveryExternalEvidenceHash(candidate);
    assert.equal(check(candidate), false, JSON.stringify(altered));
  }
  const metadata = { ...valid, authorization_endpoint: "https://dev.mad4b.com/authorize" };
  metadata.evidence_hash = recoveryExternalEvidenceHash(metadata);
  assert.equal(check(metadata), true, "public OAuth metadata is not a secret");
  const network = source.networkEvidence;
  assert.equal(check(network, "network"), true, "public /health remains allowed");
  const directDev = { ...network, direct_recovery_surface_status: 404,
    direct_recovery_surface_reason: "RECOVERY_STAGING_HOST_UNAVAILABLE" };
  directDev.evidence_hash = recoveryExternalEvidenceHash(directDev);
  assert.equal(check(directDev, "network"), true, "actual direct dev host rejection is host-isolation evidence when signed same-path succeeds");
  for (const altered of [{ direct_recovery_surface_bypass_denied: false }, { direct_recovery_surface_status: 200 },
    { direct_recovery_surface_status: 404 }, { direct_recovery_surface_reason: "unknown_route" },
    { signed_gateway_recovery_status: 403 }, { direct_recovery_surface_path: "/health" },
    { signed_gateway_recovery_path: "/admin/recovery/staging/readiness" },
    { signed_gateway_recovery_method: "POST" }, { signed_gateway_recovery_body_sha256: H }]) {
    const candidate = { ...network, ...altered };
    candidate.evidence_hash = recoveryExternalEvidenceHash(candidate);
    assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, networkEvidence: candidate }),
      (error) => error.code === "RECOVERY_CANARY_EXTERNAL_INTEGRITY_INVALID");
  }
});

test("invalid external evidence stops the canary before Kernel state is touched", async () => {
  const source = await input();
  let kernelCalls = 0;
  const blocked = new Proxy({}, { get() { kernelCalls += 1; throw new Error("Kernel must not run"); } });
  const adapters = Object.fromEntries([
    "recoveryStore", "approvalIssuer", "approvalVerifier", "approvalStore",
    "executionTicketSigner", "recoveryLock", "mutationExecutor", "readbackVerifier",
  ].map((key) => [key, blocked]));
  adapters.deploymentIdentityProvider = { readAttestation: async () => ({ sha: SHA, target_fingerprint: TARGET }) };
  const badNetwork = { ...source.networkEvidence, direct_recovery_surface_status: 200 };
  badNetwork.evidence_hash = recoveryExternalEvidenceHash(badNetwork);
  await assert.rejects(() => runGenuineStagingRecoveryCanary({ expectedSha: SHA,
    externalEvidence: { registrationEvidence: source.registrationEvidence, oauthEvidence: source.oauthEvidence,
      networkEvidence: badNetwork } }, { adapters }),
  (error) => error.code === "RECOVERY_CANARY_EXTERNAL_INTEGRITY_INVALID");
  assert.equal(kernelCalls, 0);
});

test("independent verifier and signing payload refuse forged source authenticity", async () => {
  const source = await input(); const envelope = produceGenuineStagingRecoveryCanaryEvidence(source);
  await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { expectedSha: SHA, expectedTargetFingerprint: TARGET, workflowSourceSha: SHA, negativeTestEvidence: negativeEvidence(), loadKernelArtifacts: async () => source }), (e) => e.code === "RECOVERY_CANARY_SOURCE_AUTHENTICITY_UNAVAILABLE");
  assert.throws(() => buildRecoveryReadinessSigningPayload(envelope, { verified: true, evidence_envelope_sha256: envelope.evidence_envelope_sha256, lifecycle_trace: { source: "recovery_kernel" }, negative_tests: { all_passed: true } }, { issuer: "mad4b://staging-recovery-certification", keyId: "recovery-certification-test" }), (e) => e.code === "RECOVERY_CANARY_SOURCE_AUTHENTICITY_UNAVAILABLE");
  await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { expectedSha: SHA, expectedTargetFingerprint: TARGET, workflowSourceSha: SHA, negativeTestEvidence: negativeEvidence(), loadKernelArtifacts: async () => ({ ...source, ticket: { ...source.ticket, ticket_hash: "f".repeat(64) } }) }), (e) => e.code === "RECOVERY_CANARY_KERNEL_BINDING_MISMATCH");
});

test("independent countersign revalidates fresh Worker and Gateway identity", async () => {
  const source = await input();

  const envelope = produceGenuineStagingRecoveryCanaryEvidence(source);

  const liveWorkerProviderObservation = {
    contract: "mad4b.staging.worker-provider-observation.v1",
    environment: "staging",
    provider: "cloudflare_workers",
    observed_in: source.workerDeploymentEvidence.observed_in,
    deployment_verified: source.workerDeploymentEvidence.deployment_verified,
    deployment_sha: source.workerDeploymentEvidence.deployment_sha,
    gateway_host: source.workerDeploymentEvidence.gateway_host,
    policy_hash: source.workerDeploymentEvidence.policy_hash,
    worker_build_sha: source.workerDeploymentEvidence.worker_build_sha,
    policy_source_sha: source.workerDeploymentEvidence.policy_source_sha,
    worker_bundle_sha256: source.workerDeploymentEvidence.worker_bundle_sha256,
    release_bundle_sha256: source.workerDeploymentEvidence.release_bundle_sha256,
    deployed_bundle_sha256: source.workerDeploymentEvidence.deployed_bundle_sha256,
    observed_at: new Date().toISOString(),
    secrets_included: false,
  };

  const liveIngressBuildIdentity = {
    ...source.ingressBuildIdentity,
    expires_at: Math.floor(Date.now() / 1000) + 30,
  };

  await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, {
    expectedSha: SHA, expectedTargetFingerprint: TARGET, workflowSourceSha: SHA,
    negativeTestEvidence: negativeEvidence(), liveWorkerProviderObservation,
    liveIngressBuildIdentity, requireLiveRuntimeRevalidation: true,
    loadKernelArtifacts: async () => source,
  }), (error) => error.code === "RECOVERY_CANARY_SOURCE_AUTHENTICITY_UNAVAILABLE");

  await assert.rejects(
    () => independentlyVerifyStagingRecoveryCanaryEvidence(
      envelope,
      {
        expectedSha: SHA,
        expectedTargetFingerprint: TARGET,
        workflowSourceSha: SHA,
        negativeTestEvidence: negativeEvidence(),
        liveWorkerProviderObservation: {
          ...liveWorkerProviderObservation,
          deployed_bundle_sha256: "f".repeat(64),
        },
        liveIngressBuildIdentity,
        requireLiveRuntimeRevalidation: true,
        loadKernelArtifacts: async () => source,
      },
    ),
    (error) =>
      error.code === "RECOVERY_CANARY_LIVE_WORKER_PROVENANCE_MISMATCH",
  );

  await assert.rejects(
    () => independentlyVerifyStagingRecoveryCanaryEvidence(
      envelope,
      {
        expectedSha: SHA,
        expectedTargetFingerprint: TARGET,
        workflowSourceSha: SHA,
        negativeTestEvidence: negativeEvidence(),
        liveWorkerProviderObservation,
        liveIngressBuildIdentity: {
          ...liveIngressBuildIdentity,
          worker_bundle_sha256: "f".repeat(64),
        },
        requireLiveRuntimeRevalidation: true,
        loadKernelArtifacts: async () => source,
      },
    ),
    (error) =>
      error.code === "RECOVERY_CANARY_LIVE_INGRESS_BUILD_MISMATCH",
  );
});

test("independent verifier rejects absent, failing, or cross-SHA negative evidence", async () => {
  const source = await input(); const envelope = produceGenuineStagingRecoveryCanaryEvidence(source);
  await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { expectedSha: SHA, expectedTargetFingerprint: TARGET, workflowSourceSha: SHA, loadKernelArtifacts: async () => source }), (e) => e.code === "RECOVERY_CANARY_NEGATIVE_TEST_EVIDENCE_REQUIRED");
  await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { expectedSha: SHA, expectedTargetFingerprint: TARGET, workflowSourceSha: SHA, negativeTestEvidence: negativeEvidence(SHA, "fail"), loadKernelArtifacts: async () => source }), (e) => e.code === "RECOVERY_CANARY_NEGATIVE_TEST_FAILED");
  await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { expectedSha: SHA, expectedTargetFingerprint: TARGET, workflowSourceSha: SHA, negativeTestEvidence: negativeEvidence("f".repeat(40)), loadKernelArtifacts: async () => source }), (e) => e.code === "RECOVERY_CANARY_NEGATIVE_TEST_SHA_MISMATCH");
});

test("protocol rejects stale SHA, wrong target, expiry, Production and secret-bearing evidence", async () => {
  const source = await input(); const envelope = produceGenuineStagingRecoveryCanaryEvidence(source);
  for (const options of [{ expectedSha: "f".repeat(40), expectedTargetFingerprint: TARGET }, { expectedSha: SHA, expectedTargetFingerprint: "e".repeat(64) }]) await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { ...options, workflowSourceSha: SHA, negativeTestEvidence: negativeEvidence(), loadKernelArtifacts: async () => source }), (e) => e.code === "RECOVERY_CANARY_EXACT_TARGET_MISMATCH");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, targetIdentity: { environment: "production", target_fingerprint: TARGET } }), (e) => e.code === "RECOVERY_CANARY_TARGET_BINDING_INVALID");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, expiresAt: new Date(Date.now() - 1000).toISOString() }), (e) => e.code === "RECOVERY_CANARY_EVIDENCE_EXPIRED");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, artifactIntegrity: { ...source.artifactIntegrity, client_secret: "forbidden" } }), (e) => e.code === "RECOVERY_CANARY_SECRET_FIELD_FORBIDDEN");
});
