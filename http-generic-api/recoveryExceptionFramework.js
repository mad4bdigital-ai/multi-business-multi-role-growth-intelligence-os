import { createHash } from "node:crypto";

export const RECOVERY_EXCEPTION_CONTRACT = "mad4b.recovery-exception-framework.v1";
export const RECOVERY_PLANE_LEVELS = Object.freeze({
  R0: "observe",
  R1: "diagnose",
  R2: "simulate",
  R3: "governed_repair",
  R4: "privileged_recovery",
  R5: "disaster_recovery",
});
export const RECOVERY_MODES = Object.freeze([
  "NORMAL",
  "DEGRADED",
  "RECOVERY_READONLY",
  "RECOVERY_CONTROLLED",
  "RECOVERY_PRIVILEGED",
  "DISASTER_RECOVERY",
  "VERIFYING",
  "RECOVERED",
]);
export const EXCEPTION_CLASSES = Object.freeze({
  E0: "diagnostic",
  E1: "target_topology",
  E2: "tool_provider",
  E3: "policy",
  E4: "privilege",
  E5: "execution_reconciliation",
  E6: "disaster",
});
export const PRIVILEGED_OPERATION_TYPES = Object.freeze([
  "ssh_command",
  "sql_statement",
  "file_patch",
  "service_action",
  "process_action",
  "network_diagnostic",
  "backup_operation",
  "deployment_rollback",
]);
export const EXCEPTION_APPROVAL_POLICY = Object.freeze({
  E0: { required_approvals: 0, approval_class: "admin_auth_only", max_ttl_seconds: 1800 },
  E1: { required_approvals: 1, approval_class: "owner_confirmation", max_ttl_seconds: 1800 },
  E2: { required_approvals: 1, approval_class: "owner_confirmation", max_ttl_seconds: 1800 },
  E3: { required_approvals: 1, approval_class: "typed_policy_approval", max_ttl_seconds: 900 },
  E4: { required_approvals: 1, approval_class: "privilege_approval", max_ttl_seconds: 600 },
  E5: { required_approvals: 1, approval_class: "reconciliation_approval", max_ttl_seconds: 600 },
  E6: { required_approvals: 2, approval_class: "dual_control", max_ttl_seconds: 300 },
});
export const NON_BYPASSABLE_INVARIANTS = Object.freeze([
  "target_identity_must_be_verified",
  "raw_credentials_never_return_to_gpt",
  "mutation_requires_append_only_audit_evidence",
  "approval_is_plan_and_target_bound",
  "recovered_requires_readback_and_behavioral_verification",
  "no_cross_tenant_authority_expansion",
  "unknown_host_is_denied",
  "production_sha_binding_cannot_be_silently_changed",
]);
export const ERROR_TAXONOMY = Object.freeze([
  "PRIVILEGED_SESSION_REQUIRED",
  "PRIVILEGED_SESSION_EXPIRED",
  "COMMAND_POLICY_DENIED",
  "SQL_POLICY_DENIED",
  "TARGET_IDENTITY_MISMATCH",
  "PLAN_STALE",
  "APPROVAL_REQUIRED",
  "APPROVAL_EXPIRED",
  "SECRET_OUTPUT_REDACTED",
  "EXECUTION_OUTCOME_UNKNOWN",
  "POSTCONDITION_FAILED",
  "EXCEPTION_REQUIRED",
  "EXCEPTION_NOT_ALLOWED",
  "EXCEPTION_APPROVAL_REQUIRED",
  "EXCEPTION_EXPIRED",
  "EXCEPTION_CONSUMED",
  "EXCEPTION_SCOPE_MISMATCH",
  "EXCEPTION_TARGET_MISMATCH",
  "EXCEPTION_STALE_SHA",
  "EXCEPTION_BUDGET_EXCEEDED",
  "EXCEPTION_REVOKED",
  "EXCEPTION_NON_BYPASSABLE_POLICY",
  "EGRESS_DENIED",
  "FILE_STATE_CHANGED",
  "WORKTREE_DRIFT_DETECTED",
  "DDL_LOCK_RISK_TOO_HIGH",
  "BACKUP_REQUIRED",
  "MANUAL_ESCALATION_REQUIRED",
]);

const SHA40_RE = /^[0-9a-f]{40}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/iu;
const INCIDENT_RE = /^incident:[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const SAFE_SEVERITY = new Set(["low", "medium", "high", "critical"]);
const SAFE_RISKS = new Set(["read_only", "reversible", "service_impacting", "filesystem_mutation", "destructive", "unknown"]);

function text(value, max = 256) { return String(value ?? "").trim().slice(0, max); }
function hash(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  throw error;
}
function exactSha(value, field = "production_sha") {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA40_RE.test(normalized)) fail(400, "RECOVERY_SHA_INVALID", `${field} must be a full 40-character SHA.`);
  return normalized;
}
function exactHash(value, field) {
  const normalized = text(value, 128).toLowerCase();
  if (!SHA256_RE.test(normalized)) fail(400, "RECOVERY_ARTIFACT_HASH_INVALID", `${field} must be a 64-character SHA-256 digest.`);
  return normalized;
}
function safeRef(value, field) {
  const normalized = text(value, 160);
  if (!SAFE_REF_RE.test(normalized)) fail(400, "RECOVERY_REFERENCE_INVALID", `${field} must be a bounded repository-safe reference.`);
  return normalized;
}
function assertAdmin(adminPrincipal) {
  if (!adminPrincipal?.verified) fail(403, "RECOVERY_ADMIN_PRINCIPAL_REQUIRED", "A verified administrative principal is required for privileged recovery contract operations.", { principal_binding: "verified_admin_guard" });
}
function assertProductionTarget({ environment = "production", target_key = "production-runtime", target_fingerprint = null, expected_sha }) {
  if (!["production", "production_hostinger_autodeploy"].includes(text(environment, 64).toLowerCase())) fail(404, "TARGET_IDENTITY_MISMATCH", "Privileged recovery contracts are Production-only.");
  if (text(target_key, 128) !== "production-runtime") fail(403, "TARGET_IDENTITY_MISMATCH", "The target is not the registered Production runtime.");
  exactSha(expected_sha, "expected_sha");
  if (target_fingerprint !== null && !SHA256_RE.test(text(target_fingerprint, 128))) fail(400, "RECOVERY_TARGET_FINGERPRINT_INVALID", "target_fingerprint must be a SHA-256 digest when provided.");
}
function boundedTtl(expiresAt, maxSeconds, field = "expires_at") {
  const date = new Date(expiresAt);
  const delta = date.getTime() - Date.now();
  if (!Number.isFinite(date.getTime()) || delta <= 0 || delta > maxSeconds * 1000) fail(400, "RECOVERY_TTL_INVALID", `${field} must be in the future and within the contract TTL.`);
  return date.toISOString();
}
function normalizeBudget(input = {}) {
  const limits = {
    max_statements: 1,
    max_rows: 100,
    max_files: 1,
    max_bytes: 1024 * 1024,
    max_runtime_seconds: 30,
    max_services: 1,
    max_commands: 1,
    ...input,
  };
  for (const [key, value] of Object.entries(limits)) {
    const maximum = key === "max_bytes" ? 64 * 1024 * 1024 : 1000000;
    if (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > maximum) fail(400, "RECOVERY_CAPABILITY_BUDGET_INVALID", `${key} must be a bounded non-negative integer.`);
    limits[key] = Number(value);
  }
  return limits;
}
function exceptionPolicy(exceptionClass) {
  const policy = EXCEPTION_APPROVAL_POLICY[exceptionClass];
  if (!policy) fail(400, "EXCEPTION_NOT_ALLOWED", "The exception class is not registered.");
  return policy;
}

export function buildRecoveryIncident(input = {}, { adminPrincipal } = {}) {
  assertAdmin(adminPrincipal);
  const incident = safeRef(input.incident_id, "incident_id");
  if (!INCIDENT_RE.test(incident)) fail(400, "RECOVERY_INCIDENT_ID_INVALID", "incident_id must use the incident: namespace.");
  const environment = text(input.environment || "production", 64).toLowerCase();
  const productionSha = exactSha(input.production_sha || input.expected_sha, "production_sha");
  assertProductionTarget({ ...input, expected_sha: productionSha, environment });
  const severity = text(input.severity || "high", 32).toLowerCase();
  if (!SAFE_SEVERITY.has(severity)) fail(400, "RECOVERY_SEVERITY_INVALID", "Incident severity is not registered.");
  const recoveryLevel = text(input.recovery_level || "R1", 8).toUpperCase();
  if (!Object.hasOwn(RECOVERY_PLANE_LEVELS, recoveryLevel)) fail(400, "RECOVERY_LEVEL_INVALID", "Incident recovery_level must be R0-R5.");
  const symptoms = Array.isArray(input.symptoms) ? [...new Set(input.symptoms.map((value) => safeRef(value, "symptom")))].slice(0, 20) : [];
  const record = {
    contract: "mad4b.recovery-incident.v1",
    incident_id: incident,
    environment,
    production_sha: productionSha,
    severity,
    symptoms,
    status: text(input.status || "investigating", 64),
    recovery_level: recoveryLevel,
    recovery_mode: recoveryLevel === "R4" ? "RECOVERY_PRIVILEGED" : recoveryLevel === "R5" ? "DISASTER_RECOVERY" : "RECOVERY_READONLY",
    target_key: "production-runtime",
    target_fingerprint: input.target_fingerprint ? exactHash(input.target_fingerprint, "target_fingerprint") : null,
    principal_bound: true,
    normal_recovery_required_first: true,
    exception_budget: { max_E4: 3, max_E6: 1, max_privileged_duration_seconds: 1800 },
    created_at: new Date().toISOString(),
    secrets_included: false,
  };
  return { ok: true, ...record, incident_hash: hash(record), read_only_probe: true };
}

export function buildPrivilegedOperationPreview(input = {}, { adminPrincipal } = {}) {
  assertAdmin(adminPrincipal);
  assertProductionTarget(input);
  const incident = safeRef(input.incident_id, "incident_id");
  if (!INCIDENT_RE.test(incident)) fail(400, "RECOVERY_INCIDENT_ID_INVALID", "incident_id must use the incident: namespace.");
  const operationType = text(input.operation_type, 64);
  if (!PRIVILEGED_OPERATION_TYPES.includes(operationType)) fail(400, "RECOVERY_OPERATION_TYPE_INVALID", "operation_type is not registered.");
  const transport = text(input.transport || "contract", 16).toLowerCase();
  if (operationType === "ssh_command" && transport !== "ssh") fail(400, "RECOVERY_TRANSPORT_MISMATCH", "ssh_command requires the SSH broker contract.");
  if (operationType === "sql_statement" && transport !== "sql") fail(400, "RECOVERY_TRANSPORT_MISMATCH", "sql_statement requires the SQL broker contract.");
  const scopeRef = safeRef(input.scope_ref, "scope_ref");
  const artifactHash = exactHash(input.artifact_sha256 || input.command_sha256 || input.query_sha256, "artifact_sha256");
  const expiresAt = boundedTtl(input.expires_at || new Date(Date.now() + 5 * 60 * 1000).toISOString(), 1800);
  const riskClass = text(input.risk_class || "unknown", 64);
  if (!SAFE_RISKS.has(riskClass)) fail(400, "RECOVERY_RISK_CLASS_INVALID", "risk_class is not registered.");
  const profile = text(input.profile || (transport === "ssh" ? "S1" : transport === "sql" ? "Q0" : "R2"), 16);
  const exceptionClass = text(input.exception_class || (riskClass === "destructive" ? "E6" : "E4"), 8).toUpperCase();
  const policy = exceptionPolicy(exceptionClass);
  const preview = {
    contract: "mad4b.privileged-operation-preview.v1",
    incident_id: incident,
    expected_sha: exactSha(input.expected_sha),
    target_key: "production-runtime",
    target_fingerprint: input.target_fingerprint ? exactHash(input.target_fingerprint, "target_fingerprint") : null,
    operation_type: operationType,
    transport,
    profile,
    scope_ref: scopeRef,
    artifact_sha256: artifactHash,
    risk_class: riskClass,
    exception_class: exceptionClass,
    expires_at: expiresAt,
    max_uses: 1,
    capability_budget: normalizeBudget(input.capability_budget),
    required_approvals: policy.required_approvals,
    approval_class: policy.approval_class,
    normal_recovery_required_first: true,
    execution_allowed: false,
    session_opened: false,
    no_pty_by_default: true,
    non_bypassable_invariants: [...NON_BYPASSABLE_INVARIANTS],
    required_evidence: ["production_identity", "target_identity", "pre_state_snapshot", "append_only_event_chain", "same_cycle_readback", "behavioral_probe"],
    secrets_included: false,
  };
  return { ok: true, ...preview, preview_hash: hash(preview), read_only_probe: true };
}

export function buildPrivilegedLeasePreview(input = {}, { adminPrincipal } = {}) {
  assertAdmin(adminPrincipal);
  assertProductionTarget(input);
  const transport = text(input.transport, 16).toLowerCase();
  if (!["ssh", "sql"].includes(transport)) fail(400, "RECOVERY_TRANSPORT_INVALID", "A privileged lease must be SSH or SQL.");
  const maxTtl = transport === "ssh" ? 1800 : 1800;
  const expiresAt = boundedTtl(input.expires_at || new Date(Date.now() + 5 * 60 * 1000).toISOString(), maxTtl);
  const lease = {
    contract: "mad4b.privileged-recovery-lease-preview.v1",
    lease_id: `lease:${hash({ incident_id: input.incident_id, transport, expires_at: expiresAt }).slice(0, 32)}`,
    incident_id: safeRef(input.incident_id, "incident_id"),
    transport,
    scope_ref: safeRef(input.scope_ref, "scope_ref"),
    expected_sha: exactSha(input.expected_sha),
    target_key: "production-runtime",
    target_fingerprint: input.target_fingerprint ? exactHash(input.target_fingerprint, "target_fingerprint") : null,
    expires_at: expiresAt,
    max_commands: Math.min(Number(input.max_commands || 50), 50),
    max_rows: Math.min(Number(input.max_rows || 100), 100),
    owner_bound: true,
    heartbeat_required: true,
    session_opened: false,
    execution_allowed: false,
    secrets_included: false,
  };
  return { ok: true, ...lease, lease_hash: hash(lease), read_only_probe: true };
}

export function buildRecoveryExceptionPreview(input = {}, { adminPrincipal } = {}) {
  assertAdmin(adminPrincipal);
  assertProductionTarget(input);
  const exceptionClass = text(input.exception_class || input.class, 8).toUpperCase();
  const policy = exceptionPolicy(exceptionClass);
  const expiresAt = boundedTtl(input.expires_at || new Date(Date.now() + Math.min(policy.max_ttl_seconds, 300) * 1000).toISOString(), policy.max_ttl_seconds);
  const requestedScope = safeRef(input.scope_ref || input.requested_scope_ref, "scope_ref");
  const record = {
    contract: "mad4b.recovery-exception-preview.v1",
    exception_id: `exception:${hash({ incident_id: input.incident_id, exceptionClass, requestedScope, expiresAt }).slice(0, 32)}`,
    incident_id: safeRef(input.incident_id, "incident_id"),
    exception_class: exceptionClass,
    reason: text(input.reason, 1000),
    expected_sha: exactSha(input.expected_sha),
    target_key: "production-runtime",
    target_fingerprint: input.target_fingerprint ? exactHash(input.target_fingerprint, "target_fingerprint") : null,
    requested_scope_ref: requestedScope,
    expires_at: expiresAt,
    max_uses: 1,
    status: "awaiting_approval",
    required_approvals: policy.required_approvals,
    approval_class: policy.approval_class,
    max_ttl_seconds: policy.max_ttl_seconds,
    non_bypassable_invariants: [...NON_BYPASSABLE_INVARIANTS],
    exception_graph_dependencies: Array.isArray(input.depends_on) ? input.depends_on.slice(0, 5).map((value) => safeRef(value, "depends_on")) : [],
    execution_allowed: false,
    consumed: false,
    revoked: false,
    secrets_included: false,
  };
  if (record.reason.length < 12) fail(400, "RECOVERY_EXCEPTION_REASON_REQUIRED", "An exception requires a specific reason explaining why the normal path is insufficient.");
  return { ok: true, ...record, exception_hash: hash(record), read_only_probe: true };
}

export function buildReconciliationPreview(input = {}, { adminPrincipal } = {}) {
  assertAdmin(adminPrincipal);
  assertProductionTarget(input);
  const incidentId = safeRef(input.incident_id, "incident_id");
  const runId = safeRef(input.run_id, "run_id");
  const planHash = exactHash(input.plan_hash, "plan_hash");
  const preview = {
    contract: "mad4b.recovery-reconciliation-preview.v1",
    incident_id: incidentId,
    run_id: runId,
    plan_hash: planHash,
    expected_sha: exactSha(input.expected_sha),
    target_key: "production-runtime",
    observed_outcome: "execution_outcome_unknown",
    retry_allowed: false,
    mutation_allowed: false,
    allowed_actions: ["inspect_schema", "inspect_process_list", "inspect_locks", "inspect_ledger", "same_cycle_readback"],
    required_next_state: "reconciliation_required",
    reason: "The provider outcome is unknown; readback is required before any retry or compensating mutation.",
    secrets_included: false,
  };
  return { ok: true, ...preview, preview_hash: hash(preview), read_only_probe: true };
}

export function buildRecoveryCancelPreview(input = {}, { adminPrincipal } = {}) {
  assertAdmin(adminPrincipal);
  assertProductionTarget(input);
  const preview = {
    contract: "mad4b.recovery-cancel-preview.v1",
    incident_id: safeRef(input.incident_id, "incident_id"),
    run_id: safeRef(input.run_id, "run_id"),
    plan_hash: exactHash(input.plan_hash, "plan_hash"),
    expected_sha: exactSha(input.expected_sha),
    target_key: "production-runtime",
    reason: text(input.reason, 1000),
    stops_future_steps: true,
    rollback_automatic: false,
    reconciliation_required: true,
    provider_mutation_performed: false,
    database_mutation_performed: false,
    execution_allowed: false,
    secrets_included: false,
  };
  if (preview.reason.length < 12) fail(400, "RECOVERY_CANCEL_REASON_REQUIRED", "Cancel preview requires a specific reason.");
  return { ok: true, ...preview, preview_hash: hash(preview), read_only_probe: true };
}

export function appendEvidenceChainEvent({ previous_hash = null, event = {} } = {}) {
  const safeEvent = { ...event, secrets_included: false };
  const chainHash = hash({ previous_hash: previous_hash || "GENESIS", event: safeEvent });
  return { previous_hash: previous_hash || null, event: safeEvent, event_hash: chainHash, chain_valid: true, secrets_included: false };
}

export function observeSecretSafely({ configured = false, value_hash = null, age_seconds = null } = {}) {
  return {
    configured: configured === true,
    secret_fingerprint: value_hash && SHA256_RE.test(text(value_hash, 128)) ? text(value_hash, 128).toLowerCase() : null,
    secret_age_seconds: Number.isFinite(Number(age_seconds)) ? Math.max(0, Number(age_seconds)) : null,
    raw_value_returned: false,
    secrets_included: false,
  };
}

export const _testingRecoveryExceptionFramework = Object.freeze({
  stable: stable,
  hash,
  exactSha,
  exactHash,
  boundedTtl,
  normalizeBudget,
  exceptionPolicy,
});
