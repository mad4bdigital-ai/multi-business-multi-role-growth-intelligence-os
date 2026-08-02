import { createHash } from "node:crypto";

export const EFFECT_POLICIES = Object.freeze({
  read_only: Object.freeze({ risk_level: "low", hold_type: null, required_role: null }),
  state_change: Object.freeze({ risk_level: "medium", hold_type: "review", required_role: "certified_reviewer" }),
  destructive: Object.freeze({ risk_level: "critical", hold_type: "supervisor_approval", required_role: "supervisor" }),
  external_send: Object.freeze({ risk_level: "high", hold_type: "supervisor_approval", required_role: "supervisor" }),
  managed_operation: Object.freeze({ risk_level: "high", hold_type: "managed_handoff", required_role: "managed_operator" }),
});

const ACCESS_HOLD_POLICIES = Object.freeze({
  REQUIRE_REVIEW: Object.freeze({ hold_type: "review", required_role: "certified_reviewer" }),
  REQUIRE_SUPERVISOR_APPROVAL: Object.freeze({ hold_type: "supervisor_approval", required_role: "supervisor" }),
  ROUTE_TO_MANAGED_SERVICE: Object.freeze({ hold_type: "managed_handoff", required_role: "managed_operator" }),
});

const HOLD_RANK = Object.freeze({ review: 1, managed_handoff: 2, supervisor_approval: 3 });
export const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
export const OPEN_PARENT_STATUSES = new Set(["open", "in_review", "awaiting_approval"]);
export const MANAGED_STEP_TYPES = new Set(["action", "review", "approval", "managed_op", "branch", "wait", "end"]);
export const ACTIVE_CAPABILITY_STATUSES = new Set(["active", "available", "read_only_certified", "diagnostic_certified", "certified"]);
export const PERMISSION_RANK = Object.freeze({ view: 1, comment: 2, edit: 3, operate: 4, manage: 5, admin: 6, owner: 7 });
export const REQUIRED_PERMISSION_BY_EFFECT = Object.freeze({
  read_only: "view",
  state_change: "edit",
  destructive: "manage",
  external_send: "operate",
  managed_operation: "operate",
});

const SERVICE_MODES = new Set(["self_serve", "assisted", "managed"]);
const SENSITIVE_KEY = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie)/i;
const SENSITIVE_VALUE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)=)/i;

export function managedError(status, code, message, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

export function requiredString(value, field, max = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw managedError(400, "managed_execution_missing_field", `${field} is required.`, { field });
  if (normalized.length > max) throw managedError(400, "managed_execution_field_too_long", `${field} exceeds ${max} characters.`, { field, max });
  return normalized;
}

export function optionalString(value, max = 191) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

export function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function assertManagedExecutionPayloadSecretFree(value, path = "payload", depth = 0) {
  if (depth > 10 || value === null || value === undefined) return true;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE.test(value)) throw managedError(400, "managed_execution_secret_value_rejected", `Secret-like value is not allowed at ${path}.`);
    return true;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertManagedExecutionPayloadSecretFree(item, `${path}[${index}]`, depth + 1));
    return true;
  }
  if (typeof value !== "object") return true;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw managedError(400, "managed_execution_secret_field_rejected", `Secret-bearing field is not allowed at ${path}.${key}.`);
    assertManagedExecutionPayloadSecretFree(child, `${path}.${key}`, depth + 1);
  }
  return true;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

export function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(stableObject(value))).digest("hex");
}

function strongerHold(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return (HOLD_RANK[left.hold_type] || 0) >= (HOLD_RANK[right.hold_type] || 0) ? left : right;
}

function gateForHold(hold) {
  if (!hold) return {
    initial_status: "pending",
    lifecycle_state: "execution_ready",
    customer_status: "in_progress",
    requires_approval: false,
    hold_type: null,
    required_role: null,
  };
  return {
    initial_status: hold.hold_type === "review" ? "awaiting_review" : "awaiting_approval",
    lifecycle_state: hold.hold_type === "managed_handoff" ? "managed_handoff_required" : "awaiting_approval",
    customer_status: "waiting_for_approval",
    requires_approval: true,
    hold_type: hold.hold_type,
    required_role: hold.required_role,
  };
}

export function normalizeManagedExecutionEnvelope(input = {}) {
  const effect_class = requiredString(input.effect_class, "effect_class", 64).toLowerCase();
  const policy = EFFECT_POLICIES[effect_class];
  if (!policy) throw managedError(400, "managed_execution_effect_class_invalid", `Unsupported effect_class '${effect_class}'.`);
  const envelope = {
    tenant_id: requiredString(input.tenant_id, "tenant_id", 64),
    user_id: requiredString(input.user_id || input.requester_id, "user_id", 64),
    parent_ticket_id: requiredString(input.parent_ticket_id, "parent_ticket_id", 64),
    workflow_key: requiredString(input.workflow_key, "workflow_key", 128),
    capability_key: requiredString(input.capability_key, "capability_key", 191),
    resource_type: requiredString(input.resource_type, "resource_type", 128),
    resource_ref: requiredString(input.resource_ref, "resource_ref", 255),
    effect_class,
    idempotency_key: requiredString(input.idempotency_key || input.request_id, "idempotency_key", 191),
    workspace_id: optionalString(input.workspace_id, 64),
    workspace_key: optionalString(input.workspace_key, 128),
    brand_id: optionalString(input.brand_id, 64),
    brand_key: optionalString(input.brand_key, 128),
    request_id: optionalString(input.request_id || input.idempotency_key, 128),
    session_id: optionalString(input.session_id, 128),
    conversation_id: optionalString(input.conversation_id, 128),
    correlation_id: optionalString(input.correlation_id, 191),
    plan_id: optionalString(input.plan_id, 64),
    service_mode: optionalString(input.service_mode, 32) || "managed",
    task_title: optionalString(input.task_title, 512) || `Managed execution: ${input.capability_key || input.workflow_key}`,
    input_json: input.input_json ?? null,
    policy,
  };
  if (!SERVICE_MODES.has(envelope.service_mode)) throw managedError(400, "managed_execution_service_mode_invalid", `Unsupported service_mode '${envelope.service_mode}'.`);
  assertManagedExecutionPayloadSecretFree(envelope.input_json, "input_json");
  return envelope;
}

export function resolveManagedExecutionGate({ access_decision, effect_class }) {
  if (access_decision === "DENY") throw managedError(403, "managed_execution_access_denied", "Effective access denied managed execution.");
  const effectPolicy = EFFECT_POLICIES[effect_class];
  if (!effectPolicy) throw managedError(400, "managed_execution_effect_class_invalid", `Unsupported effect_class '${effect_class}'.`);
  const effectHold = effectPolicy.hold_type ? { hold_type: effectPolicy.hold_type, required_role: effectPolicy.required_role } : null;
  return gateForHold(strongerHold(effectHold, ACCESS_HOLD_POLICIES[access_decision] || null));
}

export function buildManagedAuthoritySnapshot({ envelope, access, gate, authority }) {
  const snapshot = {
    contract: "tenant-managed-execution-v1",
    tenant_id: envelope.tenant_id,
    user_id: envelope.user_id,
    parent_ticket_id: envelope.parent_ticket_id,
    workflow_key: envelope.workflow_key,
    capability_key: envelope.capability_key,
    resource: { type: envelope.resource_type, ref: envelope.resource_ref },
    effect_class: envelope.effect_class,
    idempotency_key: envelope.idempotency_key,
    access_decision: access.decision,
    access_reason: access.reason,
    risk_level: envelope.policy.risk_level,
    service_mode: access.service_mode || envelope.service_mode,
    plan_key: access.plan_key || null,
    resolved_at: access.resolved_at || new Date().toISOString(),
    approval: { required: gate.requires_approval, hold_type: gate.hold_type, required_role: gate.required_role },
    capability_authority: authority.capability,
    resource_grant: authority.resource_grant,
    authority_resolved_at: authority.resolved_at,
    secrets_included: false,
  };
  return { ...snapshot, fingerprint_sha256: sha256Json(snapshot) };
}

export function assertManagedExecutionTransition({ current_status, next_status }) {
  const current = String(current_status || "");
  const next = String(next_status || "");
  if (current && current === next) return true;
  const allowed = {
    pending: new Set(["running", "cancelled"]),
    running: new Set(["paused", "completed", "failed", "cancelled"]),
    paused: new Set(["running", "cancelled"]),
    awaiting_review: new Set(["cancelled"]),
    awaiting_approval: new Set(["cancelled"]),
    completed: new Set(), failed: new Set(), cancelled: new Set(),
  };
  if (!allowed[current]?.has(next)) throw managedError(409, "managed_execution_transition_forbidden", `Managed execution cannot transition from '${current}' to '${next}'.`);
  return true;
}

export function assertManagedExecutionStepEligibility({ run, holds = [], now = new Date() }) {
  const context = parseJson(run?.execution_context_json, {});
  if (context.contract !== "tenant-managed-execution-v1") return { managed: false, allowed: true };
  const authority = context.authority_snapshot || {};
  const { fingerprint_sha256: fingerprint, ...authorityPayload } = authority;
  if (!fingerprint || !authority.capability_key || !authority.resource?.type || !authority.resource?.ref) throw managedError(409, "managed_execution_authority_snapshot_invalid", "Managed execution authority snapshot is incomplete.");
  if (sha256Json(authorityPayload) !== fingerprint) throw managedError(409, "managed_execution_authority_snapshot_tampered", "Managed execution authority snapshot fingerprint does not match its payload.");
  if (!["pending", "running"].includes(run.status)) throw managedError(409, "managed_execution_run_not_eligible", `Run status '${run.status}' is not eligible for step creation.`);
  const openHold = holds.find((hold) => hold.status === "open");
  if (authority.approval?.required && holds.length === 0) throw managedError(409, "managed_execution_approval_evidence_missing", "Managed execution requires approval evidence before steps can be created.");
  if (openHold) {
    if (openHold.expires_at && new Date(openHold.expires_at).getTime() <= now.getTime()) throw managedError(409, "managed_execution_approval_expired", "Managed execution approval has expired.");
    throw managedError(409, "managed_execution_approval_pending", "Managed execution is still awaiting approval.");
  }
  if (holds.some((hold) => ["rejected", "expired"].includes(hold.status))) throw managedError(409, "managed_execution_approval_not_valid", "Managed execution approval is rejected or expired.");
  if (authority.approval?.required && !holds.some((hold) => hold.status === "approved")) throw managedError(409, "managed_execution_approval_evidence_missing", "Managed execution requires an approved hold before steps can be created.");
  return { managed: true, allowed: true, authority_snapshot: authority };
}

export function projectManagedExecutionState({ run = {}, holds = [], steps = [], binding = {} }) {
  const contradictions = [];
  const openHolds = holds.filter((hold) => hold.status === "open");
  const runningSteps = steps.filter((step) => step.status === "running");
  if (openHolds.length && ["running", "completed"].includes(run.status)) contradictions.push("run_active_while_approval_open");
  if (TERMINAL_RUN_STATUSES.has(run.status) && runningSteps.length) contradictions.push("terminal_run_has_running_steps");
  if (run.status === "completed" && steps.some((step) => ["failed", "awaiting", "pending"].includes(step.status))) contradictions.push("completed_run_has_incomplete_steps");
  const customer_status = contradictions.length ? "under_review" : openHolds.length ? "waiting_for_approval" : run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : run.status === "cancelled" ? "cancelled" : run.status === "paused" ? "blocked" : "in_progress";
  return {
    run_id: run.run_id || binding.run_id || null,
    task_ticket_id: binding.task_ticket_id || null,
    lifecycle_state: contradictions.length ? "reconciliation_required" : (binding.lifecycle_state || run.status || "unknown"),
    customer_status,
    approval_pending: openHolds.length > 0,
    contradictions,
    next_action: contradictions.length ? "reconcile_linked_states" : openHolds.length ? "approval_decision_required" : TERMINAL_RUN_STATUSES.has(run.status) ? "none" : "continue_execution",
    secrets_included: false,
  };
}

export const MANAGED_EXECUTION_EFFECT_CLASSES = Object.freeze(Object.keys(EFFECT_POLICIES));
