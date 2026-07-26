import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { canonicalizeOperationValue, stableOperationHash } from "./operationRegistryContracts.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const STEP_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,95}$/;
const TERMINAL_RECEIPT_STATUSES = new Set(["completed", "recovered_completed"]);
const RETRY_RECOVERY_STATUSES = new Set(["reserved", "dispatching", "readback_required", "retry_ready", "blocked_recovery"]);
const FORBIDDEN_EXACT_KEYS = new Set([
  "credential_payload",
  "credential_value",
  "provider_url",
  "endpoint_url",
  "base_url",
  "authorization",
  "cookie",
  "request_headers",
  "raw_secret",
]);
const SECRET_KEY_PATTERN = /(?:password|passphrase|access[_-]?token|refresh[_-]?token|private[_-]?key|secret_value|client_secret)/i;

export class OperationWriteReceiptError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationWriteReceiptError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationWriteReceiptError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, field) {
  if (!isObject(value)) fail("operation_write_receipt_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function requiredString(value, field, { max = 191, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_write_receipt_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function requiredUuid(value, field) {
  const normalized = requiredString(value, field, { max: 36 }).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) fail("operation_write_receipt_invalid_uuid", `${field} must be a UUID.`, 400, { field });
  return normalized;
}

function requiredHash(value, field) {
  const normalized = requiredString(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_write_receipt_invalid_hash", `${field} must be SHA-256.`, 400, { field });
  return normalized;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function validateSafePayload(value, field = "payload", depth = 0) {
  if (depth > 24) fail("operation_write_receipt_payload_depth_exceeded", `${field} exceeds the maximum depth.`, 400, { field });
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSafePayload(entry, `${field}[${index}]`, depth + 1));
    return;
  }
  if (!isObject(value)) fail("operation_write_receipt_payload_not_json", `${field} must be JSON-safe.`, 400, { field });
  for (const [key, nested] of Object.entries(value)) {
    const childField = `${field}.${key}`;
    if (key === "secrets_included" || key === "credential_payloads_read") {
      if (nested !== false) fail("operation_write_receipt_safety_marker_invalid", `${childField} must be false.`, 400, { field: childField });
      continue;
    }
    if (FORBIDDEN_EXACT_KEYS.has(key) || SECRET_KEY_PATTERN.test(key)) {
      fail("operation_write_receipt_sensitive_field_forbidden", `${childField} is not allowed.`, 400, { field: childField });
    }
    validateSafePayload(nested, childField, depth + 1);
  }
}

function canonicalPayload(value, field) {
  const payload = requiredObject(value, field);
  validateSafePayload(payload, field);
  const canonical = canonicalizeOperationValue(payload);
  const serialized = JSON.stringify(canonical);
  if (serialized.length > 100_000) fail("operation_write_receipt_payload_too_large", `${field} exceeds the bounded size.`, 400, { field });
  return { canonical, serialized, sha256: stableOperationHash(canonical) };
}

function normalizeInput(input = {}) {
  const root = requiredObject(input, "input");
  const allowed = new Set([
    "run_id", "tenant_id", "workspace_id", "user_id", "step_key", "idempotency_key",
    "revision_bundle_hash", "resource_fingerprint", "request",
  ]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) fail("operation_write_receipt_unknown_field", `input.${key} is not supported.`, 400, { field: `input.${key}` });
  }
  const request = canonicalPayload(root.request, "input.request");
  const idempotencyKey = requiredString(root.idempotency_key, "input.idempotency_key", { max: 500 });
  return {
    run_id: requiredUuid(root.run_id, "input.run_id"),
    tenant_id: requiredUuid(root.tenant_id, "input.tenant_id"),
    workspace_id: root.workspace_id ? requiredUuid(root.workspace_id, "input.workspace_id") : null,
    user_id: requiredUuid(root.user_id, "input.user_id"),
    step_key: requiredString(root.step_key, "input.step_key", { max: 96, pattern: STEP_KEY_PATTERN }).toLowerCase(),
    idempotency_key_sha256: sha256(idempotencyKey),
    revision_bundle_hash: requiredHash(root.revision_bundle_hash, "input.revision_bundle_hash"),
    resource_fingerprint: requiredHash(root.resource_fingerprint, "input.resource_fingerprint"),
    request: request.canonical,
    request_sha256: request.sha256,
  };
}

function normalizeExternalResult(value, field, { requireReadback = false } = {}) {
  const root = requiredObject(value, field);
  validateSafePayload(root, field);
  if (root.secrets_included !== false) {
    fail("operation_write_receipt_external_safety_marker_missing", `${field}.secrets_included must be false.`, 409, { field });
  }
  const result = root.result === undefined ? {} : requiredObject(root.result, `${field}.result`);
  validateSafePayload(result, `${field}.result`);
  const normalized = {
    ok: root.ok === true,
    result: canonicalizeOperationValue(result),
    error_code: root.error_code ? requiredString(root.error_code, `${field}.error_code`, { max: 128 }) : null,
    secrets_included: false,
  };
  if (requireReadback) {
    if (typeof root.conclusive !== "boolean" || typeof root.applied !== "boolean") {
      fail("operation_write_receipt_readback_shape_invalid", `${field} must include boolean conclusive and applied fields.`, 409, { field });
    }
    normalized.conclusive = root.conclusive;
    normalized.applied = root.applied;
  }
  normalized.sha256 = stableOperationHash(normalized);
  return normalized;
}

function dependencies(overrides = {}) {
  return {
    pool: overrides.pool || getPool(),
    uuid: overrides.uuid || randomUUID,
    now: overrides.now || (() => new Date()),
    dispatchWrite: overrides.dispatchWrite,
    readbackWrite: overrides.readbackWrite,
  };
}

async function readRunContext(connection, runId, lock = false) {
  const [rows] = await connection.query(
    `SELECT o.run_id,o.tenant_id,o.workspace_id,o.user_id,o.operation_key,
            p.revision_bundle_hash,p.resource_fingerprint
       FROM operation_run_ownership o
       JOIN operation_run_revision_pins p ON p.run_id=o.run_id
      WHERE o.run_id=?
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [runId],
  );
  return rows?.[0] || null;
}

function assertRunAuthority(context, input) {
  if (!context) fail("operation_write_receipt_run_not_found", "The governed operation run does not exist.", 404, { run_id: input.run_id });
  if (context.tenant_id !== input.tenant_id || context.user_id !== input.user_id) {
    fail("operation_write_receipt_ownership_mismatch", "The operation run is not owned by the requested principal.", 403);
  }
  if (input.workspace_id && context.workspace_id !== input.workspace_id) {
    fail("operation_write_receipt_workspace_mismatch", "The operation run workspace does not match.", 403);
  }
  if (context.revision_bundle_hash !== input.revision_bundle_hash || context.resource_fingerprint !== input.resource_fingerprint) {
    fail("operation_write_receipt_authority_mismatch", "The immutable run authority does not match the write request.", 409, {
      current_revision_bundle_hash: context.revision_bundle_hash,
      current_resource_fingerprint: context.resource_fingerprint,
    });
  }
}

function receiptProjection(row) {
  if (!row) return null;
  return {
    receipt_id: row.receipt_id,
    run_id: row.run_id,
    step_key: row.step_key,
    idempotency_key_sha256: row.idempotency_key_sha256,
    request_sha256: row.request_sha256,
    revision_bundle_hash: row.revision_bundle_hash,
    resource_fingerprint: row.resource_fingerprint,
    state_revision: Number(row.state_revision),
    receipt_status: row.receipt_status,
    attempt_count: Number(row.attempt_count),
    last_attempt_id: row.last_attempt_id,
    dispatch_result_sha256: row.dispatch_result_sha256,
    readback_sha256: row.readback_sha256,
    result_sha256: row.result_sha256,
    same_cycle_readback_verified: Boolean(Number(row.same_cycle_readback_verified)),
    dispatch_succeeded: Boolean(Number(row.dispatch_succeeded)),
    write_observed: Boolean(Number(row.write_observed)),
    recovery_required: Boolean(Number(row.recovery_required)),
    last_error_code: row.last_error_code,
    reserved_at: row.reserved_at,
    dispatch_started_at: row.dispatch_started_at,
    dispatch_completed_at: row.dispatch_completed_at,
    readback_verified_at: row.readback_verified_at,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
    dispatch_authorized_by_receipt: false,
    secrets_included: false,
  };
}

async function readReceipt(connection, input, lock = false) {
  const [rows] = await connection.query(
    `SELECT receipt_id,run_id,step_key,idempotency_key_sha256,request_sha256,revision_bundle_hash,
            resource_fingerprint,state_revision,receipt_status,attempt_count,last_attempt_id,
            dispatch_result_sha256,readback_sha256,result_sha256,same_cycle_readback_verified,
            dispatch_succeeded,write_observed,recovery_required,last_error_code,reserved_at,
            dispatch_started_at,dispatch_completed_at,readback_verified_at,completed_at,updated_at
       FROM operation_write_receipts
      WHERE run_id=? AND step_key=? AND idempotency_key_sha256=?
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [input.run_id, input.step_key, input.idempotency_key_sha256],
  );
  return rows?.[0] || null;
}

function assertReceiptIdentity(receipt, input) {
  if (
    receipt.request_sha256 !== input.request_sha256
    || receipt.revision_bundle_hash !== input.revision_bundle_hash
    || receipt.resource_fingerprint !== input.resource_fingerprint
  ) {
    fail("operation_write_receipt_idempotency_conflict", "The idempotency key was reused with a different request or authority context.", 409, {
      receipt_id: receipt.receipt_id,
    });
  }
}

async function reserveReceipt(input, deps) {
  const connection = await deps.pool.getConnection();
  try {
    await connection.beginTransaction();
    const context = await readRunContext(connection, input.run_id, true);
    assertRunAuthority(context, input);
    let receipt = await readReceipt(connection, input, true);
    if (receipt) {
      assertReceiptIdentity(receipt, input);
      await connection.commit();
      return { inserted: false, context, receipt: receiptProjection(receipt) };
    }
    const receiptId = deps.uuid();
    await connection.query(
      `INSERT INTO operation_write_receipts
        (receipt_id,run_id,step_key,idempotency_key_sha256,request_sha256,revision_bundle_hash,
         resource_fingerprint,state_revision,receipt_status)
       VALUES (?,?,?,?,?,?,?,1,'reserved')`,
      [
        receiptId, input.run_id, input.step_key, input.idempotency_key_sha256, input.request_sha256,
        input.revision_bundle_hash, input.resource_fingerprint,
      ],
    );
    receipt = await readReceipt(connection, input, false);
    if (!receipt || receipt.receipt_id !== receiptId || receipt.receipt_status !== "reserved" || Number(receipt.state_revision) !== 1) {
      fail("operation_write_receipt_reservation_readback_mismatch", "Receipt reservation failed same-cycle readback.", 500);
    }
    await connection.commit();
    return { inserted: true, context, receipt: receiptProjection(receipt) };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function markDispatching(input, receipt, attemptId, deps) {
  const connection = await deps.pool.getConnection();
  try {
    await connection.beginTransaction();
    const context = await readRunContext(connection, input.run_id, true);
    assertRunAuthority(context, input);
    const current = await readReceipt(connection, input, true);
    if (!current || current.receipt_id !== receipt.receipt_id) fail("operation_write_receipt_missing", "The reserved receipt no longer exists.", 409);
    assertReceiptIdentity(current, input);
    if (TERMINAL_RECEIPT_STATUSES.has(current.receipt_status)) {
      await connection.commit();
      return receiptProjection(current);
    }
    const nextRevision = Number(current.state_revision) + 1;
    const [update] = await connection.query(
      `UPDATE operation_write_receipts
          SET state_revision=?,receipt_status='dispatching',attempt_count=attempt_count+1,
              last_attempt_id=?,dispatch_started_at=CURRENT_TIMESTAMP(6),updated_at=CURRENT_TIMESTAMP(6)
        WHERE receipt_id=? AND state_revision=?`,
      [nextRevision, attemptId, current.receipt_id, Number(current.state_revision)],
    );
    if (Number(update?.affectedRows || 0) !== 1) fail("operation_write_receipt_revision_conflict", "The receipt changed before dispatch.", 409);
    const readback = await readReceipt(connection, input, false);
    if (!readback || Number(readback.state_revision) !== nextRevision || readback.receipt_status !== "dispatching" || readback.last_attempt_id !== attemptId) {
      fail("operation_write_receipt_dispatch_mark_readback_mismatch", "Dispatch reservation failed same-cycle readback.", 500);
    }
    await connection.commit();
    return receiptProjection(readback);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function finalizeReceipt(input, receipt, outcome, deps) {
  const connection = await deps.pool.getConnection();
  try {
    await connection.beginTransaction();
    const context = await readRunContext(connection, input.run_id, true);
    assertRunAuthority(context, input);
    const current = await readReceipt(connection, input, true);
    if (!current || current.receipt_id !== receipt.receipt_id) fail("operation_write_receipt_missing", "The receipt no longer exists.", 409);
    assertReceiptIdentity(current, input);
    if (TERMINAL_RECEIPT_STATUSES.has(current.receipt_status)) {
      await connection.commit();
      return receiptProjection(current);
    }
    const nextRevision = Number(current.state_revision) + 1;
    const completedAt = TERMINAL_RECEIPT_STATUSES.has(outcome.status) ? deps.now().toISOString() : null;
    const [update] = await connection.query(
      `UPDATE operation_write_receipts
          SET state_revision=?,receipt_status=?,dispatch_result_sha256=?,readback_sha256=?,result_sha256=?,
              same_cycle_readback_verified=?,dispatch_succeeded=?,write_observed=?,recovery_required=?,
              last_error_code=?,dispatch_completed_at=CURRENT_TIMESTAMP(6),readback_verified_at=?,completed_at=?,
              updated_at=CURRENT_TIMESTAMP(6)
        WHERE receipt_id=? AND state_revision=?`,
      [
        nextRevision, outcome.status, outcome.dispatch_result_sha256, outcome.readback_sha256,
        outcome.result_sha256, outcome.same_cycle_readback_verified ? 1 : 0,
        outcome.dispatch_succeeded ? 1 : 0, outcome.write_observed ? 1 : 0,
        outcome.recovery_required ? 1 : 0, outcome.last_error_code,
        outcome.same_cycle_readback_verified ? deps.now().toISOString() : null,
        completedAt, current.receipt_id, Number(current.state_revision),
      ],
    );
    if (Number(update?.affectedRows || 0) !== 1) fail("operation_write_receipt_revision_conflict", "The receipt changed during finalization.", 409);
    const readback = await readReceipt(connection, input, false);
    if (
      !readback
      || Number(readback.state_revision) !== nextRevision
      || readback.receipt_status !== outcome.status
      || Boolean(Number(readback.same_cycle_readback_verified)) !== outcome.same_cycle_readback_verified
      || readback.readback_sha256 !== outcome.readback_sha256
    ) {
      fail("operation_write_receipt_final_readback_mismatch", "Receipt finalization failed same-cycle readback.", 500);
    }
    await connection.commit();
    return receiptProjection(readback);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

function classifyOutcome(dispatchResult, readbackResult, { dispatchAttempted }) {
  const dispatchSucceeded = dispatchResult?.ok === true;
  if (!readbackResult || readbackResult.conclusive !== true) {
    return {
      status: "blocked_recovery",
      dispatch_result_sha256: dispatchResult?.sha256 || null,
      readback_sha256: readbackResult?.sha256 || null,
      result_sha256: null,
      same_cycle_readback_verified: false,
      dispatch_succeeded: dispatchSucceeded,
      write_observed: false,
      recovery_required: true,
      last_error_code: readbackResult?.error_code || dispatchResult?.error_code || "operation_write_readback_inconclusive",
    };
  }
  if (readbackResult.applied === true) {
    return {
      status: dispatchAttempted && dispatchSucceeded ? "completed" : "recovered_completed",
      dispatch_result_sha256: dispatchResult?.sha256 || null,
      readback_sha256: readbackResult.sha256,
      result_sha256: stableOperationHash(readbackResult.result),
      same_cycle_readback_verified: true,
      dispatch_succeeded: dispatchSucceeded,
      write_observed: true,
      recovery_required: false,
      last_error_code: dispatchSucceeded ? null : dispatchResult?.error_code || null,
    };
  }
  if (dispatchAttempted && dispatchSucceeded) {
    return {
      status: "blocked_recovery",
      dispatch_result_sha256: dispatchResult.sha256,
      readback_sha256: readbackResult.sha256,
      result_sha256: null,
      same_cycle_readback_verified: true,
      dispatch_succeeded: true,
      write_observed: false,
      recovery_required: true,
      last_error_code: "operation_write_dispatch_readback_conflict",
    };
  }
  return {
    status: "retry_ready",
    dispatch_result_sha256: dispatchResult?.sha256 || null,
    readback_sha256: readbackResult.sha256,
    result_sha256: null,
    same_cycle_readback_verified: true,
    dispatch_succeeded: false,
    write_observed: false,
    recovery_required: false,
    last_error_code: dispatchResult?.error_code || null,
  };
}

async function invokeReadback(deps, input, receipt, phase) {
  if (typeof deps.readbackWrite !== "function") {
    return {
      ok: false,
      conclusive: false,
      applied: false,
      result: {},
      error_code: "operation_write_readback_dependency_missing",
      secrets_included: false,
      sha256: stableOperationHash({ error_code: "operation_write_readback_dependency_missing", phase }),
    };
  }
  try {
    return normalizeExternalResult(await deps.readbackWrite({
      phase,
      receipt,
      request: input.request,
      request_sha256: input.request_sha256,
      secrets_included: false,
    }), "readback_result", { requireReadback: true });
  } catch (error) {
    if (error instanceof OperationWriteReceiptError) throw error;
    return {
      ok: false,
      conclusive: false,
      applied: false,
      result: {},
      error_code: String(error?.code || "operation_write_readback_failed").slice(0, 128),
      secrets_included: false,
      sha256: stableOperationHash({ error_code: String(error?.code || "operation_write_readback_failed").slice(0, 128), phase }),
    };
  }
}

async function invokeDispatch(deps, input, receipt, attemptId) {
  if (typeof deps.dispatchWrite !== "function") {
    return {
      ok: false,
      result: {},
      error_code: "operation_write_dispatch_dependency_missing",
      secrets_included: false,
      sha256: stableOperationHash({ error_code: "operation_write_dispatch_dependency_missing", attempt_id: attemptId }),
    };
  }
  try {
    return normalizeExternalResult(await deps.dispatchWrite({
      receipt,
      attempt_id: attemptId,
      request: input.request,
      request_sha256: input.request_sha256,
      idempotency_key_sha256: input.idempotency_key_sha256,
      secrets_included: false,
    }), "dispatch_result");
  } catch (error) {
    return {
      ok: false,
      result: {},
      error_code: String(error?.code || "operation_write_dispatch_failed").slice(0, 128),
      secrets_included: false,
      sha256: stableOperationHash({ error_code: String(error?.code || "operation_write_dispatch_failed").slice(0, 128), attempt_id: attemptId }),
    };
  }
}

export async function executeOperationWriteWithReceipt(input, dependencyOverrides = {}) {
  const normalized = normalizeInput(input);
  const deps = dependencies(dependencyOverrides);
  const reservation = await reserveReceipt(normalized, deps);
  let receipt = reservation.receipt;

  if (TERMINAL_RECEIPT_STATUSES.has(receipt.receipt_status)) {
    return {
      ok: true,
      report_type: "operation_write_receipt_execution",
      inserted: false,
      idempotent_replay: true,
      dispatch_performed: false,
      pre_dispatch_readback_performed: false,
      same_cycle_readback_performed: false,
      receipt,
      dispatch_authorized_by_receipt: false,
      credential_payloads_read: false,
      secrets_included: false,
    };
  }

  if (!reservation.inserted && !RETRY_RECOVERY_STATUSES.has(receipt.receipt_status)) {
    fail("operation_write_receipt_state_not_retryable", "The existing receipt state does not permit recovery or retry.", 409, {
      receipt_status: receipt.receipt_status,
    });
  }

  let preDispatchReadback = null;
  if (!reservation.inserted) {
    preDispatchReadback = await invokeReadback(deps, normalized, receipt, "pre_dispatch_recovery");
    if (preDispatchReadback.conclusive && preDispatchReadback.applied) {
      const outcome = classifyOutcome(null, preDispatchReadback, { dispatchAttempted: false });
      receipt = await finalizeReceipt(normalized, receipt, outcome, deps);
      return {
        ok: true,
        report_type: "operation_write_receipt_execution",
        inserted: false,
        idempotent_replay: false,
        recovered_without_dispatch: true,
        dispatch_performed: false,
        pre_dispatch_readback_performed: true,
        same_cycle_readback_performed: true,
        receipt,
        dispatch_authorized_by_receipt: false,
        credential_payloads_read: false,
        secrets_included: false,
      };
    }
    if (!preDispatchReadback.conclusive) {
      const outcome = classifyOutcome(null, preDispatchReadback, { dispatchAttempted: false });
      receipt = await finalizeReceipt(normalized, receipt, outcome, deps);
      return {
        ok: false,
        report_type: "operation_write_receipt_execution",
        inserted: false,
        idempotent_replay: false,
        dispatch_performed: false,
        pre_dispatch_readback_performed: true,
        same_cycle_readback_performed: false,
        receipt,
        blocker: {
          code: "operation_write_receipt_recovery_readback_inconclusive",
          message: "The existing receipt requires conclusive readback before another dispatch.",
          secrets_included: false,
        },
        dispatch_authorized_by_receipt: false,
        credential_payloads_read: false,
        secrets_included: false,
      };
    }
  }

  const attemptId = deps.uuid();
  receipt = await markDispatching(normalized, receipt, attemptId, deps);
  if (TERMINAL_RECEIPT_STATUSES.has(receipt.receipt_status)) {
    return {
      ok: true,
      report_type: "operation_write_receipt_execution",
      inserted: reservation.inserted,
      idempotent_replay: true,
      dispatch_performed: false,
      pre_dispatch_readback_performed: Boolean(preDispatchReadback),
      same_cycle_readback_performed: false,
      receipt,
      dispatch_authorized_by_receipt: false,
      credential_payloads_read: false,
      secrets_included: false,
    };
  }

  const dispatchResult = await invokeDispatch(deps, normalized, receipt, attemptId);
  const readbackResult = await invokeReadback(deps, normalized, receipt, "same_cycle_post_dispatch");
  const outcome = classifyOutcome(dispatchResult, readbackResult, { dispatchAttempted: true });
  receipt = await finalizeReceipt(normalized, receipt, outcome, deps);

  return {
    ok: TERMINAL_RECEIPT_STATUSES.has(receipt.receipt_status),
    report_type: "operation_write_receipt_execution",
    inserted: reservation.inserted,
    idempotent_replay: false,
    recovered_without_dispatch: false,
    dispatch_performed: true,
    pre_dispatch_readback_performed: Boolean(preDispatchReadback),
    same_cycle_readback_performed: true,
    receipt,
    blocker: receipt.recovery_required ? {
      code: receipt.last_error_code || "operation_write_receipt_recovery_required",
      message: "The write receipt requires governed recovery before another dispatch.",
      secrets_included: false,
    } : null,
    dispatch_authorized_by_receipt: false,
    credential_payloads_read: false,
    secrets_included: false,
  };
}

export async function getOperationWriteReceipt(input, dependencyOverrides = {}) {
  const normalized = normalizeInput(input);
  const deps = dependencies(dependencyOverrides);
  const connection = await deps.pool.getConnection();
  try {
    const context = await readRunContext(connection, normalized.run_id, false);
    assertRunAuthority(context, normalized);
    const receipt = await readReceipt(connection, normalized, false);
    if (!receipt) fail("operation_write_receipt_not_found", "No write receipt exists for the idempotency key.", 404);
    assertReceiptIdentity(receipt, normalized);
    return {
      ok: true,
      report_type: "operation_write_receipt_get",
      receipt: receiptProjection(receipt),
      read_only: true,
      database_writes_performed: false,
      dispatch_authorized_by_receipt: false,
      credential_payloads_read: false,
      secrets_included: false,
    };
  } finally {
    connection.release();
  }
}

export function createOperationWriteReceiptService(dependencyOverrides = {}) {
  return Object.freeze({
    execute: (input) => executeOperationWriteWithReceipt(input, dependencyOverrides),
    get: (input) => getOperationWriteReceipt(input, dependencyOverrides),
  });
}

export const _testingOperationWriteReceipt = Object.freeze({
  normalizeInput,
  classifyOutcome,
});
