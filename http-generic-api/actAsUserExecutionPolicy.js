const ROLE_RANK = Object.freeze({
  viewer: 10,
  member: 20,
  manager: 30,
  supervisor: 40,
  admin: 50,
  owner: 60,
  tenant_responsible: 60,
});

const MAX_TTL_SECONDS = 900;
const ALLOWED_OPERATIONS = new Set(["call_tool", "execute"]);

function policyError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
}

function intersection(...values) {
  if (!values.length) return [];
  const [first, ...rest] = values.map((value) => new Set(list(value)));
  return [...first].filter((item) => rest.every((set) => set.has(item))).sort();
}

function parseDate(value, field) {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) {
    throw policyError("act_as_user_invalid_date", `${field} must be a valid date.`, { field });
  }
  return parsed;
}

function assertNoWildcard(values, field) {
  if (values.some((value) => value === "*" || value.endsWith(".*"))) {
    throw policyError("act_as_user_wildcard_scope_denied", `${field} cannot contain wildcard operations.`, { field });
  }
}

export function resolveActAsUserExecutionContext({
  actor,
  target,
  tenantId,
  delegation,
  requestedOperation,
  requestedTool,
  requestedCapabilities,
  toolCapabilities,
  tenantCapabilities,
  now = new Date(),
  maxTtlSeconds = MAX_TTL_SECONDS,
} = {}) {
  const actorId = text(actor?.id || actor?.principalRef);
  const targetId = text(target?.id || target?.principalRef);
  const resolvedTenantId = text(tenantId || actor?.tenantId || target?.tenantId);
  if (!actorId || !targetId || !resolvedTenantId) {
    throw policyError("act_as_user_context_required", "Actor, target, and Tenant context are required.");
  }
  if (actorId === targetId) {
    throw policyError("act_as_user_same_subject_denied", "Act-as-User cannot target the actor itself.");
  }
  if (text(actor?.tenantId) !== resolvedTenantId || text(target?.tenantId) !== resolvedTenantId) {
    throw policyError("act_as_user_cross_tenant_denied", "Actor and target must belong to the same Tenant.");
  }

  const actorRank = ROLE_RANK[text(actor?.role).toLowerCase()];
  const targetRank = ROLE_RANK[text(target?.role).toLowerCase()];
  if (!actorRank || !targetRank || targetRank >= actorRank) {
    throw policyError("act_as_user_role_escalation_denied", "Target role must be lower than actor role.", { actorRole: actor?.role, targetRole: target?.role });
  }

  const operation = text(requestedOperation);
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw policyError("act_as_user_operation_denied", "Only call_tool and execute are eligible for Act-as-User.", { requestedOperation: operation });
  }

  const delegationActor = text(delegation?.actorPrincipalRef || delegation?.actor_principal_ref);
  const delegationTarget = text(delegation?.subjectRef || delegation?.targetUserId || delegation?.target_user_id);
  const delegationTenant = text(delegation?.tenantRef || delegation?.tenant_id);
  if (delegation?.status !== "active" || delegationActor !== actorId || delegationTarget !== targetId || delegationTenant !== resolvedTenantId) {
    throw policyError("act_as_user_delegation_invalid", "Active delegation must bind actor, target, and Tenant exactly.");
  }

  const nowDate = now instanceof Date ? now : parseDate(now, "now");
  const expiresAt = parseDate(delegation.expiresAt || delegation.expires_at, "delegation.expires_at");
  const validFrom = delegation.validFrom || delegation.valid_from;
  if (validFrom && parseDate(validFrom, "delegation.valid_from") > nowDate) {
    throw policyError("act_as_user_delegation_not_started", "Delegation is not active yet.");
  }
  if (expiresAt <= nowDate) {
    throw policyError("act_as_user_delegation_expired", "Delegation has expired.");
  }
  const ttlSeconds = Math.floor((expiresAt.getTime() - nowDate.getTime()) / 1000);
  if (ttlSeconds > Number(maxTtlSeconds) || ttlSeconds > MAX_TTL_SECONDS) {
    throw policyError("act_as_user_ttl_exceeded", "Act-as-User TTL exceeds the governed maximum.", { ttlSeconds, maxTtlSeconds: Math.min(Number(maxTtlSeconds), MAX_TTL_SECONDS) });
  }
  if (!text(delegation.idempotencyKey || delegation.idempotency_key)) {
    throw policyError("act_as_user_idempotency_required", "An idempotency key is required for Act-as-User execution.");
  }
  if (delegation.revokedAt || delegation.revoked_at || delegation.revoked === true) {
    throw policyError("act_as_user_revoked", "Act-as-User delegation has been revoked.");
  }

  const allowedOperations = list(delegation.allowedOperations || delegation.allowed_operations);
  assertNoWildcard(allowedOperations, "delegation.allowed_operations");
  const requested = list(requestedCapabilities);
  const effectiveCapabilities = intersection(
    actor.capabilities,
    target.capabilities,
    tenantCapabilities,
    toolCapabilities,
    allowedOperations,
    requested,
  );
  if (!effectiveCapabilities.includes(operation)) {
    throw policyError("act_as_user_capability_intersection_denied", "Requested operation is outside the effective authority intersection.", { requestedOperation: operation, effectiveCapabilities });
  }

  return Object.freeze({
    mode: "act_as_user",
    actorId,
    targetId,
    tenantId: resolvedTenantId,
    targetRole: text(target.role).toLowerCase(),
    actorRole: text(actor.role).toLowerCase(),
    requestedTool: text(requestedTool) || null,
    requestedOperation: operation,
    effectiveCapabilities,
    delegationId: text(delegation.delegationRef || delegation.delegation_id || delegation.id) || null,
    idempotencyKey: text(delegation.idempotencyKey || delegation.idempotency_key),
    expiresAt: expiresAt.toISOString(),
    audit: Object.freeze({ actorId, targetId, tenantId: resolvedTenantId, delegationId: text(delegation.delegationRef || delegation.delegation_id || delegation.id) || null }),
  });
}

export function assertActAsUserExecutionContext(context, { now = new Date(), revoked = false } = {}) {
  if (!context || context.mode !== "act_as_user") {
    throw policyError("act_as_user_context_missing", "A valid Act-as-User execution context is required.");
  }
  if (revoked) throw policyError("act_as_user_revoked", "Act-as-User execution context has been revoked.");
  if (parseDate(context.expiresAt, "context.expiresAt") <= (now instanceof Date ? now : parseDate(now, "now"))) {
    throw policyError("act_as_user_expired", "Act-as-User execution context has expired.");
  }
  return context;
}

export const ACT_AS_USER_ROLE_RANK = ROLE_RANK;
export const ACT_AS_USER_MAX_TTL_SECONDS = MAX_TTL_SECONDS;
