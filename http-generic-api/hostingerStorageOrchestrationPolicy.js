const OPERATION_DEFINITIONS = Object.freeze({
  hostinger_storage_scan: {
    contexts: ["admin", "tenant"],
    mutating: false,
    tenantRoles: ["workspace_owner", "tenant_operator", "service_principal"],
  },
  hostinger_storage_plan: {
    contexts: ["admin", "tenant"],
    mutating: false,
    tenantRoles: ["workspace_owner", "tenant_operator"],
  },
  hostinger_storage_inspect_plan: {
    contexts: ["admin", "tenant"],
    mutating: false,
    tenantRoles: ["workspace_owner", "tenant_operator"],
  },
  hostinger_storage_request_apply: {
    contexts: ["admin", "tenant"],
    mutating: false,
    createsApprovalHoldOnly: true,
    tenantRoles: ["workspace_owner", "tenant_operator"],
  },
  hostinger_storage_approve_plan: {
    contexts: ["admin", "tenant"],
    mutating: false,
    approvalDecision: true,
    tenantRoles: ["workspace_owner"],
  },
  hostinger_storage_apply_plan: {
    contexts: ["admin", "tenant"],
    mutating: true,
    planBound: true,
    tenantRoles: ["workspace_owner"],
  },
  hostinger_storage_readback: {
    contexts: ["admin", "tenant"],
    mutating: false,
    tenantRoles: ["workspace_owner", "tenant_operator", "service_principal"],
  },
  hostinger_storage_reserve_status: {
    contexts: ["admin"],
    mutating: false,
    platformOnly: true,
  },
  hostinger_storage_reserve_create: {
    contexts: ["admin"],
    mutating: true,
    platformOnly: true,
  },
  hostinger_storage_reserve_release: {
    contexts: ["admin"],
    mutating: true,
    platformOnly: true,
    incidentRequired: true,
  },
  hostinger_storage_policy_manage: {
    contexts: ["admin"],
    mutating: true,
    platformOnly: true,
  },
});

const STATE_TRANSITIONS = Object.freeze({
  observed: ["classified", "blocked", "cancelled"],
  classified: ["planned", "blocked", "cancelled"],
  planned: ["inspected", "expired", "cancelled", "blocked"],
  inspected: ["approval_requested", "expired", "cancelled", "blocked"],
  approval_requested: ["partially_approved", "approved", "expired", "cancelled", "blocked"],
  partially_approved: ["approved", "expired", "cancelled", "blocked"],
  approved: ["lease_acquired", "expired", "cancelled", "blocked"],
  lease_acquired: ["executing", "expired", "cancelled", "blocked"],
  executing: ["readback_pending", "unknown_outcome", "failed"],
  readback_pending: ["reconciling", "completed", "unknown_outcome", "failed"],
  reconciling: ["completed", "blocked", "failed", "unknown_outcome"],
  unknown_outcome: ["reconciling", "blocked", "failed", "completed"],
  completed: [],
  blocked: [],
  expired: [],
  cancelled: [],
  failed: [],
});

const TERMINAL_STATES = new Set(["completed", "blocked", "expired", "cancelled", "failed"]);
const TENANT_READ_OPERATIONS = new Set([
  "hostinger_storage_scan",
  "hostinger_storage_plan",
  "hostinger_storage_inspect_plan",
  "hostinger_storage_request_apply",
  "hostinger_storage_approve_plan",
  "hostinger_storage_readback",
]);

function compact(value, max = 191) {
  return String(value ?? "").trim().slice(0, max);
}

function uniq(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => compact(value, 128)).filter(Boolean))];
}

function rolesOf(actor = {}) {
  const roles = uniq(actor.roles);
  if (actor.is_platform_admin === true && !roles.includes("platform_admin")) roles.push("platform_admin");
  if (actor.principal_type === "service" && !roles.includes("service_principal")) roles.push("service_principal");
  return roles;
}

function hasRole(actor, role) {
  return rolesOf(actor).includes(role);
}

function ok(details = {}) {
  return {
    allowed: true,
    decision: "allow",
    reason_codes: [],
    secrets_included: false,
    ...details,
  };
}

function deny(reasonCodes, details = {}) {
  return {
    allowed: false,
    decision: "deny",
    reason_codes: uniq(Array.isArray(reasonCodes) ? reasonCodes : [reasonCodes]),
    secrets_included: false,
    ...details,
  };
}

function normalizedContext(context = {}) {
  return {
    mode: compact(context.mode, 16).toLowerCase(),
    tenant_id: compact(context.tenant_id || context.tenantId, 64),
    workspace_id: compact(context.workspace_id || context.workspaceId, 64),
    resource_id: compact(context.resource_id || context.resourceId, 64),
  };
}

function normalizedTarget(target = {}) {
  return {
    target_id: compact(target.target_id || target.targetId, 64),
    hosting_account_id: compact(target.hosting_account_id || target.hostingAccountId, 64),
    resource_id: compact(target.resource_id || target.resourceId, 64),
    ownership_scope: compact(target.ownership_scope || target.ownershipScope, 16).toLowerCase(),
    account_ownership_scope: compact(target.account_ownership_scope || target.accountOwnershipScope, 16).toLowerCase(),
    tenant_id: compact(target.tenant_id || target.tenantId, 64),
    workspace_id: compact(target.workspace_id || target.workspaceId, 64),
    ownership_revision: compact(target.ownership_revision || target.ownershipRevision, 128),
    policy_revision: compact(target.policy_revision || target.policyRevision, 128),
    path_scope: compact(target.path_scope || target.pathScope, 1024),
  };
}

function normalizedRequest(request = {}) {
  return {
    operation_key: compact(request.operation_key || request.operationKey, 128),
    capability_envelope_id: compact(request.capability_envelope_id || request.capabilityEnvelopeId, 64),
    resource_authority_id: compact(request.resource_authority_id || request.resourceAuthorityId, 64),
    execution_lease_id: compact(request.execution_lease_id || request.executionLeaseId, 64),
    delegation_id: compact(request.delegation_id || request.delegationId, 64),
    support_case_id: compact(request.support_case_id || request.supportCaseId, 64),
    break_glass_id: compact(request.break_glass_id || request.breakGlassId, 64),
    active_incident_id: compact(request.active_incident_id || request.activeIncidentId, 64),
    release_authority_id: compact(request.release_authority_id || request.releaseAuthorityId, 64),
    authority_context_hash: compact(request.authority_context_hash || request.authorityContextHash, 128),
    plan_hash: compact(request.plan_hash || request.planHash, 128).toLowerCase(),
    candidate_set_hash: compact(request.candidate_set_hash || request.candidateSetHash, 128).toLowerCase(),
    ownership_revision: compact(request.ownership_revision || request.ownershipRevision, 128),
    policy_revision: compact(request.policy_revision || request.policyRevision, 128),
    typed_confirmation: compact(request.typed_confirmation || request.typedConfirmation, 512),
    approval_workspace_ids: uniq(request.approval_workspace_ids || request.approvalWorkspaceIds),
    impacted_workspace_ids: uniq(request.impacted_workspace_ids || request.impactedWorkspaceIds),
    plan_candidate_classes: uniq(request.plan_candidate_classes || request.planCandidateClasses),
    current_state: compact(request.current_state || request.currentState, 64),
  };
}

export function buildStorageAuthorityContextFingerprintInput({ actor = {}, context = {}, target = {}, request = {} } = {}) {
  const ctx = normalizedContext(context);
  const tgt = normalizedTarget(target);
  const req = normalizedRequest(request);
  return {
    principal_id: compact(actor.principal_id || actor.user_id || actor.userId, 64),
    principal_type: compact(actor.principal_type || actor.principalType, 32),
    roles: rolesOf(actor).sort(),
    context_mode: ctx.mode,
    context_tenant_id: ctx.tenant_id || null,
    context_workspace_id: ctx.workspace_id || null,
    context_resource_id: ctx.resource_id || null,
    target_id: tgt.target_id || null,
    hosting_account_id: tgt.hosting_account_id || null,
    resource_id: tgt.resource_id || null,
    ownership_scope: tgt.ownership_scope || null,
    account_ownership_scope: tgt.account_ownership_scope || null,
    target_tenant_id: tgt.tenant_id || null,
    target_workspace_id: tgt.workspace_id || null,
    ownership_revision: tgt.ownership_revision || null,
    policy_revision: tgt.policy_revision || null,
    operation_key: req.operation_key || null,
    delegation_id: req.delegation_id || null,
    support_case_id: req.support_case_id || null,
    break_glass_id: req.break_glass_id || null,
  };
}

export function validateStoragePlanBinding({ context = {}, target = {}, request = {} } = {}) {
  const ctx = normalizedContext(context);
  const tgt = normalizedTarget(target);
  const req = normalizedRequest(request);
  const reasons = [];

  if (!/^[a-f0-9]{64}$/.test(req.plan_hash)) reasons.push("plan_hash_required");
  if (!/^[a-f0-9]{64}$/.test(req.candidate_set_hash)) reasons.push("candidate_set_hash_required");
  if (!req.authority_context_hash) reasons.push("authority_context_hash_required");
  if (!req.ownership_revision) reasons.push("ownership_revision_required");
  if (!req.policy_revision) reasons.push("policy_revision_required");
  if (req.ownership_revision && tgt.ownership_revision && req.ownership_revision !== tgt.ownership_revision) reasons.push("ownership_revision_mismatch");
  if (req.policy_revision && tgt.policy_revision && req.policy_revision !== tgt.policy_revision) reasons.push("policy_revision_mismatch");
  if (ctx.resource_id && tgt.resource_id && ctx.resource_id !== tgt.resource_id) reasons.push("context_resource_mismatch");

  return reasons.length ? deny(reasons) : ok({ binding_valid: true });
}

function validateContextPrincipal(actor, ctx) {
  const reasons = [];
  if (!["admin", "tenant"].includes(ctx.mode)) reasons.push("explicit_context_mode_required");

  if (ctx.mode === "admin" && !hasRole(actor, "platform_admin")) reasons.push("platform_admin_role_required");

  if (ctx.mode === "tenant") {
    const actorTenant = compact(actor.tenant_id || actor.tenantId, 64);
    const actorWorkspace = compact(actor.workspace_id || actor.workspaceId, 64);
    if (!ctx.tenant_id || !ctx.workspace_id) reasons.push("tenant_context_identifiers_required");
    if (actorTenant && actorTenant !== ctx.tenant_id) reasons.push("principal_tenant_context_mismatch");
    if (actorWorkspace && actorWorkspace !== ctx.workspace_id) reasons.push("principal_workspace_context_mismatch");
    if (!rolesOf(actor).some((role) => ["workspace_owner", "tenant_operator", "service_principal"].includes(role))) {
      reasons.push("tenant_role_required");
    }
  }

  return reasons;
}

function validateTenantTargetScope(ctx, tgt, definition) {
  const reasons = [];
  if (ctx.mode !== "tenant") return reasons;
  if (definition.platformOnly) reasons.push("platform_only_operation");
  if (tgt.ownership_scope !== "tenant") reasons.push("tenant_context_requires_tenant_owned_resource");
  if (!tgt.tenant_id || tgt.tenant_id !== ctx.tenant_id) reasons.push("target_tenant_mismatch");
  if (!tgt.workspace_id || tgt.workspace_id !== ctx.workspace_id) reasons.push("target_workspace_mismatch");
  if (ctx.resource_id && tgt.resource_id !== ctx.resource_id) reasons.push("target_resource_mismatch");
  return reasons;
}

function validateTenantRole(actor, definition) {
  if (!Array.isArray(definition.tenantRoles)) return [];
  return definition.tenantRoles.some((role) => hasRole(actor, role)) ? [] : ["tenant_operation_role_not_satisfied"];
}

function requiredApprovals(ctx, tgt, req) {
  if (ctx.mode === "tenant") return [ctx.workspace_id];
  if (tgt.ownership_scope === "tenant") return uniq([tgt.workspace_id]);
  if (tgt.ownership_scope === "shared" || tgt.account_ownership_scope === "shared") {
    return uniq(req.impacted_workspace_ids);
  }
  return [];
}

function validateApprovalSet(ctx, tgt, req) {
  const required = requiredApprovals(ctx, tgt, req);
  const approved = new Set(req.approval_workspace_ids);
  return {
    required,
    missing: required.filter((workspaceId) => !approved.has(workspaceId)),
  };
}

function validateAdminTenantMutationBoundary(ctx, tgt, req) {
  if (ctx.mode !== "admin" || tgt.ownership_scope !== "tenant") return [];
  const delegated = Boolean(req.delegation_id && req.support_case_id);
  const breakGlass = Boolean(req.break_glass_id && req.support_case_id && req.active_incident_id);
  return delegated || breakGlass ? [] : ["tenant_mutation_requires_delegation_or_break_glass"];
}

function validateMutationRequirements(ctx, tgt, req, definition) {
  if (!definition.mutating) return [];
  const reasons = [];
  if (!req.capability_envelope_id) reasons.push("capability_envelope_required");
  if (!req.execution_lease_id) reasons.push("execution_lease_required");
  if (!req.authority_context_hash) reasons.push("authority_context_hash_required");
  if (ctx.mode === "tenant" && !req.resource_authority_id) reasons.push("resource_authority_required");
  reasons.push(...validateAdminTenantMutationBoundary(ctx, tgt, req));

  if (definition.planBound) {
    const binding = validateStoragePlanBinding({ context: ctx, target: tgt, request: req });
    reasons.push(...binding.reason_codes);
    if (!req.typed_confirmation) reasons.push("typed_confirmation_required");
    const approval = validateApprovalSet(ctx, tgt, req);
    if (approval.missing.length) reasons.push("required_workspace_approvals_missing");
  }

  if (definition.incidentRequired && !req.active_incident_id) reasons.push("active_storage_incident_required");
  if (req.plan_candidate_classes.includes("deployment_history") && !req.release_authority_id) reasons.push("release_authority_required");
  return uniq(reasons);
}

export function resolveHostingerStorageAuthorization({ actor = {}, context = {}, target = {}, request = {} } = {}) {
  const ctx = normalizedContext(context);
  const tgt = normalizedTarget(target);
  const req = normalizedRequest(request);
  const definition = OPERATION_DEFINITIONS[req.operation_key];
  if (!definition) return deny("unsupported_storage_operation", { operation_key: req.operation_key || null });

  const reasons = [
    ...validateContextPrincipal(actor, ctx),
    ...(definition.contexts.includes(ctx.mode) ? [] : ["operation_not_available_in_context"]),
    ...validateTenantTargetScope(ctx, tgt, definition),
    ...(ctx.mode === "tenant" ? validateTenantRole(actor, definition) : []),
  ];

  if (ctx.mode === "admin" && !hasRole(actor, "platform_admin")) reasons.push("platform_admin_role_required");
  if (ctx.mode === "tenant" && !TENANT_READ_OPERATIONS.has(req.operation_key) && req.operation_key !== "hostinger_storage_apply_plan") {
    reasons.push("tenant_operation_not_exposed");
  }

  reasons.push(...validateMutationRequirements(ctx, tgt, req, definition));

  if (reasons.length) {
    return deny(reasons, {
      operation_key: req.operation_key,
      context_mode: ctx.mode || null,
      ownership_scope: tgt.ownership_scope || null,
      required_workspace_approvals: requiredApprovals(ctx, tgt, req),
      visibility: ctx.mode === "tenant" ? "tenant_redacted_projection" : "admin_bounded_projection",
    });
  }

  const approval = validateApprovalSet(ctx, tgt, req);
  return ok({
    operation_key: req.operation_key,
    context_mode: ctx.mode,
    ownership_scope: tgt.ownership_scope,
    mutating: definition.mutating,
    dispatch_allowed: definition.mutating ? false : true,
    dispatch_certification_required: definition.mutating,
    required_workspace_approvals: approval.required,
    visibility: ctx.mode === "tenant" ? "tenant_redacted_projection" : "admin_bounded_projection",
    authority_context: buildStorageAuthorityContextFingerprintInput({ actor, context: ctx, target: tgt, request: req }),
  });
}

export function transitionHostingerStorageOperation({ current_state, next_state, unknown_outcome_reconciled = false } = {}) {
  const current = compact(current_state, 64);
  const next = compact(next_state, 64);
  if (!(current in STATE_TRANSITIONS)) return deny("unknown_current_state", { current_state: current, next_state: next });
  if (!(next in STATE_TRANSITIONS)) return deny("unknown_next_state", { current_state: current, next_state: next });
  if (TERMINAL_STATES.has(current)) return deny("terminal_state_transition_forbidden", { current_state: current, next_state: next });
  if (!STATE_TRANSITIONS[current].includes(next)) return deny("invalid_state_transition", { current_state: current, next_state: next });
  if (current === "unknown_outcome" && next === "completed" && unknown_outcome_reconciled !== true) {
    return deny("unknown_outcome_requires_reconciliation", { current_state: current, next_state: next });
  }
  return ok({ current_state: current, next_state: next });
}

export const HOSTINGER_STORAGE_OPERATION_DEFINITIONS = OPERATION_DEFINITIONS;
export const HOSTINGER_STORAGE_STATE_TRANSITIONS = STATE_TRANSITIONS;
