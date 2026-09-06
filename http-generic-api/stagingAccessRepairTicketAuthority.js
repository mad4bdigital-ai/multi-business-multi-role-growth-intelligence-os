import { createHash, randomUUID } from "node:crypto";
import { createApprovalChallenge } from "./recoveryKernel.js";
import { issueExecutionTicket } from "./recoveryExecutionTicket.js";
import { buildApprovalBinding } from "./recoveryExecutionBinding.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";

export const STAGING_ACCESS_REPAIR_TICKET_AUTHORITY_CONTRACT = "mad4b.staging-access-repair-ticket-authority.v1";
export const STAGING_ACCESS_REPAIR_CAPABILITY = "staging_database_access_repair";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const PLAN_ID = /^plan:[0-9a-f]{32}$/u;
const STEP_ID = /^step:[0-9a-f]{32}$/u;

const text = (value, max = 512) => String(value ?? "").trim().slice(0, max);
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function fail(code, message, details = {}, status = 409) {
  throw Object.assign(new Error(message), { code, status, details: { ...details, secrets_included: false } });
}

function sha(value, field, pattern = SHA256) {
  const normalized = text(value, 128).toLowerCase();
  if (!pattern.test(normalized)) fail(field === "expected_sha" ? "STAGING_SHA_MISMATCH" : "RECOVERY_TICKET_BINDING_MISMATCH", `${field} is invalid.`, { field }, 400);
  return normalized;
}

function graphFor(env = process.env) {
  stagingRecoveryAuthorityInternals.runtime({ environment: "staging", runtime_class: "local_windows_docker", requested_mode: "injected_non_live", production_live: false }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  return stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
}

function normalizePrepare(input = {}) {
  const idempotencyKey = text(input.idempotency_key, 160);
  const targetKey = text(input.target_key || "staging-runtime", 128);
  if (!SAFE_ID.test(idempotencyKey)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "A bounded idempotency key is required.", {}, 400);
  if (targetKey !== "staging-runtime") fail("RECOVERY_TICKET_BINDING_MISMATCH", "Staging access repair is bound to staging-runtime.", { target_key: targetKey }, 400);
  return {
    expected_sha: sha(input.expected_sha, "expected_sha", SHA40),
    target_key: targetKey,
    target_fingerprint: sha(input.target_fingerprint, "target_fingerprint"),
    grant_binding_hash: sha(input.grant_binding_hash, "grant_binding_hash"),
    idempotency_key: idempotencyKey,
  };
}

function buildPlan(binding, attestation) {
  const findingBase = {
    contract: "mad4b.staging-access-repair-finding.v1",
    repair_key: STAGING_ACCESS_REPAIR_CAPABILITY,
    expected_sha: binding.expected_sha,
    target_key: binding.target_key,
    target_fingerprint: binding.target_fingerprint,
    grant_binding_hash: binding.grant_binding_hash,
    mutation_required: true,
    mutation_class: "C2",
    raw_sql_allowed: false,
    caller_command_allowed: false,
    server_derived: true,
    secrets_included: false,
  };
  const findingId = `finding:${digest(findingBase).slice(0, 32)}`;
  const stepBase = {
    ordinal: 1,
    finding_id: findingId,
    classification: "staging_database_access_repair",
    capability_key: STAGING_ACCESS_REPAIR_CAPABILITY,
    operation: "grants",
    target_role: "composite",
    target_fingerprint: binding.target_fingerprint,
    grant_binding_hash: binding.grant_binding_hash,
    mutation_class: "C2",
    consequential: true,
    approval_required: true,
    execution_ticket_required: true,
    verification_before_finalization: true,
    raw_sql_allowed: false,
    caller_command_allowed: false,
    rollback: "reconciliation_before_any_replay",
  };
  const stepHash = digest(stepBase);
  const step = { ...stepBase, step_id: `step:${stepHash.slice(0, 32)}`, step_hash: stepHash };
  const findingHash = digest([findingId]);
  const planIdentity = { expected_sha: binding.expected_sha, target_key: binding.target_key, target_fingerprint: binding.target_fingerprint, grant_binding_hash: binding.grant_binding_hash, finding_id: findingId, step_hash: stepHash, nonce: randomUUID() };
  const planId = `plan:${digest(planIdentity).slice(0, 32)}`;
  const base = {
    contract: "mad4b.recovery-remediation-plan.v1",
    plan_id: planId,
    environment: "staging",
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "main",
    expected_sha: binding.expected_sha,
    expected_sha_at_creation: binding.expected_sha,
    target_key: binding.target_key,
    target_fingerprint: binding.target_fingerprint,
    target_fingerprint_at_creation: binding.target_fingerprint,
    target_fingerprints: { composite: binding.target_fingerprint },
    runtime_attestation_hash: attestation.attestation_hash,
    finding_ids: [findingId],
    finding_hash: findingHash,
    grant_binding_hash: binding.grant_binding_hash,
    role_selection_hash: null,
    role_selection_proof: null,
    role_bundle_bindings: {},
    steps: [step],
    status: "planned",
    repair_key: STAGING_ACCESS_REPAIR_CAPABILITY,
    required_approval: "server_managed_staging_database_access_repair",
    execution_allowed: false,
    database_independent_control_plane: true,
    production_live_enabled: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    raw_sql_allowed: false,
    caller_command_allowed: false,
    secrets_included: false,
  };
  const plan = { ...base, plan_hash: digest(base) };
  return { finding: { finding_id: findingId, ...findingBase }, step, plan };
}

function approvalConfirmation(plan, step) {
  return `APPROVE_STAGING_DATABASE_ACCESS_REPAIR:${plan.plan_hash}:${step.step_hash}:${plan.expected_sha}:${plan.target_key}:${plan.grant_binding_hash}`;
}

async function attestExactDeployment(graph, binding) {
  if (!graph.deploymentIdentityProvider?.readAttestation) fail("RECOVERY_DEPLOYMENT_ATTESTATION_UNAVAILABLE", "Staging deployment attestation is unavailable.", {}, 503);
  const attestation = await graph.deploymentIdentityProvider.readAttestation();
  if (attestation.environment !== "staging" || attestation.branch !== "main" || attestation.sha !== binding.expected_sha || attestation.target_fingerprint !== binding.target_fingerprint) {
    fail(attestation.sha !== binding.expected_sha ? "STAGING_SHA_MISMATCH" : "RECOVERY_TICKET_BINDING_MISMATCH", "Staging access-repair approval is not bound to the exact deployment and target.", { deployment_sha: attestation.sha, target_match: attestation.target_fingerprint === binding.target_fingerprint }, 412);
  }
  return attestation;
}

export function createStagingAccessRepairTicketAuthority({ env = process.env } = {}) {
  const graph = graphFor(env);
  const store = graph.recoveryStore;
  if (!store?.putPlan || !store?.getPlan || !store?.putFinding || !store?.getApprovalByPlanStep || !store?.putExecutionTicket || !store?.reserveApproval || !store?.releaseApprovalReservation || !store?.markApprovalUsed || !graph.approvalIssuer?.createChallenge || !graph.approvalVerifier?.verify || !graph.executionTicketSigner?.sign) {
    fail("RECOVERY_APPROVAL_CHALLENGE_AUTHORITY_UNAVAILABLE", "Staging access-repair approval/ticket authorities are incomplete.", {}, 503);
  }
  return Object.freeze({
    contract: STAGING_ACCESS_REPAIR_TICKET_AUTHORITY_CONTRACT,
    capability: STAGING_ACCESS_REPAIR_CAPABILITY,
    production_authority: false,

    async prepare(input = {}) {
      const binding = normalizePrepare(input);
      const attestation = await attestExactDeployment(graph, binding);
      const { finding, step, plan } = buildPlan(binding, attestation);
      await store.putFinding(finding);
      await store.putPlan(plan);
      const challenge = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, { approvalIssuer: graph.approvalIssuer, approvalStore: graph.approvalStore, recoveryStore: store });
      return {
        ok: true,
        contract: STAGING_ACCESS_REPAIR_TICKET_AUTHORITY_CONTRACT,
        status: "approval_required",
        capability: STAGING_ACCESS_REPAIR_CAPABILITY,
        plan_id: plan.plan_id,
        plan_hash: plan.plan_hash,
        step_id: step.step_id,
        step_hash: step.step_hash,
        approval_id: challenge.approval_id,
        approval_hash: challenge.challenge_hash,
        approval_confirmation: approvalConfirmation(plan, step),
        approval_token_not_returned: true,
        execution_ticket_not_returned: true,
        expected_sha: plan.expected_sha,
        target_key: plan.target_key,
        target_fingerprint: plan.target_fingerprint,
        grant_binding_hash: plan.grant_binding_hash,
        raw_sql_allowed: false,
        caller_command_allowed: false,
        database_mutation_performed: false,
        secrets_included: false,
      };
    },

    async approveAndIssue(input = {}) {
      const planId = text(input.plan_id, 160);
      const planHash = sha(input.plan_hash, "plan_hash");
      const stepId = text(input.step_id, 160);
      const idempotencyKey = text(input.idempotency_key, 160);
      if (!PLAN_ID.test(planId) || !STEP_ID.test(stepId) || !SAFE_ID.test(idempotencyKey)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Approval references are invalid.", {}, 400);
      const plan = await store.getPlan(planId);
      if (!plan || plan.plan_hash !== planHash || plan.repair_key !== STAGING_ACCESS_REPAIR_CAPABILITY || plan.target_key !== "staging-runtime" || plan.environment !== "staging" || plan.raw_sql_allowed !== false || plan.caller_command_allowed !== false) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Approval references do not resolve to the fixed Staging access-repair plan.", {}, 409);
      const step = Array.isArray(plan.steps) ? plan.steps.find((entry) => entry.step_id === stepId) : null;
      if (!step || step.capability_key !== STAGING_ACCESS_REPAIR_CAPABILITY || step.operation !== "grants" || step.grant_binding_hash !== plan.grant_binding_hash) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Approval step is not the fixed grant-repair capability.", {}, 409);
      const expectedConfirmation = approvalConfirmation(plan, step);
      if (text(input.approval_confirmation, 1024) !== expectedConfirmation) fail("RECOVERY_APPROVAL_INVALID", "Exact high-level Staging access-repair approval confirmation is required.", { confirmation_formula: "APPROVE_STAGING_DATABASE_ACCESS_REPAIR:<plan_hash>:<step_hash>:<expected_sha>:staging-runtime:<grant_binding_hash>" }, 401);
      const attestation = await attestExactDeployment(graph, { expected_sha: plan.expected_sha, target_fingerprint: plan.target_fingerprint });
      const approval = await store.getApprovalByPlanStep(plan.plan_id, step.step_id);
      if (!approval || approval.used === true || Date.parse(approval.expires_at || 0) <= Date.now()) fail("RECOVERY_APPROVAL_INVALID", "The plan-bound approval challenge is absent, expired, or already used.", {}, 401);
      const issuedApproval = await graph.approvalIssuer.createChallenge(approval);
      const approvalToken = issuedApproval?.server_token;
      const approvalContext = {
        plan_hash: plan.plan_hash,
        step_id: step.step_id,
        step_hash: step.step_hash,
        expected_sha: plan.expected_sha,
        target_key: plan.target_key,
        target_fingerprint: plan.target_fingerprint,
        composite_target_fingerprint: plan.target_fingerprint,
        step_target_fingerprint: step.target_fingerprint,
        target_role: step.target_role,
        operation: step.operation,
        approval_id: approval.approval_id,
        approval_hash: approval.challenge_hash,
      };
      if ((await graph.approvalVerifier.verify({ token: approvalToken, approval, context: approvalContext })) !== true) fail("RECOVERY_APPROVAL_INVALID", "Server-managed approval verification failed closed.", {}, 401);
      const approvalBinding = buildApprovalBinding({ approvalId: approval.approval_id, approvalHash: approval.challenge_hash, approvalVersion: approval.approval_version || "v1", planHash: plan.plan_hash, stepId: step.step_id, stepHash: step.step_hash, targetKey: plan.target_key, targetFingerprint: plan.target_fingerprint, targetRole: step.target_role, operation: step.operation });
      const reservationContext = { ...approvalContext, approval_hash: approvalBinding.approval_hash, approval_binding_hash: approvalBinding.binding_hash, idempotency_key: idempotencyKey, execution_ticket_id: null };
      const reserved = await store.reserveApproval(reservationContext);
      if (reserved?.reserved !== true) fail("RECOVERY_APPROVAL_INVALID", "The approval challenge is already reserved or consumed.", { reconciliation_required: true }, 409);
      let ticketPersisted = false;
      try {
        const ticket = await issueExecutionTicket({
          inspection_run_id: `run:${digest({ plan_hash: plan.plan_hash, approval_id: approval.approval_id }).slice(0, 32)}`,
          inspection_evidence_hash: plan.finding_hash,
          finding_ids: plan.finding_ids,
          selected_roles: ["composite"],
          role_selection_required: false,
          role_object_count_fingerprints: {},
          target_fingerprints: { composite: plan.target_fingerprint },
          role_selection_hash: null,
          role_bundle_bindings: {},
          deployment_attestation_hash: attestation.attestation_hash,
          approval_id: approvalBinding.approval_id,
          approval_hash: approvalBinding.approval_hash,
          approval_version: approvalBinding.approval_version,
          approval_binding: approvalBinding,
          production_sha: plan.expected_sha,
          target_key: plan.target_key,
          target_fingerprint: plan.target_fingerprint,
          plan_hash: plan.plan_hash,
          step_hash: step.step_hash,
          step_id: step.step_id,
          target_role: "composite",
          operation: "grants",
          idempotency_key: idempotencyKey,
          grant_binding_hash: plan.grant_binding_hash,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          nonce: randomUUID(),
        }, { signer: graph.executionTicketSigner });
        await store.putExecutionTicket(ticket);
        ticketPersisted = true;
        try {
          await store.markApprovalUsed(approval.approval_id);
        } catch (error) {
          await store.appendEvidenceEvent?.(idempotencyKey, {
            event: "staging_access_repair_ticket_issuance_reconciliation_required",
            phase: "issued_unreconciled",
            ticket_id: ticket.ticket_id,
            ticket_hash: ticket.ticket_hash,
            plan_id: plan.plan_id,
            plan_hash: plan.plan_hash,
            step_id: step.step_id,
            approval_id: approval.approval_id,
            expected_sha: plan.expected_sha,
            target_key: plan.target_key,
            target_fingerprint: plan.target_fingerprint,
            grant_binding_hash: plan.grant_binding_hash,
            reconciliation_required: true,
            automatic_rerun_allowed: false,
            secrets_included: false,
          }).catch(() => {});
          fail("RECOVERY_RECONCILIATION_REQUIRED", "Execution ticket was durably persisted but approval consumption could not be finalized; reconciliation is required and automatic re-issuance is forbidden.", {
            ticket_id: ticket.ticket_id,
            ticket_hash: ticket.ticket_hash,
            plan_id: plan.plan_id,
            approval_id: approval.approval_id,
            ticket_persisted: true,
            reconciliation_required: true,
            automatic_rerun_allowed: false,
            cause_code: text(error?.code || error?.name || "mark_approval_used_failed", 128),
          }, 409);
        }
        await store.appendEvidenceEvent?.(idempotencyKey, {
          event: "staging_access_repair_ticket_issued",
          phase: "issued",
          ticket_id: ticket.ticket_id,
          ticket_hash: ticket.ticket_hash,
          plan_id: plan.plan_id,
          plan_hash: plan.plan_hash,
          step_id: step.step_id,
          approval_id: approval.approval_id,
          expected_sha: plan.expected_sha,
          target_key: plan.target_key,
          target_fingerprint: plan.target_fingerprint,
          grant_binding_hash: plan.grant_binding_hash,
          single_use: true,
          automatic_rerun_allowed: false,
          secrets_included: false,
        }).catch(() => {});
        return {
          ok: true,
          contract: STAGING_ACCESS_REPAIR_TICKET_AUTHORITY_CONTRACT,
          status: "ticket_issued",
          capability: STAGING_ACCESS_REPAIR_CAPABILITY,
          ticket_id: ticket.ticket_id,
          ticket_hash: ticket.ticket_hash,
          plan_id: plan.plan_id,
          plan_hash: plan.plan_hash,
          step_id: step.step_id,
          expected_sha: plan.expected_sha,
          target_key: plan.target_key,
          target_fingerprint: plan.target_fingerprint,
          grant_binding_hash: plan.grant_binding_hash,
          expires_at: ticket.expires_at,
          single_use: true,
          signature_not_returned: true,
          approval_token_not_returned: true,
          raw_sql_allowed: false,
          caller_command_allowed: false,
          database_mutation_performed: false,
          secrets_included: false,
        };
      } catch (error) {
        if (!ticketPersisted) await store.releaseApprovalReservation(reservationContext).catch(() => {});
        throw error;
      }
    },
  });
}

export const _testingStagingAccessRepairTicketAuthority = Object.freeze({ normalizePrepare, buildPlan, approvalConfirmation, digest, graphFor });
