import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { sanitizeReleaseEvidence } from "./releaseOperationService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const OPENABLE_OPERATION_STATUSES = new Set(["dry_run_complete", "approval_required", "ready_for_execution"]);
const TERMINAL_OPERATION_STATUSES = new Set(["verified", "rolled_back", "failed_preflight", "failed_execution", "failed_rollback", "cancelled"]);
const GATE_FINAL_STATUSES = new Set(["closed", "expired", "hard_disabled", "orphaned"]);

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
  if (!UUID_PATTERN.test(text)) fail("release_gate_validation_error", `${fieldName} must be a UUID.`, 400, { field: fieldName });
  return text;
}

function safeSha(value, fieldName, { required = false } = {}) {
  const text = safeString(value, 40).toLowerCase();
  if (!text && !required) return null;
  if (!SHA_PATTERN.test(text)) fail("release_gate_validation_error", `${fieldName} must be a 40-character Git SHA.`, 400, { field: fieldName });
  return text;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function shapeAdapter(row) {
  if (!row) return null;
  return {
    ...row,
    accepted_app_keys_json: parseJson(row.accepted_app_keys_json, []),
    metadata_json: parseJson(row.metadata_json, {}),
    secrets_included: false,
  };
}

function shapeGate(row) {
  if (!row) return null;
  return {
    ...row,
    config_snapshot_json: parseJson(row.config_snapshot_json, null),
    readback_json: parseJson(row.readback_json, null),
    secrets_included: false,
  };
}

export function normalizeReleaseGateOpenInput(input = {}, adapter = {}) {
  const defaultTtl = boundedInt(adapter.default_ttl_minutes, 30, 5, 120);
  const maxTtl = boundedInt(adapter.max_ttl_minutes, 120, 5, 1440);
  const ttlMinutes = boundedInt(input.ttl_minutes, defaultTtl, 5, maxTtl);
  return {
    operation_id: safeUuid(input.operation_id || input.operationId, "operation_id", { required: true }),
    adapter_key: safeString(input.adapter_key || input.adapterKey || "hostinger_ssh_executor", 64),
    target_id: safeUuid(input.target_id || input.targetId, "target_id", { required: true }),
    app_key: safeString(input.app_key || input.appKey || adapter.app_key || "hostinger", 191),
    expected_commit_sha: safeSha(input.expected_commit_sha || input.expectedCommitSha, "expected_commit_sha", { required: true }),
    capability_envelope_id: safeUuid(input.capability_envelope_id || input.capabilityEnvelopeId, "capability_envelope_id", { required: true }),
    ttl_minutes: ttlMinutes,
    reason: safeString(input.reason, 1000),
    opened_by: safeString(input.opened_by || input.openedBy || "gpt_admin", 191),
    metadata: sanitizeReleaseEvidence(input.metadata || {}),
  };
}

export function buildReleaseGateCompatibilityConfig({ gate, adapter, enabled = true, event = "opened", actor = "gpt_admin", verification = null } = {}) {
  return sanitizeReleaseEvidence({
    enabled: enabled === true,
    gate_id: gate?.gate_id || null,
    release_operation_id: gate?.operation_id || null,
    adapter_key: adapter?.adapter_key || gate?.adapter_key || null,
    purpose: "dynamic_release_gate_manager",
    target_id: gate?.target_id || null,
    app_key: gate?.app_key || adapter?.app_key || null,
    expected_commit_sha: gate?.expected_commit_sha || null,
    verified_commit_sha: verification?.verified_commit_sha || gate?.verified_commit_sha || null,
    expires_at: asIso(gate?.expires_at),
    capability_envelope_id: gate?.capability_envelope_id || null,
    runtime_verification_run_id: verification?.runtime_verification_run_id || gate?.runtime_verification_run_id || null,
    event,
    event_actor: actor,
    event_at: new Date().toISOString(),
    deploy_allowed: enabled === true,
    restart_allowed: enabled === true,
    provider_dispatch_allowed: false,
    credential_payload_read_allowed: false,
    hard_disable_required_after_close: true,
    same_cycle_readback_required: true,
    secrets_included: false,
  });
}

export function classifyReleaseGateReadback({ gate, adapter, configRow, now = new Date() } = {}) {
  const config = parseJson(configRow?.config_json, {});
  const expiresAt = gate?.expires_at ? new Date(gate.expires_at) : null;
  const expired = Boolean(expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= now);
  const shouldBeOpen = gate?.status === "open" && !expired;
  const configEnabled = configRow?.status === "active" && config.enabled === true;
  const identityMatches = String(config.gate_id || "") === String(gate?.gate_id || "")
    && String(config.target_id || "") === String(gate?.target_id || "")
    && String(config.expected_commit_sha || "").toLowerCase() === String(gate?.expected_commit_sha || "").toLowerCase();
  const stateMatches = shouldBeOpen ? configEnabled && identityMatches : !configEnabled;
  return {
    status: expired && gate?.status === "open" ? "expired_open_gate" : stateMatches ? "verified" : "mismatch",
    should_be_open: shouldBeOpen,
    config_enabled: configEnabled,
    identity_matches: identityMatches,
    state_matches: stateMatches,
    expired,
    adapter_key: adapter?.adapter_key || gate?.adapter_key || null,
    config_key: adapter?.config_key || null,
    secrets_included: false,
  };
}

export function classifyCapabilityEnvelopeForReleaseGate(envelope = {}, { now = new Date(), requireApproval = true } = {}) {
  const envelopeJson = parseJson(envelope.envelope_json, {});
  const approvalStatus = safeNullableString(envelopeJson?.approval?.status, 64);
  const expectedCommitSha = safeNullableString(envelopeJson?.capability?.expected_commit_sha, 64)?.toLowerCase() || null;
  const reasons = [];
  if (envelope.envelope_status !== "ready_for_dispatch" || envelope.decision !== "ready_for_dispatch") reasons.push("envelope_not_ready");
  if (envelope.authority_status !== "passed") reasons.push("authority_not_passed");
  if (!bool(envelope.dispatch_allowed)) reasons.push("dispatch_not_allowed");
  if (Number(envelope.blocking_gap_count || 0) > 0) reasons.push("blocking_gaps_present");
  if (requireApproval && approvalStatus !== "approved") reasons.push("approval_not_active");
  if (envelope.expires_at && new Date(envelope.expires_at) <= now) reasons.push("envelope_expired");
  if (["failed", "cancelled"].includes(String(envelope.execution_status || ""))) reasons.push("execution_not_usable");
  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    reasons,
    approval_status: approvalStatus,
    expected_commit_sha: expectedCommitSha,
    dispatch_allowed: bool(envelope.dispatch_allowed),
    blocking_gap_count: Number(envelope.blocking_gap_count || 0),
    secrets_included: false,
  };
}

async function loadAdapter(connection, adapterKey, { forUpdate = false } = {}) {
  const key = safeString(adapterKey || "hostinger_ssh_executor", 64);
  const [rows] = await connection.query(
    `SELECT * FROM release_gate_adapters WHERE adapter_key = ? AND status = 'active' LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [key],
  );
  if (!rows[0]) fail("release_gate_adapter_not_found", "Release gate adapter was not found or is inactive.", 404, { adapter_key: key });
  return shapeAdapter(rows[0]);
}

async function loadGate(connection, gateId, { forUpdate = false } = {}) {
  const id = safeUuid(gateId, "gate_id", { required: true });
  const [rows] = await connection.query(
    `SELECT * FROM release_gates WHERE gate_id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!rows[0]) fail("release_gate_not_found", "Release gate was not found.", 404, { gate_id: id });
  return rows[0];
}

async function loadOperation(connection, operationId, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT * FROM release_operations WHERE operation_id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [operationId],
  );
  if (!rows[0]) fail("release_gate_operation_not_found", "Linked release operation was not found.", 404, { operation_id: operationId });
  return rows[0];
}

async function validateTarget(connection, targetId, adapter) {
  const [rows] = await connection.query(`SELECT * FROM remote_runtime_targets WHERE target_id = ? LIMIT 1 FOR UPDATE`, [targetId]);
  const target = rows[0];
  if (!target) fail("release_gate_target_not_found", "Runtime target was not found.", 404, { target_id: targetId });
  if (adapter.provider_family && String(target.provider_family || "") !== String(adapter.provider_family)) {
    fail("release_gate_target_provider_mismatch", "Runtime target provider does not match the gate adapter.", 409);
  }
  if (adapter.target_kind && String(target.target_kind || "") !== String(adapter.target_kind)) {
    fail("release_gate_target_kind_mismatch", "Runtime target kind does not match the gate adapter.", 409);
  }
  return target;
}

async function validateEnvelope(connection, envelopeId, { adapter, operation, target, expectedCommitSha, appKey }) {
  const [rows] = await connection.query(
    `SELECT * FROM capability_resolution_envelope_ledger WHERE envelope_id = ? LIMIT 1 FOR UPDATE`,
    [envelopeId],
  );
  const envelope = rows[0];
  if (!envelope) fail("release_gate_envelope_not_found", "Capability resolution envelope was not found.", 404);
  const lifecycle = classifyCapabilityEnvelopeForReleaseGate(envelope, { requireApproval: true });
  if (lifecycle.reasons.includes("envelope_expired")) {
    fail("release_gate_envelope_expired", "Capability resolution envelope has expired.", 403, lifecycle);
  }
  if (lifecycle.status !== "ready") {
    fail("release_gate_envelope_not_approved", "Capability resolution envelope is not approved and ready for dispatch.", 403, lifecycle);
  }
  const acceptedAppKeys = Array.isArray(adapter.accepted_app_keys_json) ? adapter.accepted_app_keys_json : [adapter.app_key];
  if (!acceptedAppKeys.includes(envelope.app_key) || !acceptedAppKeys.includes(appKey)) {
    fail("release_gate_envelope_app_mismatch", "Envelope app_key does not match the release gate adapter.", 409);
  }
  if (adapter.capability_key && envelope.capability_key !== adapter.capability_key) {
    fail("release_gate_envelope_capability_mismatch", "Envelope capability_key does not match the release gate adapter.", 409);
  }
  if (lifecycle.expected_commit_sha && lifecycle.expected_commit_sha !== expectedCommitSha) {
    fail("release_gate_envelope_commit_mismatch", "Envelope expected commit does not match the release gate request.", 409);
  }
  if (target.tenant_id && envelope.tenant_id && String(target.tenant_id) !== String(envelope.tenant_id)) {
    fail("release_gate_envelope_tenant_mismatch", "Envelope tenant does not match the runtime target.", 409);
  }
  if (operation.workspace_id && envelope.workspace_id && String(operation.workspace_id) !== String(envelope.workspace_id)) {
    fail("release_gate_envelope_workspace_mismatch", "Envelope workspace does not match the release operation.", 409);
  }
  return envelope;
}

async function writeCompatibilityConfig(connection, adapter, config, note, enabled) {
  await connection.query(
    `INSERT INTO platform_runtime_config (config_key, config_json, status, note)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), status = VALUES(status), note = VALUES(note), updated_at = CURRENT_TIMESTAMP`,
    [adapter.config_key, JSON.stringify(config), enabled ? "active" : "disabled", safeString(note, 255)],
  );
}

async function insertGateEvent(connection, gate, { eventType, gateStatus, reason, actor, verificationRunId = null, detail = {} }) {
  await connection.query(
    `INSERT INTO release_gate_events
     (gate_event_uuid, operation_id, gate_key, event_type, gate_status, ttl_minutes, expires_at,
      capability_envelope_id, runtime_verification_run_id, reason, detail_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), gate.operation_id, gate.gate_key, eventType, gateStatus, gate.ttl_minutes, gate.expires_at,
     gate.capability_envelope_id, verificationRunId, safeNullableString(reason, 1000),
     JSON.stringify(sanitizeReleaseEvidence({ gate_id: gate.gate_id, adapter_key: gate.adapter_key, target_id: gate.target_id, ...detail, secrets_included: false })),
     safeString(actor || "gpt_admin", 191)],
  );
}

export async function openReleaseGate(input = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const requestedAdapterKey = safeString(input.adapter_key || input.adapterKey || "hostinger_ssh_executor", 64);
    const adapter = await loadAdapter(connection, requestedAdapterKey, { forUpdate: true });
    const normalized = normalizeReleaseGateOpenInput(input, adapter);
    if (normalized.reason.length < 20) fail("release_gate_reason_required", "reason with at least 20 characters is required to open a release gate.", 400);
    const operation = await loadOperation(connection, normalized.operation_id, { forUpdate: true });
    if (!OPENABLE_OPERATION_STATUSES.has(operation.current_status)) {
      fail("release_gate_operation_not_ready", "Release operation must be dry_run_complete, approval_required, or ready_for_execution before opening a gate.", 409, { current_status: operation.current_status });
    }
    if (operation.target_id && String(operation.target_id) !== normalized.target_id) fail("release_gate_operation_target_mismatch", "Release operation target does not match gate target.", 409);
    if (operation.expected_commit_sha && String(operation.expected_commit_sha).toLowerCase() !== normalized.expected_commit_sha) fail("release_gate_operation_commit_mismatch", "Release operation expected commit does not match gate request.", 409);
    const target = await validateTarget(connection, normalized.target_id, adapter);
    await validateEnvelope(connection, normalized.capability_envelope_id, {
      adapter, operation, target, expectedCommitSha: normalized.expected_commit_sha, appKey: normalized.app_key,
    });
    const activeScopeKey = `${adapter.adapter_key}:${normalized.target_id}:${adapter.gate_key}`;
    const [activeRows] = await connection.query(`SELECT gate_id FROM release_gates WHERE active_scope_key = ? LIMIT 1 FOR UPDATE`, [activeScopeKey]);
    if (activeRows[0]) fail("release_gate_already_open", "An active release gate already exists for this adapter, target, and gate key.", 409, { gate_id: activeRows[0].gate_id });
    const gateId = randomUUID();
    const expiresAt = new Date(Date.now() + normalized.ttl_minutes * 60_000);
    const gate = {
      gate_id: gateId,
      operation_id: normalized.operation_id,
      adapter_key: adapter.adapter_key,
      gate_key: adapter.gate_key,
      active_scope_key: activeScopeKey,
      target_id: normalized.target_id,
      tenant_id: target.tenant_id || operation.tenant_id || null,
      workspace_id: operation.workspace_id || null,
      app_key: normalized.app_key,
      capability_key: adapter.capability_key,
      expected_commit_sha: normalized.expected_commit_sha,
      capability_envelope_id: normalized.capability_envelope_id,
      status: "open",
      ttl_minutes: normalized.ttl_minutes,
      expires_at: expiresAt,
      opened_by: normalized.opened_by,
    };
    const config = buildReleaseGateCompatibilityConfig({ gate, adapter, enabled: true, event: "opened", actor: normalized.opened_by });
    await connection.query(
      `INSERT INTO release_gates
       (gate_id, operation_id, adapter_key, gate_key, active_scope_key, target_id, tenant_id, workspace_id,
        app_key, capability_key, expected_commit_sha, capability_envelope_id, status, ttl_minutes, expires_at,
        opened_by, opened_at, config_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NOW(3), ?)`,
      [gate.gate_id, gate.operation_id, gate.adapter_key, gate.gate_key, gate.active_scope_key, gate.target_id,
       gate.tenant_id, gate.workspace_id, gate.app_key, gate.capability_key, gate.expected_commit_sha,
       gate.capability_envelope_id, gate.ttl_minutes, gate.expires_at, gate.opened_by, JSON.stringify(config)],
    );
    await writeCompatibilityConfig(connection, adapter, config, `Dynamic release gate ${gate.gate_id} open for ${gate.target_id}.`, true);
    await insertGateEvent(connection, gate, { eventType: "opened", gateStatus: "open", reason: normalized.reason, actor: normalized.opened_by, detail: normalized.metadata });
    if (operation.current_status !== "ready_for_execution") {
      await connection.query(
        `UPDATE release_operations SET current_status = 'ready_for_execution', capability_envelope_id = ?, updated_at = NOW(3) WHERE operation_id = ?`,
        [gate.capability_envelope_id, gate.operation_id],
      );
    }
    await connection.commit();
    return readReleaseGate(gate.gate_id);
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") fail("release_gate_already_open", "An active release gate already exists for this target scope.", 409);
    throw error;
  } finally { connection.release(); }
}

async function validateVerification(connection, runId, verifiedCommitSha, gate) {
  const [rows] = await connection.query(`SELECT * FROM runtime_verification_runs WHERE run_id = ? LIMIT 1 FOR UPDATE`, [runId]);
  const run = rows[0];
  if (!run) fail("release_gate_verification_not_found", "Runtime verification run was not found.", 404);
  if (run.run_status !== "verified" || run.production_parity !== "verified") fail("release_gate_verification_not_verified", "Runtime verification run has not verified production parity.", 409);
  if (String(run.expected_commit_sha || "").toLowerCase() !== verifiedCommitSha || String(run.deployed_commit_sha || "").toLowerCase() !== verifiedCommitSha) {
    fail("release_gate_verification_commit_mismatch", "Runtime verification run does not match verified_commit_sha.", 409);
  }
  if (String(gate.expected_commit_sha || "").toLowerCase() !== verifiedCommitSha) fail("release_gate_expected_commit_mismatch", "Gate expected commit does not match verified commit.", 409);
  return run;
}

async function disableGate({ gateId, status, eventType, reason, actor, verificationRunId = null, verifiedCommitSha = null }) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const gate = await loadGate(connection, gateId, { forUpdate: true });
    const adapter = await loadAdapter(connection, gate.adapter_key, { forUpdate: true });
    if (GATE_FINAL_STATUSES.has(gate.status) && gate.status === status) {
      await connection.commit();
      return readReleaseGate(gate.gate_id);
    }
    if (gate.status !== "open") fail("release_gate_not_open", "Release gate is not open.", 409, { status: gate.status });
    const config = buildReleaseGateCompatibilityConfig({
      gate, adapter, enabled: false, event: eventType, actor,
      verification: { runtime_verification_run_id: verificationRunId, verified_commit_sha: verifiedCommitSha },
    });
    await connection.query(
      `UPDATE release_gates
       SET status = ?, active_scope_key = NULL, runtime_verification_run_id = COALESCE(?, runtime_verification_run_id),
           verified_commit_sha = COALESCE(?, verified_commit_sha), close_reason = ?, closed_by = ?, closed_at = NOW(3),
           hard_disabled_at = NOW(3),
           config_snapshot_json = ?, updated_at = NOW(3)
       WHERE gate_id = ?`,
      [status, verificationRunId, verifiedCommitSha, safeString(reason, 1000), safeString(actor || "gpt_admin", 191), JSON.stringify(config), gate.gate_id],
    );
    await writeCompatibilityConfig(connection, adapter, config, `Dynamic release gate ${gate.gate_id} ${status}.`, false);
    await insertGateEvent(connection, gate, { eventType, gateStatus: status, reason, actor, verificationRunId, detail: { verified_commit_sha: verifiedCommitSha } });
    if (verificationRunId || verifiedCommitSha) {
      await connection.query(
        `UPDATE release_operations
         SET runtime_verification_run_id = COALESCE(?, runtime_verification_run_id),
             deployed_commit_sha = COALESCE(?, deployed_commit_sha), updated_at = NOW(3)
         WHERE operation_id = ?`,
        [verificationRunId, verifiedCommitSha, gate.operation_id],
      );
    }
    await connection.commit();
    return readReleaseGate(gate.gate_id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function closeReleaseGate(gateId, input = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const gate = await loadGate(connection, gateId, { forUpdate: true });
    if (gate.status !== "open") fail("release_gate_not_open", "Release gate is not open.", 409, { status: gate.status });
    const runId = safeUuid(input.runtime_verification_run_id || input.runtimeVerificationRunId, "runtime_verification_run_id", { required: true });
    const verifiedCommitSha = safeSha(input.verified_commit_sha || input.verifiedCommitSha, "verified_commit_sha", { required: true });
    const reason = safeString(input.reason, 1000);
    if (reason.length < 20) fail("release_gate_reason_required", "reason with at least 20 characters is required to close a release gate.", 400);
    await validateVerification(connection, runId, verifiedCommitSha, gate);
    await connection.rollback();
    return disableGate({ gateId: gate.gate_id, status: "closed", eventType: "closed", reason, actor: input.closed_by || input.closedBy || "gpt_admin", verificationRunId: runId, verifiedCommitSha });
  } catch (error) {
    try { await connection.rollback(); } catch { /* noop */ }
    throw error;
  } finally { connection.release(); }
}

export async function expireReleaseGate(gateId, input = {}) {
  const pool = getPool();
  const gate = await loadGate(pool, gateId);
  if (gate.status !== "open") fail("release_gate_not_open", "Release gate is not open.", 409, { status: gate.status });
  const force = bool(input.force);
  if (!force && new Date(gate.expires_at) > new Date()) fail("release_gate_not_expired", "Release gate has not expired yet.", 409);
  const reason = safeString(input.reason || "Release gate expired by TTL policy.", 1000);
  return disableGate({ gateId: gate.gate_id, status: "expired", eventType: "expired", reason, actor: input.expired_by || input.expiredBy || "release_gate_manager" });
}

export async function hardDisableReleaseGate(gateId, input = {}) {
  const reason = safeString(input.reason, 1000);
  if (reason.length < 20) fail("release_gate_reason_required", "reason with at least 20 characters is required for hard-disable.", 400);
  return disableGate({ gateId, status: "hard_disabled", eventType: "hard_disabled", reason, actor: input.disabled_by || input.disabledBy || "gpt_admin" });
}

export async function readReleaseGate(gateId) {
  const pool = getPool();
  const gate = await loadGate(pool, gateId);
  const adapter = await loadAdapter(pool, gate.adapter_key);
  const [configRows] = await pool.query(`SELECT config_key, config_json, status, note, updated_at FROM platform_runtime_config WHERE config_key = ? LIMIT 1`, [adapter.config_key]);
  const readback = classifyReleaseGateReadback({ gate, adapter, configRow: configRows[0] || null });
  return { ok: true, gate: shapeGate(gate), adapter, compatibility_config: configRows[0] ? { ...configRows[0], config_json: parseJson(configRows[0].config_json, {}) } : null, readback, secrets_included: false };
}

export async function listReleaseGates(filters = {}) {
  const pool = getPool();
  const clauses = [];
  const params = [];
  if (filters.status) { clauses.push("status = ?"); params.push(safeString(filters.status, 32)); }
  if (filters.adapter_key) { clauses.push("adapter_key = ?"); params.push(safeString(filters.adapter_key, 64)); }
  if (filters.target_id) { clauses.push("target_id = ?"); params.push(safeUuid(filters.target_id, "target_id", { required: true })); }
  if (filters.operation_id) { clauses.push("operation_id = ?"); params.push(safeUuid(filters.operation_id, "operation_id", { required: true })); }
  const limit = boundedInt(filters.limit, 25, 1, 100);
  const [rows] = await pool.query(`SELECT * FROM release_gates ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`, [...params, limit]);
  return { ok: true, items: rows.map(shapeGate), page: { limit, has_more: rows.length === limit }, secrets_included: false };
}

export async function reconcileReleaseGates(input = {}) {
  const pool = getPool();
  const dryRun = input.dry_run === undefined ? true : bool(input.dry_run);
  const limit = boundedInt(input.limit, 50, 1, 200);
  const [rows] = await pool.query(
    `SELECT g.*, o.current_status AS operation_status,
            e.envelope_status, e.approval_hold_status, e.expires_at AS envelope_expires_at
       FROM release_gates g
       LEFT JOIN release_operations o ON o.operation_id = g.operation_id
       LEFT JOIN capability_resolution_envelope_ledger e ON e.envelope_id = g.capability_envelope_id
      WHERE g.status = 'open'
      ORDER BY g.created_at ASC
      LIMIT ?`,
    [limit],
  );
  const now = new Date();
  const actions = rows.map((row) => {
    const reasons = [];
    if (row.expires_at && new Date(row.expires_at) <= now) reasons.push("ttl_expired");
    if (!row.operation_status) reasons.push("operation_missing");
    else if (TERMINAL_OPERATION_STATUSES.has(row.operation_status)) reasons.push("operation_terminal");
    if (!row.envelope_status) reasons.push("envelope_missing");
    else if (row.envelope_status !== "ready_for_dispatch") reasons.push("envelope_not_ready");
    if (row.approval_hold_status !== "approved") reasons.push("approval_not_active");
    if (row.envelope_expires_at && new Date(row.envelope_expires_at) <= now) reasons.push("envelope_expired");
    return { gate_id: row.gate_id, action: reasons.length ? "hard_disable" : "none", reasons, secrets_included: false };
  }).filter((item) => item.action !== "none");
  const applied = [];
  if (!dryRun) {
    for (const action of actions) {
      const result = await disableGate({
        gateId: action.gate_id,
        status: action.reasons.includes("ttl_expired") ? "expired" : "orphaned",
        eventType: action.reasons.includes("ttl_expired") ? "expired" : "orphaned",
        reason: `Release gate reconciliation: ${action.reasons.join(", ")}`,
        actor: input.reconciled_by || input.reconciledBy || "release_gate_manager",
      });
      applied.push({ gate_id: action.gate_id, status: result.gate.status });
    }
  }
  return { ok: true, dry_run: dryRun, scanned_count: rows.length, action_count: actions.length, actions, applied, secrets_included: false };
}
