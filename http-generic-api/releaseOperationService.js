import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export const RELEASE_OPERATION_STATUSES = Object.freeze([
  "accepted", "planning", "dry_run_pending", "dry_run_complete", "approval_required",
  "ready_for_execution", "deploy_started", "executing", "restart_in_progress", "readback_pending",
  "verified", "degraded", "blocked", "rollback_required", "rollback_started", "rolled_back",
  "failed_preflight", "failed_execution", "failed_rollback", "cancelled",
]);

const TERMINAL_STATUSES = new Set(["verified", "rolled_back", "failed_preflight", "failed_execution", "failed_rollback", "cancelled"]);
const TRANSITIONS = new Map([
  ["accepted", new Set(["planning", "dry_run_pending", "approval_required", "blocked", "cancelled"])],
  ["planning", new Set(["dry_run_pending", "dry_run_complete", "approval_required", "ready_for_execution", "blocked", "cancelled"])],
  ["dry_run_pending", new Set(["dry_run_complete", "degraded", "blocked", "failed_preflight", "cancelled"])],
  ["dry_run_complete", new Set(["approval_required", "ready_for_execution", "blocked", "cancelled"])],
  ["approval_required", new Set(["ready_for_execution", "blocked", "cancelled"])],
  ["ready_for_execution", new Set(["deploy_started", "executing", "blocked", "cancelled"])],
  ["deploy_started", new Set(["restart_in_progress", "readback_pending", "verified", "degraded", "rollback_required", "failed_execution"])],
  ["executing", new Set(["restart_in_progress", "readback_pending", "verified", "degraded", "rollback_required", "failed_execution"])],
  ["restart_in_progress", new Set(["readback_pending", "verified", "degraded", "rollback_required", "failed_execution"])],
  ["readback_pending", new Set(["verified", "degraded", "rollback_required", "failed_execution"])],
  ["degraded", new Set(["verified", "rollback_required", "cancelled"])],
  ["blocked", new Set(["planning", "approval_required", "cancelled"])],
  ["rollback_required", new Set(["rollback_started", "cancelled"])],
  ["rollback_started", new Set(["rolled_back", "failed_rollback"])],
]);

const SHA_PATTERN = /^[a-f0-9]{7,64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY_PATTERN = /(secret|token|password|authorization|cookie|private[_-]?key|credential)/i;
const SAFE_SENSITIVE_METADATA_KEYS = new Set(["secrets_included", "secrets_excluded", "no_secrets"]);

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function safeString(value, max = 512, fallback = "") {
  return String(value ?? fallback).trim().slice(0, max);
}

function safeNullableString(value, max = 512) {
  const text = safeString(value, max);
  return text || null;
}

function safeUuid(value, fieldName, { required = false } = {}) {
  const text = safeString(value, 36);
  if (!text && !required) return null;
  if (!UUID_PATTERN.test(text)) fail("release_operation_validation_error", `${fieldName} must be a UUID.`, 400, { field: fieldName });
  return text;
}

function safeSha(value, fieldName) {
  const text = safeString(value, 64);
  if (!text) return null;
  if (!SHA_PATTERN.test(text)) fail("release_operation_validation_error", `${fieldName} must be a Git commit SHA.`, 400, { field: fieldName });
  return text.toLowerCase();
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function isSafeSensitiveMetadataKey(key) {
  return SAFE_SENSITIVE_METADATA_KEYS.has(key)
    || key.endsWith("_secrets_included")
    || key.endsWith("_secrets_excluded")
    || key.endsWith("_no_secrets");
}

export function sanitizeReleaseEvidence(value, depth = 0) {
  if (depth > 12) return "[depth_limited]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeReleaseEvidence(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 8000) : value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => isSafeSensitiveMetadataKey(key) || !SENSITIVE_KEY_PATTERN.test(key))
      .slice(0, 300)
      .map(([key, item]) => [key, sanitizeReleaseEvidence(item, depth + 1)]),
  );
}

function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSortObject(value[key])]));
}

export function buildReleaseEvidenceRecord(input = {}) {
  const evidence = sanitizeReleaseEvidence(input.evidence ?? input.payload ?? {});
  const canonical = JSON.stringify(stableSortObject(evidence));
  return {
    evidence_id: randomUUID(),
    evidence_type: safeString(input.evidence_type || "runtime_readback", 96),
    evidence_surface: safeString(input.evidence_surface || "release_operation", 128),
    evidence_ref: safeNullableString(input.evidence_ref, 512),
    evidence_json: evidence,
    evidence_sha256: createHash("sha256").update(canonical).digest("hex"),
    evidence_bytes: Buffer.byteLength(canonical, "utf8"),
    secrets_included: false,
  };
}

export function assertReleaseOperationTransition(fromStatus, toStatus) {
  const from = safeString(fromStatus, 64);
  const to = safeString(toStatus, 64);
  if (!RELEASE_OPERATION_STATUSES.includes(from)) fail("release_operation_status_invalid", `Unknown release operation status: ${from}.`);
  if (!RELEASE_OPERATION_STATUSES.includes(to)) fail("release_operation_status_invalid", `Unknown release operation status: ${to}.`);
  if (from === to) return true;
  if (TERMINAL_STATUSES.has(from)) fail("release_operation_terminal", `Release operation is terminal in status ${from}.`, 409);
  if (!TRANSITIONS.get(from)?.has(to)) fail("release_operation_transition_invalid", `Invalid release operation transition from ${from} to ${to}.`, 409, { from, to });
  return true;
}

export function normalizeReleaseOperationInput(input = {}) {
  const operationType = safeString(input.operation_type || "deploy_release", 64);
  const environmentKey = safeString(input.environment_key || "production", 64);
  const expectedCommitSha = safeSha(input.expected_commit_sha, "expected_commit_sha");
  const targetId = safeUuid(input.target_id, "target_id");
  return {
    operation_id: randomUUID(),
    operation_key: safeString(input.operation_key || `${operationType}:${targetId || "unbound"}:${expectedCommitSha || randomUUID()}`, 191),
    operation_type: operationType,
    environment_key: environmentKey,
    target_id: targetId,
    tenant_id: safeUuid(input.tenant_id, "tenant_id"),
    workspace_id: safeUuid(input.workspace_id, "workspace_id"),
    expected_commit_sha: expectedCommitSha,
    deployed_commit_sha: safeSha(input.deployed_commit_sha, "deployed_commit_sha"),
    capability_envelope_id: safeUuid(input.capability_envelope_id, "capability_envelope_id"),
    runtime_verification_run_id: safeUuid(input.runtime_verification_run_id, "runtime_verification_run_id"),
    release_readiness_log_id: input.release_readiness_log_id == null ? null : Number(input.release_readiness_log_id),
    current_status: "accepted",
    risk_level: safeString(input.risk_level || "medium", 32),
    requested_by: safeString(input.requested_by || "gpt_admin", 191),
    reason: safeNullableString(input.reason, 1000),
    context_json: sanitizeReleaseEvidence(input.context || {}),
  };
}

function shapeOperation(row) {
  return row ? { ...row, context_json: parseJson(row.context_json, {}), final_detail_json: parseJson(row.final_detail_json), rollback_plan_json: parseJson(row.rollback_plan_json), secrets_included: false } : null;
}
function shapeStep(row) { return { ...row, detail_json: parseJson(row.detail_json), error_json: parseJson(row.error_json), secrets_included: false }; }
function shapeEvidence(row) { return { ...row, evidence_json: parseJson(row.evidence_json), secrets_included: false }; }
function shapeGateEvent(row) { return { ...row, detail_json: parseJson(row.detail_json), secrets_included: false }; }

async function requireOperation(connection, operationId, { forUpdate = false } = {}) {
  const id = safeUuid(operationId, "operation_id", { required: true });
  const [rows] = await connection.query(`SELECT * FROM release_operations WHERE operation_id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  if (!rows[0]) fail("release_operation_not_found", "Release operation not found.", 404, { operation_id: id });
  return rows[0];
}

export async function createReleaseOperation(input = {}) {
  const pool = getPool();
  const operation = normalizeReleaseOperationInput(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (operation.target_id) {
      const [targetRows] = await connection.query(`SELECT target_id, tenant_id FROM remote_runtime_targets WHERE target_id = ? LIMIT 1 FOR UPDATE`, [operation.target_id]);
      if (!targetRows[0]) fail("release_operation_target_not_found", "Runtime target not found.", 404, { target_id: operation.target_id });
      operation.tenant_id = operation.tenant_id || targetRows[0].tenant_id || null;
    }
    await connection.query(
      `INSERT INTO release_operations
       (operation_id, operation_key, operation_type, environment_key, target_id, tenant_id, workspace_id,
        expected_commit_sha, deployed_commit_sha, capability_envelope_id, runtime_verification_run_id,
        release_readiness_log_id, current_status, risk_level, requested_by, reason, context_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [operation.operation_id, operation.operation_key, operation.operation_type, operation.environment_key,
       operation.target_id, operation.tenant_id, operation.workspace_id, operation.expected_commit_sha,
       operation.deployed_commit_sha, operation.capability_envelope_id, operation.runtime_verification_run_id,
       Number.isFinite(operation.release_readiness_log_id) ? operation.release_readiness_log_id : null,
       operation.current_status, operation.risk_level, operation.requested_by, operation.reason, JSON.stringify(operation.context_json)],
    );
    await connection.query(
      `INSERT INTO release_operation_steps
       (operation_id, step_key, step_order, attempt_number, step_status, classification, detail_json, started_at, completed_at)
       VALUES (?, 'operation_accepted', 0, 1, 'completed', 'accepted', ?, NOW(3), NOW(3))`,
      [operation.operation_id, JSON.stringify({ operation_key: operation.operation_key, secrets_included: false })],
    );
    await connection.commit();
    return getReleaseOperation(operation.operation_id);
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") fail("release_operation_conflict", "A release operation with this operation_key already exists.", 409);
    throw error;
  } finally { connection.release(); }
}

export async function listReleaseOperations(filters = {}) {
  const pool = getPool();
  const clauses = [];
  const params = [];
  if (filters.status) { clauses.push("current_status = ?"); params.push(safeString(filters.status, 64)); }
  if (filters.target_id) { clauses.push("target_id = ?"); params.push(safeUuid(filters.target_id, "target_id", { required: true })); }
  if (filters.environment_key) { clauses.push("environment_key = ?"); params.push(safeString(filters.environment_key, 64)); }
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const [rows] = await pool.query(`SELECT * FROM release_operations ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`, [...params, limit]);
  return { ok: true, items: rows.map(shapeOperation), page: { limit, has_more: rows.length === limit }, secrets_included: false };
}

export async function getReleaseOperation(operationId) {
  const pool = getPool();
  const operation = await requireOperation(pool, operationId);
  const [steps] = await pool.query(`SELECT * FROM release_operation_steps WHERE operation_id = ? ORDER BY step_order, attempt_number, step_id`, [operation.operation_id]);
  const [evidence] = await pool.query(`SELECT * FROM release_operation_evidence WHERE operation_id = ? ORDER BY evidence_id`, [operation.operation_id]);
  const [gateEvents] = await pool.query(`SELECT * FROM release_gate_events WHERE operation_id = ? ORDER BY gate_event_id`, [operation.operation_id]);
  return { ok: true, operation: shapeOperation(operation), steps: steps.map(shapeStep), evidence: evidence.map(shapeEvidence), gate_events: gateEvents.map(shapeGateEvent), secrets_included: false };
}

export async function appendReleaseOperationStep(operationId, input = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operation = await requireOperation(connection, operationId, { forUpdate: true });
    const nextStatus = safeString(input.operation_status || operation.current_status, 64);
    assertReleaseOperationTransition(operation.current_status, nextStatus);
    const stepStatus = safeString(input.step_status || "completed", 64);
    const stepKey = safeString(input.step_key, 128);
    if (!stepKey) fail("release_operation_validation_error", "step_key is required.", 400, { field: "step_key" });
    await connection.query(
      `INSERT INTO release_operation_steps
       (operation_id, step_key, step_order, attempt_number, step_status, classification, idempotency_key,
        detail_json, error_json, duration_ms, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW(3)), ?)
       ON DUPLICATE KEY UPDATE step_status = VALUES(step_status), classification = VALUES(classification),
         detail_json = VALUES(detail_json), error_json = VALUES(error_json), duration_ms = VALUES(duration_ms),
         completed_at = VALUES(completed_at), updated_at = NOW(3)`,
      [operation.operation_id, stepKey, Math.max(Number(input.step_order) || 0, 0), Math.max(Number(input.attempt_number) || 1, 1),
       stepStatus, safeNullableString(input.classification, 64), safeNullableString(input.idempotency_key, 191),
       JSON.stringify(sanitizeReleaseEvidence(input.detail || {})), input.error ? JSON.stringify(sanitizeReleaseEvidence(input.error)) : null,
       input.duration_ms == null ? null : Math.max(Number(input.duration_ms) || 0, 0), input.started_at || null,
       stepStatus === "completed" || stepStatus === "failed" ? (input.completed_at || new Date()) : null],
    );
    if (nextStatus !== operation.current_status) await connection.query(`UPDATE release_operations SET current_status = ?, updated_at = NOW(3) WHERE operation_id = ?`, [nextStatus, operation.operation_id]);
    await connection.commit();
    return getReleaseOperation(operation.operation_id);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function appendReleaseOperationEvidence(operationId, input = {}) {
  const pool = getPool();
  const operation = await requireOperation(pool, operationId);
  const record = buildReleaseEvidenceRecord(input);
  await pool.query(
    `INSERT INTO release_operation_evidence
     (evidence_uuid, operation_id, step_id, evidence_type, evidence_surface, evidence_ref,
      evidence_json, evidence_sha256, evidence_bytes, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE evidence_ref = VALUES(evidence_ref), evidence_json = VALUES(evidence_json), evidence_bytes = VALUES(evidence_bytes)`,
    [record.evidence_id, operation.operation_id, input.step_id == null ? null : Number(input.step_id), record.evidence_type,
     record.evidence_surface, record.evidence_ref, JSON.stringify(record.evidence_json), record.evidence_sha256, record.evidence_bytes],
  );
  return getReleaseOperation(operation.operation_id);
}

export async function appendReleaseGateEvent(operationId, input = {}) {
  const pool = getPool();
  const operation = await requireOperation(pool, operationId);
  const eventType = safeString(input.event_type, 64);
  if (!eventType) fail("release_operation_validation_error", "event_type is required.", 400, { field: "event_type" });
  await pool.query(
    `INSERT INTO release_gate_events
     (gate_event_uuid, operation_id, gate_key, event_type, gate_status, ttl_minutes, expires_at,
      capability_envelope_id, runtime_verification_run_id, reason, detail_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), operation.operation_id, safeString(input.gate_key || "release_execution", 128), eventType,
     safeString(input.gate_status || eventType, 64), input.ttl_minutes == null ? null : Math.max(Number(input.ttl_minutes) || 0, 0),
     input.expires_at || null, safeUuid(input.capability_envelope_id, "capability_envelope_id"),
     safeUuid(input.runtime_verification_run_id, "runtime_verification_run_id"), safeNullableString(input.reason, 1000),
     JSON.stringify(sanitizeReleaseEvidence(input.detail || {})), safeString(input.created_by || "gpt_admin", 191)],
  );
  return getReleaseOperation(operation.operation_id);
}

export async function finalizeReleaseOperation(operationId, input = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operation = await requireOperation(connection, operationId, { forUpdate: true });
    const finalStatus = safeString(input.final_status, 64);
    if (!TERMINAL_STATUSES.has(finalStatus) && finalStatus !== "degraded") fail("release_operation_final_status_invalid", "final_status must be verified, degraded, rolled_back, failed_preflight, failed_execution, failed_rollback, or cancelled.", 400);
    assertReleaseOperationTransition(operation.current_status, finalStatus);
    await connection.query(
      `UPDATE release_operations SET current_status = ?, final_classification = ?, final_detail_json = ?, rollback_plan_json = ?,
       deployed_commit_sha = COALESCE(?, deployed_commit_sha), runtime_verification_run_id = COALESCE(?, runtime_verification_run_id),
       release_readiness_log_id = COALESCE(?, release_readiness_log_id), completed_at = NOW(3), updated_at = NOW(3)
       WHERE operation_id = ?`,
      [finalStatus, safeString(input.final_classification || finalStatus, 64), JSON.stringify(sanitizeReleaseEvidence(input.detail || {})),
       input.rollback_plan ? JSON.stringify(sanitizeReleaseEvidence(input.rollback_plan)) : null,
       safeSha(input.deployed_commit_sha, "deployed_commit_sha"), safeUuid(input.runtime_verification_run_id, "runtime_verification_run_id"),
       input.release_readiness_log_id == null ? null : Number(input.release_readiness_log_id), operation.operation_id],
    );
    await connection.commit();
    return getReleaseOperation(operation.operation_id);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
