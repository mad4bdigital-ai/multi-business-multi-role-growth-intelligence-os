import { createHash } from "node:crypto";
import { readDurableOperationShadow } from "./durableExecutionShadowService.js";

const ADMIN_MODES = new Set(["backend_api", "admin", "service", "service_account"]);
const TERMINAL_PLAN_STATES = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_SESSION_STATES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_DELEGATION_STATES = new Set(["pending", "executing"]);
const APPROVAL_REQUIRED_DECISIONS = new Set([
  "REQUIRE_REVIEW",
  "REQUIRE_SUPERVISOR_APPROVAL",
  "ROUTE_TO_MANAGED_SERVICE",
]);

function shadowError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details ? { ...details, secrets_included: false } : { secrets_included: false };
  return error;
}

function compact(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value) {
  return compact(value, 128).toLowerCase();
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

function normalizeExpectedHash(value, field) {
  const normalized = lower(value);
  if (!normalized) return null;
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw shadowError(400, "PLAN_BOUND_HASH_INVALID", `${field} must be a lowercase SHA-256 hash.`, { field });
  }
  return normalized;
}

function fingerprintJson(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { hash: sha256("null"), valid: true, present: false };
  try {
    return { hash: sha256(JSON.parse(text)), valid: true, present: true };
  } catch {
    return { hash: sha256(text), valid: false, present: true };
  }
}

function parseDate(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function isoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function deriveRiskCeiling(plan = {}) {
  const decision = compact(plan.access_decision, 64).toUpperCase();
  const map = {
    ALLOW_SELF_SERVE: { tier: "read_only", ordinal: 0 },
    ALLOW_WITH_OPTIONAL_ASSISTANCE: { tier: "low", ordinal: 1 },
    REQUIRE_REVIEW: { tier: "medium", ordinal: 2 },
    REQUIRE_SUPERVISOR_APPROVAL: { tier: "high", ordinal: 3 },
    ROUTE_TO_MANAGED_SERVICE: { tier: "high", ordinal: 3 },
    DENY: { tier: "blocked", ordinal: -1 },
  };
  return {
    ...(map[decision] || { tier: "unknown", ordinal: -1 }),
    source: decision ? "execution_plans.access_decision" : "missing",
    access_decision: decision || null,
  };
}

function selectSession(rows, requestedSessionId) {
  if (requestedSessionId) {
    const exact = rows.filter((row) => row.connected_session_id === requestedSessionId);
    if (exact.length > 1) {
      throw shadowError(409, "PLAN_BOUND_SESSION_AMBIGUOUS", "More than one connected session matched the requested identifier.", {
        connected_session_id: requestedSessionId,
        candidate_count: exact.length,
      });
    }
    if (exact.length === 1) return exact[0];
    throw shadowError(404, "PLAN_BOUND_SESSION_NOT_FOUND", "The connected execution session was not found for the plan.", {
      connected_session_id: requestedSessionId,
    });
  }
  const active = rows.filter((row) => !TERMINAL_SESSION_STATES.has(lower(row.status)));
  if (active.length > 1) {
    throw shadowError(409, "PLAN_BOUND_SESSION_AMBIGUOUS", "More than one non-terminal connected session is bound to the plan.", {
      candidate_count: active.length,
    });
  }
  return active[0] || null;
}

function selectDelegation(rows) {
  const active = rows.filter((row) => ACTIVE_DELEGATION_STATES.has(lower(row.status)));
  if (active.length > 1) {
    throw shadowError(409, "PLAN_BOUND_DELEGATION_AMBIGUOUS", "More than one active delegation is bound to the plan.", {
      candidate_count: active.length,
    });
  }
  return active[0] || null;
}

function approvalProjection(rows, planAgentId) {
  const holds = rows.map((row) => {
    const requestedBy = compact(row.requested_by, 64) || null;
    const assignedTo = compact(row.assigned_to, 64) || null;
    const decisionBy = compact(row.decision_by, 64) || null;
    const actorId = compact(row.actor_id, 64) || null;
    const status = lower(row.status);
    const selfApproval = status === "approved" && Boolean(decisionBy)
      && [requestedBy, actorId].filter(Boolean).includes(decisionBy);
    const selfAssignment = Boolean(requestedBy && assignedTo && requestedBy === assignedTo);
    const agentSelfApproval = status === "approved"
      && Boolean(planAgentId && decisionBy && planAgentId === decisionBy);
    return {
      hold_id: row.hold_id,
      hold_type: row.hold_type,
      status,
      required_role: row.required_role || null,
      requested_by: requestedBy,
      assigned_to: assignedTo,
      decision_by: decisionBy,
      expires_at: row.expires_at || null,
      decided_at: row.decided_at || null,
      created_at: row.created_at || null,
      self_approval: selfApproval,
      self_assignment: selfAssignment,
      agent_self_approval: agentSelfApproval,
    };
  });
  return {
    holds,
    approved_independent_count: holds.filter((row) => row.status === "approved"
      && !row.self_approval && !row.self_assignment && !row.agent_self_approval).length,
    pending_count: holds.filter((row) => ["open", "escalated"].includes(row.status)).length,
    self_approval_detected: holds.some((row) => row.self_approval),
    self_assignment_detected: holds.some((row) => row.self_assignment),
    agent_self_approval_detected: holds.some((row) => row.agent_self_approval),
  };
}

function nextActionFor(blocker) {
  const map = {
    ACCESS_DENIED: "start_new_plan",
    PLAN_TERMINAL: "start_new_plan",
    CONNECTED_SESSION_REQUIRED: "create_connected_session",
    CONNECTED_SESSION_TERMINAL: "create_connected_session",
    SESSION_MAX_ROUNDS_REQUIRED: "set_session_round_limit",
    SESSION_ROUND_LIMIT_EXHAUSTED: "request_new_session",
    SESSION_EXPIRED: "request_new_session",
    DELEGATION_REQUIRED: "request_delegation",
    DELEGATION_EXPIRED: "request_delegation",
    DELEGATION_PLAN_MISMATCH: "request_plan_bound_delegation",
    DELEGATION_AGENT_MISMATCH: "request_plan_bound_delegation",
    DELEGATION_INTENT_MISMATCH: "request_plan_bound_delegation",
    DELEGATION_SCOPE_MISMATCH: "request_plan_bound_delegation",
    APPROVAL_PENDING: "provide_independent_approval",
    INDEPENDENT_APPROVAL_REQUIRED: "provide_independent_approval",
    SELF_APPROVAL_DETECTED: "request_independent_approval",
    SELF_ASSIGNMENT_DETECTED: "request_independent_approver",
    AGENT_SELF_APPROVAL_DETECTED: "request_independent_approval",
    PLAN_JSON_INVALID: "repair_plan_payload",
  };
  return map[blocker] || "review_plan_bound_session_gap";
}

function resourceSnapshot(plan) {
  return {
    tenant_id: plan.tenant_id,
    workspace_id: plan.workspace_id || null,
    workspace_key: plan.workspace_key || null,
    brand_id: plan.brand_id || null,
    brand_key: plan.brand_key || null,
    target_key: plan.target_key || null,
    workflow_key: plan.workflow_key || null,
    workflow_id: plan.workflow_id || null,
    route_key: plan.route_key || null,
    service_mode: plan.service_mode || null,
  };
}

function planDefinition(plan) {
  const context = fingerprintJson(plan.execution_context_json);
  const steps = fingerprintJson(plan.steps_json);
  const preview = fingerprintJson(plan.preview_json);
  const definition = {
    plan_id: plan.plan_id,
    tenant_id: plan.tenant_id,
    workspace_id: plan.workspace_id || null,
    workspace_key: plan.workspace_key || null,
    user_id: plan.user_id || null,
    actor_id: plan.actor_id || null,
    actor_type: plan.actor_type || null,
    brand_id: plan.brand_id || null,
    brand_key: plan.brand_key || null,
    intent_key: plan.intent_key || null,
    target_key: plan.target_key || null,
    workflow_key: plan.workflow_key || null,
    workflow_id: plan.workflow_id || null,
    agent_id: plan.agent_id || null,
    route_key: plan.route_key || null,
    service_mode: plan.service_mode || null,
    access_decision: plan.access_decision || null,
    execution_context_sha256: context.hash,
    steps_sha256: steps.hash,
    preview_sha256: preview.hash,
  };
  return {
    plan_hash: sha256(definition),
    json_valid: context.valid && steps.valid && preview.valid,
    payload_hashes: {
      execution_context_sha256: context.hash,
      steps_sha256: steps.hash,
      preview_sha256: preview.hash,
    },
  };
}

function safeSession(row, ttlMinutes, delegation) {
  if (!row) return null;
  const createdMs = parseDate(row.created_at);
  const sessionExpiryMs = createdMs === null ? null : createdMs + ttlMinutes * 60_000;
  const delegationExpiryMs = parseDate(delegation?.expires_at);
  const effectiveExpiryMs = [sessionExpiryMs, delegationExpiryMs]
    .filter((value) => value !== null)
    .sort((a, b) => a - b)[0] ?? null;
  const maxRounds = row.max_rounds === null || row.max_rounds === undefined ? null : Number(row.max_rounds);
  const roundCount = Number(row.round_count || 0);
  return {
    connected_session_id: row.connected_session_id,
    mode: row.mode,
    status: lower(row.status),
    current_run_id: row.current_run_id || null,
    current_step_run_id: row.current_step_run_id || null,
    last_evidence_report_id: row.last_evidence_report_id || null,
    round_count: roundCount,
    max_rounds: maxRounds,
    rounds_remaining: maxRounds === null ? null : Math.max(maxRounds - roundCount, 0),
    session_ttl_minutes: ttlMinutes,
    effective_expires_at: isoOrNull(effectiveExpiryMs),
    policy_hashes: {
      resume_policy_sha256: fingerprintJson(row.resume_policy_json).hash,
      budget_policy_sha256: fingerprintJson(row.budget_policy_json).hash,
      checkpoint_policy_sha256: fingerprintJson(row.checkpoint_policy_json).hash,
      resume_cursor_sha256: fingerprintJson(row.resume_cursor_json).hash,
      last_checkpoint_sha256: fingerprintJson(row.last_checkpoint_json).hash,
      next_action_sha256: fingerprintJson(row.next_action_json).hash,
    },
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_activity_at: row.last_activity_at || null,
  };
}

function safeDelegation(row) {
  if (!row) return null;
  return {
    delegation_id: row.delegation_id,
    agent_id: row.agent_id,
    intent_key: row.intent_key,
    brand_key: row.brand_key || null,
    plan_id: row.plan_id || null,
    status: lower(row.status),
    expires_at: row.expires_at || null,
    created_at: row.created_at || null,
  };
}

export function projectPlanBoundSessionShadow({
  plan,
  durableOperation,
  session,
  delegation,
  approvalHolds = [],
  input = {},
  now = new Date().toISOString(),
}) {
  if (!plan?.plan_id || !durableOperation?.operation?.plan_id) {
    throw shadowError(500, "PLAN_BOUND_PROJECTION_INVALID", "A persisted plan and durable operation projection are required.");
  }
  const ttlMinutes = Number(input.session_ttl_minutes || 60);
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) {
    throw shadowError(400, "PLAN_BOUND_SESSION_TTL_INVALID", "session_ttl_minutes must be an integer from 1 to 1440.");
  }

  const definition = planDefinition(plan);
  const resources = resourceSnapshot(plan);
  const resourceSnapshotHash = sha256(resources);
  const expectedPlanHash = normalizeExpectedHash(input.expected_plan_hash, "expected_plan_hash");
  const expectedResourceHash = normalizeExpectedHash(input.expected_resource_snapshot_hash, "expected_resource_snapshot_hash");
  if (expectedPlanHash && expectedPlanHash !== definition.plan_hash) {
    throw shadowError(409, "PLAN_BOUND_PLAN_HASH_STALE", "The persisted plan no longer matches expected_plan_hash.", {
      expected_plan_hash: expectedPlanHash,
      observed_plan_hash: definition.plan_hash,
    });
  }
  if (expectedResourceHash && expectedResourceHash !== resourceSnapshotHash) {
    throw shadowError(409, "PLAN_BOUND_RESOURCE_SNAPSHOT_STALE", "The persisted resource snapshot no longer matches expected_resource_snapshot_hash.", {
      expected_resource_snapshot_hash: expectedResourceHash,
      observed_resource_snapshot_hash: resourceSnapshotHash,
    });
  }

  const safeDelegationRow = safeDelegation(delegation);
  const safeSessionRow = safeSession(session, ttlMinutes, delegation);
  const approvals = approvalProjection(approvalHolds, safeDelegationRow?.agent_id || plan.agent_id || null);
  const riskCeiling = deriveRiskCeiling(plan);
  const blockers = [];
  const planStatus = lower(plan.plan_status);
  const nowMs = parseDate(now);

  if (riskCeiling.tier === "blocked") blockers.push("ACCESS_DENIED");
  if (TERMINAL_PLAN_STATES.has(planStatus)) blockers.push("PLAN_TERMINAL");
  if (!definition.json_valid) blockers.push("PLAN_JSON_INVALID");
  if (!safeSessionRow) {
    blockers.push("CONNECTED_SESSION_REQUIRED");
  } else {
    if (TERMINAL_SESSION_STATES.has(safeSessionRow.status)) blockers.push("CONNECTED_SESSION_TERMINAL");
    if (safeSessionRow.max_rounds === null) blockers.push("SESSION_MAX_ROUNDS_REQUIRED");
    else if (safeSessionRow.rounds_remaining <= 0) blockers.push("SESSION_ROUND_LIMIT_EXHAUSTED");
    const expiryMs = parseDate(safeSessionRow.effective_expires_at);
    if (nowMs !== null && expiryMs !== null && expiryMs <= nowMs) blockers.push("SESSION_EXPIRED");
  }

  if (input.require_delegation === true && !safeDelegationRow) blockers.push("DELEGATION_REQUIRED");
  if (safeDelegationRow) {
    const delegationExpiryMs = parseDate(safeDelegationRow.expires_at);
    if (safeDelegationRow.status === "expired"
      || (nowMs !== null && delegationExpiryMs !== null && delegationExpiryMs <= nowMs)) {
      blockers.push("DELEGATION_EXPIRED");
    }
    if (safeDelegationRow.plan_id !== plan.plan_id) blockers.push("DELEGATION_PLAN_MISMATCH");
    if (input.agent_id && safeDelegationRow.agent_id !== input.agent_id) blockers.push("DELEGATION_AGENT_MISMATCH");
    if (input.intent_key && safeDelegationRow.intent_key !== input.intent_key) blockers.push("DELEGATION_INTENT_MISMATCH");
    if (safeDelegationRow.agent_id !== (plan.agent_id || safeDelegationRow.agent_id)
      || safeDelegationRow.intent_key !== (plan.intent_key || safeDelegationRow.intent_key)) {
      blockers.push("DELEGATION_SCOPE_MISMATCH");
    }
  }

  if (approvals.self_approval_detected) blockers.push("SELF_APPROVAL_DETECTED");
  if (approvals.self_assignment_detected) blockers.push("SELF_ASSIGNMENT_DETECTED");
  if (approvals.agent_self_approval_detected) blockers.push("AGENT_SELF_APPROVAL_DETECTED");
  if (approvals.pending_count > 0) blockers.push("APPROVAL_PENDING");
  if (APPROVAL_REQUIRED_DECISIONS.has(compact(plan.access_decision, 64).toUpperCase())
    && approvals.approved_independent_count === 0) {
    blockers.push("INDEPENDENT_APPROVAL_REQUIRED");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const resolved = uniqueBlockers.length === 0;
  return {
    ok: true,
    report_type: "plan_bound_session_shadow",
    projection_mode: "shadow",
    runtime_authority: false,
    observed_at: now,
    decision: resolved ? "resolved_preview" : "blocked",
    plan: {
      plan_id: plan.plan_id,
      plan_hash: definition.plan_hash,
      durable_operation_hash: durableOperation.operation.plan_hash,
      plan_status: planStatus,
      runtime_status: plan.runtime_status || null,
      intent_key: plan.intent_key || null,
      agent_id: plan.agent_id || null,
      access_decision: plan.access_decision || null,
      payload_hashes: definition.payload_hashes,
      created_at: plan.created_at || null,
      updated_at: plan.updated_at || null,
    },
    resource_snapshot: { ...resources, resource_snapshot_hash: resourceSnapshotHash },
    risk_ceiling: riskCeiling,
    session: safeSessionRow,
    delegation: safeDelegationRow,
    approval_independence: approvals,
    blockers: uniqueBlockers,
    next_action: resolved
      ? { action: "none", reason_code: "PLAN_BOUND_SESSION_RESOLVED" }
      : { action: nextActionFor(uniqueBlockers[0]), reason_code: uniqueBlockers[0] },
    guarantees: {
      registry_authority: "mysql_primary",
      tenant_scope_enforced: true,
      plan_hash_bound: true,
      resource_snapshot_hash_bound: true,
      risk_ceiling_advisory_only: true,
      authority_expansion_allowed: false,
      delegation_activation_performed: false,
      approval_mutation_performed: false,
      database_writes_performed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      raw_json_payloads_returned: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export async function readPlanBoundSessionShadow({
  pool,
  auth = {},
  planId,
  connectedSessionId = null,
  requireDelegation = false,
  agentId = null,
  intentKey = null,
  expectedPlanHash = null,
  expectedResourceSnapshotHash = null,
  sessionTtlMinutes = 60,
} = {}) {
  if (!pool) throw shadowError(500, "PLAN_BOUND_POOL_REQUIRED", "Plan-bound session shadow requires a database pool.");
  const scope = principalClass(auth);
  if (!scope) throw shadowError(403, "PLAN_BOUND_PRINCIPAL_NOT_ALLOWED", "An authenticated Admin or Tenant principal is required.");
  const normalizedPlanId = compact(planId, 64);
  if (!normalizedPlanId) throw shadowError(400, "PLAN_BOUND_PLAN_ID_REQUIRED", "plan_id is required.");

  const durable = await readDurableOperationShadow({ pool, auth, operationId: normalizedPlanId });
  const tenantScoped = scope === "tenant";
  const tenantId = compact(auth.tenant_id, 36);
  const userId = compact(auth.user_id, 36);
  const planSql = tenantScoped
    ? `SELECT plan_id, tenant_id, workspace_id, workspace_key, user_id, actor_id, actor_type,
              brand_id, brand_key, intent_key, target_key, workflow_key, workflow_id, agent_id,
              route_key, service_mode, access_decision, plan_status, runtime_status,
              execution_context_json, steps_json, preview_json, created_at, updated_at
         FROM execution_plans
        WHERE plan_id = ? AND tenant_id = ? AND user_id = ?
        LIMIT 1`
    : `SELECT plan_id, tenant_id, workspace_id, workspace_key, user_id, actor_id, actor_type,
              brand_id, brand_key, intent_key, target_key, workflow_key, workflow_id, agent_id,
              route_key, service_mode, access_decision, plan_status, runtime_status,
              execution_context_json, steps_json, preview_json, created_at, updated_at
         FROM execution_plans
        WHERE plan_id = ?
        LIMIT 1`;
  const [planRows] = await pool.query(planSql, tenantScoped ? [normalizedPlanId, tenantId, userId] : [normalizedPlanId]);
  const plan = planRows[0];
  if (!plan) {
    throw shadowError(404, "PLAN_BOUND_PLAN_NOT_FOUND", "The execution plan was not found for the authenticated principal.", {
      plan_id: normalizedPlanId,
    });
  }

  const sessionSql = tenantScoped
    ? `SELECT connected_session_id, tenant_id, user_id, root_plan_id, current_run_id,
              current_step_run_id, mode, status, resume_policy_json, budget_policy_json,
              checkpoint_policy_json, resume_cursor_json, last_checkpoint_json,
              next_action_json, last_evidence_report_id, round_count, max_rounds,
              created_at, updated_at, last_activity_at
         FROM connected_execution_sessions
        WHERE root_plan_id = ? AND tenant_id = ? AND user_id = ?
        ORDER BY updated_at DESC
        LIMIT 10`
    : `SELECT connected_session_id, tenant_id, user_id, root_plan_id, current_run_id,
              current_step_run_id, mode, status, resume_policy_json, budget_policy_json,
              checkpoint_policy_json, resume_cursor_json, last_checkpoint_json,
              next_action_json, last_evidence_report_id, round_count, max_rounds,
              created_at, updated_at, last_activity_at
         FROM connected_execution_sessions
        WHERE root_plan_id = ?
        ORDER BY updated_at DESC
        LIMIT 10`;
  const [sessionRows] = await pool.query(sessionSql, tenantScoped ? [normalizedPlanId, tenantId, userId] : [normalizedPlanId]);
  const session = selectSession(sessionRows, compact(connectedSessionId, 64) || null);

  const delegationSql = tenantScoped
    ? `SELECT delegation_id, user_id, tenant_id, agent_id, intent_key, brand_key,
              plan_id, status, expires_at, created_at
         FROM agent_delegations
        WHERE plan_id = ? AND tenant_id = ? AND user_id = ?
        ORDER BY created_at DESC
        LIMIT 10`
    : `SELECT delegation_id, user_id, tenant_id, agent_id, intent_key, brand_key,
              plan_id, status, expires_at, created_at
         FROM agent_delegations
        WHERE plan_id = ?
        ORDER BY created_at DESC
        LIMIT 10`;
  const [delegationRows] = await pool.query(delegationSql, tenantScoped ? [normalizedPlanId, tenantId, userId] : [normalizedPlanId]);
  const delegation = selectDelegation(delegationRows);

  let approvalRows = [];
  if (session?.current_run_id) {
    const approvalSql = tenantScoped
      ? `SELECT hold_id, run_id, step_run_id, tenant_id, workspace_id, workspace_key,
                hold_type, requested_by, user_id, actor_id, actor_type, assigned_to,
                required_role, status, decision_by, expires_at, decided_at, created_at
           FROM approval_holds
          WHERE run_id = ? AND tenant_id = ?
          ORDER BY created_at
          LIMIT 100`
      : `SELECT hold_id, run_id, step_run_id, tenant_id, workspace_id, workspace_key,
                hold_type, requested_by, user_id, actor_id, actor_type, assigned_to,
                required_role, status, decision_by, expires_at, decided_at, created_at
           FROM approval_holds
          WHERE run_id = ?
          ORDER BY created_at
          LIMIT 100`;
    [approvalRows] = await pool.query(approvalSql, tenantScoped ? [session.current_run_id, tenantId] : [session.current_run_id]);
  }

  return projectPlanBoundSessionShadow({
    plan,
    durableOperation: durable,
    session,
    delegation,
    approvalHolds: approvalRows,
    input: {
      require_delegation: requireDelegation === true,
      agent_id: compact(agentId, 64) || null,
      intent_key: compact(intentKey, 128) || null,
      expected_plan_hash: expectedPlanHash,
      expected_resource_snapshot_hash: expectedResourceSnapshotHash,
      session_ttl_minutes: sessionTtlMinutes,
    },
  });
}

export const _testingPlanBoundSessionShadow = {
  principalClass,
  fingerprintJson,
  deriveRiskCeiling,
  selectSession,
  selectDelegation,
  approvalProjection,
  resourceSnapshot,
  planDefinition,
  safeSession,
  safeDelegation,
};
