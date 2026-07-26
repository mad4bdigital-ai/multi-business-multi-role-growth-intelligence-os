import { getPool } from "./db.js";
import { upsertPlatformPluginSmokeRecertificationPolicy } from "./platformPluginSmokeRecertificationPolicy.js";

const AUDIT_ENTRY_TYPE = "platform_plugin_smoke_recertification_policy_upsert";

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function toPolicyInput(snapshot = {}, overrides = {}) {
  if (!snapshot?.policy_id) return null;
  return {
    policy_id: snapshot.policy_id,
    tenant_id: snapshot.tenant_id || null,
    plugin_key: snapshot.plugin_key || "*",
    action_key: snapshot.action_key || null,
    mock_provider: snapshot.mock_provider || null,
    mock_resource: snapshot.mock_resource || null,
    certification_ttl_days: snapshot.certification_ttl_days || 90,
    expires_soon_days: snapshot.expires_soon_days || 14,
    max_batch_size: snapshot.max_batch_size || 5,
    auto_recertification_enabled: snapshot.auto_recertification_enabled === true,
    provider_smoke_required: snapshot.provider_smoke_required !== false,
    allowed_expected_origin: snapshot.allowed_expected_origin || null,
    status: snapshot.status || "active",
    priority: snapshot.priority || 100,
    notes: overrides.notes || "Rollback applied from policy audit history. Original notes are not replayed from audit summary.",
    metadata: {
      ...(overrides.metadata || {}),
      rollback_source_audit_id: overrides.audit_id || null,
      rollback_source_trace_id: overrides.trace_id || null,
      secrets_included: false,
    },
  };
}

function auditSummary(row = {}) {
  const output = parseJson(row.output_summary, {});
  return {
    audit_log_id: row.id,
    trace_id: row.execution_trace_id_writeback || null,
    execution_status: row.execution_status,
    created_at: row.created_at || null,
    actor: output.actor || null,
    reason: output.reason || null,
    upsert_mode: output.upsert_mode || null,
    changed_fields: Array.isArray(output.changed_fields) ? output.changed_fields : [],
    before: output.before || null,
    after: output.after || null,
    secrets_included: false,
  };
}

async function loadAuditRows(pool, { auditLogId = null, traceId = null, limit = 50 } = {}) {
  const where = ["entry_type = ?"];
  const params = [AUDIT_ENTRY_TYPE];
  if (auditLogId) { where.push("id = ?"); params.push(Number(auditLogId)); }
  if (traceId) { where.push("execution_trace_id_writeback = ?"); params.push(compact(traceId, 255)); }
  const [rows] = await pool.query(
    `SELECT id, entry_type, execution_status, execution_trace_id_writeback, output_summary, created_at
       FROM execution_log
      WHERE ${where.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?`,
    [...params, boundedInt(limit, 50, 1, 200)]
  );
  return rows || [];
}

async function getCurrentPolicy(pool, policyId) {
  const [rows] = await pool.query(
    `SELECT policy_id, tenant_id, plugin_key, action_key, mock_provider, mock_resource,
            certification_ttl_days, expires_soon_days, max_batch_size,
            auto_recertification_enabled, provider_smoke_required, allowed_expected_origin,
            status, priority, notes, metadata_json, created_at, updated_at
       FROM platform_plugin_smoke_recertification_policies
      WHERE policy_id = ?
      LIMIT 1`,
    [policyId]
  );
  return rows[0] || null;
}

function summarizeCurrentPolicy(row = null) {
  if (!row) return null;
  return {
    policy_id: row.policy_id,
    tenant_id: row.tenant_id || null,
    plugin_key: row.plugin_key || "*",
    action_key: row.action_key || null,
    mock_provider: row.mock_provider || null,
    mock_resource: row.mock_resource || null,
    certification_ttl_days: row.certification_ttl_days,
    expires_soon_days: row.expires_soon_days,
    max_batch_size: row.max_batch_size,
    auto_recertification_enabled: Number(row.auto_recertification_enabled || 0) === 1,
    provider_smoke_required: Number(row.provider_smoke_required ?? 1) === 1,
    allowed_expected_origin: row.allowed_expected_origin || null,
    status: row.status,
    priority: row.priority,
    notes_present: Boolean(row.notes),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

function changedFromCurrent(current = null, target = null) {
  const fields = [
    "tenant_id", "plugin_key", "action_key", "mock_provider", "mock_resource",
    "certification_ttl_days", "expires_soon_days", "max_batch_size",
    "auto_recertification_enabled", "provider_smoke_required", "allowed_expected_origin",
    "status", "priority", "notes_present",
  ];
  const c = summarizeCurrentPolicy(current) || {};
  const t = target || {};
  return fields.filter((field) => JSON.stringify(c[field] ?? null) !== JSON.stringify(t[field] ?? null));
}

export async function listPlatformPluginSmokeRecertificationPolicyHistory(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const policyId = compact(input.policy_id || input.policyId, 64);
  const actor = compact(input.actor || input.actor_id || input.actorId, 128);
  const changedField = compact(input.changed_field || input.changedField, 128);
  const reasonContains = compact(input.reason_contains || input.reasonContains, 255).toLowerCase();
  const rows = await loadAuditRows(pool, { limit: input.limit || 100 });
  const audits = rows.map(auditSummary).filter((audit) => {
    if (policyId && audit.before?.policy_id !== policyId && audit.after?.policy_id !== policyId) return false;
    if (actor && String(audit.actor || "") !== actor) return false;
    if (changedField && !audit.changed_fields.includes(changedField)) return false;
    if (reasonContains && !String(audit.reason || "").toLowerCase().includes(reasonContains)) return false;
    return true;
  });
  return {
    ok: true,
    count: audits.length,
    audits,
    filters: { policy_id: policyId || null, actor: actor || null, changed_field: changedField || null, reason_contains: reasonContains || null },
    secrets_included: false,
  };
}

export async function previewPlatformPluginSmokeRecertificationPolicyRollback(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const auditLogId = Number(input.audit_log_id || input.auditLogId || 0) || null;
  const traceId = compact(input.trace_id || input.traceId, 255) || null;
  if (!auditLogId && !traceId) {
    const err = new Error("audit_log_id or trace_id is required for policy rollback preview.");
    err.status = 400;
    err.code = "policy_rollback_audit_reference_required";
    throw err;
  }
  const rows = await loadAuditRows(pool, { auditLogId, traceId, limit: 1 });
  const audit = rows[0] ? auditSummary(rows[0]) : null;
  if (!audit) {
    const err = new Error("Policy audit row was not found.");
    err.status = 404;
    err.code = "policy_audit_row_not_found";
    throw err;
  }
  const rollbackTo = compact(input.rollback_to || input.rollbackTo || "before", 32).toLowerCase();
  const target = rollbackTo === "after" ? audit.after : audit.before;
  if (!target?.policy_id) {
    return {
      ok: true,
      can_apply: false,
      reason: "rollback_target_snapshot_missing",
      audit,
      rollback_to: rollbackTo,
      secrets_included: false,
    };
  }
  const current = await getCurrentPolicy(pool, target.policy_id);
  const changed_fields = changedFromCurrent(current, target);
  return {
    ok: true,
    can_apply: true,
    rollback_to: rollbackTo,
    audit,
    target_snapshot: target,
    current_policy: summarizeCurrentPolicy(current),
    changed_fields,
    notes: {
      rollback_safe: true,
      notes_content_replayed: false,
      reason: "audit snapshots intentionally store notes_present only, not raw notes text",
    },
    secrets_included: false,
  };
}

export async function applyPlatformPluginSmokeRecertificationPolicyRollback(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const preview = await previewPlatformPluginSmokeRecertificationPolicyRollback(input, { pool });
  if (!preview.can_apply) return { ...preview, applied: false };
  if (input.confirm_rollback !== true && input.confirmRollback !== true) {
    return {
      ok: true,
      applied: false,
      reason: "confirm_rollback_required",
      preview,
      secrets_included: false,
    };
  }
  const actor = compact(input.actor || input.actor_id || input.actorId || input.admin_user_id || input.adminUserId || "platform_policy_rollback", 128);
  const reason = compact(input.reason || input.change_reason || input.changeReason || `rollback_from_audit_${preview.audit.audit_log_id}`, 2000);
  const traceId = compact(input.rollback_trace_id || input.rollbackTraceId || input.trace_id || input.traceId || `smoke_recert_policy_rollback_${preview.audit.audit_log_id}_${Date.now()}`, 255);
  const policyInput = toPolicyInput(preview.target_snapshot, {
    audit_id: preview.audit.audit_log_id,
    trace_id: preview.audit.trace_id,
    notes: input.notes || `Rollback applied from audit log ${preview.audit.audit_log_id}.`,
    metadata: { rollback_applied: true },
  });
  const result = await upsertPlatformPluginSmokeRecertificationPolicy({
    ...policyInput,
    actor,
    reason,
    trace_id: traceId,
  }, { pool });
  return {
    ok: true,
    applied: true,
    rollback_to: preview.rollback_to,
    source_audit_log_id: preview.audit.audit_log_id,
    changed_fields: preview.changed_fields,
    result,
    secrets_included: false,
  };
}
