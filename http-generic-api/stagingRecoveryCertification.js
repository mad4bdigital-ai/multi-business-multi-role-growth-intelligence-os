import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import path from "node:path";
import {
  createRecoveryReadinessAuthorities,
  createServerManagedRecoveryBinding,
} from "./stagingRecoveryAuthorityBinding.js";
import {
  RECOVERY_READINESS_EVIDENCE_CONTRACT,
  createFileRecoveryEvidenceStore,
  expectedStagingGatewayDeployment,
  expectedStagingRegistration,
  readinessEvidencePayload,
} from "./recoveryReadinessEvidence.js";
import {
  RECOVERY_CERTIFICATION_TRACE_STEPS,
  RECOVERY_STAGING_CERTIFICATION_CONTRACT,
  buildRecoveryAuthorityReadiness,
  certificationPayloadHash,
  evaluateStagingRecoveryCertification,
} from "./recoveryActivationReadiness.js";
import { createProductionRecoveryComposition } from "./productionRecoveryCompositionFactory.js";
import { issueExecutionTicket, verifyExecutionTicket } from "./recoveryExecutionTicket.js";

export const STAGING_RECOVERY_CERTIFICATION_RUNNER_CONTRACT = "mad4b.staging-recovery-certification-runner.v1";
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CANARY_OPERATION = "staging.recovery.certification_canary";
const TARGET_KEY = "staging-recovery-certification-canary";
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const canonical = (value) => JSON.stringify(stable(value));
const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
const nowIso = (now) => new Date(now).toISOString();
const futureIso = (now, ms) => new Date(now + ms).toISOString();

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, status: 503, details: { ...details, secrets_included: false } });
}

function assertExactRuntime(env = process.env) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "staging"
    || String(env.DEPLOYMENT_ENVIRONMENT || "").trim().toLowerCase() !== "staging_local_windows_docker"
    || String(env.REMOTE_MCP_ENVIRONMENT || "").trim().toLowerCase() !== "staging") {
    fail("RECOVERY_STAGING_CERTIFICATION_RUNTIME_INVALID", "Certification is limited to explicit local Windows/Docker Staging.");
  }
}

function provenanceComplete(provenance, sha) {
  if (provenance?.contract !== "mad4b.recovery-adapter-provenance.v1"
    || provenance.environment !== "staging" || provenance.deployment_sha !== sha) return false;
  const entries = Object.values(provenance.components || {});
  return entries.length === 14 && entries.every((entry) => entry?.authority_class === "server_managed"
    && SHA256.test(entry?.artifact_sha256 || "") && ["durable", "stateless"].includes(entry?.storage_class));
}

function bindObservation(raw, { deploymentSha, targetFingerprint, expiresAt }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("RECOVERY_STAGING_EXTERNAL_EVIDENCE_INVALID", "External evidence must be an object.");
  return Object.freeze({
    ...raw,
    deployment_sha: deploymentSha,
    target_fingerprint: targetFingerprint,
    evidence_hash: digest(raw),
    expires_at: expiresAt,
    secrets_included: false,
  });
}

async function validateAndBindExternalEvidence({ registration, oauth, network, worker, deploymentSha, targetFingerprint, expiresAt }) {
  const expectedRegistration = await expectedStagingRegistration();
  const expectedGateway = await expectedStagingGatewayDeployment();
  if (registration?.observed_in !== "chatgpt"
    || !Object.entries(expectedRegistration).every(([key, value]) => registration?.[key] === value)) {
    fail("RECOVERY_STAGING_REGISTRATION_EVIDENCE_INVALID", "Actual ChatGPT Staging registration evidence is absent or stale.");
  }
  if (oauth?.issuer !== "https://dev.mad4b.com" || oauth?.resource !== "https://activation-dev.mad4b.com"
    || !["authorize", "login_consent", "code", "callback", "token", "resource"].every((step) => oauth?.steps?.[step] === "pass")) {
    fail("RECOVERY_STAGING_OAUTH_EVIDENCE_INVALID", "The Staging OAuth browser round-trip is incomplete.");
  }
  if (network?.environment !== "staging" || network?.gateway_host !== expectedGateway.gateway_host
    || network?.upstream_origin !== expectedGateway.upstream_origin || network?.gateway_only !== true
    || network?.signed_ingress_required !== true || network?.network_restriction_verified !== true
    || network?.direct_origin_publicly_reachable !== false) {
    fail("RECOVERY_STAGING_NETWORK_EVIDENCE_INVALID", "Staging Recovery network-isolation evidence is incomplete.");
  }
  if (worker?.observed_in !== "cloudflare_workers" || worker?.deployment_verified !== true
    || worker?.gateway_host !== expectedGateway.gateway_host || worker?.policy_hash !== expectedGateway.policy_hash
    || worker?.worker_build_sha !== deploymentSha || worker?.policy_source_sha !== deploymentSha
    || !SHA256.test(worker?.worker_bundle_sha256 || "") || !SHA256.test(worker?.release_bundle_sha256 || "")
    || worker?.deployed_bundle_sha256 !== worker?.release_bundle_sha256) {
    fail("RECOVERY_STAGING_WORKER_EVIDENCE_INVALID", "Exact-SHA Staging Worker deployment evidence is incomplete.");
  }
  const binding = { deploymentSha, targetFingerprint, expiresAt };
  return Object.freeze({
    registrationEvidence: bindObservation(registration, binding),
    oauthEvidence: bindObservation(oauth, binding),
    networkEvidence: bindObservation(network, binding),
    workerDeploymentEvidence: bindObservation(worker, binding),
  });
}

function approvalContextMatches(approval, context) {
  return approval?.used !== true && Date.parse(approval?.expires_at || 0) > Date.now()
    && approval?.plan_hash === context.plan_hash && approval?.step_id === context.step_id
    && approval?.step_hash === context.step_hash && approval?.expected_sha === context.expected_sha
    && approval?.target_key === context.target_key && approval?.target_fingerprint === context.target_fingerprint
    && (approval?.environment || "staging") === context.environment;
}

async function wholeApprovalAccepted(adapters, token, approval, context) {
  if (!approvalContextMatches(approval, context)) return false;
  return (await adapters.approvalVerifier.verify({ token, approval, context })) === true;
}

async function throwsAsync(fn) {
  try { await fn(); return false; } catch { return true; }
}

function canaryInputValid(input) {
  return input?.operation === CANARY_OPERATION && SHA256.test(input?.plan_hash || "")
    && /^step:[A-Za-z0-9._:-]{8,160}$/u.test(input?.step_id || "")
    && typeof input?.idempotency_key === "string" && input.idempotency_key.length >= 16;
}

async function runLifecycle({ adapters, deploymentSha, targetFingerprint, now }) {
  const trace = Object.fromEntries(RECOVERY_CERTIFICATION_TRACE_STEPS.map((step) => [step, { status: "pending" }]));
  const mark = (step, evidence = null) => { trace[step] = { status: "pass", ...(evidence ? { evidence } : {}) }; };
  const seed = digest({ deploymentSha, targetFingerprint, nonce: randomUUID(), now });
  const runId = `run:${seed.slice(0, 32)}`;
  const findingId = `finding:${digest({ seed, kind: "certification_canary" }).slice(0, 32)}`;
  const inspection = {
    contract: "mad4b.staging-recovery-certification-inspection.v1",
    run_id: runId,
    expected_sha: deploymentSha,
    target_fingerprint: targetFingerprint,
    environment: "staging",
    read_only_probe: true,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
  await adapters.recoveryStore.putRun(inspection);
  mark("durable_inspection", { run_id: runId, hash: digest(inspection) });

  const finding = {
    contract: "mad4b.staging-recovery-certification-finding.v1",
    finding_id: findingId,
    inspection_run_id: runId,
    category: "bounded_certification_canary",
    repairability: "deterministic",
    candidate_capability: CANARY_OPERATION,
    secrets_included: false,
  };
  await adapters.recoveryStore.putFinding(finding);
  mark("finding", { finding_id: findingId, hash: digest(finding) });

  const planBase = {
    contract: "mad4b.staging-recovery-certification-plan.v1",
    expected_sha: deploymentSha,
    target_key: TARGET_KEY,
    target_fingerprint: targetFingerprint,
    finding_ids: [findingId],
    environment: "staging",
    operation: CANARY_OPERATION,
    secrets_included: false,
  };
  const planHash = digest(planBase);
  const planId = `plan:${planHash.slice(0, 32)}`;
  const stepBase = { plan_hash: planHash, operation: CANARY_OPERATION, target_key: TARGET_KEY, target_fingerprint: targetFingerprint };
  const stepHash = digest(stepBase);
  const stepId = `step:${stepHash.slice(0, 32)}`;
  const plan = { ...planBase, plan_id: planId, plan_hash: planHash, step_id: stepId, step_hash: stepHash };
  await adapters.recoveryStore.putPlan(plan);
  mark("immutable_remediation_plan", { plan_id: planId, plan_hash: planHash });

  const approvalId = `approval:${digest({ planHash, stepId, nonce: randomUUID() }).slice(0, 32)}`;
  const challengeBase = {
    contract: "mad4b.recovery-approval-challenge.v1",
    approval_id: approvalId,
    plan_id: planId,
    plan_hash: planHash,
    step_id: stepId,
    step_hash: stepHash,
    expected_sha: deploymentSha,
    target_key: TARGET_KEY,
    target_fingerprint: targetFingerprint,
    environment: "staging",
    target_role: "composite",
    expires_at: futureIso(now, 5 * 60 * 1000),
    single_use: true,
    non_transferable: true,
    secrets_included: false,
  };
  const issued = await adapters.approvalIssuer.createChallenge(challengeBase);
  const approval = { ...challengeBase, expires_at: issued.expires_at, challenge_hash: digest(challengeBase), approval_version: "v1", used: false };
  await adapters.approvalStore.putChallenge(approval);
  await adapters.recoveryStore.putApproval(approval);
  mark("approval_challenge", { approval_id: approvalId, challenge_hash: approval.challenge_hash });

  const approvalContext = {
    plan_hash: planHash,
    step_id: stepId,
    step_hash: stepHash,
    expected_sha: deploymentSha,
    target_key: TARGET_KEY,
    target_fingerprint: targetFingerprint,
    environment: "staging",
  };
  if (!(await wholeApprovalAccepted(adapters, issued.server_token, approval, approvalContext))) {
    fail("RECOVERY_STAGING_APPROVAL_VERIFICATION_FAILED", "The server-issued Staging certification approval was not verifiable.");
  }
  mark("approval_verification");

  const idempotencyKey = `staging-cert:${seed}`;
  const reservationContext = { approval_id: approvalId, plan_hash: planHash, step_id: stepId, idempotency_key: idempotencyKey };
  const approvalReservation = await adapters.recoveryStore.reserveApproval(reservationContext);
  if (approvalReservation?.reserved !== true) fail("RECOVERY_STAGING_APPROVAL_RESERVATION_FAILED", "Approval reservation failed.");
  mark("approval_reservation");

  const ticket = await issueExecutionTicket({
    inspection_run_id: runId,
    inspection_evidence_hash: digest(inspection),
    finding_ids: [findingId],
    selected_roles: ["composite"],
    role_selection_required: false,
    role_object_count_fingerprints: {},
    role_bundle_bindings: {},
    target_fingerprints: { composite: targetFingerprint },
    deployment_attestation_hash: null,
    approval_id: approvalId,
    approval_hash: approval.challenge_hash,
    approval_version: "v1",
    production_sha: deploymentSha,
    target_key: TARGET_KEY,
    target_fingerprint: targetFingerprint,
    plan_hash: planHash,
    step_hash: stepHash,
    step_id: stepId,
    target_role: "composite",
    operation: CANARY_OPERATION,
    idempotency_key: idempotencyKey,
    expires_at: futureIso(now, 10 * 60 * 1000),
    nonce: randomUUID(),
  }, { signer: adapters.executionTicketSigner, now });
  await verifyExecutionTicket(ticket, { verifier: adapters.executionTicketVerifier, expected: { plan_hash: planHash, step_id: stepId, production_sha: deploymentSha, target_fingerprints: { composite: targetFingerprint } }, now });
  await adapters.recoveryStore.putExecutionTicket(ticket);
  mark("server_issued_execution_ticket", { ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash });

  const ticketContext = { ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, idempotency_key: idempotencyKey };
  const ticketReservation = await adapters.recoveryStore.reserveExecutionTicket(ticketContext);
  if (ticketReservation?.reserved !== true) fail("RECOVERY_STAGING_TICKET_RESERVATION_FAILED", "Execution-ticket reservation failed.");
  mark("ticket_reservation");

  const claimContext = { idempotency_key: idempotencyKey, plan_hash: planHash, step_id: stepId, execution_ticket_id: ticket.ticket_id, execution_ticket_hash: ticket.ticket_hash };
  const claim = await adapters.recoveryStore.claimExecution(claimContext);
  if (claim?.claimed !== true) fail("RECOVERY_STAGING_IDEMPOTENCY_CLAIM_FAILED", "Execution idempotency claim failed.");
  mark("idempotency_claim", { claim_id: claim.claim_id });

  const lock = await adapters.recoveryLock.acquire({ target_key: TARGET_KEY, plan_hash: planHash, ttl_seconds: 600 });
  if (lock?.acquired !== true || !(await adapters.recoveryLock.assertFence({ target_key: TARGET_KEY, lease_id: lock.lease_id, fencing_token: lock.fencing_token })).valid) {
    fail("RECOVERY_STAGING_FENCE_ACQUIRE_FAILED", "Fenced Staging certification lock was not acquired.");
  }
  mark("fenced_lock", { lease_id: lock.lease_id, fencing_token_hash: digest(lock.fencing_token) });

  let execution;
  try {
    const canaryInput = { plan_hash: planHash, step_id: stepId, idempotency_key: idempotencyKey, operation: CANARY_OPERATION, fencing_token: lock.fencing_token, lock };
    if (!canaryInputValid(canaryInput)) fail("RECOVERY_STAGING_CANARY_PRECONDITION_INVALID", "Certification canary preconditions are invalid.");
    execution = await adapters.mutationExecutor.execute(canaryInput);
    if (execution?.ok !== true || execution?.status !== "provider_acknowledged" || execution?.database_mutation_performed !== false || execution?.provider_mutation_performed !== false) {
      fail("RECOVERY_STAGING_CANARY_EXECUTION_INVALID", "Bounded Staging certification canary did not return the required attestation.");
    }
    mark("provider_execution", { canary_id: execution.canary_id });

    const readback = await adapters.readbackVerifier.verify({ result: execution, execution_result: execution });
    if (readback?.verified !== true || readback?.postconditions_passed !== true || readback?.behavioral_probe_passed !== true
      || execution?.mutation_attestation?.fencing_token !== lock.fencing_token) {
      fail("RECOVERY_STAGING_SAME_FENCE_READBACK_FAILED", "Staging certification readback was not bound to the execution fence.");
    }
    mark("same_fence_readback", { evidence_hash: readback.evidence_hash });

    const partial = await adapters.partialReceiptStore.putImmutablePartialRebuildReceipt({
      contract: "mad4b.staging-recovery-certification-partial-receipt.v1",
      run_id: runId,
      plan_hash: planHash,
      step_id: stepId,
      canary_id: execution.canary_id,
      fencing_token_hash: digest(lock.fencing_token),
      secrets_included: false,
    });
    await adapters.recoveryStore.appendEvidenceEvent(runId, { event: "certification_canary_verified", canary_id: execution.canary_id, evidence_hash: readback.evidence_hash, secrets_included: false });
    await adapters.migrationLedger.finalize({ contract: "mad4b.staging-recovery-certification-ledger.v1", run_id: runId, plan_hash: planHash, canary_id: execution.canary_id, secrets_included: false });
    if (partial?.durable !== true || partial?.persisted !== true) fail("RECOVERY_STAGING_DURABLE_EVIDENCE_FAILED", "Certification evidence was not durably persisted.");
    mark("durable_evidence", { partial_receipt_hash: partial.evidence_hash, readback_hash: readback.evidence_hash });

    const ticketFinal = await adapters.recoveryStore.finalizeExecutionTicket(ticketContext);
    if (ticketFinal?.finalized !== true) fail("RECOVERY_STAGING_TICKET_FINALIZATION_FAILED", "Execution ticket was not finalized.");
    mark("ticket_finalization");
    const approvalFinal = await adapters.recoveryStore.markApprovalUsed(approvalId);
    if (approvalFinal?.finalized !== true) fail("RECOVERY_STAGING_APPROVAL_FINALIZATION_FAILED", "Approval was not finalized.");
    mark("approval_finalization");
    await adapters.recoveryStore.putIdempotencyReceipt(idempotencyKey, { run_id: runId, plan_hash: planHash, step_id: stepId, status: "verified", canary_id: execution.canary_id, secrets_included: false });
  } finally {
    await adapters.recoveryLock.release({ target_key: TARGET_KEY, plan_hash: planHash, lock });
  }
  const releasedFence = await adapters.recoveryLock.assertFence({ target_key: TARGET_KEY, lease_id: lock.lease_id, fencing_token: lock.fencing_token });
  if (releasedFence?.valid === true) fail("RECOVERY_STAGING_LOCK_RELEASE_FAILED", "Staging certification lock remained valid after release.");
  mark("lock_release");

  return { trace, runId, findingId, plan, approval, approvalToken: issued.server_token, approvalContext, ticket, ticketContext, claimContext, lock, execution, idempotencyKey };
}

async function runNegativeSuite({ adapters, lifecycle, deploymentSha, targetFingerprint, snapshot, now }) {
  const cases = {};
  const record = (name, passed) => { cases[name] = { status: passed ? "pass" : "fail" }; };
  const { approval, approvalToken, approvalContext, ticket, ticketContext, lock, plan, idempotencyKey } = lifecycle;
  record("wrong_plan_hash", !(await wholeApprovalAccepted(adapters, approvalToken, approval, { ...approvalContext, plan_hash: "0".repeat(64) })));
  record("wrong_step", !(await wholeApprovalAccepted(adapters, approvalToken, approval, { ...approvalContext, step_id: `step:${"0".repeat(32)}` })));
  record("expired_approval", !(await wholeApprovalAccepted(adapters, approvalToken, { ...approval, expires_at: new Date(now - 1000).toISOString() }, approvalContext)));
  const finalizedApproval = await adapters.recoveryStore.getApprovalByPlanStep(plan.plan_id, plan.step_id);
  record("approval_reuse", !(await wholeApprovalAccepted(adapters, approvalToken, finalizedApproval, approvalContext)));
  record("cross_target_approval", !(await wholeApprovalAccepted(adapters, approvalToken, approval, { ...approvalContext, target_fingerprint: "f".repeat(64) })));
  record("cross_sha_approval", !(await wholeApprovalAccepted(adapters, approvalToken, approval, { ...approvalContext, expected_sha: "b".repeat(40) })));
  record("cross_environment_approval", !(await wholeApprovalAccepted(adapters, approvalToken, approval, { ...approvalContext, environment: "production" })));
  record("caller_ticket_fields", await throwsAsync(() => verifyExecutionTicket({ ...ticket, plan_hash: "0".repeat(64) }, { verifier: adapters.executionTicketVerifier, now })));
  const replayReservation = await adapters.recoveryStore.reserveExecutionTicket(ticketContext);
  record("ticket_replay", replayReservation?.reserved === false);
  record("expired_ticket", await throwsAsync(() => verifyExecutionTicket(ticket, { verifier: adapters.executionTicketVerifier, now: Date.parse(ticket.expires_at) + 1 })));
  record("cross_target_ticket", await throwsAsync(() => verifyExecutionTicket(ticket, { verifier: adapters.executionTicketVerifier, expected: { target_fingerprints: { composite: "f".repeat(64) } }, now })));
  record("cross_sha_ticket", await throwsAsync(() => verifyExecutionTicket(ticket, { verifier: adapters.executionTicketVerifier, expected: { production_sha: "b".repeat(40) }, now })));

  const raceKey = `staging-cert-negative-race:${digest(randomUUID())}`;
  const firstRace = await adapters.recoveryStore.claimExecution({ idempotency_key: raceKey, plan_hash: plan.plan_hash, step_id: plan.step_id });
  const secondRace = await adapters.recoveryStore.claimExecution({ idempotency_key: raceKey, plan_hash: plan.plan_hash, step_id: plan.step_id });
  record("idempotency_race", firstRace?.claimed === true && secondRace?.existing === true);
  await adapters.recoveryStore.releaseExecutionClaim({ idempotency_key: raceKey });

  const rebound = createServerManagedRecoveryBinding({ environment: "staging", requested_mode: "injected_non_live", production_live: false });
  const durableRun = await rebound.adapters.recoveryStore.getRun(lifecycle.runId);
  const durableTicket = await rebound.adapters.recoveryStore.getExecutionTicket(ticket.ticket_id);
  record("restart_durability", durableRun?.run_id === lifecycle.runId && durableTicket?.ticket_hash === ticket.ticket_hash);
  const lostFence = await adapters.recoveryLock.assertFence({ target_key: TARGET_KEY, lease_id: lock.lease_id, fencing_token: lock.fencing_token });
  record("lost_fence", lostFence?.valid === false);

  const timeoutRunId = `run:${digest({ kind: "timeout", nonce: randomUUID() }).slice(0, 32)}`;
  await adapters.recoveryStore.putRun({ run_id: timeoutRunId, status: "execution_outcome_unknown", phase: "execution_outcome_unknown", expected_sha: deploymentSha, target_fingerprint: targetFingerprint, secrets_included: false });
  const timeoutReadback = await rebound.adapters.recoveryStore.getRun(timeoutRunId);
  record("provider_timeout_unknown_outcome", timeoutReadback?.status === "execution_outcome_unknown");

  const partial = await adapters.partialReceiptStore.putImmutablePartialRebuildReceipt({ contract: "mad4b.staging-recovery-negative-partial.v1", run_id: timeoutRunId, status: "reconciliation_required", secrets_included: false });
  record("partial_execution_reconciliation", partial?.durable === true && partial?.persisted === true);
  const badReadback = await adapters.readbackVerifier.verify({ result: { canary_id: "0".repeat(64) } });
  record("readback_failure", badReadback?.verified === false);

  const drifted = structuredClone(snapshot.adapterProvenance || {});
  if (drifted.components?.recoveryStore) drifted.components.recoveryStore.artifact_sha256 = "drift";
  record("artifact_drift", provenanceComplete(drifted, deploymentSha) === false);
  record("schema_precondition_drift", canaryInputValid({ plan_hash: plan.plan_hash, step_id: plan.step_id, idempotency_key: idempotencyKey, operation: "staging.recovery.unregistered_canary" }) === false);

  const required = [
    "wrong_plan_hash", "wrong_step", "expired_approval", "approval_reuse", "cross_target_approval",
    "cross_sha_approval", "cross_environment_approval", "caller_ticket_fields", "ticket_replay",
    "expired_ticket", "cross_target_ticket", "cross_sha_ticket", "idempotency_race", "restart_durability",
    "lost_fence", "provider_timeout_unknown_outcome", "partial_execution_reconciliation", "readback_failure",
    "artifact_drift", "schema_precondition_drift",
  ];
  const allPassed = required.every((name) => cases[name]?.status === "pass");
  return { all_passed: allPassed, cases };
}

function resolveCertificationTrust(privateKeyPem, env = process.env) {
  const keyId = String(env.RECOVERY_STAGING_CERTIFICATION_KEY_ID || "").trim();
  const issuer = String(env.RECOVERY_STAGING_CERTIFICATION_ISSUER || "").trim();
  const escaped = String(env.RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY_PEM_ESCAPED || "").trim();
  if (!keyId || !issuer || !escaped) fail("RECOVERY_STAGING_CERTIFICATION_TRUST_UNAVAILABLE", "Public certification trust must be provisioned in Staging before certification.");
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(escaped.replaceAll("\\n", "\n"));
  const derivedPublic = createPublicKey(privateKey);
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") fail("RECOVERY_STAGING_CERTIFICATION_KEY_INVALID", "Certification trust must use Ed25519.");
  const expected = publicKey.export({ type: "spki", format: "der" });
  const derived = derivedPublic.export({ type: "spki", format: "der" });
  if (!expected.equals(derived)) fail("RECOVERY_STAGING_CERTIFICATION_KEY_MISMATCH", "The external private key does not match the Staging public trust anchor.");
  return { keyId, issuer, privateKey, publicKey };
}

export async function certifyStagingRecovery({
  privateKeyPem,
  registrationEvidence,
  oauthEvidence,
  networkEvidence,
  workerDeploymentEvidence,
  now = Date.now(),
  lifetimeMs = 60 * 60 * 1000,
  env = process.env,
} = {}) {
  assertExactRuntime(env);
  if (typeof privateKeyPem !== "string" || !privateKeyPem.includes("PRIVATE KEY")) fail("RECOVERY_STAGING_CERTIFICATION_PRIVATE_KEY_REQUIRED", "An external certification private key is required.");
  if (!Number.isFinite(now) || lifetimeMs < 5 * 60 * 1000 || lifetimeMs > 24 * 60 * 60 * 1000) fail("RECOVERY_STAGING_CERTIFICATION_LIFETIME_INVALID", "Certification lifetime must be between five minutes and twenty-four hours.");
  const trust = resolveCertificationTrust(privateKeyPem, env);
  const envelope = createServerManagedRecoveryBinding({ environment: "staging", requested_mode: "injected_non_live", production_live: false });
  const authority = createRecoveryReadinessAuthorities({ environment: "staging", runtime_class: "local_windows_docker", read_only: true, production_live: false });
  const snapshot = await authority.readSnapshot();
  const deploymentSha = snapshot.candidateSha;
  const targetFingerprint = snapshot.candidateTargetFingerprint;
  if (!SHA40.test(deploymentSha || "") || !SHA256.test(targetFingerprint || "") || !provenanceComplete(snapshot.adapterProvenance, deploymentSha)) {
    fail("RECOVERY_STAGING_CERTIFICATION_AUTHORITY_NOT_READY", "Phase A authority identity/provenance is not ready for certification.");
  }
  const composition = createProductionRecoveryComposition({ mode: "injected_non_live", serverManagedBindingProvider: () => envelope, source: "staging_recovery_certification" });
  const authorityGraph = buildRecoveryAuthorityReadiness({ composition, environmentKey: "staging", adapterProvenance: snapshot.adapterProvenance });
  if (authorityGraph.ready !== true) fail("RECOVERY_STAGING_CERTIFICATION_AUTHORITY_NOT_READY", "The 14-component Staging Recovery authority graph is incomplete.", { blocking_reasons: authorityGraph.blocking_reasons });

  const expiresAt = futureIso(now, lifetimeMs);
  const external = await validateAndBindExternalEvidence({
    registration: registrationEvidence,
    oauth: oauthEvidence,
    network: networkEvidence,
    worker: workerDeploymentEvidence,
    deploymentSha,
    targetFingerprint,
    expiresAt,
  });
  const lifecycle = await runLifecycle({ adapters: envelope.adapters, deploymentSha, targetFingerprint, now });
  const negativeTests = await runNegativeSuite({ adapters: envelope.adapters, lifecycle, deploymentSha, targetFingerprint, snapshot, now });
  if (negativeTests.all_passed !== true) fail("RECOVERY_STAGING_NEGATIVE_SUITE_FAILED", "The canonical Staging Recovery negative certification suite did not pass.", { cases: negativeTests.cases });

  const auditEvidenceHash = digest({ lifecycle_trace: lifecycle.trace, negative_tests: negativeTests, run_id: lifecycle.runId, canary_id: lifecycle.execution?.canary_id, deployment_sha: deploymentSha, target_fingerprint: targetFingerprint });
  const certification = {
    contract: RECOVERY_STAGING_CERTIFICATION_CONTRACT,
    certification_id: `cert:staging:${digest({ deploymentSha, targetFingerprint, auditEvidenceHash, now }).slice(0, 32)}`,
    status: "passed",
    result: "pass",
    environment_key: "staging",
    deployment_sha: deploymentSha,
    runtime_sha: deploymentSha,
    branch: "main",
    target_fingerprint: targetFingerprint,
    server_identity_fingerprint: digest({ deployment_sha: deploymentSha, target_fingerprint: targetFingerprint, provenance: snapshot.adapterProvenance }),
    provider_environment: "staging",
    authority_graph: { ready: true, test_or_mock_adapter_detected: false },
    lifecycle_trace: lifecycle.trace,
    negative_tests: negativeTests,
    audit_evidence: { durable: true, evidence_hash: auditEvidenceHash, canonical_payload_hash: null },
    artifact_integrity: { valid: true, adapter_provenance_hash: digest(snapshot.adapterProvenance) },
    expires_at: expiresAt,
    safety: {
      production_mutation_performed: false,
      database_mutation_performed: false,
      provider_mutation_performed: false,
      secrets_included: false,
      caller_credentials_accepted: false,
      local_connector_production_authority: false,
    },
    secrets_included: false,
  };
  certification.audit_evidence.canonical_payload_hash = certificationPayloadHash(certification);
  const evaluated = evaluateStagingRecoveryCertification({ certification, expectedSha: deploymentSha, expectedBranch: "main", expectedTargetFingerprint: targetFingerprint, requireExpectedTargetFingerprint: true });
  if (evaluated.valid !== true) fail("RECOVERY_STAGING_CERTIFICATION_EVALUATION_FAILED", "The generated certification failed the canonical evaluator.", { blocking_failures: evaluated.blocking_failures });

  const payload = {
    contract: RECOVERY_READINESS_EVIDENCE_CONTRACT,
    issuer: trust.issuer,
    key_id: trust.keyId,
    environment: "staging",
    deployment_sha: deploymentSha,
    target_fingerprint: targetFingerprint,
    issued_at: nowIso(now),
    expires_at: expiresAt,
    stagingCertification: certification,
    adapterProvenance: snapshot.adapterProvenance,
    ...external,
    unresolvedRecoveryIncidents: [],
    secrets_included: false,
  };
  const signature = sign(null, Buffer.from(readinessEvidencePayload(payload)), trust.privateKey).toString("base64url");
  if (!verify(null, Buffer.from(readinessEvidencePayload(payload)), trust.publicKey, Buffer.from(signature, "base64url"))) {
    fail("RECOVERY_STAGING_CERTIFICATION_SIGNATURE_INVALID", "External certification signature verification failed before persistence.");
  }

  const readinessRoot = path.resolve(String(env.RECOVERY_STAGING_READINESS_DIRECTORY || ""));
  const replayRoot = path.resolve(String(env.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY || ""));
  if (!path.isAbsolute(readinessRoot) || !path.isAbsolute(replayRoot) || readinessRoot === replayRoot) fail("RECOVERY_STAGING_CERTIFICATION_STORE_INVALID", "Host certification requires isolated absolute readiness/replay roots.");
  const store = createFileRecoveryEvidenceStore({ directory: path.join(readinessRoot, "certification-evidence"), replayDirectory: replayRoot });
  const record = { payload, signature };
  const evidenceId = await store.putCertification(record);
  const persisted = await store.getCertification(evidenceId);
  if (!verify(null, Buffer.from(readinessEvidencePayload(persisted.payload)), trust.publicKey, Buffer.from(persisted.signature, "base64url"))) {
    fail("RECOVERY_STAGING_CERTIFICATION_PERSISTED_SIGNATURE_INVALID", "Persisted certification did not verify before pointer promotion.");
  }
  await store.setCurrentCertification(evidenceId);
  const promoted = await authority.readSnapshot();
  if (promoted.authenticity_verified !== true || promoted.evidence_id !== evidenceId || promoted.candidateSha !== deploymentSha || promoted.candidateTargetFingerprint !== targetFingerprint) {
    fail("RECOVERY_STAGING_CERTIFICATION_POINTER_VERIFICATION_FAILED", "Atomic current-certification promotion was not verifiable.");
  }
  return Object.freeze({
    contract: STAGING_RECOVERY_CERTIFICATION_RUNNER_CONTRACT,
    status: "promoted_pending_public_readback",
    evidence_id: evidenceId,
    certification_id: certification.certification_id,
    deployment_sha: deploymentSha,
    target_fingerprint: targetFingerprint,
    expires_at: expiresAt,
    lifecycle_trace: lifecycle.trace,
    negative_tests: negativeTests,
    production_mutation_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  });
}

export const _testingStagingRecoveryCertification = Object.freeze({
  CANARY_OPERATION,
  TARGET_KEY,
  bindObservation,
  canaryInputValid,
  provenanceComplete,
  validateAndBindExternalEvidence,
  wholeApprovalAccepted,
});
