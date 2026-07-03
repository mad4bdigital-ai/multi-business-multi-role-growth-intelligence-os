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
  expectedCommitSha = "",
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
  if (sha && hintedSha && hintedSha !== sha) {
    return capabilityEnvelopeFailure("capability_resolution_envelope_commit_mismatch", { envelope_id: resolvedEnvelopeId, expected_commit_sha: sha, envelope_commit_sha: hintedSha });
  }

  return {
    ok: true,
    status: "capability_resolution_envelope_resolved",
    envelope_id: resolvedEnvelopeId,
    envelope_status: row.envelope_status,
    decision: row.decision,
    app_key: row.app_key || null,
    capability_key: row.capability_key || null,
    operation_intent: row.operation_intent || null,
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
