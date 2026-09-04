import assert from "node:assert/strict";
import test from "node:test";
import { expectedStagingGatewayDeployment, expectedStagingRegistration } from "./recoveryReadinessEvidence.js";
import {
  buildRecoveryReadinessSigningPayload,
  independentlyVerifyStagingRecoveryCanaryEvidence,
  produceGenuineStagingRecoveryCanaryEvidence,
} from "./stagingRecoveryCertificationProtocol.js";

const SHA = "a".repeat(40); const TARGET = "b".repeat(64); const H = "c".repeat(64);
function artifacts() {
  const step = { step_id: "step:" + "1".repeat(32), step_hash: "2".repeat(64), operation: "staging.certification.canary" };
  const plan = { contract: "mad4b.recovery-remediation-plan.v1", plan_id: "plan:" + "3".repeat(32), plan_hash: "4".repeat(64), steps: [step] };
  const approval = { contract: "mad4b.recovery-approval-challenge.v1", approval_id: "approval:" + "5".repeat(32), approval_hash: "6".repeat(64), approval_version: 1, plan_hash: plan.plan_hash, step_id: step.step_id, step_hash: step.step_hash };
  const ticket = { ticket_id: "ticket:" + "7".repeat(32), ticket_hash: "8".repeat(64), plan_hash: plan.plan_hash, step_id: step.step_id, step_hash: step.step_hash, approval_id: approval.approval_id };
  const run = { run_id: "run:" + "9".repeat(32), plan_hash: plan.plan_hash, step_id: step.step_id, phase: "recovered", status: "recovered", events: ["created", "planned", "awaiting_approval", "approval_granted", "locked", "executing", "provider_acknowledged", "readback_pending", "verifying", "verified", "recovered"].map((phase, i) => ({ phase, evidence_hash: String((i % 9) + 1).repeat(64) })) };
  const receipt = { contract: "mad4b.recovery-remediation-execution-receipt.v1", plan_hash: plan.plan_hash, step_id: step.step_id, ticket_id: ticket.ticket_id, run_id: run.run_id, phase: "recovered", status: "recovered", database_mutation_performed: false, provider_mutation_performed: false, production_mutation_performed: false, secrets_included: false };
  return { plan, approval, ticket, receipt, run };
}
async function input() {
  const registration = await expectedStagingRegistration(); const gateway = await expectedStagingGatewayDeployment();
  const bound = { deployment_sha: SHA, target_fingerprint: TARGET, evidence_hash: H, expires_at: new Date(Date.now() + 60_000).toISOString() };
  return { deploymentAttestation: { environment: "staging", sha: SHA, target_fingerprint: TARGET }, targetIdentity: { environment: "staging", target_fingerprint: TARGET }, ...artifacts(), registrationEvidence: { ...bound, ...registration, observed_in: "chatgpt" }, oauthEvidence: { ...bound, issuer: "https://dev.mad4b.com", resource: "https://activation-dev.mad4b.com", steps: Object.fromEntries(["authorize", "login_consent", "code", "callback", "token", "resource"].map((v) => [v, "pass"])) }, networkEvidence: { ...bound, environment: "staging", gateway_host: gateway.gateway_host, upstream_origin: gateway.upstream_origin, gateway_only: true, signed_ingress_required: true, network_restriction_verified: true, direct_origin_publicly_reachable: false }, workerDeploymentEvidence: { ...bound, observed_in: "cloudflare_workers", deployment_verified: true, gateway_host: gateway.gateway_host, policy_hash: gateway.policy_hash, worker_build_sha: SHA, policy_source_sha: SHA, worker_bundle_sha256: H, release_bundle_sha256: H, deployed_bundle_sha256: H }, ingressBuildIdentity: { deployment_sha: SHA, worker_build_sha: SHA, worker_bundle_sha256: H, policy_hash: gateway.policy_hash, gateway_host: gateway.gateway_host, expires_at: Math.floor(Date.now() / 1000) + 60 }, artifactIntegrity: { valid: true, manifest_sha256: H }, nonce: "nonce:protocol-test", certificationRunId: "cert-run:protocol-test" };
}

test("genuine producer derives lifecycle bindings only from complete Kernel artifacts", async () => {
  const source = await input(); const envelope = produceGenuineStagingRecoveryCanaryEvidence(source);
  assert.equal(envelope.kernel.run_id, source.run.run_id); assert.equal(envelope.kernel.lifecycle_phases.at(-1), "recovered");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, run: { ...source.run, events: source.run.events.slice(0, -1) } }), (e) => e.code === "RECOVERY_CANARY_LIFECYCLE_INVALID");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, receipt: { ...source.receipt, database_mutation_performed: true } }), (e) => e.code === "RECOVERY_CANARY_SAFETY_BOUNDARY_INVALID");
});

test("independent verifier recomputes Kernel bindings and rejects altered artifacts", async () => {
  const source = await input(); const envelope = produceGenuineStagingRecoveryCanaryEvidence(source);
  const report = await independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { expectedSha: SHA, expectedTargetFingerprint: TARGET, workflowSourceSha: SHA, loadKernelArtifacts: async () => source });
  assert.equal(report.verified, true);
  const payload = buildRecoveryReadinessSigningPayload(envelope, report, { issuer: "mad4b://staging-recovery-certification", keyId: "recovery-certification-test" });
  assert.equal(payload.stagingCertification.lifecycle_trace.source, "recovery_kernel"); assert.equal(payload.production_live_enabled, false);
  await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { expectedSha: SHA, expectedTargetFingerprint: TARGET, workflowSourceSha: SHA, loadKernelArtifacts: async () => ({ ...source, ticket: { ...source.ticket, ticket_hash: "f".repeat(64) } }) }), (e) => e.code === "RECOVERY_CANARY_KERNEL_BINDING_MISMATCH");
});

test("protocol rejects stale SHA, wrong target, expiry, Production and secret-bearing evidence", async () => {
  const source = await input(); const envelope = produceGenuineStagingRecoveryCanaryEvidence(source);
  for (const options of [{ expectedSha: "f".repeat(40), expectedTargetFingerprint: TARGET }, { expectedSha: SHA, expectedTargetFingerprint: "e".repeat(64) }]) await assert.rejects(() => independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { ...options, workflowSourceSha: SHA, loadKernelArtifacts: async () => source }), (e) => e.code === "RECOVERY_CANARY_EXACT_TARGET_MISMATCH");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, targetIdentity: { environment: "production", target_fingerprint: TARGET } }), (e) => e.code === "RECOVERY_CANARY_TARGET_BINDING_INVALID");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, expiresAt: new Date(Date.now() - 1000).toISOString() }), (e) => e.code === "RECOVERY_CANARY_EVIDENCE_EXPIRED");
  assert.throws(() => produceGenuineStagingRecoveryCanaryEvidence({ ...source, artifactIntegrity: { ...source.artifactIntegrity, client_secret: "forbidden" } }), (e) => e.code === "RECOVERY_CANARY_SECRET_FIELD_FORBIDDEN");
});
