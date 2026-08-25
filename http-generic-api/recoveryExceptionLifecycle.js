import { createHash, randomUUID } from "node:crypto";

export const EXCEPTION_LIFECYCLE_CONTRACT = "mad4b.recovery-exception-lifecycle.v1";
export const EXCEPTION_LIFECYCLE_STATES = Object.freeze([
  "draft",
  "awaiting_approval",
  "approved",
  "active",
  "consumed",
  "revoked",
  "expired",
  "failed_closed",
]);
export const EXCEPTION_LIFECYCLE_TRANSITIONS = Object.freeze({
  draft: ["awaiting_approval", "approved", "failed_closed"],
  awaiting_approval: ["awaiting_approval", "approved", "expired", "revoked", "failed_closed"],
  approved: ["active", "expired", "revoked", "failed_closed"],
  active: ["active", "consumed", "expired", "revoked", "failed_closed"],
  consumed: [],
  revoked: [],
  expired: [],
  failed_closed: [],
});
export const DISASTER_RECOVERY_PHASES = Object.freeze([
  "backup_create",
  "backup_verify",
  "restore_preview",
  "replacement_build",
  "schema_reconstruct",
  "data_copy_policy",
  "replacement_validation",
  "cutover_preview",
  "cutover_rollback_preview",
]);

const SHA40_RE = /^[0-9a-f]{40}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/iu;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const INCIDENT_RE = /^incident:[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const EXCEPTION_CLASSES = new Set(["E0", "E1", "E2", "E3", "E4", "E5", "E6"]);
const REQUIRED_REVIEWER_COUNTS = Object.freeze({ E0: 0, E1: 1, E2: 1, E3: 1, E4: 1, E5: 1, E6: 2 });
const CLASS_EXPIRY_WINDOWS = Object.freeze({ E0: 1800, E1: 1800, E2: 1800, E3: 900, E4: 600, E5: 600, E6: 300 });

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function hash(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function text(value, max = 256) { return String(value ?? "").trim().slice(0, max); }
function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  throw error;
}
function safeRef(value, field) {
  const normalized = text(value, 160);
  if (!SAFE_REF_RE.test(normalized)) fail(400, "RECOVERY_REFERENCE_INVALID", `${field} must be a bounded repository-safe reference.`);
  return normalized;
}
function exactSha(value, field = "expected_sha") {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA40_RE.test(normalized)) fail(400, "RECOVERY_SHA_INVALID", `${field} must be a full 40-character SHA.`);
  return normalized;
}
function exactHash(value, field) {
  const normalized = text(value, 128).toLowerCase();
  if (!SHA256_RE.test(normalized)) fail(400, "RECOVERY_DIGEST_INVALID", `${field} must be a SHA-256 digest.`);
  return normalized;
}
function assertAdmin(adminPrincipal) {
  if (!adminPrincipal?.verified) fail(403, "RECOVERY_ADMIN_PRINCIPAL_REQUIRED", "A verified administrative principal is required for exception lifecycle operations.");
}
function assertTarget(input = {}) {
  exactSha(input.expected_sha || input.production_sha, "expected_sha");
  if (text(input.target_key, 128) !== "production-runtime") fail(403, "TARGET_IDENTITY_MISMATCH", "Exception lifecycle is bound to the registered Production runtime.");
  if (input.target_fingerprint !== undefined && input.target_fingerprint !== null) exactHash(input.target_fingerprint, "target_fingerprint");
}
function ttl(expiresAt, exceptionClass, now = Date.now()) {
  const date = new Date(expiresAt);
  const delta = date.getTime() - now;
  const max = CLASS_EXPIRY_WINDOWS[exceptionClass] * 1000;
  if (!Number.isFinite(date.getTime()) || delta <= 0 || delta > max) fail(400, "EXCEPTION_TTL_INVALID", "Exception expiry is outside its registered bounded TTL.");
  return date.toISOString();
}
function boundedBudget(input = {}) {
  const budget = {
    max_uses: 1,
    max_runtime_seconds: 30,
    max_rows: 100,
    max_bytes: 1024 * 1024,
    max_commands: 1,
    ...input,
  };
  for (const [key, value] of Object.entries(budget)) {
    const number = Number(value);
    const max = key === "max_bytes" ? 64 * 1024 * 1024 : 1000000;
    if (!Number.isInteger(number) || number < 0 || number > max) fail(400, "EXCEPTION_BUDGET_INVALID", `${key} is outside the bounded exception budget.`);
    budget[key] = number;
  }
  if (budget.max_uses !== 1) fail(400, "EXCEPTION_MAX_USES_INVALID", "Exception lifecycle contracts are single-use by default.");
  return budget;
}
function requireStore(exceptionStore) {
  if (!exceptionStore || typeof exceptionStore.putException !== "function" || typeof exceptionStore.getException !== "function" || typeof exceptionStore.appendExceptionEvent !== "function") {
    fail(503, "EXCEPTION_STORE_UNAVAILABLE", "Stateful exception lifecycle requires an injected durable exception store; preview-only mode cannot activate authority.");
  }
  return exceptionStore;
}
async function persist(record, event, { exceptionStore } = {}) {
  const store = requireStore(exceptionStore);
  await store.appendExceptionEvent(record.exception_id, event);
  await store.putException(record);
  return record;
}
async function loadRecord(recordInput, exceptionStore) {
  const inputId = typeof recordInput === "string" ? safeRef(recordInput, "exception_id") : recordInput?.exception_id;
  if (exceptionStore && inputId) {
    const store = requireStore(exceptionStore);
    const durable = await store.getException(inputId);
    if (!durable) fail(404, "EXCEPTION_NOT_FOUND", "The durable exception lifecycle record was not found.");
    return sanitizeRecord(durable);
  }
  if (!recordInput || typeof recordInput !== "object") fail(400, "EXCEPTION_RECORD_INVALID", "A lifecycle record or durable exception_id is required.");
  return sanitizeRecord(recordInput);
}
function lifecycleEvent(record, event, nextState, details = {}, now = new Date().toISOString()) {
  if (!(EXCEPTION_LIFECYCLE_TRANSITIONS[record.state] || []).includes(nextState)) fail(409, "EXCEPTION_STATE_TRANSITION_INVALID", "Exception lifecycle transition is not permitted.", { state: record.state, next_state: nextState });
  const body = { event_id: `exception-event:${hash({ exception_id: record.exception_id, event, next_state: nextState, nonce: randomUUID() }).slice(0, 32)}`, exception_id: record.exception_id, event, previous_state: record.state, state: nextState, at: now, ...details, secrets_included: false };
  return { ...body, event_hash: hash(body) };
}
function sanitizeRecord(record) {
  return { ...record, approvals: (record.approvals || []).map((approval) => ({ approval_id: approval.approval_id, approval_hash: approval.approval_hash, principal_fingerprint: approval.principal_fingerprint, approved_at: approval.approved_at, secrets_included: false })), events: (record.events || []).map((event) => ({ ...event, secrets_included: false })), secrets_included: false };
}

export function createExceptionLifecycleRecord(input = {}, { adminPrincipal, now = Date.now() } = {}) {
  assertAdmin(adminPrincipal);
  assertTarget(input);
  const incidentId = safeRef(input.incident_id, "incident_id");
  if (!INCIDENT_RE.test(incidentId)) fail(400, "RECOVERY_INCIDENT_ID_INVALID", "incident_id must use the incident namespace.");
  const exceptionClass = text(input.exception_class || input.class, 8).toUpperCase();
  if (!EXCEPTION_CLASSES.has(exceptionClass)) fail(400, "EXCEPTION_NOT_ALLOWED", "The exception class is not registered.");
  const expiresAt = ttl(input.expires_at, exceptionClass, now);
  const planHash = exactHash(input.plan_hash, "plan_hash");
  const targetFingerprint = input.target_fingerprint ? exactHash(input.target_fingerprint, "target_fingerprint") : null;
  const recordBase = {
    contract: EXCEPTION_LIFECYCLE_CONTRACT,
    exception_id: safeRef(input.exception_id || `exception:${hash({ incidentId, planHash, nonce: randomUUID() }).slice(0, 32)}`, "exception_id"),
    incident_id: incidentId,
    exception_class: exceptionClass,
    plan_hash: planHash,
    expected_sha: exactSha(input.expected_sha || input.production_sha),
    target_key: "production-runtime",
    target_fingerprint: targetFingerprint,
    scope_ref: safeRef(input.scope_ref, "scope_ref"),
    reason_ref: safeRef(input.reason_ref || "reason:bounded-operational-necessity", "reason_ref"),
    expires_at: expiresAt,
    max_uses: 1,
    uses: 0,
    budget: boundedBudget(input.budget),
    required_approvals: REQUIRED_REVIEWER_COUNTS[exceptionClass],
    approvals: [],
    state: "draft",
    execution_allowed: false,
    provider_connected: false,
    runtime_mutation_performed: false,
    preview_only_without_store: true,
    normal_recovery_required_first: true,
    dual_control_required: exceptionClass === "E6",
    created_at: new Date(now).toISOString(),
    events: [],
    secrets_included: false,
  };
  const record = { ...recordBase, record_hash: hash(recordBase) };
  return sanitizeRecord(record);
}

export async function createExceptionLifecycle(input = {}, { adminPrincipal, exceptionStore, now = Date.now() } = {}) {
  const record = createExceptionLifecycleRecord(input, { adminPrincipal, now });
  const initialState = record.required_approvals === 0 ? "approved" : "awaiting_approval";
  const event = lifecycleEvent(record, "exception_created", initialState, { required_approvals: record.required_approvals, approval_satisfied: initialState === "approved" }, new Date(now).toISOString());
  const next = sanitizeRecord({ ...record, state: initialState, events: [event], record_hash: hash({ ...record, state: initialState, events: [event] }) });
  if (!exceptionStore) return { ok: true, ...next, persistence: { durable: false, mode: "contract_preview_only" }, execution_allowed: false };
  await persist(next, event, { exceptionStore });
  return { ok: true, ...next, persistence: { durable: true, mode: "injected_exception_store" }, execution_allowed: false };
}

export async function approveExceptionLifecycle(recordInput, approvalInput = {}, { exceptionStore, now = Date.now() } = {}) {
  const record = await loadRecord(recordInput, exceptionStore);
  if (!EXCEPTION_LIFECYCLE_STATES.includes(record.state)) fail(409, "EXCEPTION_STATE_INVALID", "The exception lifecycle record has an unknown state.");
  if (record.state !== "awaiting_approval") fail(409, "EXCEPTION_APPROVAL_NOT_ALLOWED", "The exception is not awaiting approval.");
  if (Date.parse(record.expires_at) <= now) fail(409, "EXCEPTION_EXPIRED", "The exception has expired before approval.");
  const principalFingerprint = exactHash(approvalInput.principal_fingerprint, "principal_fingerprint");
  const approvalHash = exactHash(approvalInput.approval_hash, "approval_hash");
  if ((record.approvals || []).some((approval) => approval.principal_fingerprint === principalFingerprint)) fail(409, "EXCEPTION_DUPLICATE_APPROVAL", "A principal cannot provide more than one approval for the same exception.");
  const decision = { approval_id: safeRef(approvalInput.approval_id, "approval_id"), approval_hash: approvalHash, principal_fingerprint: principalFingerprint, approved_at: new Date(now).toISOString(), secrets_included: false };
  const decisions = [...(record.approvals || []), decision];
  if (decisions.length > record.required_approvals) fail(409, "EXCEPTION_APPROVAL_OVERFLOW", "The exception approval count exceeds its policy.");
  const nextState = decisions.length >= record.required_approvals ? "approved" : "awaiting_approval";
  const event = nextState === "approved" ? lifecycleEvent(record, "exception_approved", nextState, { approval_count: decisions.length, dual_control_satisfied: record.required_approvals === 2 ? new Set(decisions.map((entry) => entry.principal_fingerprint)).size === 2 : true }, new Date(now).toISOString()) : { ...lifecycleEvent(record, "exception_approval_recorded", nextState, { approval_count: decisions.length }, new Date(now).toISOString()), state: nextState };
  const next = sanitizeRecord({ ...record, state: nextState, approvals: decisions, events: [...(record.events || []), event], record_hash: hash({ ...record, state: nextState, approvals: decisions, events: [...(record.events || []), event] }) });
  if (exceptionStore) await persist(next, event, { exceptionStore });
  return { ok: true, ...next, execution_allowed: false, persistence: { durable: Boolean(exceptionStore), mode: exceptionStore ? "injected_exception_store" : "contract_preview_only" } };
}

export async function activateExceptionLifecycle(recordInput, { exceptionStore, now = Date.now() } = {}) {
  const record = await loadRecord(recordInput, exceptionStore);
  if (record.state !== "approved") fail(409, "EXCEPTION_APPROVAL_REQUIRED", "The exception requires all policy approvals before activation.");
  if (Date.parse(record.expires_at) <= now) fail(409, "EXCEPTION_EXPIRED", "The exception has expired before activation.");
  if (record.exception_class === "E6" && new Set((record.approvals || []).map((approval) => approval.principal_fingerprint)).size < 2) fail(403, "EXCEPTION_DUAL_CONTROL_REQUIRED", "E6 disaster exceptions require two distinct approved principal fingerprints.");
  const event = lifecycleEvent(record, "exception_activated", "active", { execution_allowed: false, provider_connected: false }, new Date(now).toISOString());
  const next = sanitizeRecord({ ...record, state: "active", events: [...(record.events || []), event], record_hash: hash({ ...record, state: "active", events: [...(record.events || []), event] }) });
  await persist(next, event, { exceptionStore });
  return { ok: true, ...next, execution_allowed: false, provider_connected: false, provider_required: true, persistence: { durable: true, mode: "injected_exception_store" } };
}

export async function heartbeatExceptionLease(recordInput, { exceptionStore, now = Date.now(), heartbeatRef } = {}) {
  const record = await loadRecord(recordInput, exceptionStore);
  if (record.state !== "active") fail(409, "EXCEPTION_LEASE_NOT_ACTIVE", "Only an active exception can receive a heartbeat.");
  if (Date.parse(record.expires_at) <= now) fail(409, "EXCEPTION_EXPIRED", "The exception lease has expired.");
  const event = lifecycleEvent(record, "exception_heartbeat", "active", { heartbeat_ref: safeRef(heartbeatRef, "heartbeat_ref") }, new Date(now).toISOString());
  const next = sanitizeRecord({ ...record, events: [...(record.events || []), event], record_hash: hash({ ...record, events: [...(record.events || []), event] }) });
  await persist(next, event, { exceptionStore });
  return { ok: true, ...next, execution_allowed: false, persistence: { durable: true, mode: "injected_exception_store" } };
}

export async function consumeExceptionLifecycle(recordInput, { exceptionStore, now = Date.now(), consumeRef } = {}) {
  const record = await loadRecord(recordInput, exceptionStore);
  if (record.state !== "active") fail(409, "EXCEPTION_NOT_ACTIVE", "Only an active exception can be consumed.");
  if (Date.parse(record.expires_at) <= now) fail(409, "EXCEPTION_EXPIRED", "The exception lease has expired.");
  if (record.uses >= record.max_uses) fail(409, "EXCEPTION_CONSUMED", "The exception has reached its single-use limit.");
  const event = lifecycleEvent(record, "exception_consumed", "consumed", { consume_ref: safeRef(consumeRef, "consume_ref"), use_number: record.uses + 1, runtime_mutation_performed: false }, new Date(now).toISOString());
  const next = sanitizeRecord({ ...record, state: "consumed", uses: record.uses + 1, events: [...(record.events || []), event], record_hash: hash({ ...record, state: "consumed", uses: record.uses + 1, events: [...(record.events || []), event] }) });
  await persist(next, event, { exceptionStore });
  return { ok: true, ...next, execution_allowed: false, runtime_mutation_performed: false, persistence: { durable: true, mode: "injected_exception_store" } };
}

export async function revokeExceptionLifecycle(recordInput, { exceptionStore, now = Date.now(), reasonRef } = {}) {
  const record = await loadRecord(recordInput, exceptionStore);
  if (["consumed", "revoked", "expired", "failed_closed"].includes(record.state)) fail(409, "EXCEPTION_REVOKE_NOT_ALLOWED", "The exception is already terminal.");
  const event = lifecycleEvent(record, "exception_revoked", "revoked", { reason_ref: safeRef(reasonRef, "reason_ref") }, new Date(now).toISOString());
  const next = sanitizeRecord({ ...record, state: "revoked", events: [...(record.events || []), event], record_hash: hash({ ...record, state: "revoked", events: [...(record.events || []), event] }) });
  await persist(next, event, { exceptionStore });
  return { ok: true, ...next, execution_allowed: false, persistence: { durable: true, mode: "injected_exception_store" } };
}

export async function expireExceptionLifecycle(recordInput, { exceptionStore, now = Date.now() } = {}) {
  const record = await loadRecord(recordInput, exceptionStore);
  if (Date.parse(record.expires_at) > now) fail(409, "EXCEPTION_NOT_EXPIRED", "The exception has not reached its expiry time.");
  if (["consumed", "revoked", "expired", "failed_closed"].includes(record.state)) return { ok: true, ...record, execution_allowed: false, persistence: { durable: Boolean(exceptionStore), mode: exceptionStore ? "injected_exception_store" : "contract_preview_only" } };
  const event = lifecycleEvent(record, "exception_expired", "expired", {}, new Date(now).toISOString());
  const next = sanitizeRecord({ ...record, state: "expired", events: [...(record.events || []), event], record_hash: hash({ ...record, state: "expired", events: [...(record.events || []), event] }) });
  await persist(next, event, { exceptionStore });
  return { ok: true, ...next, execution_allowed: false, persistence: { durable: true, mode: "injected_exception_store" } };
}

export function buildDisasterRecoveryPreview(input = {}, { adminPrincipal } = {}) {
  assertAdmin(adminPrincipal);
  assertTarget(input);
  const preview = {
    contract: "mad4b.disaster-recovery-preview.v1",
    incident_id: safeRef(input.incident_id, "incident_id"),
    expected_sha: exactSha(input.expected_sha),
    target_key: "production-runtime",
    target_fingerprint: input.target_fingerprint ? exactHash(input.target_fingerprint, "target_fingerprint") : null,
    plan_hash: exactHash(input.plan_hash, "plan_hash"),
    phases: DISASTER_RECOVERY_PHASES.map((phase, ordinal) => ({ ordinal: ordinal + 1, phase, execution_allowed: false, provider_required: true, evidence_required: ["pre_state_snapshot", "provider_receipt", "same_cycle_readback"], rollback_defined: phase.includes("rollback") || phase === "cutover_preview" })),
    backup_required_before_restore: true,
    replacement_target_server_resolved: true,
    cutover_requires_separate_approval: true,
    credential_rotation_required_after_cutover: true,
    data_copy_policy: "explicit_allowlist_only",
    destructive_replacement_allowed: false,
    provider_connected: false,
    execution_allowed: false,
    runtime_mutation_performed: false,
    secrets_included: false,
  };
  return { ok: true, ...preview, preview_hash: hash(preview), read_only_probe: true };
}

export const _testingRecoveryExceptionLifecycle = Object.freeze({ hash, stable, exactHash, exactSha, boundedBudget, REQUIRED_REVIEWER_COUNTS, CLASS_EXPIRY_WINDOWS });
