import { createApprovalChallenge, createExecutionTicket, createStagingCertificationCanaryPlan, executeRemediationStep } from "./recoveryKernel.js";
import { createStagingAccessRepairTicketAuthority } from "./stagingAccessRepairTicketAuthority.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";
import { createStagingRebuildEmptyAuthority } from "./stagingRebuildEmptyAuthority.js";
import { buildStagingRebuildEmptyLocalHandoff } from "./stagingRebuildEmptyHandoff.js";
import { prepareStagingRecoveryGatewayDarkDeployDryRun } from "./stagingRecoveryGatewayPreflight.js";

export const STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT = "mad4b.staging-recovery-system-surface.v1";
export const STAGING_RECOVERY_SYSTEM_SOURCE_KEY = "staging_recovery_system_surface_v1";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const PLAN_ID_RE = /^plan:[0-9a-f]{32}$/u;
const STEP_ID_RE = /^step:[0-9a-f]{32}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const STAGING_CERTIFICATION_CANARY_CAPABILITY = "staging.certification.canary";
const STAGING_CERTIFICATION_CANARY_TARGET = "staging-recovery-certification";
const STAGING_ENVIRONMENT_VALUES = new Set(["staging", "stage", "staging_local_windows_docker"]);
const PRODUCTION_ENVIRONMENT_VALUES = new Set(["production", "prod", "production_hostinger_autodeploy"]);

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function systemError(status, code, message, details = {}) {
  return Object.assign(new Error(message), {
    status,
    code,
    details: { ...details, production_authority: false, secrets_included: false },
  });
}

function environmentSignals(env = process.env) {
  return [env.DEPLOYMENT_ENVIRONMENT, env.REMOTE_MCP_ENVIRONMENT, env.NODE_ENV]
    .map((value) => text(value, 96).toLowerCase())
    .filter(Boolean);
}

export function isStagingRecoverySystemEnvironment(env = process.env) {
  const values = environmentSignals(env);
  if (values.some((value) => PRODUCTION_ENVIRONMENT_VALUES.has(value))) return false;
  return values.some((value) => STAGING_ENVIRONMENT_VALUES.has(value));
}

function requireStagingEnvironment(env = process.env) {
  if (!isStagingRecoverySystemEnvironment(env)) {
    throw systemError(404, "STAGING_RECOVERY_SYSTEM_SURFACE_UNAVAILABLE", "Staging Recovery system tools are unavailable outside Staging.");
  }
  return env;
}

function graphFor(env = process.env) {
  requireStagingEnvironment(env);
  stagingRecoveryAuthorityInternals.runtime({
    environment: "staging",
    runtime_class: "local_windows_docker",
    requested_mode: "injected_non_live",
    production_live: false,
  }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  return stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
}

function requireObject(input, allowedKeys, requiredKeys, code) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw systemError(400, code, "Staging Recovery system-tool input must be a JSON object.");
  }
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  const missing = requiredKeys.filter((key) => input[key] === undefined || input[key] === null || input[key] === "");
  if (unexpected.length || missing.length) {
    throw systemError(400, code, "Staging Recovery system-tool input is outside the fixed contract.", {
      unexpected_fields: unexpected,
      missing_fields: missing,
    });
  }
  return input;
}

function requireSha40(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA40_RE.test(normalized)) throw systemError(400, "STAGING_RECOVERY_SHA_INVALID", `${field} must be an exact 40-character Git SHA.`, { field });
  return normalized;
}

function requireSha256(value, field) {
  const normalized = text(value, 128).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw systemError(400, "STAGING_RECOVERY_BINDING_INVALID", `${field} must be a SHA-256 digest.`, { field });
  return normalized;
}

function requireSafeId(value, field, pattern = SAFE_ID_RE) {
  const normalized = text(value, 180);
  if (!pattern.test(normalized)) throw systemError(400, "STAGING_RECOVERY_BINDING_INVALID", `${field} is invalid.`, { field });
  return normalized;
}

function canaryApprovalConfirmation(plan, step) {
  return `APPROVE_STAGING_RECOVERY_CERTIFICATION_CANARY:${plan.plan_hash}:${step.step_hash}:${plan.expected_sha}:${plan.target_key}:${plan.target_fingerprint}`;
}

async function resolveCertificationCanaryPlan(graph, input = {}) {
  const planId = requireSafeId(input.plan_id, "plan_id", PLAN_ID_RE);
  const planHash = requireSha256(input.plan_hash, "plan_hash");
  const stepId = requireSafeId(input.step_id, "step_id", STEP_ID_RE);
  const plan = await graph.recoveryStore?.getPlan?.(planId);
  const step = Array.isArray(plan?.steps) ? plan.steps.find((entry) => entry.step_id === stepId) : null;
  if (!plan
    || plan.plan_hash !== planHash
    || plan.environment !== "staging"
    || plan.branch !== "main"
    || plan.target_key !== STAGING_CERTIFICATION_CANARY_TARGET
    || plan.production_live_enabled !== false
    || plan.database_mutation_performed !== false
    || plan.provider_mutation_performed !== false
    || !step
    || step.capability_key !== STAGING_CERTIFICATION_CANARY_CAPABILITY
    || step.operation !== STAGING_CERTIFICATION_CANARY_CAPABILITY
    || step.target_role !== "runtime") {
    throw systemError(409, "STAGING_RECOVERY_CANARY_BINDING_MISMATCH", "The references do not resolve to the fixed Staging certification canary plan.");
  }
  const attestation = await graph.deploymentIdentityProvider?.readAttestation?.();
  const deploymentSha = text(attestation?.sha || attestation?.deployment_sha, 64).toLowerCase();
  if (attestation?.environment !== "staging"
    || attestation?.branch !== "main"
    || deploymentSha !== plan.expected_sha
    || text(attestation?.target_fingerprint, 128).toLowerCase() !== text(plan.target_fingerprint, 128).toLowerCase()) {
    throw systemError(412, "STAGING_RECOVERY_CANARY_DEPLOYMENT_MISMATCH", "The certification canary is not bound to the exact current Staging deployment and target.");
  }
  return { plan, step };
}

async function ensureCertificationCanaryApproval(graph, plan, step) {
  let approval = await graph.recoveryStore?.getApprovalByPlanStep?.(plan.plan_id, step.step_id);
  if (!approval) {
    await createApprovalChallenge(
      { plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id },
      { recoveryStore: graph.recoveryStore, approvalIssuer: graph.approvalIssuer, approvalStore: graph.approvalStore },
    );
    approval = await graph.recoveryStore?.getApprovalByPlanStep?.(plan.plan_id, step.step_id);
  }
  if (!approval || approval.used === true || !approval.expires_at || Date.parse(approval.expires_at) <= Date.now()) {
    throw systemError(401, "STAGING_RECOVERY_CANARY_APPROVAL_INVALID", "A current server-managed approval challenge is required for the exact Staging certification canary step.");
  }
  return approval;
}

async function resolveCertificationCanaryApprovalToken(graph, approval, plan, step, idempotencyKey) {
  const resolver = graph.approvalStore?.resolveApprovedExecutionApproval;
  if (typeof resolver !== "function") {
    throw systemError(503, "STAGING_RECOVERY_SERVER_APPROVAL_RESOLVER_UNAVAILABLE", "The Staging Recovery approval store cannot resolve approved execution material server-side.");
  }
  const resolved = await resolver.call(graph.approvalStore, {
    approval_id: approval.approval_id,
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    step_hash: step.step_hash,
    expected_sha: plan.expected_sha,
    target_key: plan.target_key,
    target_fingerprint: step.target_fingerprint || plan.target_fingerprint,
    target_role: step.target_role,
    idempotency_key: idempotencyKey,
    admin_principal_verified: true,
    secrets_included: false,
  });
  const token = typeof resolved === "string" ? resolved : text(resolved?.approval_token, 512);
  if (!token || token.length < 16) {
    throw systemError(401, "STAGING_RECOVERY_CANARY_APPROVAL_UNRESOLVED", "The server-managed Staging approval could not be resolved for the exact certification canary step.");
  }
  return token;
}

const CANARY_SENSITIVE_EVIDENCE_KEYS = new Set([
  "approval_token",
  "server_token",
  "execution_ticket_id",
  "execution_ticket_hash",
  "signature",
]);

function redactCanarySensitiveEvidence(value) {
  if (Array.isArray(value)) return value.map((entry) => redactCanarySensitiveEvidence(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !CANARY_SENSITIVE_EVIDENCE_KEYS.has(key))
      .map(([key, entry]) => [key, redactCanarySensitiveEvidence(entry)]),
  );
}

function sanitizeCanaryReplay(value = {}) {
  const safe = redactCanarySensitiveEvidence(value || {});
  return {
    ...safe,
    approval_token_returned: false,
    execution_ticket_returned: false,
    production_authority: false,
    secrets_included: false,
  };
}

export async function stagingRecoveryCertificationCanaryPlanCreate(input = {}, { env = process.env } = {}) {
  requireStagingEnvironment(env);
  requireObject(input, ["expected_sha"], ["expected_sha"], "STAGING_RECOVERY_CANARY_PLAN_INPUT_INVALID");
  const expectedSha = requireSha40(input.expected_sha, "expected_sha");
  const graph = graphFor(env);
  const plan = await createStagingCertificationCanaryPlan({ expected_sha: expectedSha }, {
    env,
    recoveryStore: graph.recoveryStore,
    deploymentIdentityProvider: graph.deploymentIdentityProvider,
  });
  const step = Array.isArray(plan.steps) ? plan.steps[0] : null;
  return {
    ...plan,
    status: "approval_required",
    approval_confirmation: step ? canaryApprovalConfirmation(plan, step) : null,
    approval_token_returned: false,
    execution_ticket_returned: false,
    surface_contract: STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT,
    control_plane_state_written: true,
    target_database_mutation_performed: false,
    provider_mutation_performed: false,
    production_authority: false,
    secrets_included: false,
  };
}

export async function stagingRecoveryCertificationCanaryApprove(input = {}, { env = process.env } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
    ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
    "STAGING_RECOVERY_CANARY_APPROVE_INPUT_INVALID",
  );
  const graph = graphFor(env);
  const idempotencyKey = requireSafeId(input.idempotency_key, "idempotency_key");
  const { plan, step } = await resolveCertificationCanaryPlan(graph, input);
  if (text(input.approval_confirmation, 1024) !== canaryApprovalConfirmation(plan, step)) {
    throw systemError(401, "STAGING_RECOVERY_CANARY_APPROVAL_INVALID", "Exact high-level Staging certification canary approval confirmation is required.", {
      confirmation_formula: "APPROVE_STAGING_RECOVERY_CERTIFICATION_CANARY:<plan_hash>:<step_hash>:<expected_sha>:staging-recovery-certification:<target_fingerprint>",
    });
  }
  if (plan.execution_ticket_id || plan.status === "approved") {
    if (plan.approval_idempotency_key === idempotencyKey && plan.execution_ticket_id && plan.execution_ticket_hash) {
      return {
        ok: true,
        contract: "mad4b.staging-recovery-certification-canary-approval.v1",
        status: "ticket_already_issued",
        plan_id: plan.plan_id,
        plan_hash: plan.plan_hash,
        step_id: step.step_id,
        expected_sha: plan.expected_sha,
        approval_token_returned: false,
        execution_ticket_returned: false,
        production_authority: false,
        database_mutation_performed: false,
        provider_mutation_performed: false,
        secrets_included: false,
      };
    }
    throw systemError(409, "STAGING_RECOVERY_CANARY_APPROVAL_ALREADY_ISSUED", "The certification canary approval has already issued a single-use execution ticket.");
  }
  const approval = await ensureCertificationCanaryApproval(graph, plan, step);
  const approvalToken = await resolveCertificationCanaryApprovalToken(graph, approval, plan, step, idempotencyKey);
  const ticket = await createExecutionTicket({
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    approval_token: approvalToken,
    idempotency_key: idempotencyKey,
  }, {
    recoveryStore: graph.recoveryStore,
    executionTicketSigner: graph.executionTicketSigner,
    deploymentIdentityProvider: graph.deploymentIdentityProvider,
    approvalVerifier: graph.approvalVerifier,
    approvalStore: graph.approvalStore,
  });
  await graph.recoveryStore.putPlan({
    ...plan,
    status: "approved",
    approval_id: approval.approval_id,
    approval_idempotency_key: idempotencyKey,
    execution_ticket_id: ticket.ticket_id,
    execution_ticket_hash: ticket.ticket_hash,
  });
  return {
    ok: true,
    contract: "mad4b.staging-recovery-certification-canary-approval.v1",
    status: "ticket_issued",
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    expected_sha: plan.expected_sha,
    approval_id: approval.approval_id,
    approval_token_returned: false,
    execution_ticket_returned: false,
    single_use: true,
    production_authority: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

export async function stagingRecoveryCertificationCanaryExecute(input = {}, { env = process.env } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["plan_id", "plan_hash", "step_id", "idempotency_key"],
    ["plan_id", "plan_hash", "step_id", "idempotency_key"],
    "STAGING_RECOVERY_CANARY_EXECUTE_INPUT_INVALID",
  );
  const graph = graphFor(env);
  const idempotencyKey = requireSafeId(input.idempotency_key, "idempotency_key");
  const { plan, step } = await resolveCertificationCanaryPlan(graph, input);
  const existing = await graph.recoveryStore.getRunByIdempotency?.(idempotencyKey);
  if (existing) {
    if ((existing.plan_hash && existing.plan_hash !== plan.plan_hash) || (existing.step_id && existing.step_id !== step.step_id)) {
      throw systemError(409, "STAGING_RECOVERY_CANARY_IDEMPOTENCY_BINDING_MISMATCH", "The idempotency key is already bound to a different Recovery plan or step.");
    }
    return sanitizeCanaryReplay({
      ...existing,
      status: existing.phase === "execution_outcome_unknown" || existing.status === "execution_outcome_unknown"
        ? "reconciliation_required"
        : existing.status,
      reconciliation_required: existing.phase === "execution_outcome_unknown" || existing.status === "execution_outcome_unknown",
      idempotent_replay: true,
    });
  }
  if (!plan.execution_ticket_id || !plan.execution_ticket_hash || plan.approval_idempotency_key !== idempotencyKey) {
    throw systemError(409, "STAGING_RECOVERY_CANARY_EXECUTION_TICKET_REQUIRED", "The certification canary requires the server-issued single-use ticket bound to the same idempotency key.");
  }
  const ticket = await graph.recoveryStore.getExecutionTicket(plan.execution_ticket_id);
  if (!ticket || ticket.ticket_hash !== plan.execution_ticket_hash) {
    throw systemError(409, "STAGING_RECOVERY_CANARY_EXECUTION_TICKET_INVALID", "The server-issued certification canary execution ticket is unavailable or rebound.");
  }
  const approval = await graph.recoveryStore.getApprovalByPlanStep(plan.plan_id, step.step_id);
  const approvalToken = await resolveCertificationCanaryApprovalToken(graph, approval, plan, step, idempotencyKey);
  const result = await executeRemediationStep({
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    approval_token: approvalToken,
    idempotency_key: idempotencyKey,
    execution_ticket_id: ticket.ticket_id,
  }, {
    env,
    adminPrincipal: { verified: true, binding: "admin_guard_auth_context" },
    approvalVerifier: graph.approvalVerifier,
    approvalStore: graph.approvalStore,
    recoveryLock: graph.recoveryLock,
    mutationExecutor: graph.mutationExecutor,
    recoveryStore: graph.recoveryStore,
    readbackVerifier: graph.readbackVerifier,
    deploymentIdentityProvider: graph.deploymentIdentityProvider,
    migrationLedger: graph.migrationLedger,
  });
  return {
    ...sanitizeCanaryReplay(result),
    contract: "mad4b.staging-recovery-certification-canary-execution.v1",
    database_mutation_performed: false,
    provider_mutation_performed: false,
  };
}

export async function stagingRecoveryAccessRepairPrepare(input = {}, { env = process.env } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["expected_sha", "idempotency_key"],
    ["expected_sha", "idempotency_key"],
    "STAGING_RECOVERY_ACCESS_REPAIR_PREPARE_INPUT_INVALID",
  );
  const graph = graphFor(env);
  const attestation = await graph.deploymentIdentityProvider.readAttestation();
  const targetFingerprint = requireSha256(attestation?.target_fingerprint, "target_fingerprint");
  const authority = createStagingAccessRepairTicketAuthority({ env });
  const result = await authority.prepare({
    expected_sha: requireSha40(input.expected_sha, "expected_sha"),
    target_key: "staging-runtime",
    target_fingerprint: targetFingerprint,
    idempotency_key: requireSafeId(input.idempotency_key, "idempotency_key"),
  });
  return {
    ...result,
    target_fingerprint_source: "server_derived_deployment_attestation",
    caller_selected_target_fingerprint: false,
    target_database_mutation_performed: false,
    provider_mutation_performed: false,
    production_authority: false,
    secrets_included: false,
  };
}

export async function stagingRecoveryAccessRepairExecute(input = {}, { env = process.env, adapters = null } = {}) {
  requireStagingEnvironment(env);
  requireObject(input, ["plan_id", "plan_hash", "step_id", "idempotency_key"], ["plan_id", "plan_hash", "step_id", "idempotency_key"], "STAGING_RECOVERY_ACCESS_REPAIR_EXECUTE_INPUT_INVALID");
  const injected = Object.fromEntries(Object.entries(adapters || {}).filter(([, value]) => value !== undefined && value !== null));
  const effectiveAdapters = { ...graphFor(env), ...injected };
  const authority = createStagingAccessRepairTicketAuthority({ env, adapters: effectiveAdapters });
  const resolved = await authority.resolveExecution({
    plan_id: requireSafeId(input.plan_id, "plan_id", PLAN_ID_RE),
    plan_hash: requireSha256(input.plan_hash, "plan_hash"),
    step_id: requireSafeId(input.step_id, "step_id", STEP_ID_RE),
  });
  const result = await executeRemediationStep({
    plan_id: resolved.plan.plan_id,
    plan_hash: resolved.plan.plan_hash,
    step_id: resolved.step.step_id,
    approval_token: resolved.approval_token,
    idempotency_key: requireSafeId(input.idempotency_key, "idempotency_key"),
    execution_ticket_id: resolved.ticket.ticket_id,
  }, {
    env,
    adminPrincipal: { verified: true, binding: "admin_guard_auth_context" },
    approvalVerifier: effectiveAdapters.approvalVerifier,
    approvalStore: effectiveAdapters.approvalStore,
    recoveryLock: effectiveAdapters.recoveryLock,
    mutationExecutor: typeof effectiveAdapters.hostBreakglassMutationExecutor === "function"
      ? { execute: effectiveAdapters.hostBreakglassMutationExecutor }
      : effectiveAdapters.hostBreakglassMutationExecutor,
    recoveryStore: effectiveAdapters.recoveryStore,
    readbackVerifier: effectiveAdapters.readbackVerifier,
    deploymentIdentityProvider: effectiveAdapters.deploymentIdentityProvider,
  });
  const { execution_ticket_id: _ticketId, execution_ticket_hash: _ticketHash, approval_token: _approvalToken, ...safeResult } = result || {};
  return { ...safeResult, execution_ticket_returned: false, approval_token_returned: false, production_authority: false, secrets_included: false };
}

export async function stagingRecoveryAccessRepairApprove(input = {}, { env = process.env } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
    ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
    "STAGING_RECOVERY_ACCESS_REPAIR_APPROVE_INPUT_INVALID",
  );
  const authority = createStagingAccessRepairTicketAuthority({ env });
  return authority.approveAndIssue({
    plan_id: requireSafeId(input.plan_id, "plan_id", PLAN_ID_RE),
    plan_hash: requireSha256(input.plan_hash, "plan_hash"),
    step_id: requireSafeId(input.step_id, "step_id", STEP_ID_RE),
    idempotency_key: requireSafeId(input.idempotency_key, "idempotency_key"),
    approval_confirmation: text(input.approval_confirmation, 1024),
  });
}

export async function stagingRecoveryRebuildEmptyInspectionRecord(input = {}, { env = process.env, adapters = null } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["expected_sha", "target_key", "correlation_id", "inspection", "role_bundle_bindings"],
    ["expected_sha", "target_key", "correlation_id", "inspection", "role_bundle_bindings"],
    "STAGING_RECOVERY_REBUILD_EMPTY_INSPECTION_INPUT_INVALID",
  );
  const authority = createStagingRebuildEmptyAuthority({ env, adapters });
  return authority.recordInspection({
    ...input,
    expected_sha: requireSha40(input.expected_sha, "expected_sha"),
    target_key: text(input.target_key, 128),
    correlation_id: requireSafeId(input.correlation_id, "correlation_id"),
  });
}

export async function stagingRecoveryRebuildEmptyPrepare(input = {}, { env = process.env, adapters = null } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["expected_sha", "inspection_run_id", "idempotency_key"],
    ["expected_sha", "inspection_run_id", "idempotency_key"],
    "STAGING_RECOVERY_REBUILD_EMPTY_PREPARE_INPUT_INVALID",
  );
  const authority = createStagingRebuildEmptyAuthority({ env, adapters });
  return authority.prepare({
    expected_sha: requireSha40(input.expected_sha, "expected_sha"),
    inspection_run_id: requireSafeId(input.inspection_run_id, "inspection_run_id"),
    idempotency_key: requireSafeId(input.idempotency_key, "idempotency_key"),
  });
}

export async function stagingRecoveryRebuildEmptyApprove(input = {}, { env = process.env, adapters = null } = {}) {
  requireStagingEnvironment(env);
  requireObject(
    input,
    ["expected_sha", "inspection_run_id", "idempotency_key", "approval_confirmation"],
    ["expected_sha", "inspection_run_id", "idempotency_key", "approval_confirmation"],
    "STAGING_RECOVERY_REBUILD_EMPTY_APPROVE_INPUT_INVALID",
  );
  const idempotencyKey = requireSafeId(input.idempotency_key, "idempotency_key");
  const authority = createStagingRebuildEmptyAuthority({ env, adapters });
  const issued = await authority.approveAndIssue({
    expected_sha: requireSha40(input.expected_sha, "expected_sha"),
    inspection_run_id: requireSafeId(input.inspection_run_id, "inspection_run_id"),
    idempotency_key: idempotencyKey,
    approval_confirmation: text(input.approval_confirmation, 1024),
  });
  const roleHandoffs = [];
  for (const roleIssuance of issued.role_issuances || []) {
    const handoff = await buildStagingRebuildEmptyLocalHandoff({
      issued: roleIssuance,
      idempotencyKey: roleIssuance.idempotency_key,
      broker: adapters || {},
    });
    roleHandoffs.push({
      role: roleIssuance.target_role,
      capability_key: roleIssuance.canonical_capability_key,
      plan_id: roleIssuance.plan_id,
      authority_plan_hash: roleIssuance.authority_plan_hash,
      step_id: roleIssuance.step_id,
      execution_ticket_id: roleIssuance.execution_ticket_id,
      execution_ticket_hash: roleIssuance.execution_ticket_hash,
      ...handoff,
    });
  }
  if (roleHandoffs.length !== issued.selected_zero_object_roles?.length) {
    throw systemError(503, "STAGING_REBUILD_EMPTY_ROLE_HANDOFF_INCOMPLETE", "Every server-selected rebuild role must resolve to one verified local handoff.", {
      selected_role_count: issued.selected_zero_object_roles?.length || 0,
      handoff_count: roleHandoffs.length,
    });
  }
  return {
    ...issued,
    status: "role_execution_tickets_issued_local_handoffs_ready",
    role_handoffs: roleHandoffs,
    handoff_count: roleHandoffs.length,
    caller_selected_plan_or_step: false,
    database_mutation_performed: false,
    grant_mutation_performed: false,
    production_authority: false,
    secrets_included: false,
  };
}

export async function stagingRecoveryActivationGatewayDarkDeployDryRun(input = {}, { env = process.env, ...deps } = {}) {
  requireStagingEnvironment(env);
  const result = await prepareStagingRecoveryGatewayDarkDeployDryRun(input, { ...deps, env });
  return {
    ...result,
    system_tool: "prepareStagingActivationGatewayDarkDeployDryRun",
    system_surface_contract: STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT,
    caller_selected_account_id: false,
    caller_selected_script_name: false,
    caller_selected_resource_binding: false,
    caller_selected_capability_envelope: false,
    provider_target_caller_selectable: false,
    provider_accessed: false,
    provider_mutation_performed: false,
    target_database_mutation_performed: false,
    production_mutation_performed: false,
    production_authority: false,
    secrets_included: false,
  };
}

export async function stagingRecoverySystemSurfaceReadiness(_input = {}, { env = process.env } = {}) {
  const available = isStagingRecoverySystemEnvironment(env);
  if (!available) {
    return {
      ok: true,
      status: "pass",
      classification: "staging_recovery_system_surface_not_advertised_outside_staging",
      available: false,
      production_authority: false,
      mutations_executed: false,
      secrets_included: false,
    };
  }
  const graph = graphFor(env);
  const approvalResolverReady = typeof graph.approvalStore?.resolveApprovedExecutionApproval === "function";
  if (!approvalResolverReady) {
    return {
      ok: false,
      status: "blocked",
      classification: "staging_recovery_server_approval_resolver_unavailable",
      available: false,
      environment: "staging",
      production_authority: false,
      mutations_executed: false,
      secrets_included: false,
    };
  }
  return {
    ok: true,
    status: "pass",
    classification: "staging_recovery_system_surface_ready",
    available: true,
    environment: "staging",
    target_key: "staging-runtime",
    control_plane_target_fingerprint_source: "server_derived_deployment_attestation",
    rebuild_database_target_fingerprint_source: "runtime_bootstrap_target_binding_from_local_exact_environment",
    rebuild_capability_authority: "role_specific_recovery_kernel_capabilities",
    rebuild_role_capability_keys: ["runtime.baseline.rebuild_empty", "governance.baseline.rebuild_empty", "runtime_persistence.baseline.rebuild_empty"],
    caller_selected_target: false,
    caller_selected_target_fingerprint: false,
    caller_selected_rebuild_role: false,
    caller_selected_rebuild_plan_or_step: false,
    server_managed_approval_resolver_ready: true,
    dedicated_certification_canary_approve_execute: true,
    production_authority: false,
    raw_sql_allowed: false,
    caller_command_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

const descriptors = Object.freeze([
  {
    name: "staging_recovery_certification_canary_plan_create",
    handler: "stagingRecoveryCertificationCanaryPlanCreate",
    description: "Staging-only Admin Recovery control-plane operation. Creates and durably persists an exact-SHA certification canary plan bound to the server-derived Staging target. It does not execute the canary and performs no target-database, provider, Production, DNS, or deployment mutation.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_certification_canary_plan_create",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "control_plane", "plan"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha"],
      properties: { expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" } },
    },
  },
  {
    name: "staging_recovery_certification_canary_approve",
    handler: "stagingRecoveryCertificationCanaryApprove",
    description: "Staging-only Admin Recovery operation. Consumes the exact high-level certification-canary confirmation, resolves approval material only inside the server, and issues one signed single-use execution ticket without returning approval tokens, ticket identifiers, signatures, SQL, commands, credentials, or Production authority.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: STAGING_CERTIFICATION_CANARY_CAPABILITY,
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "certification", "canary", "approval"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
      properties: {
        plan_id: { type: "string", pattern: "^plan:[0-9a-f]{32}$" },
        plan_hash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        step_id: { type: "string", pattern: "^step:[0-9a-f]{32}$" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
        approval_confirmation: { type: "string", minLength: 32, maxLength: 1024 },
      },
    },
  },
  {
    name: "staging_recovery_certification_canary_execute",
    handler: "stagingRecoveryCertificationCanaryExecute",
    description: "Staging-only Admin Recovery operation. Resolves the approved canary, approval material and server-issued single-use ticket internally, executes only staging.certification.canary under the fenced Recovery authority, and requires independent same-cycle readback. It grants no Production, SQL, provider, DNS, or deployment authority.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: STAGING_CERTIFICATION_CANARY_CAPABILITY,
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "certification", "canary", "execute"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["plan_id", "plan_hash", "step_id", "idempotency_key"],
      properties: {
        plan_id: { type: "string", pattern: "^plan:[0-9a-f]{32}$" },
        plan_hash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        step_id: { type: "string", pattern: "^step:[0-9a-f]{32}$" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
      },
    },
  },
  {
    name: "staging_recovery_access_repair_prepare",
    handler: "stagingRecoveryAccessRepairPrepare",
    description: "Staging-only Admin Recovery operation. Creates the fixed database-access-repair plan and server-managed approval challenge for staging-runtime using the server-derived deployment target fingerprint. Caller-selected target identity, SQL, commands, operation, target key, credentials, and execution tickets are forbidden.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_database_access_repair",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "approval", "access_repair"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha", "idempotency_key"],
      properties: {
        expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
      },
    },
  },
  {
    name: "staging_recovery_access_repair_execute",
    handler: "stagingRecoveryAccessRepairExecute",
    description: "Staging-only Admin Recovery operation. Resolves the approved plan, canonical grant binding, single-use ticket, fixed Staging target and same-cycle readback entirely on the server, then executes only the bounded database access repair.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_database_access_repair",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "execute", "access_repair"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["plan_id", "plan_hash", "step_id", "idempotency_key"],
      properties: {
        plan_id: { type: "string", pattern: "^plan:[0-9a-f]{32}$" },
        plan_hash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        step_id: { type: "string", pattern: "^step:[0-9a-f]{32}$" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
      },
    },
  },
  {
    name: "staging_recovery_access_repair_approve",
    handler: "stagingRecoveryAccessRepairApprove",
    description: "Staging-only Admin Recovery operation. Consumes the exact high-level access-repair confirmation and issues one server-signed, single-use execution ticket without returning approval material, signatures, SQL, commands, or credentials.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_database_access_repair",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "approval", "ticket"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
      properties: {
        plan_id: { type: "string", pattern: "^plan:[0-9a-f]{32}$" },
        plan_hash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        step_id: { type: "string", pattern: "^step:[0-9a-f]{32}$" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
        approval_confirmation: { type: "string", minLength: 32, maxLength: 1024 },
      },
    },
  },
  {
    name: "staging_recovery_rebuild_empty_inspection_record",
    handler: "stagingRecoveryRebuildEmptyInspectionRecord",
    description: "Staging-only canonical Recovery inspection ingress. Persists an exact-SHA read-only three-role census, classifies findings through RecoveryKernel.findingsFromInspection, and never accepts a caller-selected rebuild role.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "database_full_inspection",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "inspection", "rebuild_empty", "canonical_findings"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha", "target_key", "correlation_id", "inspection", "role_bundle_bindings"],
      properties: {
        expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        target_key: { const: "staging-runtime" },
        correlation_id: { type: "string", minLength: 8, maxLength: 160 },
        inspection: { type: "object" },
        role_bundle_bindings: { type: "object" },
      },
    },
  },
  {
    name: "staging_recovery_rebuild_empty_prepare",
    handler: "stagingRecoveryRebuildEmptyPrepare",
    description: "Staging-only canonical Recovery planning operation. Builds one remediation-plan.v1 step per server-selected zero-object role using the role-specific baseline.rebuild_empty capabilities and one set-bound approval confirmation.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "remediation_plan_create",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "plan", "approval", "rebuild_empty", "role_specific_capability"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha", "inspection_run_id", "idempotency_key"],
      properties: {
        expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        inspection_run_id: { type: "string", minLength: 12, maxLength: 180 },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
      },
    },
  },
  {
    name: "staging_recovery_rebuild_empty_approve",
    handler: "stagingRecoveryRebuildEmptyApprove",
    description: "Staging-only canonical Recovery approval/handoff operation. Approves the complete server-derived role-plan set and returns one verified local Host Breakglass handoff per role-specific baseline.rebuild_empty step; caller-selected plan, step, or role is forbidden.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "remediation_step_execute",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "approval", "ticket", "local_handoff", "rebuild_empty", "role_specific_capability"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha", "inspection_run_id", "idempotency_key", "approval_confirmation"],
      properties: {
        expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        inspection_run_id: { type: "string", minLength: 12, maxLength: 180 },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
        approval_confirmation: { type: "string", minLength: 32, maxLength: 1024 },
      },
    },
  },
  {
    name: "prepareStagingActivationGatewayDarkDeployDryRun",
    handler: "stagingRecoveryActivationGatewayDarkDeployDryRun",
    description: "Staging-only Admin Recovery dry-run for the profile-owned Activation Gateway Worker. The caller supplies only the exact source commit, policy hash, and environment-convergence-plan digest; account, script, resource binding, workspace and capability authority remain server-resolved. It may persist only the short-lived Governance execution plan when all readiness checks pass and never contacts or mutates the provider.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "activation_gateway_dark_deploy_dry_run",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "activation_gateway", "dry_run", "server_resolved_target", "no_provider_write"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_source_commit", "expected_policy_hash", "environment_convergence_plan_sha256"],
      properties: {
        expected_source_commit: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        expected_policy_hash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        environment_convergence_plan_sha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
      },
    },
  },
  {
    name: "staging_recovery_system_surface_readiness",
    handler: "stagingRecoverySystemSurfaceReadiness",
    description: "Staging-only Admin diagnostic for the fixed Recovery System Tool surface. Verifies concrete Staging recovery authorities are constructible without executing a mutation or exposing secrets.",
    source_key: STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
    capability_key: "staging_recovery_system_surface_readiness",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "private", "readiness"],
    requires_admin: true,
    inputSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
]);

export function buildStagingRecoverySystemTools(env = process.env) {
  return isStagingRecoverySystemEnvironment(env) ? descriptors.map((tool) => ({ ...tool })) : [];
}

export const STAGING_RECOVERY_SYSTEM_TOOLS = Object.freeze(buildStagingRecoverySystemTools(process.env));

export const _testingStagingRecoverySystemTools = Object.freeze({
  sanitizeCanaryReplay,
  redactCanarySensitiveEvidence,
});
