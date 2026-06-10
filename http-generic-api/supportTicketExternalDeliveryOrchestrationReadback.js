import { getPool } from "./db.js";

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function boundedInt(value, fallback = 10, min = 1, max = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeRowJson(row = {}, jsonFields = []) {
  const out = { ...row };
  for (const field of jsonFields) {
    if (Object.prototype.hasOwnProperty.call(out, field)) out[field] = parseJson(out[field], null);
  }
  return out;
}

async function countRows(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return Number(rows[0]?.row_count || 0);
}

export async function readSupportTicketExternalDeliveryOrchestrationReadiness(input = {}) {
  const pool = getPool();
  const tenantId = input.tenant_id || input.tenantId || null;
  const limit = boundedInt(input.limit, 10, 1, 50);
  const tenantClause = tenantId ? " AND tenant_id = ?" : "";
  const tenantParams = tenantId ? [tenantId] : [];

  let readiness = null;
  try {
    const [rows] = await pool.query(
      `SELECT * FROM v_platform_orchestration_support_ticket_external_delivery_readiness LIMIT 1`
    );
    readiness = rows[0] || null;
  } catch {
    readiness = null;
  }

  const [recentLinks] = await pool.query(
    `SELECT link_id, ticket_id, tenant_id, plan_id, run_id, approval_hold_id,
            relationship, status, evidence_json, created_at, updated_at
       FROM ticket_workflow_links
      WHERE relationship LIKE 'external_%'${tenantClause}
      ORDER BY updated_at DESC
      LIMIT ?`,
    [...tenantParams, limit]
  );

  const [recentApprovals] = await pool.query(
    `SELECT hold_id, tenant_id, workspace_id, workspace_key, hold_type, requested_by,
            user_id, actor_type, brand_key, request_id, status, decision_by,
            expires_at, decided_at, created_at
       FROM approval_holds
      WHERE (hold_type LIKE '%external%' OR request_id LIKE '%external%')${tenantClause}
      ORDER BY created_at DESC
      LIMIT ?`,
    [...tenantParams, limit]
  );

  const [recentCredentialIntake] = await pool.query(
    `SELECT intake_id, tenant_id, channel, audience, status, credential_ref,
            approval_hold_id, expires_at, created_at, updated_at
       FROM credential_intake_sessions
      WHERE 1=1${tenantClause}
      ORDER BY updated_at DESC
      LIMIT ?`,
    [...tenantParams, limit]
  ).catch(() => [[]]);

  const counts = {
    credential_bindings: await countRows(pool, `SELECT COUNT(*) AS row_count FROM credential_bindings WHERE 1=1${tenantClause}`, tenantParams).catch(() => 0),
    credential_intake_sessions: await countRows(pool, `SELECT COUNT(*) AS row_count FROM credential_intake_sessions WHERE 1=1${tenantClause}`, tenantParams).catch(() => 0),
    adapter_enablement_proposals: await countRows(pool, `SELECT COUNT(*) AS row_count FROM external_delivery_provider_adapter_enablement_proposals WHERE 1=1${tenantClause}`, tenantParams).catch(() => 0),
    adapter_readiness_checklists: await countRows(pool, `SELECT COUNT(*) AS row_count FROM external_delivery_provider_adapter_readiness_checklists WHERE 1=1${tenantClause}`, tenantParams).catch(() => 0),
    adapter_readiness_decisions: await countRows(pool, `SELECT COUNT(*) AS row_count FROM external_delivery_provider_adapter_readiness_decisions WHERE 1=1${tenantClause}`, tenantParams).catch(() => 0),
    send_mode_policies: await countRows(pool, `SELECT COUNT(*) AS row_count FROM external_delivery_provider_send_mode_policy_registry WHERE 1=1`, []).catch(() => 0),
    external_workflow_links: recentLinks.length,
    external_approval_holds: recentApprovals.length,
  };

  const ready = Boolean(readiness) || counts.send_mode_policies > 0;
  return {
    ok: true,
    plugin_key: "support_ticket_external_delivery_orchestrator",
    readback_mode: "support_ticket_external_delivery_readonly",
    readiness_status: ready ? "ready_readonly_external_delivery_graph" : "degraded_external_delivery_evidence_missing",
    tenant_id: tenantId,
    readiness,
    counts,
    recent_workflow_links: recentLinks.map((row) => normalizeRowJson(row, ["evidence_json"])),
    recent_approval_holds: recentApprovals,
    recent_credential_intake: recentCredentialIntake.map((row) => normalizeRowJson(row, [])),
    guidance: {
      admin_next_action: "review_external_delivery_readiness_before_any_send",
      customer_safe_summary: "External Delivery evidence can be reviewed without sending any external notification.",
      customer_safe_next_step: "Keep external delivery in record-only mode until credential readiness, adapter readiness, approval gate, and send-mode policy all pass.",
      requires_credential_readiness_review: counts.credential_bindings === 0,
      requires_adapter_readiness_review: counts.adapter_readiness_checklists === 0,
      requires_approval_gate_review: true,
    },
    execution: {
      will_record_snapshot: false,
      will_record_recommendation: false,
      will_mutate_ticket: false,
      will_dispatch_workflow: false,
      will_decide_approval: false,
      will_execute_provider_call: false,
      will_read_credential_payload: false,
      will_change_spend: false,
      will_external_send: false,
      will_external_write: false,
      will_deploy: false,
      will_publish: false,
      recommendation_only: true,
    },
    secrets_included: false,
  };
}
