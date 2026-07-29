import { createHash } from "node:crypto";
import { evaluateAgentDelegationOptIn } from "./agentDelegationOptIn.js";
import { readPlanBoundSessionShadow } from "./planBoundSessionShadow.js";

export const DELEGATION_GRANT_SHADOW_VERSION = "spec011-delegation-grant-shadow-v1";

const ADMIN_MODES = new Set(["backend_api", "admin", "service", "service_account"]);
const SUPPORTED_APPROVAL_MODES = new Set([
  "user_approval_only",
  "agent_recommend_only",
  "agent_queue_for_approval",
  "delegated_low_risk",
  "delegated_plan_bound",
]);
const CANONICAL_STATUSES = new Set(["preview", "active", "revoked", "expired", "exhausted", "completed", "denied"]);
const LEGACY_STATUS_MAP = Object.freeze({
  pending: "active",
  executing: "active",
  completed: "completed",
  failed: "denied",
  expired: "expired",
});
const RISK_ORDER = Object.freeze({ read_only: 0, low: 1, medium: 2, high: 3, critical: 4 });
const USER_CONTROLLED_DENIED_INTENTS = new Set([
  "repo.pr.merge",
  "production.deploy",
  "database.migration.apply",
  "credential.write",
  "permission.write",
  "billing.write",
  "external.publish",
]);

function grantError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value) {
  return compact(value, 191).toLowerCase();
}

function principalClass(auth = {}) {
  const mode = lower(auth.mode || auth.caller_type);
  if (auth.is_admin === true || ADMIN_MODES.has(mode)) return "admin";
  if (mode === "user_jwt" && auth.user_id && auth.tenant_id) return "tenant";
  return null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function deterministicUuid(hash) {
  const source = String(hash || "").padEnd(32, "0").slice(0, 32).split("");
  source[12] = "4";
  source[16] = "8";
  const hex = source.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function parseDate(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function normalizeHash(value, field, required = true) {
  const normalized = lower(value);
  if (!normalized && !required) return null;
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw grantError(400, "DELEGATION_GRANT_HASH_INVALID", `${field} must be a lowercase SHA-256 hash.`, { field });
  }
  return normalized;
}

function normalizeStringSet(value, field, { required = false, maxItems = 100 } = {}) {
  if (!Array.isArray(value)) {
    if (!required && (value === null || value === undefined)) return [];
    throw grantError(400, "DELEGATION_GRANT_LIST_INVALID", `${field} must be an array.`, { field });
  }
  const normalized = [...new Set(value.map((item) => compact(item, 191)).filter(Boolean))];
  if (required && normalized.length === 0) {
    throw grantError(400, "DELEGATION_GRANT_LIST_REQUIRED", `${field} must include at least one value.`, { field });
  }
  if (normalized.length > maxItems) {
    throw grantError(400, "DELEGATION_GRANT_LIST_TOO_LARGE", `${field} exceeds the maximum item count.`, {
      field,
      maximum: maxItems,
    });
  }
  return normalized.sort();
}

function normalizeResourceScope(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw grantError(400, "DELEGATION_GRANT_RESOURCE_SCOPE_REQUIRED", "resource_scope must include at least one resource.");
  }
  if (value.length > 50) {
    throw grantError(400, "DELEGATION_GRANT_RESOURCE_SCOPE_TOO_LARGE", "resource_scope exceeds the maximum item count.");
  }
  const seen = new Set();
  const resources = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw grantError(400, "DELEGATION_GRANT_RESOURCE_SCOPE_INVALID", "Each resource_scope item must be an object.", { index });
    }
    const resourceUri = compact(item.resource_uri, 500);
    if (!resourceUri) {
      throw grantError(400, "DELEGATION_GRANT_RESOURCE_URI_REQUIRED", "resource_uri is required.", { index });
    }
    const snapshotHash = normalizeHash(item.snapshot_hash, `resource_scope[${index}].snapshot_hash`);
    const key = `${resourceUri}\n${snapshotHash}`;
    if (seen.has(key)) {
      throw grantError(409, "DELEGATION_GRANT_RESOURCE_SCOPE_DUPLICATE", "Duplicate resource scope binding.", {
        resource_uri: resourceUri,
      });
    }
    seen.add(key);
    return { resource_uri: resourceUri, snapshot_hash: snapshotHash };
  });
  return resources.sort((a, b) => a.resource_uri.localeCompare(b.resource_uri)
    || a.snapshot_hash.localeCompare(b.snapshot_hash));
}

function normalizeLimits(input = {}) {
  const limits = {
    max_mutations: Number(input.max_mutations),
    max_retries: Number(input.max_retries),
    max_pull_requests: Number(input.max_pull_requests),
  };
  const bounds = { max_mutations: 100, max_retries: 10, max_pull_requests: 10 };
  for (const [field, maximum] of Object.entries(bounds)) {
    if (!Number.isInteger(limits[field]) || limits[field] < 0 || limits[field] > maximum) {
      throw grantError(400, "DELEGATION_GRANT_LIMIT_INVALID", `${field} must be an integer from 0 to ${maximum}.`, {
        field,
        maximum,
      });
    }
  }
  return limits;
}

function normalizePreviewInput(input = {}, now = new Date().toISOString()) {
  const delegatedBy = compact(input.delegated_by, 191);
  const delegatedTo = compact(input.delegated_to, 191);
  const planId = compact(input.plan_id, 64);
  const approvalMode = lower(input.approval_mode);
  if (!delegatedBy) throw grantError(400, "DELEGATION_GRANT_DELEGATED_BY_REQUIRED", "delegated_by is required.");
  if (!delegatedTo) throw grantError(400, "DELEGATION_GRANT_DELEGATED_TO_REQUIRED", "delegated_to is required.");
  if (!planId) throw grantError(400, "DELEGATION_GRANT_PLAN_REQUIRED", "plan_id is required.");
  if (!SUPPORTED_APPROVAL_MODES.has(approvalMode)) {
    throw grantError(400, "DELEGATION_GRANT_APPROVAL_MODE_UNSUPPORTED", "approval_mode is not supported by the initial implementation.", {
      approval_mode: approvalMode || null,
    });
  }
  const maxRiskTier = lower(input.max_risk_tier);
  if (!Object.hasOwn(RISK_ORDER, maxRiskTier)) {
    throw grantError(400, "DELEGATION_GRANT_RISK_TIER_INVALID", "max_risk_tier is invalid.");
  }
  const createdMs = parseDate(input.created_at) ?? parseDate(now);
  const expiresMs = parseDate(input.expires_at);
  if (createdMs === null || expiresMs === null || expiresMs <= createdMs) {
    throw grantError(400, "DELEGATION_GRANT_EXPIRY_INVALID", "expires_at must be after created_at.");
  }
  const ttlMinutes = Math.ceil((expiresMs - createdMs) / 60_000);
  if (ttlMinutes < 1 || ttlMinutes > 1440) {
    throw grantError(400, "DELEGATION_GRANT_TTL_INVALID", "Delegation TTL must be from 1 to 1440 minutes.", {
      ttl_minutes: ttlMinutes,
    });
  }
  const allowedIntents = normalizeStringSet(input.allowed_intents, "allowed_intents", { required: true });
  const deniedIntents = normalizeStringSet(input.denied_intents, "denied_intents");
  const overlap = allowedIntents.filter((intent) => deniedIntents.includes(intent));
  if (overlap.length > 0) {
    throw grantError(409, "DELEGATION_GRANT_INTENT_CONFLICT", "An intent cannot be both allowed and denied.", {
      overlapping_intents: overlap,
    });
  }
  return {
    delegated_by: delegatedBy,
    delegated_to: delegatedTo,
    approval_mode: approvalMode,
    plan_id: planId,
    plan_hash: normalizeHash(input.plan_hash, "plan_hash"),
    resource_scope: normalizeResourceScope(input.resource_scope),
    allowed_intents: allowedIntents,
    denied_intents: deniedIntents,
    max_risk_tier: maxRiskTier,
    limits: normalizeLimits(input.limits),
    require_readback: input.require_readback === true,
    stop_on_drift: input.stop_on_drift === true,
    policy_version: compact(input.policy_version, 64) || null,
    created_at: new Date(createdMs).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
    ttl_minutes: ttlMinutes,
    delegation_approved: input.delegation_approved === true,
    delegation_mode: input.delegation_mode,
    delegation_reason: input.delegation_reason,
    allow_fallback_agent: input.allow_fallback_agent === true,
  };
}

function riskAllowed(maxTier, observedTier) {
  if (!Object.hasOwn(RISK_ORDER, maxTier) || !Object.hasOwn(RISK_ORDER, observedTier)) return false;
  return RISK_ORDER[observedTier] <= RISK_ORDER[maxTier];
}

function modeBlockers(input) {
  const blockers = [];
  if (input.approval_mode === "agent_recommend_only" && input.limits.max_mutations !== 0) {
    blockers.push("RECOMMEND_ONLY_MUTATIONS_FORBIDDEN");
  }
  if (input.approval_mode === "agent_queue_for_approval" && input.limits.max_mutations !== 0) {
    blockers.push("QUEUE_FOR_APPROVAL_MUTATIONS_FORBIDDEN");
  }
  if (input.approval_mode === "delegated_low_risk" && RISK_ORDER[input.max_risk_tier] > RISK_ORDER.low) {
    blockers.push("LOW_RISK_MODE_RISK_CEILING_EXCEEDED");
  }
  if (["user_approval_only", "agent_recommend_only", "agent_queue_for_approval"].includes(input.approval_mode)) {
    for (const intent of input.allowed_intents) {
      if (USER_CONTROLLED_DENIED_INTENTS.has(intent)) {
        blockers.push("USER_CONTROLLED_INTENT_REQUIRES_EXPLICIT_STEP_APPROVAL");
      }
    }
  }
  return blockers;
}

function resourceSnapshotMatches(input, planBoundSession) {
  const snapshotHash = planBoundSession?.resource_snapshot?.resource_snapshot_hash;
  if (!snapshotHash) return false;
  return input.resource_scope.some((item) => item.snapshot_hash === snapshotHash);
}

export function projectDelegationGrantPreview({
  input,
  planBoundSession,
  agent,
  existingDelegations = [],
  now = new Date().toISOString(),
}) {
  const normalized = normalizePreviewInput(input, now);
  if (!planBoundSession?.plan?.plan_id || !planBoundSession?.plan?.plan_hash) {
    throw grantError(500, "DELEGATION_GRANT_PLAN_PROJECTION_REQUIRED", "A plan-bound session projection is required.");
  }
  const blockers = [];
  const optIn = evaluateAgentDelegationOptIn({
    delegation_approved: normalized.delegation_approved,
    delegation_mode: normalized.delegation_mode,
    delegation_reason: normalized.delegation_reason,
    allow_fallback_agent: normalized.allow_fallback_agent,
  });
  for (const blocker of optIn.blockers || []) blockers.push(String(blocker).toUpperCase());
  if (normalized.delegated_by === normalized.delegated_to) blockers.push("SELF_DELEGATION_FORBIDDEN");
  if (planBoundSession.plan.plan_id !== normalized.plan_id) blockers.push("PLAN_ID_MISMATCH");
  if (planBoundSession.plan.plan_hash !== normalized.plan_hash) blockers.push("PLAN_HASH_MISMATCH");
  if (!resourceSnapshotMatches(normalized, planBoundSession)) blockers.push("RESOURCE_SNAPSHOT_MISMATCH");
  const planIntent = compact(planBoundSession.plan.intent_key, 191);
  if (planIntent && !normalized.allowed_intents.includes(planIntent)) blockers.push("PLAN_INTENT_NOT_ALLOWED");
  if (planIntent && normalized.denied_intents.includes(planIntent)) blockers.push("PLAN_INTENT_DENIED");
  const observedRisk = lower(planBoundSession.risk_ceiling?.tier);
  if (!riskAllowed(normalized.max_risk_tier, observedRisk)) blockers.push("DELEGATION_RISK_EXCEEDED");
  if (planBoundSession.decision !== "resolved_preview") blockers.push("PLAN_BOUND_SESSION_BLOCKED");
  if (agent?.agent_id !== normalized.delegated_to) blockers.push("AGENT_BINDING_MISMATCH");
  if (lower(agent?.status) !== "active" || lower(agent?.health_status) !== "active") blockers.push("AGENT_NOT_ACTIVE");
  const maxAgentTtlMinutes = Number(agent?.max_delegation_ttl || 0) / 60;
  if (maxAgentTtlMinutes > 0 && normalized.ttl_minutes > maxAgentTtlMinutes) blockers.push("AGENT_TTL_EXCEEDED");
  if (existingDelegations.some((row) => ["pending", "executing"].includes(lower(row.status)))) {
    blockers.push("ACTIVE_DELEGATION_ALREADY_EXISTS");
  }
  blockers.push(...modeBlockers(normalized));

  const contractDescriptor = {
    schema_version: DELEGATION_GRANT_SHADOW_VERSION,
    delegated_by: normalized.delegated_by,
    delegated_to: normalized.delegated_to,
    approval_mode: normalized.approval_mode,
    plan_id: normalized.plan_id,
    plan_hash: normalized.plan_hash,
    resource_scope: normalized.resource_scope,
    allowed_intents: normalized.allowed_intents,
    denied_intents: normalized.denied_intents,
    max_risk_tier: normalized.max_risk_tier,
    limits: normalized.limits,
    require_readback: normalized.require_readback,
    stop_on_drift: normalized.stop_on_drift,
    policy_version: normalized.policy_version,
    created_at: normalized.created_at,
    expires_at: normalized.expires_at,
  };
  if (!normalized.require_readback) blockers.push("READBACK_REQUIRED");
  if (!normalized.stop_on_drift) blockers.push("STOP_ON_DRIFT_REQUIRED");

  const grantHash = sha256(contractDescriptor);
  const uniqueBlockers = [...new Set(blockers)];
  const eligible = uniqueBlockers.length === 0;
  return {
    ok: true,
    report_type: "delegation_grant_shadow_preview",
    shadow_version: DELEGATION_GRANT_SHADOW_VERSION,
    decision: eligible ? "eligible_preview" : "blocked",
    grant: {
      ...contractDescriptor,
      grant_id: deterministicUuid(grantHash),
      status: "preview",
      revoked_at: null,
      secrets_included: false,
    },
    grant_hash: grantHash,
    opt_in: {
      delegation_allowed: optIn.delegation_allowed,
      delegation_mode: optIn.delegation_mode,
      automatic_delegation_allowed: false,
      fallback_agent_allowed: optIn.fallback_agent_allowed,
    },
    blockers: uniqueBlockers,
    next_action: eligible
      ? { action: "request_user_create_approval", reason_code: "DELEGATION_GRANT_PREVIEW_ELIGIBLE" }
      : { action: "resolve_delegation_grant_blockers", reason_code: uniqueBlockers[0] || "DELEGATION_GRANT_BLOCKED" },
    execution_performed: false,
    guarantees: {
      runtime_authority_changed: false,
      delegation_created: false,
      delegation_activated: false,
      approval_mutation_performed: false,
      database_writes_performed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function mapLegacyStatus(row, nowMs) {
  const expiresMs = parseDate(row.expires_at);
  if (expiresMs !== null && nowMs !== null && expiresMs <= nowMs
    && ["pending", "executing"].includes(lower(row.status))) {
    return "expired";
  }
  return LEGACY_STATUS_MAP[lower(row.status)] || "denied";
}

export function projectLegacyDelegationInspection({
  delegation,
  planBoundSession,
  expectedGrantHash = null,
  now = new Date().toISOString(),
}) {
  if (!delegation?.delegation_id) {
    throw grantError(500, "DELEGATION_GRANT_ROW_REQUIRED", "A persisted delegation row is required.");
  }
  const status = mapLegacyStatus(delegation, parseDate(now));
  const resourceHash = planBoundSession?.resource_snapshot?.resource_snapshot_hash || null;
  const planHash = planBoundSession?.plan?.plan_hash || null;
  const riskTier = lower(planBoundSession?.risk_ceiling?.tier);
  const policyGaps = [
    "APPROVAL_MODE_NOT_PERSISTED",
    "ALLOWED_INTENTS_SET_NOT_PERSISTED",
    "DENIED_INTENTS_SET_NOT_PERSISTED",
    "RISK_CEILING_NOT_PERSISTED",
    "MUTATION_LIMITS_NOT_PERSISTED",
    "READBACK_POLICY_NOT_PERSISTED",
    "STOP_ON_DRIFT_POLICY_NOT_PERSISTED",
  ];
  const grant = {
    schema_version: DELEGATION_GRANT_SHADOW_VERSION,
    grant_id: delegation.delegation_id,
    delegated_by: delegation.user_id,
    delegated_to: delegation.agent_id,
    approval_mode: null,
    plan_id: delegation.plan_id || null,
    plan_hash: planHash,
    resource_scope: resourceHash
      ? [{ resource_uri: `plan://${delegation.tenant_id}/${delegation.plan_id}`, snapshot_hash: resourceHash }]
      : [],
    allowed_intents: delegation.intent_key ? [delegation.intent_key] : [],
    denied_intents: [],
    max_risk_tier: Object.hasOwn(RISK_ORDER, riskTier) ? riskTier : null,
    limits: null,
    require_readback: null,
    stop_on_drift: null,
    policy_version: null,
    status,
    created_at: delegation.created_at || null,
    expires_at: delegation.expires_at || null,
    revoked_at: null,
    secrets_included: false,
  };
  const grantHash = sha256(grant);
  const expected = expectedGrantHash ? normalizeHash(expectedGrantHash, "expected_grant_hash") : null;
  if (expected && expected !== grantHash) {
    throw grantError(409, "DELEGATION_GRANT_STALE", "The persisted delegation projection does not match expected_grant_hash.", {
      expected_grant_hash: expected,
      observed_grant_hash: grantHash,
    });
  }
  return {
    ok: true,
    report_type: "delegation_grant_shadow_inspection",
    shadow_version: DELEGATION_GRANT_SHADOW_VERSION,
    grant,
    grant_hash: grantHash,
    compatibility_mode: "legacy_agent_delegations_projection",
    dispatch_eligible: false,
    policy_gaps: policyGaps,
    next_action: {
      action: "migrate_or_reissue_plan_bound_grant",
      reason_code: "LEGACY_DELEGATION_POLICY_GAPS",
    },
    execution_performed: false,
    guarantees: {
      runtime_authority_changed: false,
      delegation_created: false,
      delegation_activated: false,
      database_writes_performed: false,
      provider_calls_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export function evaluateDelegationTransitionShadow({
  inspection,
  action,
  requestedBy,
  principalScope = "tenant",
  now = new Date().toISOString(),
}) {
  const normalizedAction = lower(action);
  if (!["revoke", "expire"].includes(normalizedAction)) {
    throw grantError(400, "DELEGATION_GRANT_ACTION_INVALID", "action must be revoke or expire.");
  }
  const grant = inspection?.grant;
  if (!grant?.grant_id || !CANONICAL_STATUSES.has(grant.status)) {
    throw grantError(500, "DELEGATION_GRANT_INSPECTION_REQUIRED", "A valid delegation inspection is required.");
  }
  const blockers = [];
  let proposedStatus = grant.status;
  if (normalizedAction === "revoke") {
    if (!["preview", "active"].includes(grant.status)) blockers.push("DELEGATION_NOT_REVOCABLE");
    if (principalScope !== "admin" && compact(requestedBy, 191) !== grant.delegated_by) {
      blockers.push("DELEGATION_REVOKE_NOT_AUTHORIZED");
    }
    if (blockers.length === 0) proposedStatus = "revoked";
  } else {
    const expiresMs = parseDate(grant.expires_at);
    const nowMs = parseDate(now);
    if (grant.status === "expired") {
      proposedStatus = "expired";
    } else if (!["preview", "active"].includes(grant.status)) {
      blockers.push("DELEGATION_NOT_EXPIRABLE");
    } else if (expiresMs === null || nowMs === null || expiresMs > nowMs) {
      blockers.push("DELEGATION_NOT_YET_EXPIRED");
    } else {
      proposedStatus = "expired";
    }
  }
  const eligible = blockers.length === 0;
  return {
    ok: true,
    report_type: "delegation_grant_transition_shadow",
    action: normalizedAction,
    decision: eligible ? "eligible_preview" : "blocked",
    grant_id: grant.grant_id,
    current_status: grant.status,
    proposed_status: proposedStatus,
    blockers,
    next_action: eligible
      ? { action: `request_user_${normalizedAction}_approval`, reason_code: `DELEGATION_${normalizedAction.toUpperCase()}_PREVIEW_ELIGIBLE` }
      : { action: "resolve_delegation_transition_blockers", reason_code: blockers[0] || "DELEGATION_TRANSITION_BLOCKED" },
    execution_performed: false,
    guarantees: {
      delegation_mutated: false,
      database_writes_performed: false,
      provider_calls_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

async function loadAgent(pool, agentId) {
  const [rows] = await pool.query(
    `SELECT agent_id, name, execution_class, health_status, max_delegation_ttl, status
       FROM agents
      WHERE agent_id = ?
      LIMIT 2`,
    [agentId],
  );
  if (rows.length > 1) throw grantError(409, "DELEGATION_GRANT_AGENT_AMBIGUOUS", "More than one agent row matched.");
  if (!rows[0]) throw grantError(404, "DELEGATION_GRANT_AGENT_NOT_FOUND", "The delegated Agent was not found.");
  return rows[0];
}

async function loadExistingForPlan(pool, auth, planId) {
  const tenantScoped = principalClass(auth) === "tenant";
  const sql = tenantScoped
    ? `SELECT delegation_id, user_id, tenant_id, agent_id, intent_key, brand_key, plan_id,
              status, failure_reason, expires_at, created_at, completed_at
         FROM agent_delegations
        WHERE plan_id = ? AND tenant_id = ? AND user_id = ?
        ORDER BY created_at DESC
        LIMIT 20`
    : `SELECT delegation_id, user_id, tenant_id, agent_id, intent_key, brand_key, plan_id,
              status, failure_reason, expires_at, created_at, completed_at
         FROM agent_delegations
        WHERE plan_id = ?
        ORDER BY created_at DESC
        LIMIT 20`;
  const params = tenantScoped ? [planId, compact(auth.tenant_id, 36), compact(auth.user_id, 36)] : [planId];
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function loadDelegation(pool, auth, delegationId) {
  const tenantScoped = principalClass(auth) === "tenant";
  const sql = tenantScoped
    ? `SELECT delegation_id, user_id, tenant_id, agent_id, intent_key, brand_key, plan_id,
              status, failure_reason, expires_at, created_at, completed_at
         FROM agent_delegations
        WHERE delegation_id = ? AND tenant_id = ? AND user_id = ?
        LIMIT 2`
    : `SELECT delegation_id, user_id, tenant_id, agent_id, intent_key, brand_key, plan_id,
              status, failure_reason, expires_at, created_at, completed_at
         FROM agent_delegations
        WHERE delegation_id = ?
        LIMIT 2`;
  const params = tenantScoped
    ? [delegationId, compact(auth.tenant_id, 36), compact(auth.user_id, 36)]
    : [delegationId];
  const [rows] = await pool.query(sql, params);
  if (rows.length > 1) throw grantError(409, "DELEGATION_GRANT_AMBIGUOUS", "More than one delegation row matched.");
  if (!rows[0]) {
    throw grantError(404, "DELEGATION_GRANT_NOT_FOUND", "The delegation was not found for the authenticated principal.");
  }
  return rows[0];
}

function assertPrincipal(auth) {
  const scope = principalClass(auth);
  if (!scope) {
    throw grantError(403, "DELEGATION_GRANT_PRINCIPAL_NOT_ALLOWED", "An authenticated Admin or Tenant principal is required.");
  }
  return scope;
}

export async function previewDelegationGrantShadow({
  pool,
  auth = {},
  input = {},
  planBoundSessionReader = readPlanBoundSessionShadow,
  now = new Date().toISOString(),
} = {}) {
  if (!pool) throw grantError(500, "DELEGATION_GRANT_POOL_REQUIRED", "A database pool is required.");
  const scope = assertPrincipal(auth);
  const normalizedPlanId = compact(input.plan_id, 64);
  const delegatedTo = compact(input.delegated_to, 191);
  if (scope === "tenant") {
    if (compact(input.delegated_by, 191) !== compact(auth.user_id, 36)) {
      throw grantError(403, "DELEGATION_GRANT_DELEGATOR_MISMATCH", "Tenant users may preview grants only for themselves.");
    }
    if (input.tenant_id && compact(input.tenant_id, 36) !== compact(auth.tenant_id, 36)) {
      throw grantError(403, "DELEGATION_GRANT_TENANT_MISMATCH", "The requested Tenant does not match the authenticated Tenant.");
    }
  }
  const [planBoundSession, agent, existingDelegations] = await Promise.all([
    planBoundSessionReader({
      pool,
      auth,
      planId: normalizedPlanId,
      requireDelegation: false,
      agentId: delegatedTo,
      intentKey: Array.isArray(input.allowed_intents) ? input.allowed_intents[0] : null,
      expectedPlanHash: input.plan_hash,
      sessionTtlMinutes: Math.min(Number(input.session_ttl_minutes || 60), 1440),
    }),
    loadAgent(pool, delegatedTo),
    loadExistingForPlan(pool, auth, normalizedPlanId),
  ]);
  return projectDelegationGrantPreview({ input, planBoundSession, agent, existingDelegations, now });
}

export async function inspectDelegationGrantShadow({
  pool,
  auth = {},
  delegationId,
  expectedGrantHash = null,
  planBoundSessionReader = readPlanBoundSessionShadow,
  now = new Date().toISOString(),
} = {}) {
  if (!pool) throw grantError(500, "DELEGATION_GRANT_POOL_REQUIRED", "A database pool is required.");
  assertPrincipal(auth);
  const normalizedId = compact(delegationId, 64);
  if (!normalizedId) throw grantError(400, "DELEGATION_GRANT_ID_REQUIRED", "delegation_id is required.");
  const delegation = await loadDelegation(pool, auth, normalizedId);
  const planBoundSession = delegation.plan_id
    ? await planBoundSessionReader({
      pool,
      auth,
      planId: delegation.plan_id,
      requireDelegation: false,
      agentId: delegation.agent_id,
      intentKey: delegation.intent_key,
    })
    : null;
  return projectLegacyDelegationInspection({ delegation, planBoundSession, expectedGrantHash, now });
}

export async function previewDelegationTransitionShadow({
  pool,
  auth = {},
  delegationId,
  action,
  expectedGrantHash = null,
  planBoundSessionReader = readPlanBoundSessionShadow,
  now = new Date().toISOString(),
} = {}) {
  const scope = assertPrincipal(auth);
  const inspection = await inspectDelegationGrantShadow({
    pool,
    auth,
    delegationId,
    expectedGrantHash,
    planBoundSessionReader,
    now,
  });
  return evaluateDelegationTransitionShadow({
    inspection,
    action,
    requestedBy: auth.user_id,
    principalScope: scope,
    now,
  });
}

export const _testingDelegationGrantShadow = {
  principalClass,
  stableJson,
  sha256,
  deterministicUuid,
  normalizeHash,
  normalizeStringSet,
  normalizeResourceScope,
  normalizeLimits,
  normalizePreviewInput,
  riskAllowed,
  modeBlockers,
  resourceSnapshotMatches,
  mapLegacyStatus,
};
