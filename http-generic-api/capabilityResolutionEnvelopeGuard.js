import { createHash } from "node:crypto";
import { getPool } from "./db.js";

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function boolNumber(value) {
  return Number(value || 0) === 1 || value === true;
}

function defaultEnvelopeIdReader(source = {}) {
  return source.capability_envelope_id || source.capabilityEnvelopeId || source.envelope_id || source.envelopeId;
}

export function extractCapabilityEnvelopeId(source = {}, fallbackSources = []) {
  const direct = compact(defaultEnvelopeIdReader(source), 64);
  if (direct) return direct;
  for (const item of fallbackSources) {
    const value = compact(defaultEnvelopeIdReader(item || {}), 64);
    if (value) return value;
  }
  return "";
}

export function capabilityEnvelopeFailure(status, details = {}) {
  return {
    ok: false,
    status,
    envelope_required: true,
    ...details,
    secrets_included: false,
  };
}

export function capabilityEnvelopeError(failure, message = "Capability resolution envelope does not permit this execution.") {
  const err = new Error(message);
  err.status = 403;
  err.code = failure?.status || "capability_resolution_envelope_rejected";
  err.details = { ...(failure || {}), secrets_included: false };
  return err;
}

async function loadEnvelopeRow(pool, envelopeId) {
  const [rows] = await pool.query(
    `SELECT envelope_id, tenant_id, user_id, workspace_id, workspace_key, brand_key,
            app_key, capability_key, operation_intent, risk_class,
            selected_source_tier, selected_runtime_surface, authority_status,
            decision, envelope_status, dispatch_allowed, apply_allowed,
            approval_required, quota_required, audit_required, readback_required,
            blocking_gap_count, execution_status, expires_at, secrets_included,
            envelope_sha256, envelope_json
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 1`,
    [envelopeId]
  );
  return rows?.[0] || null;
}

function envelopeCommitHint(row = {}) {
  const envelopeJson = parseJson(row.envelope_json, {});
  return compact(
    envelopeJson?.request_context?.expected_commit_sha ||
    envelopeJson?.request_context?.expectedCommitSha ||
    envelopeJson?.capability?.expected_commit_sha ||
    envelopeJson?.capability?.expectedCommitSha ||
    envelopeJson?.selected_source?.expected_commit_sha ||
    envelopeJson?.selected_source?.expectedCommitSha ||
    envelopeJson?.inputs?.expected_commit_sha ||
    envelopeJson?.inputs?.expectedCommitSha ||
    "",
    64
  ).toLowerCase();
}

function envelopeRequestContext(row = {}) {
  const envelopeJson = parseJson(row.envelope_json, {});
  const requestContext = envelopeJson?.request_context;
  return requestContext && typeof requestContext === "object" && !Array.isArray(requestContext)
    ? requestContext
    : {};
}

export async function resolveCapabilityExecutionEnvelope({
  pool = null,
  envelopeId = "",
  source = {},
  fallbackSources = [],
  acceptedAppKeys = [],
  acceptedIntents = [],
  acceptedCapabilityKeys = [],
  expectedTenantId = "",
  expectedUserId = "",
  expectedWorkspaceId = "",
  expectedBrandKey = "",
  expectedResourceUri = "",
  expectedCommitSha = "",
  expectedBindingSha256 = "",
  expectedCapabilitySha256 = "",
  requireCommitHint = false,
  allowReferenced = true,
  requireReadyForDispatch = true,
  requireDispatchAllowed = true,
  requireNoApprovalRequired = true,
  requireNoBlockingGaps = true,
  requireNoSecrets = true,
} = {}) {
  const resolvedEnvelopeId = compact(envelopeId || extractCapabilityEnvelopeId(source, fallbackSources), 64);
  if (!resolvedEnvelopeId) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_required", {
      message: "A valid capability resolution envelope is required before execution.",
    });
  }

  const db = pool || getPool();
  const row = await loadEnvelopeRow(db, resolvedEnvelopeId);
  if (!row) return capabilityEnvelopeFailure("capability_resolution_envelope_not_found", { envelope_id: resolvedEnvelopeId });

  if (requireNoSecrets && boolNumber(row.secrets_included)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_secret_boundary_failed", { envelope_id: resolvedEnvelopeId });
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_expired", { envelope_id: resolvedEnvelopeId });
  }

  const appKey = compact(row.app_key, 128);
  const allowedApps = new Set((acceptedAppKeys || []).map((item) => compact(item, 128)).filter(Boolean));
  if (allowedApps.size > 0 && appKey && !allowedApps.has(appKey)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_app_mismatch", { envelope_id: resolvedEnvelopeId, app_key: appKey });
  }

  const capabilityKey = compact(row.capability_key, 191);
  const allowedCapabilities = new Set((acceptedCapabilityKeys || []).map((item) => compact(item, 191)).filter(Boolean));
  if (allowedCapabilities.size > 0 && !allowedCapabilities.has(capabilityKey)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_capability_mismatch", {
      envelope_id: resolvedEnvelopeId,
      capability_key: capabilityKey || null,
    });
  }

  const tenantId = compact(expectedTenantId, 64);
  if (row.tenant_id && tenantId && row.tenant_id !== tenantId) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_tenant_mismatch", { envelope_id: resolvedEnvelopeId });
  }

  const userId = compact(expectedUserId, 64);
  if (row.user_id && userId && row.user_id !== userId) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_user_mismatch", { envelope_id: resolvedEnvelopeId });
  }

  const workspaceId = compact(expectedWorkspaceId, 64);
  if (workspaceId && compact(row.workspace_id, 64) !== workspaceId) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_workspace_mismatch", {
      envelope_id: resolvedEnvelopeId,
      envelope_workspace_id: compact(row.workspace_id, 64) || null,
      expected_workspace_id: workspaceId,
    });
  }

  const brandKey = compact(expectedBrandKey, 255);
  if (brandKey && compact(row.brand_key, 255) !== brandKey) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_brand_mismatch", {
      envelope_id: resolvedEnvelopeId,
      envelope_brand_key: compact(row.brand_key, 255) || null,
      expected_brand_key: brandKey,
    });
  }

  const requestContext = envelopeRequestContext(row);
  const envelopeResourceUri = compact(requestContext.resource_uri || requestContext.resourceUri, 2048);
  const resourceUri = compact(expectedResourceUri, 2048);
  if (resourceUri && envelopeResourceUri !== resourceUri) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_resource_uri_mismatch", {
      envelope_id: resolvedEnvelopeId,
      envelope_resource_uri: envelopeResourceUri || null,
      expected_resource_uri: resourceUri,
    });
  }

  const envelopeBindingSha256 = compact(requestContext.binding_sha256 || requestContext.bindingSha256, 64).toLowerCase();
  const bindingSha256 = compact(expectedBindingSha256, 64).toLowerCase();
  if (bindingSha256 && envelopeBindingSha256 !== bindingSha256) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_binding_sha256_mismatch", {
      envelope_id: resolvedEnvelopeId,
      envelope_binding_sha256: envelopeBindingSha256 || null,
      expected_binding_sha256: bindingSha256,
    });
  }

  const envelopeCapabilitySha256 = compact(requestContext.capability_sha256 || requestContext.capabilitySha256, 64).toLowerCase();
  const capabilitySha256 = compact(expectedCapabilitySha256, 64).toLowerCase();
  if (capabilitySha256 && envelopeCapabilitySha256 !== capabilitySha256) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_capability_sha256_mismatch", {
      envelope_id: resolvedEnvelopeId,
      envelope_capability_sha256: envelopeCapabilitySha256 || null,
      expected_capability_sha256: capabilitySha256,
    });
  }

  if (requireReadyForDispatch && row.envelope_status !== "ready_for_dispatch") {
    return capabilityEnvelopeFailure("capability_resolution_envelope_not_dispatch_ready", { envelope_id: resolvedEnvelopeId, envelope_status: row.envelope_status, decision: row.decision });
  }
  if (requireDispatchAllowed && !boolNumber(row.dispatch_allowed)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_dispatch_not_allowed", { envelope_id: resolvedEnvelopeId });
  }
  if (requireNoApprovalRequired && boolNumber(row.approval_required)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_approval_required", { envelope_id: resolvedEnvelopeId });
  }
  if (requireNoBlockingGaps && Number(row.blocking_gap_count || 0) > 0) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_has_blocking_gaps", { envelope_id: resolvedEnvelopeId, blocking_gap_count: Number(row.blocking_gap_count || 0) });
  }

  const allowedStatuses = allowReferenced ? new Set(["not_executed", "referenced"]) : new Set(["not_executed"]);
  const executionStatus = compact(row.execution_status || "not_executed", 64);
  if (!allowedStatuses.has(executionStatus)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_already_consumed_or_cancelled", { envelope_id: resolvedEnvelopeId, execution_status: row.execution_status });
  }

  const intent = compact(row.operation_intent, 128).toLowerCase();
  const allowedIntents = new Set((acceptedIntents || []).map((item) => compact(item, 128).toLowerCase()).filter(Boolean));
  if (allowedIntents.size > 0 && intent && !allowedIntents.has(intent)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_intent_mismatch", { envelope_id: resolvedEnvelopeId, operation_intent: row.operation_intent });
  }

  const sha = compact(expectedCommitSha, 64).toLowerCase();
  const hintedSha = envelopeCommitHint(row);
  if (sha && ((requireCommitHint && hintedSha !== sha) || (!requireCommitHint && hintedSha && hintedSha !== sha))) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_commit_mismatch", {
      envelope_id: resolvedEnvelopeId,
      expected_commit_sha: sha,
      envelope_commit_sha: hintedSha || null,
      commit_hint_required: requireCommitHint === true,
    });
  }

  return {
    ok: true,
    status: "capability_resolution_envelope_resolved",
    envelope_id: resolvedEnvelopeId,
    envelope_status: row.envelope_status,
    decision: row.decision,
    tenant_id: row.tenant_id || null,
    user_id: row.user_id || null,
    workspace_id: row.workspace_id || null,
    brand_key: row.brand_key || null,
    app_key: row.app_key || null,
    capability_key: row.capability_key || null,
    operation_intent: row.operation_intent || null,
    resource_uri: envelopeResourceUri || null,
    expected_commit_sha: hintedSha || null,
    binding_sha256: envelopeBindingSha256 || null,
    capability_sha256: envelopeCapabilitySha256 || null,
    selected_source_tier: row.selected_source_tier || null,
    selected_runtime_surface: row.selected_runtime_surface || null,
    dispatch_allowed: true,
    apply_allowed: boolNumber(row.apply_allowed),
    audit_required: boolNumber(row.audit_required),
    quota_required: boolNumber(row.quota_required),
    readback_required: boolNumber(row.readback_required),
    blocking_gap_count: Number(row.blocking_gap_count || 0),
    secrets_included: false,
  };
}

export async function markCapabilityEnvelopeReferenced({ pool = null, envelopeId = "", executionRef = "" } = {}) {
  const id = compact(envelopeId, 64);
  if (!id) return { ok: false, status: "capability_resolution_envelope_id_missing", secrets_included: false };
  const db = pool || getPool();
  await db.query(
    `UPDATE capability_resolution_envelope_ledger
        SET execution_status = CASE WHEN execution_status = 'not_executed' THEN 'referenced' ELSE execution_status END,
            execution_ref = COALESCE(execution_ref, ?),
            updated_at = NOW()
      WHERE envelope_id = ?`,
    [compact(executionRef, 191) || null, id]
  );
  return { ok: true, status: "capability_resolution_envelope_referenced", envelope_id: id, secrets_included: false };
}

export const CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS = Object.freeze(["consume", "cancel", "expire"]);

function lifecycleExecutionRef(action, executionRef = "", reason = "") {
  const direct = compact(executionRef, 191);
  if (direct) return direct;
  const note = compact(reason, 150);
  return note ? `${action}:${note}`.slice(0, 191) : `capability_envelope_${action}`;
}

function lifecyclePublicRow(row = null) {
  if (!row) return null;
  return {
    envelope_id: row.envelope_id,
    envelope_status: row.envelope_status,
    execution_status: row.execution_status || "not_executed",
    dispatch_allowed: boolNumber(row.dispatch_allowed),
    apply_allowed: boolNumber(row.apply_allowed),
    expires_at: row.expires_at || null,
    secrets_included: false,
  };
}

export async function transitionCapabilityEnvelopeLifecycle({
  pool = null,
  envelopeId = "",
  action = "",
  executionRef = "",
  reason = "",
} = {}) {
  const id = compact(envelopeId, 64);
  if (!id) return capabilityEnvelopeFailure("capability_resolution_envelope_id_missing");

  const normalizedAction = compact(action, 32).toLowerCase();
  if (!CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS.includes(normalizedAction)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_lifecycle_action_invalid", {
      envelope_id: id,
      action: normalizedAction || null,
      allowed_actions: CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS,
    });
  }

  const db = pool || getPool();
  const before = await loadEnvelopeRow(db, id);
  if (!before) return capabilityEnvelopeFailure("capability_resolution_envelope_not_found", { envelope_id: id });
  if (boolNumber(before.secrets_included)) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_secret_boundary_failed", { envelope_id: id });
  }

  const ref = lifecycleExecutionRef(normalizedAction, executionRef, reason);
  let sql;
  let params;
  if (normalizedAction === "consume") {
    sql = `UPDATE capability_resolution_envelope_ledger
        SET execution_status = 'executed',
            execution_ref = COALESCE(NULLIF(?, ''), execution_ref),
            dispatch_allowed = 0,
            apply_allowed = 0,
            updated_at = NOW()
      WHERE envelope_id = ?
        AND envelope_status = 'ready_for_dispatch'
        AND execution_status IN ('not_executed','referenced')`;
    params = [ref, id];
  } else if (normalizedAction === "cancel") {
    sql = `UPDATE capability_resolution_envelope_ledger
        SET envelope_status = 'superseded',
            execution_status = 'cancelled',
            execution_ref = COALESCE(NULLIF(?, ''), execution_ref),
            dispatch_allowed = 0,
            apply_allowed = 0,
            updated_at = NOW()
      WHERE envelope_id = ?
        AND envelope_status IN ('dry_run','ready_requires_approval','ready_for_dispatch')
        AND execution_status IN ('not_executed','referenced')`;
    params = [ref, id];
  } else {
    sql = `UPDATE capability_resolution_envelope_ledger
        SET envelope_status = 'expired',
            dispatch_allowed = 0,
            apply_allowed = 0,
            updated_at = NOW()
      WHERE envelope_id = ?
        AND envelope_status IN ('dry_run','ready_requires_approval','ready_for_dispatch')
        AND execution_status IN ('not_executed','referenced')`;
    params = [id];
  }

  const [result] = await db.query(sql, params);
  if (Number(result?.affectedRows || 0) !== 1) {
    const current = await loadEnvelopeRow(db, id);
    return capabilityEnvelopeFailure("capability_resolution_envelope_lifecycle_transition_blocked", {
      envelope_id: id,
      action: normalizedAction,
      current: lifecyclePublicRow(current),
    });
  }

  const after = await loadEnvelopeRow(db, id);
  return {
    ok: true,
    status: `capability_resolution_envelope_${normalizedAction}d`,
    action: normalizedAction,
    before: lifecyclePublicRow(before),
    after: lifecyclePublicRow(after),
    envelope_id: id,
    secrets_included: false,
  };
}

export const CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES = Object.freeze(["dry_run", "apply"]);
export const CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION = "capability-envelope-batch-expire-v1";

function batchExpireError(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeExpiredBefore(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw batchExpireError("capability_envelope_batch_expire_timestamp_invalid", "expired_before must be a valid ISO 8601 timestamp.", 400);
  }
  if (date.getTime() > Date.now() + 60_000) {
    throw batchExpireError("capability_envelope_batch_expire_future_cutoff_blocked", "expired_before cannot be in the future.", 400);
  }
  return date;
}

function normalizeBatchExpireMaxItems(value) {
  const parsed = Number(value ?? 50);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw batchExpireError("capability_envelope_batch_expire_limit_invalid", "max_items must be an integer from 1 to 100.", 400);
  }
  return parsed;
}

function batchExpireCandidatePublicRow(row = {}) {
  return {
    envelope_id: row.envelope_id,
    capability_key: row.capability_key || null,
    operation_intent: row.operation_intent || null,
    envelope_status: row.envelope_status,
    execution_status: row.execution_status,
    expires_at: row.expires_at || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

function batchExpireFingerprint({ requestedBy, expiredBeforeIso, candidateIds }) {
  return createHash("sha256")
    .update(JSON.stringify({
      policy_version: CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION,
      requested_by: requestedBy,
      expired_before: expiredBeforeIso,
      candidate_ids: candidateIds,
    }))
    .digest("hex");
}

async function loadBatchExpireCandidates(db, { requestedBy, expiredBefore, maxItems, lockRows = false }) {
  const whereSql = `requested_by = ?
        AND expires_at IS NOT NULL
        AND expires_at < ?
        AND envelope_status IN ('dry_run','ready_requires_approval','ready_for_dispatch')
        AND execution_status = 'not_executed'
        AND execution_ref IS NULL
        AND secrets_included = 0`;
  const params = [requestedBy, expiredBefore];
  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total
       FROM capability_resolution_envelope_ledger
      WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRow?.total || 0);
  const [rows] = await db.query(
    `SELECT envelope_id, capability_key, operation_intent, envelope_status,
            execution_status, expires_at, created_at
       FROM capability_resolution_envelope_ledger
      WHERE ${whereSql}
      ORDER BY expires_at ASC, envelope_id ASC
      LIMIT ?${lockRows ? " FOR UPDATE" : ""}`,
    [...params, maxItems],
  );
  return { total, rows: rows || [] };
}

export async function planCapabilityEnvelopeBatchExpire({
  pool = null,
  requestedBy = "gpt_admin",
  expiredBefore = null,
  maxItems = 50,
  lockRows = false,
} = {}) {
  const db = pool || getPool();
  const normalizedRequestedBy = compact(requestedBy, 191);
  if (!normalizedRequestedBy) {
    throw batchExpireError("capability_envelope_batch_expire_requested_by_required", "requested_by is required.", 400);
  }
  const cutoff = normalizeExpiredBefore(expiredBefore);
  const limit = normalizeBatchExpireMaxItems(maxItems);
  const { total, rows } = await loadBatchExpireCandidates(db, {
    requestedBy: normalizedRequestedBy,
    expiredBefore: cutoff,
    maxItems: limit,
    lockRows,
  });
  const candidates = rows.map(batchExpireCandidatePublicRow);
  const candidateIds = candidates.map((row) => row.envelope_id);
  const expiredBeforeIso = cutoff.toISOString();
  const planSha256 = batchExpireFingerprint({
    requestedBy: normalizedRequestedBy,
    expiredBeforeIso,
    candidateIds,
  });
  const truncated = total > candidates.length;
  const applyAllowed = total > 0 && !truncated;
  return {
    policy_version: CAPABILITY_ENVELOPE_BATCH_EXPIRE_POLICY_VERSION,
    requested_by: normalizedRequestedBy,
    expired_before: expiredBeforeIso,
    max_items: limit,
    total_candidate_count: total,
    selected_candidate_count: candidates.length,
    truncated,
    apply_allowed: applyAllowed,
    blocking_reason: total === 0 ? "no_expired_candidates" : truncated ? "candidate_limit_exceeded" : null,
    plan_sha256: planSha256,
    confirm: `EXPIRE_CAPABILITY_ENVELOPES_${planSha256.slice(0, 12).toUpperCase()}`,
    candidates,
    execution_allowed: false,
    provider_write: false,
    external_write: false,
    secrets_included: false,
  };
}

export async function runCapabilityEnvelopeBatchExpire({
  pool = null,
  mode = "dry_run",
  requestedBy = "gpt_admin",
  expiredBefore = null,
  maxItems = 50,
  expectedPlanSha256 = "",
  confirm = "",
  capabilityEnvelopeId = "",
  reason = "",
} = {}) {
  const normalizedMode = compact(mode, 32).toLowerCase() || "dry_run";
  if (!CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES.includes(normalizedMode)) {
    throw batchExpireError("capability_envelope_batch_expire_mode_invalid", "mode must be dry_run or apply.", 400);
  }
  const db = pool || getPool();
  if (normalizedMode === "dry_run") {
    const plan = await planCapabilityEnvelopeBatchExpire({ pool: db, requestedBy, expiredBefore, maxItems });
    return {
      ok: true,
      mode: "dry_run",
      status: plan.total_candidate_count === 0 ? "capability_envelope_batch_expire_no_action" : "capability_envelope_batch_expire_planned",
      plan,
      execution_allowed: false,
      provider_write: false,
      external_write: false,
      secrets_included: false,
    };
  }

  const normalizedReason = compact(reason, 512);
  if (normalizedReason.length < 20) {
    throw batchExpireError("capability_envelope_batch_expire_reason_required", "reason must contain at least 20 characters for apply.", 400);
  }
  const expectedHash = compact(expectedPlanSha256, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw batchExpireError("capability_envelope_batch_expire_plan_hash_invalid", "expected_plan_sha256 must be a SHA-256 value.", 400);
  }
  const governanceEnvelopeId = compact(capabilityEnvelopeId, 64);
  if (!governanceEnvelopeId) {
    throw batchExpireError("capability_envelope_batch_expire_governance_envelope_required", "capability_envelope_id is required for apply.", 400);
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const governance = await resolveCapabilityExecutionEnvelope({
      pool: connection,
      envelopeId: governanceEnvelopeId,
      acceptedAppKeys: ["platform_orchestration"],
      acceptedCapabilityKeys: ["capability_resolution_envelope_batch_expire"],
      acceptedIntents: ["capability_resolution_envelope_batch_expire"],
      allowReferenced: false,
    });
    if (!governance.ok) throw capabilityEnvelopeError(governance);

    const plan = await planCapabilityEnvelopeBatchExpire({
      pool: connection,
      requestedBy,
      expiredBefore,
      maxItems,
      lockRows: true,
    });
    if (!plan.apply_allowed) {
      throw batchExpireError("capability_envelope_batch_expire_apply_blocked", "The current batch plan is not eligible for apply.", 409, {
        blocking_reason: plan.blocking_reason,
        total_candidate_count: plan.total_candidate_count,
        max_items: plan.max_items,
      });
    }
    if (plan.plan_sha256 !== expectedHash) {
      throw batchExpireError("capability_envelope_batch_expire_plan_changed", "The batch plan changed after review.", 409, {
        expected_plan_sha256: expectedHash,
        actual_plan_sha256: plan.plan_sha256,
      });
    }
    if (compact(confirm, 128) !== plan.confirm) {
      throw batchExpireError("capability_envelope_batch_expire_confirmation_invalid", "Typed confirmation does not match the reviewed plan.", 403, {
        expected_confirmation: plan.confirm,
      });
    }

    const ids = plan.candidates.map((row) => row.envelope_id);
    const placeholders = ids.map(() => "?").join(",");
    const [updateResult] = await connection.query(
      `UPDATE capability_resolution_envelope_ledger
          SET envelope_status = 'expired',
              dispatch_allowed = 0,
              apply_allowed = 0,
              updated_at = NOW()
        WHERE envelope_id IN (${placeholders})
          AND requested_by = ?
          AND expires_at IS NOT NULL
          AND expires_at < ?
          AND envelope_status IN ('dry_run','ready_requires_approval','ready_for_dispatch')
          AND execution_status = 'not_executed'
          AND execution_ref IS NULL
          AND secrets_included = 0`,
      [...ids, plan.requested_by, new Date(plan.expired_before)],
    );
    if (Number(updateResult?.affectedRows || 0) !== ids.length) {
      throw batchExpireError("capability_envelope_batch_expire_apply_count_mismatch", "The expired row count did not match the reviewed plan.", 409, {
        expected_count: ids.length,
        affected_rows: Number(updateResult?.affectedRows || 0),
      });
    }

    const [readbackRows] = await connection.query(
      `SELECT envelope_id, envelope_status, execution_status, dispatch_allowed,
              apply_allowed, execution_ref, secrets_included
         FROM capability_resolution_envelope_ledger
        WHERE envelope_id IN (${placeholders})
        ORDER BY envelope_id ASC`,
      ids,
    );
    const readbackOk = readbackRows.length === ids.length && readbackRows.every((row) =>
      row.envelope_status === "expired" &&
      row.execution_status === "not_executed" &&
      !boolNumber(row.dispatch_allowed) &&
      !boolNumber(row.apply_allowed) &&
      !row.execution_ref &&
      !boolNumber(row.secrets_included)
    );
    if (!readbackOk) {
      throw batchExpireError("capability_envelope_batch_expire_readback_failed", "Same-cycle readback did not confirm every expired envelope.", 500);
    }

    const consumed = await transitionCapabilityEnvelopeLifecycle({
      pool: connection,
      envelopeId: governanceEnvelopeId,
      action: "consume",
      executionRef: `capability_envelope_batch_expire:${plan.plan_sha256.slice(0, 24)}`,
      reason: normalizedReason,
    });
    if (!consumed.ok) throw capabilityEnvelopeError(consumed, "The governance envelope could not be consumed after batch expiration.");

    await connection.commit();
    return {
      ok: true,
      mode: "apply",
      status: "capability_envelope_batch_expire_applied",
      plan_sha256: plan.plan_sha256,
      expired_count: ids.length,
      envelope_ids: ids,
      governance_envelope_id: governanceEnvelopeId,
      governance_envelope_status: consumed.after?.envelope_status || null,
      governance_execution_status: consumed.after?.execution_status || null,
      same_cycle_readback: true,
      execution_allowed: false,
      provider_write: false,
      external_write: false,
      secrets_included: false,
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
