import { createHash } from "node:crypto";
import { evaluateDelegationRenewalNoWidening } from "./delegationGrantLifecycleShadowService.js";

export const DELEGATION_EXECUTION_POLICY_VERSION = "spec011-delegation-execution-policy-v1";

const MODES = new Set([
  "user_approval_only",
  "agent_recommend_only",
  "agent_queue_for_approval",
  "delegated_low_risk",
  "delegated_plan_bound",
  "human_on_exception",
  "multi_agent_approval",
]);
const RISK_ORDER = Object.freeze({ read_only: 0, low: 1, medium: 2, high: 3, critical: 4 });
const RESERVED_INTENTS = new Set([
  "repo.pr.merge",
  "production.deploy",
  "database.migration.apply",
  "credential.write",
  "permission.write",
  "billing.write",
  "external.publish",
  "external.send",
  "destructive.execute",
]);
const DRIFT_FIELDS = Object.freeze([
  "plan_hash",
  "resource_snapshot_hash",
  "head_sha",
  "base_sha",
  "migration_checksum",
  "cost",
  "risk_tier",
  "required_authority",
  "provider_behavior",
]);

function policyError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value, max = 191) {
  return compact(value, max).toLowerCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function parseObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => compact(item, 191)).filter(Boolean))].sort();
}

function normalizeResourceScope(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      resource_uri: compact(entry.resource_uri, 500),
      snapshot_hash: lower(entry.snapshot_hash, 64),
    }))
    .filter((entry) => entry.resource_uri && /^[0-9a-f]{64}$/.test(entry.snapshot_hash))
    .sort((left, right) => left.resource_uri.localeCompare(right.resource_uri)
      || left.snapshot_hash.localeCompare(right.snapshot_hash));
}

function normalizeGrant(input = {}) {
  const mode = lower(input.approval_mode, 64);
  if (!MODES.has(mode)) {
    throw policyError(400, "DELEGATION_POLICY_MODE_INVALID", "approval_mode is not supported by the execution policy.", {
      approval_mode: mode || null,
    });
  }
  const maxRiskTier = lower(input.max_risk_tier, 32);
  if (!Object.hasOwn(RISK_ORDER, maxRiskTier)) {
    throw policyError(400, "DELEGATION_POLICY_RISK_INVALID", "max_risk_tier is invalid.");
  }
  const expiresAt = new Date(input.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) {
    throw policyError(400, "DELEGATION_POLICY_EXPIRY_INVALID", "expires_at must be an ISO date-time.");
  }
  const delegatedBy = compact(input.delegated_by, 191);
  const delegatedTo = compact(input.delegated_to, 191);
  if (!delegatedBy || !delegatedTo) {
    throw policyError(400, "DELEGATION_POLICY_PRINCIPAL_REQUIRED", "delegated_by and delegated_to are required.");
  }
  const limits = {
    max_mutations: Number(input.limits?.max_mutations ?? 0),
    max_retries: Number(input.limits?.max_retries ?? 0),
    max_pull_requests: Number(input.limits?.max_pull_requests ?? 0),
  };
  for (const [field, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 0) {
      throw policyError(400, "DELEGATION_POLICY_LIMIT_INVALID", `${field} must be a non-negative integer.`, { field });
    }
  }
  return {
    grant_id: compact(input.grant_id, 64) || null,
    status: lower(input.status, 32),
    delegated_by: delegatedBy,
    delegated_to: delegatedTo,
    approval_mode: mode,
    plan_id: compact(input.plan_id, 64),
    plan_hash: lower(input.plan_hash, 64),
    resource_scope: normalizeResourceScope(input.resource_scope),
    allowed_intents: normalizeStringList(input.allowed_intents),
    denied_intents: normalizeStringList(input.denied_intents),
    max_risk_tier: maxRiskTier,
    limits,
    require_readback: input.require_readback === true,
    stop_on_drift: input.stop_on_drift === true,
    expires_at: new Date(expiresAt).toISOString(),
    policy_version: compact(input.policy_version, 64) || null,
    secrets_included: false,
  };
}

function normalizeExecution(input = {}) {
  const riskTier = lower(input.risk_tier || "read_only", 32);
  if (!Object.hasOwn(RISK_ORDER, riskTier)) {
    throw policyError(400, "DELEGATION_POLICY_EXECUTION_RISK_INVALID", "execution.risk_tier is invalid.");
  }
  const descriptor = {
    plan_id: compact(input.plan_id, 64),
    plan_hash: lower(input.plan_hash, 64),
    intent_key: compact(input.intent_key, 191),
    resource_snapshot_hash: lower(input.resource_snapshot_hash, 64),
    risk_tier: riskTier,
    operation_key: compact(input.operation_key, 191) || null,
    plan_step_id: compact(input.plan_step_id, 64) || null,
    step_key: compact(input.step_key, 191) || null,
    is_mutation: input.is_mutation === true,
    readback_supported: input.readback_supported === true,
    certified_workflow: input.certified_workflow === true,
    separation_of_duties_required: input.separation_of_duties_required === true,
    mutation_count: Number(input.mutation_count || 0),
    retry_count: Number(input.retry_count || 0),
    pull_request_count: Number(input.pull_request_count || 0),
  };
  for (const field of ["mutation_count", "retry_count", "pull_request_count"]) {
    if (!Number.isInteger(descriptor[field]) || descriptor[field] < 0) {
      throw policyError(400, "DELEGATION_POLICY_USAGE_INVALID", `${field} must be a non-negative integer.`, { field });
    }
  }
  descriptor.step_fingerprint = /^[0-9a-f]{64}$/.test(lower(input.step_fingerprint, 64))
    ? lower(input.step_fingerprint, 64)
    : sha256(descriptor);
  return descriptor;
}

function normalizeApproval(input = {}) {
  return {
    approved: input.approved === true,
    approved_by: compact(input.approved_by, 191) || null,
    expected_step_fingerprint: lower(input.expected_step_fingerprint, 64) || null,
    explicit_reserved_action_approval: input.explicit_reserved_action_approval === true,
    reviewer_approved: input.reviewer_approved === true,
    reviewer_id: compact(input.reviewer_id, 191) || null,
  };
}

function normalizeActors(input = {}) {
  return {
    planner_agent_id: compact(input.planner_agent_id, 191) || null,
    reviewer_agent_id: compact(input.reviewer_agent_id, 191) || null,
    executor_agent_id: compact(input.executor_agent_id, 191) || null,
  };
}

function exactApprovalSatisfied(grant, execution, approval) {
  return approval.approved === true
    && approval.approved_by === grant.delegated_by
    && approval.approved_by !== grant.delegated_to
    && approval.expected_step_fingerprint === execution.step_fingerprint;
}

function resourceBindingMatches(grant, execution) {
  return grant.resource_scope.some((entry) => entry.snapshot_hash === execution.resource_snapshot_hash);
}

function detectDrift(drift = {}) {
  const reasons = [];
  for (const field of DRIFT_FIELDS) {
    const evidence = drift[field];
    if (evidence === true) reasons.push(`DELEGATION_DRIFT_${field.toUpperCase()}`);
    if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
      if (evidence.changed === true) reasons.push(`DELEGATION_DRIFT_${field.toUpperCase()}`);
      if (evidence.expected !== undefined && evidence.observed !== undefined
        && String(evidence.expected) !== String(evidence.observed)) {
        reasons.push(`DELEGATION_DRIFT_${field.toUpperCase()}`);
      }
    }
  }
  return [...new Set(reasons)];
}

function separationOfDutiesBlockers(actors, required) {
  if (!required) return [];
  const blockers = [];
  if (!actors.planner_agent_id || !actors.reviewer_agent_id || !actors.executor_agent_id) {
    blockers.push("DELEGATION_SEPARATION_OF_DUTIES_IDENTITIES_REQUIRED");
    return blockers;
  }
  if (actors.planner_agent_id === actors.reviewer_agent_id) blockers.push("DELEGATION_PLANNER_REVIEWER_COLLISION");
  if (actors.planner_agent_id === actors.executor_agent_id) blockers.push("DELEGATION_PLANNER_EXECUTOR_COLLISION");
  if (actors.reviewer_agent_id === actors.executor_agent_id) blockers.push("DELEGATION_REVIEWER_EXECUTOR_COLLISION");
  return blockers;
}

function resultEnvelope({ decision, grant, execution, blockers = [], dispatchAllowed = false, approvalRequired = false,
  pauseRequired = false, requireDelegatorApproval = false, separationRequired = false, nextAction }) {
  return {
    ok: true,
    report_type: "delegation_execution_policy_decision",
    policy_version: DELEGATION_EXECUTION_POLICY_VERSION,
    decision,
    approval_mode: grant?.approval_mode || null,
    grant_id: grant?.grant_id || null,
    step_fingerprint: execution?.step_fingerprint || null,
    dispatch_allowed: dispatchAllowed,
    approval_required: approvalRequired,
    pause_required: pauseRequired,
    blockers: [...new Set(blockers)],
    approval_requirements: {
      require_delegator_approval: requireDelegatorApproval,
      delegated_by: grant?.delegated_by || null,
      delegated_to: grant?.delegated_to || null,
      expected_step_fingerprint: execution?.step_fingerprint || null,
      separation_of_duties_required: separationRequired,
    },
    next_action: nextAction,
    evidence: {
      grant_hash: grant ? sha256(grant) : null,
      execution_hash: execution ? sha256(execution) : null,
      secrets_included: false,
    },
    execution_performed: false,
    secrets_included: false,
  };
}

export function evaluateDelegationExecutionPolicy({
  grant: grantInput,
  execution: executionInput,
  approval: approvalInput = {},
  actors: actorsInput = {},
  drift = {},
  now = new Date().toISOString(),
} = {}) {
  if (!grantInput) return null;
  const grant = normalizeGrant(grantInput);
  const execution = normalizeExecution(executionInput);
  const approval = normalizeApproval(approvalInput);
  const actors = normalizeActors(actorsInput);
  const hardBlockers = [];
  const driftBlockers = detectDrift(drift);
  const nowMs = new Date(now).getTime();

  if (grant.status !== "active") hardBlockers.push("DELEGATION_GRANT_NOT_ACTIVE");
  if (!Number.isFinite(nowMs) || new Date(grant.expires_at).getTime() <= nowMs) hardBlockers.push("DELEGATION_GRANT_EXPIRED");
  if (grant.delegated_by === grant.delegated_to) hardBlockers.push("DELEGATION_SELF_DELEGATION_FORBIDDEN");
  if (grant.require_readback !== true) hardBlockers.push("DELEGATION_READBACK_POLICY_REQUIRED");
  if (grant.stop_on_drift !== true) hardBlockers.push("DELEGATION_STOP_ON_DRIFT_REQUIRED");
  if (execution.plan_id !== grant.plan_id) driftBlockers.push("DELEGATION_DRIFT_PLAN_ID");
  if (execution.plan_hash !== grant.plan_hash) driftBlockers.push("DELEGATION_DRIFT_PLAN_HASH");
  if (!grant.allowed_intents.includes(execution.intent_key)) hardBlockers.push("DELEGATION_INTENT_NOT_ALLOWED");
  if (grant.denied_intents.includes(execution.intent_key)) hardBlockers.push("DELEGATION_INTENT_DENIED");
  if (!resourceBindingMatches(grant, execution)) driftBlockers.push("DELEGATION_DRIFT_RESOURCE_SNAPSHOT_HASH");
  if (RISK_ORDER[execution.risk_tier] > RISK_ORDER[grant.max_risk_tier]) driftBlockers.push("DELEGATION_DRIFT_RISK_TIER");
  if (execution.mutation_count >= grant.limits.max_mutations && execution.is_mutation) hardBlockers.push("DELEGATION_MUTATION_LIMIT_EXHAUSTED");
  if (execution.retry_count > grant.limits.max_retries) hardBlockers.push("DELEGATION_RETRY_LIMIT_EXHAUSTED");
  if (execution.pull_request_count > grant.limits.max_pull_requests) hardBlockers.push("DELEGATION_PULL_REQUEST_LIMIT_EXHAUSTED");
  if (execution.is_mutation && !execution.readback_supported) hardBlockers.push("DELEGATION_MUTATION_READBACK_UNAVAILABLE");
  if (actors.executor_agent_id && actors.executor_agent_id !== grant.delegated_to) hardBlockers.push("DELEGATION_EXECUTOR_BINDING_MISMATCH");
  if (approval.approved && approval.approved_by === grant.delegated_to) hardBlockers.push("DELEGATION_SELF_APPROVAL_FORBIDDEN");

  const separationRequired = execution.separation_of_duties_required || grant.approval_mode === "multi_agent_approval";
  hardBlockers.push(...separationOfDutiesBlockers(actors, separationRequired));

  if (hardBlockers.length > 0) {
    return resultEnvelope({
      decision: "blocked",
      grant,
      execution,
      blockers: hardBlockers,
      separationRequired,
      nextAction: { action: "resolve_delegation_policy_blockers", reason_code: hardBlockers[0] },
    });
  }

  const uniqueDrift = [...new Set(driftBlockers)];
  if (uniqueDrift.length > 0) {
    return resultEnvelope({
      decision: "paused_on_drift",
      grant,
      execution,
      blockers: uniqueDrift,
      pauseRequired: true,
      approvalRequired: true,
      requireDelegatorApproval: true,
      separationRequired,
      nextAction: {
        action: "request_human_drift_review",
        reason_code: uniqueDrift[0],
        escalation_type: "delegation_boundary_drift",
      },
    });
  }

  const approvalSatisfied = exactApprovalSatisfied(grant, execution, approval);
  const reservedIntent = RESERVED_INTENTS.has(execution.intent_key);

  if (grant.approval_mode === "agent_recommend_only") {
    return resultEnvelope({
      decision: "recommend_only",
      grant,
      execution,
      pauseRequired: true,
      nextAction: { action: "present_agent_recommendation", reason_code: "DELEGATION_RECOMMEND_ONLY" },
    });
  }

  if (grant.approval_mode === "user_approval_only" && execution.is_mutation && !approvalSatisfied) {
    return resultEnvelope({
      decision: "user_approval_required",
      grant,
      execution,
      approvalRequired: true,
      requireDelegatorApproval: true,
      separationRequired,
      nextAction: { action: "request_user_step_approval", reason_code: "DELEGATION_USER_APPROVAL_REQUIRED" },
    });
  }

  if (grant.approval_mode === "agent_queue_for_approval" && !approvalSatisfied) {
    return resultEnvelope({
      decision: "queued_for_approval",
      grant,
      execution,
      approvalRequired: true,
      requireDelegatorApproval: true,
      separationRequired,
      nextAction: { action: "queue_compatible_steps_for_approval", reason_code: "DELEGATION_QUEUE_APPROVAL_REQUIRED" },
    });
  }

  if (grant.approval_mode === "delegated_low_risk") {
    const blockers = [];
    if (RISK_ORDER[execution.risk_tier] > RISK_ORDER.low) blockers.push("DELEGATION_LOW_RISK_CEILING_EXCEEDED");
    if (reservedIntent) blockers.push("DELEGATION_RESERVED_INTENT_USER_CONTROLLED");
    if (blockers.length > 0) {
      return resultEnvelope({
        decision: "blocked",
        grant,
        execution,
        blockers,
        nextAction: { action: "request_narrower_or_explicit_grant", reason_code: blockers[0] },
      });
    }
  }

  if (grant.approval_mode === "delegated_plan_bound" && reservedIntent
    && !(approvalSatisfied && approval.explicit_reserved_action_approval)) {
    return resultEnvelope({
      decision: "user_approval_required",
      grant,
      execution,
      approvalRequired: true,
      requireDelegatorApproval: true,
      separationRequired,
      nextAction: { action: "request_reserved_action_approval", reason_code: "DELEGATION_RESERVED_ACTION_APPROVAL_REQUIRED" },
    });
  }

  if (grant.approval_mode === "human_on_exception" && !execution.certified_workflow) {
    return resultEnvelope({
      decision: "blocked",
      grant,
      execution,
      blockers: ["DELEGATION_CERTIFIED_WORKFLOW_REQUIRED"],
      nextAction: { action: "certify_workflow_or_use_manual_approval", reason_code: "DELEGATION_CERTIFIED_WORKFLOW_REQUIRED" },
    });
  }

  if (grant.approval_mode === "multi_agent_approval") {
    if (!approval.reviewer_approved || approval.reviewer_id !== actors.reviewer_agent_id) {
      return resultEnvelope({
        decision: "user_approval_required",
        grant,
        execution,
        approvalRequired: true,
        separationRequired: true,
        nextAction: { action: "request_independent_agent_review", reason_code: "DELEGATION_INDEPENDENT_REVIEW_REQUIRED" },
      });
    }
  }

  return resultEnvelope({
    decision: "dispatch_allowed",
    grant,
    execution,
    dispatchAllowed: true,
    separationRequired,
    nextAction: { action: "dispatch_delegated_step", reason_code: "DELEGATION_POLICY_SATISFIED" },
  });
}

export function evaluateSequentialStepDelegationPolicy({ plan = {}, step = {}, actorId = null } = {}) {
  const policy = parseObject(step.approval_policy_json || step.approval_policy);
  if (!policy.delegation_grant) return null;
  const context = parseObject(policy.delegation_execution);
  const approval = {
    approved: policy.approved === true,
    approved_by: policy.approved_by,
    expected_step_fingerprint: policy.expected_step_fingerprint,
    explicit_reserved_action_approval: policy.explicit_reserved_action_approval === true,
    reviewer_approved: policy.reviewer_approved === true,
    reviewer_id: policy.reviewer_id,
  };
  return evaluateDelegationExecutionPolicy({
    grant: policy.delegation_grant,
    execution: {
      plan_id: plan.plan_id,
      plan_hash: context.plan_hash || plan.plan_hash,
      intent_key: context.intent_key || plan.intent_key || step.workflow_key || step.step_key,
      resource_snapshot_hash: context.resource_snapshot_hash || plan.resource_snapshot_hash,
      risk_tier: context.risk_tier || "read_only",
      operation_key: context.operation_key || step.workflow_key || step.step_key,
      plan_step_id: step.plan_step_id,
      step_key: step.step_key,
      step_fingerprint: context.step_fingerprint,
      is_mutation: context.is_mutation === undefined ? step.step_type === "workflow" : context.is_mutation === true,
      readback_supported: context.readback_supported === true,
      certified_workflow: context.certified_workflow === true,
      separation_of_duties_required: context.separation_of_duties_required === true,
      mutation_count: context.usage?.mutation_count,
      retry_count: context.usage?.retry_count,
      pull_request_count: context.usage?.pull_request_count,
    },
    approval,
    actors: {
      planner_agent_id: context.actors?.planner_agent_id,
      reviewer_agent_id: context.actors?.reviewer_agent_id,
      executor_agent_id: context.actors?.executor_agent_id || plan.agent_id || actorId,
    },
    drift: context.drift || {},
    now: context.now || new Date().toISOString(),
  });
}

export function assertDelegationApprovalDecision({ approvalPolicy, decision, decisionBy, holdContext = {} } = {}) {
  const policy = parseObject(approvalPolicy);
  if (!policy.delegation_grant || decision !== "approved") return { ok: true, applicable: false, secrets_included: false };
  const grant = normalizeGrant(policy.delegation_grant);
  const actor = compact(decisionBy, 191);
  if (!actor) throw policyError(403, "DELEGATION_APPROVAL_ACTOR_REQUIRED", "An authenticated approval actor is required.");
  if (actor === grant.delegated_to) {
    throw policyError(403, "DELEGATION_SELF_APPROVAL_FORBIDDEN", "The delegated Agent cannot approve its own execution.");
  }
  const requirements = parseObject(policy.delegation_approval_requirements || holdContext.delegation_approval_requirements);
  if (requirements.require_delegator_approval === true && actor !== grant.delegated_by) {
    throw policyError(403, "DELEGATION_DELEGATOR_APPROVAL_REQUIRED", "The delegating principal must approve this step.", {
      delegated_by: grant.delegated_by,
    });
  }
  if (requirements.separation_of_duties_required === true) {
    const planner = compact(requirements.planner_agent_id, 191);
    const executor = compact(requirements.executor_agent_id, 191);
    if (actor === planner || actor === executor) {
      throw policyError(403, "DELEGATION_INDEPENDENT_REVIEWER_REQUIRED", "Approval must be independent from planner and executor.");
    }
  }
  return { ok: true, applicable: true, approved_by: actor, secrets_included: false };
}

export function evaluateDelegationRenewalPolicy({ currentGrant, requestedGrant, approvedBy = null } = {}) {
  const noWidening = evaluateDelegationRenewalNoWidening({ currentGrant, requestedGrant });
  const current = normalizeGrant(currentGrant);
  const actor = compact(approvedBy, 191) || null;
  const blockers = [...(noWidening.blockers || [])];
  if (!actor) blockers.push("DELEGATION_RENEWAL_USER_APPROVAL_REQUIRED");
  if (actor === current.delegated_to) blockers.push("DELEGATION_RENEWAL_SELF_APPROVAL_FORBIDDEN");
  if (actor && actor !== current.delegated_by) blockers.push("DELEGATION_RENEWAL_DELEGATOR_APPROVAL_REQUIRED");
  const uniqueBlockers = [...new Set(blockers)];
  return {
    ok: true,
    report_type: "delegation_renewal_policy_decision",
    policy_version: DELEGATION_EXECUTION_POLICY_VERSION,
    decision: uniqueBlockers.length === 0 ? "renewal_allowed" : "blocked",
    blockers: uniqueBlockers,
    current_grant_hash: noWidening.current_grant_hash,
    requested_grant_hash: noWidening.requested_grant_hash,
    new_approval_required: uniqueBlockers.length > 0,
    execution_performed: false,
    secrets_included: false,
  };
}

export const delegationExecutionPolicyContract = Object.freeze({
  supported_modes: [...MODES].sort(),
  reserved_intents: [...RESERVED_INTENTS].sort(),
  human_on_drift: true,
  separation_of_duties_foundation: true,
  self_approval_forbidden: true,
  renewal_no_widening: true,
  runtime_dispatch_gate: true,
  secrets_included: false,
});

export const _testingDelegationExecutionPolicy = {
  stableValue,
  sha256,
  parseObject,
  normalizeGrant,
  normalizeExecution,
  normalizeApproval,
  normalizeActors,
  exactApprovalSatisfied,
  resourceBindingMatches,
  detectDrift,
  separationOfDutiesBlockers,
};
