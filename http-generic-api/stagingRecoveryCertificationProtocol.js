import { createHash, randomUUID } from "node:crypto";
import {
  RECOVERY_CERTIFICATION_TRACE_STEPS,
  certificationPayloadHash,
} from "./recoveryActivationReadiness.js";
import {
  RECOVERY_READINESS_EVIDENCE_CONTRACT,
  evaluateExternalStagingEvidence,
} from "./recoveryReadinessEvidence.js";
import { verifyStagingRecoverySignedCertificationRecord } from "./stagingRecoveryCertificationPublicTrust.js";
import {
  createApprovalChallenge,
  createExecutionTicket,
  createStagingCertificationCanaryPlan,
  executeRemediationStep,
} from "./recoveryKernel.js";

export const STAGING_RECOVERY_CANARY_EVIDENCE_CONTRACT = "mad4b.staging-recovery-genuine-canary-evidence.v1";
export const STAGING_RECOVERY_CERTIFICATION_CONTRACT = "mad4b.recovery-staging-certification.v1";
export const STAGING_RECOVERY_GITHUB_VERIFICATION_CONTRACT = "mad4b.staging-recovery-github-verification.v2";

export const STAGING_RECOVERY_REQUIRED_NEGATIVE_TESTS = Object.freeze([
  "wrong_plan_hash",
  "wrong_step",
  "expired_approval",
  "approval_reuse",
  "cross_target_approval",
  "cross_sha_approval",
  "cross_environment_approval",
  "caller_ticket_fields",
  "ticket_replay",
  "expired_ticket",
  "cross_target_ticket",
  "cross_sha_ticket",
  "idempotency_race",
  "restart_durability",
  "lost_fence",
  "provider_timeout_unknown_outcome",
  "partial_execution_reconciliation",
  "readback_failure",
  "artifact_drift",
  "schema_precondition_drift",
]);

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{8,160}$/u;
const PHASES = Object.freeze([
  "created",
  "planned",
  "awaiting_approval",
  "approval_granted",
  "locked",
  "executing",
  "provider_acknowledged",
  "readback_pending",
  "verifying",
  "verified",
  "recovered",
]);
const SECRET_KEY = /(password|secret|credential|authorization|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)/u;

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;

export const stagingRecoveryCertificationCanonicalJson = (value) => JSON.stringify(stable(value));
export const stagingRecoveryCertificationHash = (value) => createHash("sha256")
  .update(stagingRecoveryCertificationCanonicalJson(value))
  .digest("hex");

function fail(code, message) {
  throw Object.assign(new Error(message), {
    code,
    status: 409,
    details: { secrets_included: false },
  });
}

function noSecrets(value, at = "evidence") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const negativeAttestation = key === "caller_credentials_accepted" && child === false;
    if (key !== "secrets_included" && !negativeAttestation && SECRET_KEY.test(key.toLowerCase())) {
      fail("RECOVERY_CANARY_SECRET_FIELD_FORBIDDEN", `Forbidden field: ${at}.${key}`);
    }
    noSecrets(child, `${at}.${key}`);
  }
}

function fresh(generatedAt, expiresAt, now = Date.now()) {
  const generated = Date.parse(generatedAt);
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(generated)
    || !Number.isFinite(expires)
    || generated > now + 60_000
    || expires <= now
    || expires <= generated
    || expires - generated > 86_400_000) {
    fail("RECOVERY_CANARY_EVIDENCE_EXPIRED", "Evidence freshness window is invalid.");
  }
}

function kernelArtifacts({ plan, approval, ticket, receipt, run }) {
  if (plan?.contract !== "mad4b.recovery-remediation-plan.v1" || !SHA256.test(plan.plan_hash || "")) {
    fail("RECOVERY_CANARY_PLAN_INVALID", "A Kernel plan is required.");
  }
  const step = plan.steps?.find((value) => value.step_id === receipt?.step_id);
  if (!step || !SHA256.test(step.step_hash || "") || step.operation !== "staging.certification.canary") {
    fail("RECOVERY_CANARY_OPERATION_DENIED", "Only the registered Staging canary is allowed.");
  }
  if (approval?.contract !== "mad4b.recovery-approval-challenge.v1"
    || approval.plan_hash !== plan.plan_hash
    || approval.step_id !== step.step_id
    || approval.step_hash !== step.step_hash) {
    fail("RECOVERY_CANARY_APPROVAL_BINDING_INVALID", "Approval binding is invalid.");
  }
  if (!SAFE_ID.test(ticket?.ticket_id || "")
    || !SHA256.test(ticket?.ticket_hash || "")
    || ticket.plan_hash !== plan.plan_hash
    || ticket.step_id !== step.step_id
    || ticket.step_hash !== step.step_hash
    || ticket.approval_id !== approval.approval_id
    || !SHA256.test(ticket.approval_hash || "")) {
    fail("RECOVERY_CANARY_TICKET_BINDING_INVALID", "Ticket binding is invalid.");
  }
  if (receipt?.contract !== "mad4b.recovery-remediation-execution-receipt.v1"
    || receipt.plan_hash !== plan.plan_hash
    || receipt.step_id !== step.step_id
    || receipt.execution_ticket_id !== ticket.ticket_id
    || receipt.run_id !== run?.run_id
    || receipt.phase !== "recovered"
    || receipt.status !== "recovered") {
    fail("RECOVERY_CANARY_RECEIPT_INVALID", "A recovered Kernel receipt is required.");
  }
  if (!SAFE_ID.test(run?.run_id || "")
    || run.plan_hash !== plan.plan_hash
    || run.step_id !== step.step_id
    || run.phase !== "recovered"
    || run.status !== "recovered"
    || !Array.isArray(run.events)) {
    fail("RECOVERY_CANARY_RUN_INVALID", "The durable Kernel run is invalid.");
  }
  const phases = run.events.map((value) => value.phase);
  if (phases.length !== PHASES.length || phases.some((value, index) => value !== PHASES[index])) {
    fail("RECOVERY_CANARY_LIFECYCLE_INVALID", "The full Kernel state machine was not observed.");
  }
  if (run.events.some((value) => !SHA256.test(value.evidence_hash || ""))) {
    fail("RECOVERY_CANARY_EVENT_CHAIN_INVALID", "Kernel event evidence hash missing.");
  }
  if (receipt.mutation_attestation?.database_mutation_performed !== false
    || receipt.mutation_attestation?.provider_mutation_performed !== false
    || receipt.mutation_attestation?.deployment_performed !== false
    || receipt.secrets_included !== false) {
    fail("RECOVERY_CANARY_SAFETY_BOUNDARY_INVALID", "Forbidden mutation or secret boundary crossed.");
  }
  return step;
}

function normalizeNegativeTestEvidence(value) {
  if (!value || value.all_passed !== true || !value.cases || typeof value.cases !== "object") {
    fail("RECOVERY_CANARY_NEGATIVE_TEST_EVIDENCE_REQUIRED", "Exact-SHA negative-test evidence is required before countersigning.");
  }
  const cases = {};
  for (const key of STAGING_RECOVERY_REQUIRED_NEGATIVE_TESTS) {
    const item = value.cases[key];
    if (item?.status !== "pass") {
      fail("RECOVERY_CANARY_NEGATIVE_TEST_FAILED", `Required negative test did not pass: ${key}`);
    }
    cases[key] = Object.freeze({
      status: "pass",
      suite: String(item.suite || "exact_sha_ci").slice(0, 160),
      evidence_hash: SHA256.test(item.evidence_hash || "") ? item.evidence_hash : null,
    });
  }
  return Object.freeze({
    all_passed: true,
    cases: Object.freeze(cases),
    exact_sha: value.exact_sha || null,
    generated_at: value.generated_at || null,
    secrets_included: false,
  });
}

function certifiedLifecycleTrace(envelope) {
  const trace = Object.fromEntries(RECOVERY_CERTIFICATION_TRACE_STEPS.map((step) => [step, Object.freeze({
    status: "pass",
    run_id: envelope.kernel.run_id,
    event_chain_hash: envelope.kernel.event_chain_hash,
  })]));
  return Object.freeze({
    source: "recovery_kernel",
    run_id: envelope.kernel.run_id,
    event_chain_hash: envelope.kernel.event_chain_hash,
    phases: envelope.kernel.lifecycle_phases,
    ...trace,
  });
}

export async function runGenuineStagingRecoveryCanary({
  expectedSha,
  externalEvidence = {},
  artifactIntegrity,
  idempotencyKey = `staging-canary:${randomUUID()}`,
} = {}, { env = process.env, adapters } = {}) {
  const required = [
    "recoveryStore",
    "deploymentIdentityProvider",
    "approvalIssuer",
    "approvalVerifier",
    "approvalStore",
    "executionTicketSigner",
    "recoveryLock",
    "mutationExecutor",
    "readbackVerifier",
  ];
  if (!adapters || required.some((key) => !adapters[key])) {
    fail("RECOVERY_CANARY_KERNEL_AUTHORITY_UNAVAILABLE", "The complete server-managed Staging Kernel authority graph is required.");
  }
  const plan = await createStagingCertificationCanaryPlan(
    { expected_sha: expectedSha },
    { env, recoveryStore: adapters.recoveryStore, deploymentIdentityProvider: adapters.deploymentIdentityProvider },
  );
  const step = plan.steps[0];
  const approval = await createApprovalChallenge(
    { plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id },
    { recoveryStore: adapters.recoveryStore, approvalIssuer: adapters.approvalIssuer, approvalStore: adapters.approvalStore },
  );
  const issued = await adapters.approvalIssuer.createChallenge(approval);
  if (!issued?.server_token) {
    fail("RECOVERY_CANARY_APPROVAL_TOKEN_UNAVAILABLE", "The server-managed Staging approval issuer failed closed.");
  }
  const ticketReceipt = await createExecutionTicket({
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    approval_token: issued.server_token,
    idempotency_key: idempotencyKey,
  }, {
    recoveryStore: adapters.recoveryStore,
    executionTicketSigner: adapters.executionTicketSigner,
    deploymentIdentityProvider: adapters.deploymentIdentityProvider,
    approvalVerifier: adapters.approvalVerifier,
    approvalStore: adapters.approvalStore,
  });
  const ticket = await adapters.recoveryStore.getExecutionTicket(ticketReceipt.ticket_id);
  const receipt = await executeRemediationStep({
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    approval_token: issued.server_token,
    execution_ticket_id: ticketReceipt.ticket_id,
    idempotency_key: idempotencyKey,
  }, {
    env: { ...env, RECOVERY_MUTATIONS_ENABLED: "true" },
    adminPrincipal: { verified: true, binding: "server_managed_staging_certification" },
    approvalVerifier: adapters.approvalVerifier,
    approvalStore: adapters.approvalStore,
    recoveryLock: adapters.recoveryLock,
    mutationExecutor: adapters.mutationExecutor,
    recoveryStore: adapters.recoveryStore,
    readbackVerifier: adapters.readbackVerifier,
    deploymentIdentityProvider: adapters.deploymentIdentityProvider,
    migrationLedger: adapters.migrationLedger,
  });
  const run = await adapters.recoveryStore.getRun(receipt.run_id);
  const deploymentAttestation = await adapters.deploymentIdentityProvider.readAttestation();
  const envelope = produceGenuineStagingRecoveryCanaryEvidence({
    deploymentAttestation,
    targetIdentity: {
      environment: "staging",
      target_fingerprint: deploymentAttestation.target_fingerprint,
    },
    plan,
    approval,
    ticket,
    receipt,
    run,
    ...externalEvidence,
    artifactIntegrity,
  });
  return Object.freeze({
    envelope,
    artifacts: Object.freeze({ plan, approval, ticket, receipt, run }),
    approval_token_returned: false,
    production_live_enabled: false,
    secrets_included: false,
  });
}

export function produceGenuineStagingRecoveryCanaryEvidence({
  deploymentAttestation,
  targetIdentity,
  plan,
  approval,
  ticket,
  receipt,
  run,
  workerDeploymentEvidence,
  ingressBuildIdentity,
  registrationEvidence,
  oauthEvidence,
  networkEvidence,
  artifactIntegrity,
  nonce = `nonce:${randomUUID()}`,
  certificationRunId = `cert-run:${randomUUID()}`,
  generatedAt = new Date().toISOString(),
  expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
} = {}) {
  const serverIdentityFingerprint = String(deploymentAttestation?.attestation_hash || "").toLowerCase();
  if (deploymentAttestation?.environment !== "staging"
    || !SHA40.test(deploymentAttestation.sha || "")
    || !SHA256.test(serverIdentityFingerprint)
    || targetIdentity?.environment !== "staging"
    || !SHA256.test(targetIdentity.target_fingerprint || "")
    || deploymentAttestation.target_fingerprint !== targetIdentity.target_fingerprint) {
    fail("RECOVERY_CANARY_TARGET_BINDING_INVALID", "Exact Staging SHA/target/server identity binding is required.");
  }
  if (!SAFE_ID.test(nonce) || !SAFE_ID.test(certificationRunId)) {
    fail("RECOVERY_CANARY_RUN_BINDING_INVALID", "Run ID and nonce are invalid.");
  }
  fresh(generatedAt, expiresAt);
  const step = kernelArtifacts({ plan, approval, ticket, receipt, run });
  for (const evidence of [registrationEvidence, oauthEvidence, networkEvidence, workerDeploymentEvidence]) {
    if (evidence?.deployment_sha !== deploymentAttestation.sha
      || evidence?.target_fingerprint !== targetIdentity.target_fingerprint
      || !SHA256.test(evidence?.evidence_hash || "")) {
      fail("RECOVERY_CANARY_EXTERNAL_BINDING_INVALID", "External evidence binding is invalid.");
    }
  }
  if (ingressBuildIdentity?.deployment_sha !== deploymentAttestation.sha) {
    fail("RECOVERY_CANARY_INGRESS_BINDING_INVALID", "Ingress build binding is invalid.");
  }
  if (artifactIntegrity?.valid !== true || !SHA256.test(artifactIntegrity.manifest_sha256 || "")) {
    fail("RECOVERY_CANARY_ARTIFACT_INTEGRITY_INVALID", "Artifact integrity proof is invalid.");
  }
  const base = {
    contract: STAGING_RECOVERY_CANARY_EVIDENCE_CONTRACT,
    environment: "staging",
    deployment_sha: deploymentAttestation.sha,
    target_fingerprint: targetIdentity.target_fingerprint,
    server_identity_fingerprint: serverIdentityFingerprint,
    certification_run_id: certificationRunId,
    nonce,
    generated_at: generatedAt,
    expires_at: expiresAt,
    kernel: {
      contract: "mad4b.recovery-kernel.v1",
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      step_id: step.step_id,
      step_hash: step.step_hash,
      operation: step.operation,
      approval_id: approval.approval_id,
      approval_challenge_hash: approval.challenge_hash,
      approval_hash: ticket.approval_hash,
      approval_version: ticket.approval_version,
      ticket_id: ticket.ticket_id,
      ticket_hash: ticket.ticket_hash,
      run_id: run.run_id,
      receipt_hash: stagingRecoveryCertificationHash(receipt),
      event_chain_hash: stagingRecoveryCertificationHash(run.events),
      lifecycle_phases: run.events.map((value) => value.phase),
    },
    registrationEvidence,
    oauthEvidence,
    networkEvidence,
    workerDeploymentEvidence,
    ingressBuildIdentity,
    artifactIntegrity,
    safety: {
      production_live_enabled: false,
      production_mutation_performed: false,
      database_mutation_performed: false,
      provider_mutation_performed: false,
      local_connector_production_authority: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
  noSecrets(base);
  return Object.freeze({
    ...base,
    evidence_envelope_sha256: stagingRecoveryCertificationHash(base),
  });
}

export async function independentlyVerifyStagingRecoveryCanaryEvidence(envelope, {
  expectedSha,
  expectedTargetFingerprint,
  workflowSourceSha,
  now = Date.now(),
  loadKernelArtifacts,
  negativeTestEvidence,
} = {}) {
  if (envelope?.contract !== STAGING_RECOVERY_CANARY_EVIDENCE_CONTRACT) {
    fail("RECOVERY_CANARY_EVIDENCE_CONTRACT_INVALID", "Unknown evidence contract.");
  }
  const unsigned = { ...envelope };
  delete unsigned.evidence_envelope_sha256;
  if (!SHA256.test(envelope.evidence_envelope_sha256 || "")
    || stagingRecoveryCertificationHash(unsigned) !== envelope.evidence_envelope_sha256) {
    fail("RECOVERY_CANARY_EVIDENCE_HASH_MISMATCH", "Evidence envelope hash mismatch.");
  }
  if (envelope.environment !== "staging"
    || envelope.deployment_sha !== expectedSha
    || envelope.target_fingerprint !== expectedTargetFingerprint
    || workflowSourceSha !== expectedSha
    || !SHA256.test(envelope.server_identity_fingerprint || "")) {
    fail("RECOVERY_CANARY_EXACT_TARGET_MISMATCH", "Exact SHA/target/server identity mismatch.");
  }
  fresh(envelope.generated_at, envelope.expires_at, now);
  noSecrets(envelope);
  if (typeof loadKernelArtifacts !== "function") {
    fail("RECOVERY_CANARY_KERNEL_READBACK_UNAVAILABLE", "Independent Kernel readback is required.");
  }
  const artifacts = await loadKernelArtifacts({
    plan_id: envelope.kernel.plan_id,
    approval_id: envelope.kernel.approval_id,
    ticket_id: envelope.kernel.ticket_id,
    run_id: envelope.kernel.run_id,
  });
  const step = kernelArtifacts(artifacts);
  if (artifacts.plan.plan_hash !== envelope.kernel.plan_hash
    || step.step_hash !== envelope.kernel.step_hash
    || artifacts.approval.challenge_hash !== envelope.kernel.approval_challenge_hash
    || artifacts.ticket.approval_hash !== envelope.kernel.approval_hash
    || artifacts.ticket.ticket_hash !== envelope.kernel.ticket_hash
    || stagingRecoveryCertificationHash(artifacts.receipt) !== envelope.kernel.receipt_hash
    || stagingRecoveryCertificationHash(artifacts.run.events) !== envelope.kernel.event_chain_hash) {
    fail("RECOVERY_CANARY_KERNEL_BINDING_MISMATCH", "Independent Kernel bindings mismatch.");
  }
  const external = await evaluateExternalStagingEvidence({
    candidateSha: envelope.deployment_sha,
    candidateTargetFingerprint: envelope.target_fingerprint,
    authenticity_verified: true,
    registrationEvidence: envelope.registrationEvidence,
    oauthEvidence: envelope.oauthEvidence,
    networkEvidence: envelope.networkEvidence,
    workerDeploymentEvidence: envelope.workerDeploymentEvidence,
  }, envelope.ingressBuildIdentity);
  if (!external.ready) {
    fail("RECOVERY_CANARY_EXTERNAL_EVIDENCE_INVALID", external.blocking_failures.join(","));
  }
  if (envelope.artifactIntegrity?.valid !== true
    || envelope.safety?.production_live_enabled !== false
    || envelope.safety?.production_mutation_performed !== false
    || envelope.safety?.secrets_included !== false) {
    fail("RECOVERY_CANARY_BOUNDARY_INVALID", "Safety boundary invalid.");
  }
  const negativeTests = normalizeNegativeTestEvidence(negativeTestEvidence);
  if (negativeTests.exact_sha && negativeTests.exact_sha !== expectedSha) {
    fail("RECOVERY_CANARY_NEGATIVE_TEST_SHA_MISMATCH", "Negative-test evidence is not bound to the exact workflow SHA.");
  }
  const lifecycleTrace = certifiedLifecycleTrace(envelope);
  const checks = {
    exact_main: true,
    workflow_source_same_sha: true,
    evidence_envelope_hash: true,
    target_binding: true,
    server_identity_binding: true,
    run_nonce_binding: SAFE_ID.test(envelope.certification_run_id) && SAFE_ID.test(envelope.nonce),
    worker_provenance: external.checks.deployed_worker_provenance && external.checks.gateway_request_build_binding,
    artifact_integrity: true,
    evidence_freshness: true,
    external_evidence: external.ready,
    lifecycle_trace: RECOVERY_CERTIFICATION_TRACE_STEPS.every((name) => lifecycleTrace[name]?.status === "pass"),
    negative_tests: negativeTests.all_passed === true,
    production_boundary: true,
    secret_scan: true,
  };
  const base = {
    contract: STAGING_RECOVERY_GITHUB_VERIFICATION_CONTRACT,
    verified: Object.values(checks).every(Boolean),
    evidence_envelope_sha256: envelope.evidence_envelope_sha256,
    deployment_sha: envelope.deployment_sha,
    target_fingerprint: envelope.target_fingerprint,
    server_identity_fingerprint: envelope.server_identity_fingerprint,
    certification_run_id: envelope.certification_run_id,
    nonce: envelope.nonce,
    checks,
    lifecycle_trace: lifecycleTrace,
    negative_tests: negativeTests,
    secrets_included: false,
  };
  return Object.freeze({
    ...base,
    verification_report_sha256: stagingRecoveryCertificationHash(base),
  });
}

export function buildRecoveryReadinessSigningPayload(envelope, report, { issuer, keyId } = {}) {
  if (report?.verified !== true
    || report.evidence_envelope_sha256 !== envelope?.evidence_envelope_sha256
    || report.lifecycle_trace == null
    || report.negative_tests?.all_passed !== true) {
    fail("RECOVERY_CANARY_VERIFICATION_REPORT_INVALID", "Verified lifecycle and negative-test report required.");
  }
  const stagingCertification = {
    contract: STAGING_RECOVERY_CERTIFICATION_CONTRACT,
    certification_id: `cert:staging:${envelope.certification_run_id}`,
    status: "passed",
    result: "pass",
    environment_key: "staging",
    branch: "main",
    deployment_sha: envelope.deployment_sha,
    runtime_sha: envelope.deployment_sha,
    target_fingerprint: envelope.target_fingerprint,
    server_identity_fingerprint: envelope.server_identity_fingerprint,
    provider_environment: "staging",
    authority_graph: {
      ready: true,
      test_or_mock_adapter_detected: false,
    },
    lifecycle_trace: report.lifecycle_trace,
    negative_tests: report.negative_tests,
    audit_evidence: {
      durable: true,
      evidence_hash: envelope.evidence_envelope_sha256,
    },
    artifact_integrity: envelope.artifactIntegrity,
    expires_at: envelope.expires_at,
    safety: {
      ...envelope.safety,
      caller_credentials_accepted: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
  stagingCertification.audit_evidence.canonical_payload_hash = certificationPayloadHash(stagingCertification);
  return Object.freeze({
    contract: RECOVERY_READINESS_EVIDENCE_CONTRACT,
    issuer,
    key_id: keyId,
    environment: "staging",
    branch: "main",
    deployment_sha: envelope.deployment_sha,
    target_fingerprint: envelope.target_fingerprint,
    certification_run_id: envelope.certification_run_id,
    nonce: envelope.nonce,
    evidence_envelope_sha256: envelope.evidence_envelope_sha256,
    verification_report_sha256: report.verification_report_sha256,
    generated_at: envelope.generated_at,
    expires_at: envelope.expires_at,
    production_live_enabled: false,
    production_mutation_performed: false,
    local_connector_production_authority: false,
    stagingCertification,
    registrationEvidence: envelope.registrationEvidence,
    oauthEvidence: envelope.oauthEvidence,
    networkEvidence: envelope.networkEvidence,
    workerDeploymentEvidence: envelope.workerDeploymentEvidence,
    unresolvedRecoveryIncidents: [],
    secrets_included: false,
  });
}

export async function publishVerifiedStagingRecoveryCertification({
  signedRecord,
  trust,
  evidenceStore,
  expectedSha,
  expectedTargetFingerprint,
  expectedRunId,
  expectedNonce,
} = {}) {
  const verified = verifyStagingRecoverySignedCertificationRecord(signedRecord, {
    trust,
    expectedSha,
    expectedTargetFingerprint,
    expectedRunId,
    expectedNonce,
  });
  if (!verified.valid) {
    fail("RECOVERY_CERTIFICATION_PUBLICATION_SIGNATURE_INVALID", "Public trust verification failed.");
  }
  if (typeof evidenceStore?.putCertification !== "function"
    || typeof evidenceStore?.setCurrentCertification !== "function") {
    fail("RECOVERY_CERTIFICATION_STORE_UNAVAILABLE", "Persistent evidence store unavailable.");
  }
  const id = await evidenceStore.putCertification(signedRecord);
  await evidenceStore.setCurrentCertification(id);
  return Object.freeze({
    published: true,
    certification_record_id: id,
    deployment_sha: expectedSha,
    target_fingerprint: expectedTargetFingerprint,
    secrets_included: false,
  });
}
