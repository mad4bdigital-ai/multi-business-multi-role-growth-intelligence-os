import crypto from "node:crypto";
import { executionEnvelopeHash, validatePlatformExecutionEnvelope } from "./platformExecutionEnvelopeKernel.js";
import { approvalHash, validateApprovalDecisionLog, validateScopedApprovalRequest } from "./platformScopedApprovalKernel.js";

function safeText(value = "", max = 255) { return String(value ?? "").trim().slice(0, max); }
function bool(value) { return value === true || Number(value || 0) === 1; }
function failure(status, details = {}) { return { ok: false, status, ...details, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false }; }
function hash(value) { return crypto.createHash("sha256").update(String(value ?? "")).digest("hex"); }
function latestApproved(decisionLog = []) { const latest = Array.isArray(decisionLog) ? decisionLog.at(-1) : null; return latest?.decision === "approved"; }
function decisionLogHash(decisionLog = []) { return approvalHash(Array.isArray(decisionLog) ? decisionLog.map((record) => ({ sequence: record.decision_sequence, hash: record.decision_hash })) : []); }
function buildControlMaterial(record = {}) {
  return { control_version: record.control_version, execution_envelope_id: record.execution_envelope_id, approval_request_id: record.approval_request_id, execution_manifest_hash: record.execution_manifest_hash, approval_request_manifest_hash: record.approval_request_manifest_hash, decision_log_hash: record.decision_log_hash, idempotency_key_hash: record.idempotency_key_hash, stale_guard_hash: record.stale_guard_hash, concurrency_token: record.concurrency_token, lease_status: record.lease_status, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}

export function buildExecutionConcurrencyRecord({ execution_envelope = {}, approval_request = {}, decision_log = [], idempotency_key = "", concurrency_seed = "", lease_status = "available" } = {}) {
  if (execution_envelope?.ok !== true || execution_envelope.envelope_version !== "platform_execution_envelope_v1") return failure("execution_concurrency_envelope_invalid");
  if (approval_request?.ok !== true || approval_request.request_version !== "platform_scoped_approval_request_v1") return failure("execution_concurrency_approval_request_invalid");
  if (bool(execution_envelope.provider_apply_allowed) || bool(approval_request.provider_apply_allowed)) return failure("execution_concurrency_provider_apply_boundary_failed");
  const idempotencyKey = safeText(idempotency_key || `${execution_envelope.envelope_id}:${approval_request.approval_request_id}`, 512);
  const staleGuard = { execution_manifest_hash: execution_envelope.manifest_hash, approval_request_manifest_hash: approval_request.manifest_hash, decision_log_hash: decisionLogHash(decision_log), execution_status: execution_envelope.execution_status, approval_status: approval_request.status };
  const record = { ok: true, control_version: "platform_execution_concurrency_control_v1", control_id: crypto.randomUUID(), execution_envelope_id: execution_envelope.envelope_id, approval_request_id: approval_request.approval_request_id, execution_manifest_hash: execution_envelope.manifest_hash, approval_request_manifest_hash: approval_request.manifest_hash, decision_log_hash: staleGuard.decision_log_hash, idempotency_key_hash: hash(idempotencyKey), stale_guard_hash: executionEnvelopeHash(staleGuard), concurrency_token: hash(`${concurrency_seed || crypto.randomUUID()}:${execution_envelope.manifest_hash}:${approval_request.manifest_hash}:${staleGuard.decision_log_hash}`), lease_status: safeText(lease_status || "available", 64), provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
  record.control_hash = executionEnvelopeHash(buildControlMaterial(record));
  return record;
}

export function validateExecutionConcurrencyControl(record = {}, { execution_envelope = {}, approval_request = {}, decision_log = [], current_enforcement = {}, now = new Date(), seen_idempotency_keys = [], active_concurrency_tokens = [], expected_concurrency_token = "" } = {}) {
  if (record?.ok !== true || record.control_version !== "platform_execution_concurrency_control_v1") return failure("execution_concurrency_record_invalid");
  if (bool(record.secrets_included)) return failure("execution_concurrency_secret_boundary_failed");
  if (bool(record.provider_apply_allowed) || bool(record.mutation_allowed) || bool(record.enforcement_cutover)) return failure("execution_concurrency_apply_boundary_failed");
  const envelopeCheck = validatePlatformExecutionEnvelope(execution_envelope, { enforcement: current_enforcement, now });
  if (envelopeCheck.ok !== true) return failure("execution_concurrency_envelope_stale", { envelope_status: envelopeCheck.status });
  const requestCheck = validateScopedApprovalRequest(approval_request, { now });
  if (requestCheck.ok !== true) return failure("execution_concurrency_approval_request_stale", { approval_status: requestCheck.status });
  const decisionCheck = validateApprovalDecisionLog({ approval_request, decision_log });
  if (decisionCheck.ok !== true) return failure("execution_concurrency_decision_log_invalid", { decision_status: decisionCheck.status });
  if (!latestApproved(decision_log)) return failure("execution_concurrency_approval_not_terminal_approved", { latest_decision: decisionCheck.latest_decision });
  if (record.execution_manifest_hash !== execution_envelope.manifest_hash) return failure("execution_concurrency_execution_manifest_mismatch");
  if (record.approval_request_manifest_hash !== approval_request.manifest_hash) return failure("execution_concurrency_approval_manifest_mismatch");
  if (record.decision_log_hash !== decisionLogHash(decision_log)) return failure("execution_concurrency_decision_log_hash_mismatch");
  const staleGuard = { execution_manifest_hash: execution_envelope.manifest_hash, approval_request_manifest_hash: approval_request.manifest_hash, decision_log_hash: decisionLogHash(decision_log), execution_status: execution_envelope.execution_status, approval_status: approval_request.status };
  if (record.stale_guard_hash !== executionEnvelopeHash(staleGuard)) return failure("execution_concurrency_stale_guard_mismatch");
  if (executionEnvelopeHash(buildControlMaterial(record)) !== record.control_hash) return failure("execution_concurrency_control_hash_mismatch");
  const seenKeys = new Set((seen_idempotency_keys || []).map((item) => safeText(item, 128)).filter(Boolean));
  if (seenKeys.has(record.idempotency_key_hash)) return failure("execution_concurrency_idempotency_replay_detected", { idempotency_key_hash: record.idempotency_key_hash });
  const activeTokens = new Set((active_concurrency_tokens || []).map((item) => safeText(item, 128)).filter(Boolean));
  if (activeTokens.has(record.concurrency_token)) return failure("execution_concurrency_lock_conflict", { concurrency_token: record.concurrency_token });
  if (expected_concurrency_token && expected_concurrency_token !== record.concurrency_token) return failure("execution_concurrency_token_mismatch");
  return { ok: true, status: "execution_concurrency_ready", control_id: record.control_id, idempotency_key_hash: record.idempotency_key_hash, concurrency_token: record.concurrency_token, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}

export function reserveExecutionConcurrencyControl(record = {}, { active_concurrency_tokens = [] } = {}) {
  if (record?.ok !== true || record.control_version !== "platform_execution_concurrency_control_v1") return failure("execution_concurrency_record_invalid");
  const activeTokens = new Set((active_concurrency_tokens || []).map((item) => safeText(item, 128)).filter(Boolean));
  if (activeTokens.has(record.concurrency_token)) return failure("execution_concurrency_lock_conflict", { concurrency_token: record.concurrency_token });
  const reserved = { ...record, lease_status: "reserved", provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
  reserved.control_hash = executionEnvelopeHash(buildControlMaterial(reserved));
  return { ok: true, status: "execution_concurrency_reserved", record: reserved, active_concurrency_tokens: [...activeTokens, reserved.concurrency_token], provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}
