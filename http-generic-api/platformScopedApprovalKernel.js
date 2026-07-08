import crypto from "node:crypto";

const DEFAULT_TTL_SECONDS = 900;
const MAX_TTL_SECONDS = 3600;
const DECISIONS = new Set(["approved", "rejected", "abstained"]);
const TERMINAL_DECISIONS = new Set(["approved", "rejected"]);

function safeText(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value) {
  return value === true || Number(value || 0) === 1;
}

function toDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function ttlSeconds(value) {
  const parsed = Number(value || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(parsed), MAX_TTL_SECONDS);
}

function failure(status, details = {}) {
  return { ok: false, status, ...details, secrets_included: false };
}

export function stableApprovalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableApprovalJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableApprovalJson(value[key])}`).join(",")}}`;
}

export function approvalHash(value) {
  return crypto.createHash("sha256").update(stableApprovalJson(value)).digest("hex");
}

function normalizePermissions(value = []) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source.map((item) => safeText(item, 128)).filter(Boolean))].sort();
}

function normalizeScope(scope = {}, executionEnvelope = {}) {
  return {
    tenant_id: safeText(scope.tenant_id || executionEnvelope.tenant_id, 64) || null,
    workspace_id: safeText(scope.workspace_id || executionEnvelope.workspace_id, 64) || null,
    boundary_key: safeText(scope.boundary_key || executionEnvelope.boundary_key, 191) || null,
    capability_envelope_id: safeText(scope.capability_envelope_id || executionEnvelope.capability_envelope_id, 64) || null,
    execution_envelope_id: safeText(scope.execution_envelope_id || executionEnvelope.envelope_id, 64) || null,
    requested_permissions: normalizePermissions(scope.requested_permissions || scope.permissions || []),
    max_uses: Math.max(1, Math.min(Number(scope.max_uses || 1), 1)),
  };
}

function requestManifest(request = {}) {
  return {
    request_version: request.request_version,
    approval_request_id: request.approval_request_id,
    execution_envelope_id: request.execution_envelope_id,
    execution_envelope_manifest_hash: request.execution_envelope_manifest_hash,
    request_scope_hash: request.request_scope_hash,
    requested_by: request.requested_by,
    issued_at: request.issued_at,
    expires_at: request.expires_at,
    provider_apply_allowed: false,
    mutation_allowed: false,
    enforcement_cutover: false,
    secrets_included: false,
  };
}

function decisionMaterial(record = {}) {
  return {
    decision_version: record.decision_version,
    approval_request_id: record.approval_request_id,
    request_manifest_hash: record.request_manifest_hash,
    decision_sequence: record.decision_sequence,
    previous_decision_hash: record.previous_decision_hash || null,
    decision: record.decision,
    decided_by: record.decided_by,
    decided_at: record.decided_at,
    decision_note_hash: record.decision_note_hash,
    provider_apply_allowed: false,
    mutation_allowed: false,
    enforcement_cutover: false,
    secrets_included: false,
  };
}

export function buildScopedApprovalRequest({ execution_envelope = {}, requested_scope = {}, requested_by = "", reason = "", issued_at = new Date(), ttl_seconds = DEFAULT_TTL_SECONDS } = {}) {
  if (execution_envelope?.ok !== true || execution_envelope.envelope_version !== "platform_execution_envelope_v1") return failure("approval_request_execution_envelope_invalid");
  if (bool(execution_envelope.provider_apply_allowed) || bool(execution_envelope.mutation_allowed) || bool(execution_envelope.enforcement_cutover)) return failure("approval_request_execution_boundary_failed");
  if (safeText(execution_envelope.execution_status, 64) !== "not_executed") return failure("approval_request_execution_envelope_not_pending", { execution_status: execution_envelope.execution_status || null });

  const issuedAt = toDate(issued_at, new Date());
  const ttl = ttlSeconds(ttl_seconds);
  const scope = normalizeScope(requested_scope, execution_envelope);
  const request = {
    ok: true,
    request_version: "platform_scoped_approval_request_v1",
    approval_request_id: crypto.randomUUID(),
    execution_envelope_id: execution_envelope.envelope_id,
    execution_envelope_manifest_hash: execution_envelope.manifest_hash,
    request_scope: scope,
    request_scope_hash: approvalHash(scope),
    requested_by: safeText(requested_by, 191) || "system",
    reason: safeText(reason, 1000),
    status: "pending_approval",
    issued_at: issuedAt.toISOString(),
    expires_at: addSeconds(issuedAt, ttl).toISOString(),
    ttl_seconds: ttl,
    single_use: true,
    provider_apply_allowed: false,
    mutation_allowed: false,
    enforcement_cutover: false,
    secrets_included: false,
  };
  request.manifest_hash = approvalHash(requestManifest(request));
  return request;
}

export function validateScopedApprovalRequest(request = {}, { now = new Date() } = {}) {
  if (request?.ok !== true || request.request_version !== "platform_scoped_approval_request_v1") return failure("approval_request_invalid");
  if (bool(request.secrets_included)) return failure("approval_request_secret_boundary_failed");
  if (bool(request.provider_apply_allowed) || bool(request.mutation_allowed) || bool(request.enforcement_cutover)) return failure("approval_request_execution_boundary_failed");
  if (toDate(request.expires_at).getTime() <= toDate(now).getTime()) return failure("approval_request_expired", { expires_at: request.expires_at });
  if (approvalHash(request.request_scope || {}) !== request.request_scope_hash) return failure("approval_request_scope_hash_mismatch");
  if (approvalHash(requestManifest(request)) !== request.manifest_hash) return failure("approval_request_manifest_hash_mismatch");
  return { ok: true, status: "approval_request_ready", approval_request_id: request.approval_request_id, request_scope_hash: request.request_scope_hash, expires_at: request.expires_at, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}

export function validateApprovalDecisionLog({ approval_request = {}, decision_log = [] } = {}) {
  const requestCheck = validateScopedApprovalRequest(approval_request, { now: approval_request.issued_at || new Date() });
  if (requestCheck.ok !== true) return requestCheck;
  if (!Array.isArray(decision_log)) return failure("approval_decision_log_invalid");
  let previous = null;
  for (let index = 0; index < decision_log.length; index += 1) {
    const record = decision_log[index];
    if (record?.decision_version !== "platform_scoped_approval_decision_v1") return failure("approval_decision_record_invalid", { index });
    if (record.approval_request_id !== approval_request.approval_request_id) return failure("approval_decision_request_mismatch", { index });
    if (record.request_manifest_hash !== approval_request.manifest_hash) return failure("approval_decision_request_hash_mismatch", { index });
    if (Number(record.decision_sequence || 0) !== index + 1) return failure("approval_decision_sequence_gap", { index });
    if ((record.previous_decision_hash || null) !== (previous?.decision_hash || null)) return failure("approval_decision_hash_chain_broken", { index });
    if (approvalHash(decisionMaterial(record)) !== record.decision_hash) return failure("approval_decision_hash_mismatch", { index });
    if (bool(record.secrets_included)) return failure("approval_decision_secret_boundary_failed", { index });
    previous = record;
  }
  return { ok: true, status: "approval_decision_log_valid", decision_count: decision_log.length, latest_decision: previous?.decision || null, latest_decision_hash: previous?.decision_hash || null, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}

export function appendApprovalDecision({ approval_request = {}, decision_log = [], decision = "", decided_by = "", decision_note = "", decided_at = new Date() } = {}) {
  const normalizedDecision = safeText(decision, 32).toLowerCase();
  if (!DECISIONS.has(normalizedDecision)) return failure("approval_decision_invalid", { decision: normalizedDecision || null, allowed_decisions: [...DECISIONS] });
  const logCheck = validateApprovalDecisionLog({ approval_request, decision_log });
  if (logCheck.ok !== true) return logCheck;
  if (TERMINAL_DECISIONS.has(logCheck.latest_decision)) return failure("approval_decision_log_already_terminal", { latest_decision: logCheck.latest_decision });
  const previous = decision_log.at(-1) || null;
  const record = {
    decision_version: "platform_scoped_approval_decision_v1",
    approval_request_id: approval_request.approval_request_id,
    request_manifest_hash: approval_request.manifest_hash,
    decision_sequence: decision_log.length + 1,
    previous_decision_hash: previous?.decision_hash || null,
    decision: normalizedDecision,
    decided_by: safeText(decided_by, 191) || "system",
    decided_at: toDate(decided_at, new Date()).toISOString(),
    decision_note_hash: approvalHash(safeText(decision_note, 1000)),
    provider_apply_allowed: false,
    mutation_allowed: false,
    enforcement_cutover: false,
    secrets_included: false,
  };
  record.decision_hash = approvalHash(decisionMaterial(record));
  const nextLog = [...decision_log, record];
  return { ok: true, status: "approval_decision_appended", decision_record: record, decision_log: nextLog, latest_decision: record.decision, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}
