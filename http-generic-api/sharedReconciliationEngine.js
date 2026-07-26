import { createHash } from "node:crypto";

export const SHARED_RECONCILIATION_ENGINE_VERSION = "shared-reconciliation-continuation-v1";

export const RECONCILIATION_SEQUENCE = Object.freeze([
  "detect_drift",
  "classify_risk",
  "dry_run_repair",
  "apply_repair",
  "verify",
  "audit",
  "resume_original_operation",
]);

export const GENERALIZED_INTERRUPTION_SIGNALS = Object.freeze([
  "tool_time_exhausted",
  "session_expired",
  "transport_timeout",
  "connector_unavailable",
  "connector_tunnel_provisioning_required",
  "branch_diverged",
  "deploy_reload_pending",
  "fallback_unsupported_command",
  "credential_intake_required",
  "approval_required",
]);

const ACTOR_TYPES = new Set(["admin", "tenant", "user", "local_device", "system"]);
const RESOURCE_SCOPES = new Set(["platform", "tenant", "user", "device", "repository", "connector", "workspace", "credential", "deployment", "job"]);
const SECRET_KEY_PATTERN = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function sanitizeContinuationPayload(value, depth = 0) {
  if (depth > 8) return "[max-depth]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeContinuationPayload(item, depth + 1));
  if (typeof value !== "object") return value;

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      sanitized[key] = "[redacted]";
    } else {
      sanitized[key] = sanitizeContinuationPayload(item, depth + 1);
    }
  }
  return sanitized;
}

export function fingerprintResource(resource = {}) {
  const sanitized = sanitizeContinuationPayload(resource);
  return createHash("sha256").update(stableJson(sanitized)).digest("hex");
}

export function normalizeActorScope(actorContext = {}) {
  const actorType = String(actorContext.actor_type || actorContext.type || "user").trim().toLowerCase();
  if (!ACTOR_TYPES.has(actorType)) {
    const err = new Error("actor_type must be admin, tenant, user, local_device, or system.");
    err.code = "invalid_actor_type";
    throw err;
  }

  const tenantId = String(actorContext.tenant_id || "").trim();
  const userId = String(actorContext.user_id || "").trim();
  const deviceId = String(actorContext.device_id || "").trim();

  if ((actorType === "tenant" || actorType === "user") && !tenantId) {
    const err = new Error("tenant_id is required for tenant and user reconciliation scopes.");
    err.code = "tenant_id_required";
    throw err;
  }
  if (actorType === "user" && !userId) {
    const err = new Error("user_id is required for user reconciliation scopes.");
    err.code = "user_id_required";
    throw err;
  }
  if (actorType === "local_device" && !deviceId) {
    const err = new Error("device_id is required for local_device reconciliation scopes.");
    err.code = "device_id_required";
    throw err;
  }

  return {
    actor_type: actorType,
    tenant_id: tenantId || null,
    user_id: userId || null,
    device_id: deviceId || null,
    scope_key: [actorType, tenantId || "platform", userId || "all-users", deviceId || "all-devices"].join(":"),
  };
}

export function assertResourceScopeAllowed(actorScope = {}, resourceScope = {}) {
  const normalizedActor = normalizeActorScope(actorScope);
  const scopeType = String(resourceScope.scope_type || resourceScope.type || "tenant").trim().toLowerCase();
  if (!RESOURCE_SCOPES.has(scopeType)) {
    const err = new Error("resource scope_type is not supported by shared reconciliation.");
    err.code = "unsupported_resource_scope";
    throw err;
  }

  const tenantId = String(resourceScope.tenant_id || "").trim();
  const userId = String(resourceScope.user_id || "").trim();
  const deviceId = String(resourceScope.device_id || "").trim();

  if (normalizedActor.actor_type === "admin" || normalizedActor.actor_type === "system") {
    return { allowed: true, actor_scope: normalizedActor, scope_type: scopeType, reason_code: "platform_authority" };
  }

  if (scopeType === "platform" || scopeType === "repository") {
    return { allowed: false, actor_scope: normalizedActor, scope_type: scopeType, reason_code: "platform_scope_requires_admin" };
  }

  if (tenantId && normalizedActor.tenant_id && tenantId !== normalizedActor.tenant_id) {
    return { allowed: false, actor_scope: normalizedActor, scope_type: scopeType, reason_code: "tenant_scope_mismatch" };
  }

  if (userId && normalizedActor.user_id && userId !== normalizedActor.user_id) {
    return { allowed: false, actor_scope: normalizedActor, scope_type: scopeType, reason_code: "user_scope_mismatch" };
  }

  if (deviceId && normalizedActor.device_id && deviceId !== normalizedActor.device_id) {
    return { allowed: false, actor_scope: normalizedActor, scope_type: scopeType, reason_code: "device_scope_mismatch" };
  }

  return { allowed: true, actor_scope: normalizedActor, scope_type: scopeType, reason_code: "actor_scope_authorized" };
}

export function createContinuationCheckpoint({
  operation_key,
  resource_type,
  actor_context = {},
  resource_scope = {},
  resource_state = {},
  interruption_signal = "tool_time_exhausted",
  stage = "detect_drift",
  metadata = {},
} = {}) {
  if (!operation_key || typeof operation_key !== "string") {
    const err = new Error("operation_key is required for continuation checkpoints.");
    err.code = "operation_key_required";
    throw err;
  }
  if (!resource_type || typeof resource_type !== "string") {
    const err = new Error("resource_type is required for continuation checkpoints.");
    err.code = "resource_type_required";
    throw err;
  }

  const scopeDecision = assertResourceScopeAllowed(actor_context, resource_scope);
  if (!scopeDecision.allowed) {
    const err = new Error("Actor is not allowed to create a continuation checkpoint for this resource scope.");
    err.code = scopeDecision.reason_code;
    err.scope_decision = scopeDecision;
    throw err;
  }

  const signal = GENERALIZED_INTERRUPTION_SIGNALS.includes(interruption_signal)
    ? interruption_signal
    : "transport_timeout";
  const sanitizedMetadata = sanitizeContinuationPayload(metadata);
  const sanitizedResourceScope = sanitizeContinuationPayload(resource_scope);
  const resourceFingerprint = fingerprintResource({ resource_type, resource_scope: sanitizedResourceScope, resource_state });

  return {
    engine: SHARED_RECONCILIATION_ENGINE_VERSION,
    operation_key,
    resource_type,
    actor_scope: scopeDecision.actor_scope,
    resource_scope: sanitizedResourceScope,
    interruption_signal: signal,
    current_stage: stage,
    status: "pending_resume",
    resource_fingerprint: resourceFingerprint,
    required_before_resume: RECONCILIATION_SEQUENCE.slice(0, 3),
    required_sequence: RECONCILIATION_SEQUENCE,
    requires_reconciliation_before_resume: true,
    metadata: sanitizedMetadata,
    secrets_included: false,
  };
}

export function classifyResumeRisk({ checkpoint, actor_context = {}, resource_scope = {}, current_resource_state = {} } = {}) {
  if (!checkpoint || typeof checkpoint !== "object") {
    return { classification: "unsafe", reason_code: "missing_continuation_checkpoint", resume_allowed: false, requires_reconciliation_before_resume: true };
  }
  if (checkpoint.engine !== SHARED_RECONCILIATION_ENGINE_VERSION) {
    return { classification: "unsafe", reason_code: "unknown_checkpoint_engine", resume_allowed: false, requires_reconciliation_before_resume: true };
  }

  const effectiveActorContext = Object.keys(actor_context || {}).length ? actor_context : checkpoint.actor_scope;
  const effectiveResourceScope = Object.keys(resource_scope || {}).length ? resource_scope : checkpoint.resource_scope;
  const scopeDecision = assertResourceScopeAllowed(effectiveActorContext, effectiveResourceScope);
  if (!scopeDecision.allowed) {
    return { classification: "unsafe", reason_code: scopeDecision.reason_code, resume_allowed: false, requires_reconciliation_before_resume: true };
  }

  const currentFingerprint = fingerprintResource({
    resource_type: checkpoint.resource_type,
    resource_scope: sanitizeContinuationPayload(effectiveResourceScope),
    resource_state: current_resource_state,
  });

  if (currentFingerprint === checkpoint.resource_fingerprint) {
    return {
      classification: "clean",
      reason_code: "resource_fingerprint_unchanged",
      resume_allowed: true,
      requires_reconciliation_before_resume: false,
      current_resource_fingerprint: currentFingerprint,
    };
  }

  return {
    classification: "drift_detected",
    reason_code: "resource_fingerprint_changed_after_interruption",
    resume_allowed: false,
    requires_reconciliation_before_resume: true,
    current_resource_fingerprint: currentFingerprint,
    required_sequence: RECONCILIATION_SEQUENCE,
  };
}

export function planContinuationResume({
  checkpoint,
  actor_context = {},
  resource_scope = {},
  current_resource_state = {},
  dry_run_result = null,
  verify_result = null,
  apply_requested = false,
} = {}) {
  const risk = classifyResumeRisk({ checkpoint, actor_context, resource_scope, current_resource_state });
  const dryRunOk = dry_run_result?.ok === true;
  const verifyOk = verify_result?.ok === true;
  const applyAllowed = risk.classification === "clean" || (risk.classification === "drift_detected" && dryRunOk && verifyOk);

  return {
    ok: risk.classification !== "unsafe",
    engine: SHARED_RECONCILIATION_ENGINE_VERSION,
    risk,
    apply_requested: apply_requested === true,
    apply_allowed: apply_requested === true ? applyAllowed : false,
    next_required_step: risk.classification === "clean"
      ? "resume_original_operation"
      : dryRunOk
        ? verifyOk
          ? "apply_repair"
          : "verify"
        : "dry_run_repair",
    required_sequence: RECONCILIATION_SEQUENCE,
    audit_required: true,
    secrets_included: false,
  };
}
