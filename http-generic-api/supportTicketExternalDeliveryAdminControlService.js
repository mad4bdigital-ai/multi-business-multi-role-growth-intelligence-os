import { getPool } from "./db.js";

const VALID_MATCH_TYPES = new Set(["exact_email", "domain", "wildcard_domain"]);
const VALID_CHANNELS = new Set(["email", "webhook"]);

function clean(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function normalizeTenantId(value) {
  return clean(value, 64) || "00000000-0000-0000-0000-000000000000";
}

function ensureEmailPattern(matchType, pattern) {
  const normalized = clean(pattern, 320).toLowerCase();
  if (!normalized) {
    const err = new Error("recipient_pattern is required.");
    err.status = 400;
    err.code = "external_delivery_recipient_pattern_required";
    throw err;
  }
  if (!VALID_MATCH_TYPES.has(matchType)) {
    const err = new Error("match_type must be one of exact_email, domain, wildcard_domain.");
    err.status = 400;
    err.code = "external_delivery_allowlist_match_type_invalid";
    throw err;
  }
  if (matchType === "exact_email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const err = new Error("exact_email allowlist rows require a valid email address.");
    err.status = 400;
    err.code = "external_delivery_allowlist_email_invalid";
    throw err;
  }
  return normalized.replace(/^@/, "");
}

export async function getExternalDeliveryAdminOverview({ tenant_id = null, limit = 25 } = {}) {
  const pool = getPool();
  const tenantId = normalizeTenantId(tenant_id);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
  const [adapters] = await pool.query(
    `SELECT adapter_key, family_key, channel, implementation_status, dispatch_enabled, provider_dispatch_enabled,
            required_credential_type, status,
            JSON_UNQUOTE(JSON_EXTRACT(safety_json, '$.runtime')) AS runtime,
            JSON_UNQUOTE(JSON_EXTRACT(safety_json, '$.live_send_enabled_by_default')) AS live_send_enabled_by_default,
            JSON_UNQUOTE(JSON_EXTRACT(safety_json, '$.canary_enabled')) AS canary_enabled,
            updated_at
       FROM external_delivery_provider_adapter_contract_registry
      WHERE family_key = 'email_delivery' OR channel IN ('email','webhook')
      ORDER BY channel, adapter_key
      LIMIT ?`,
    [safeLimit]
  );
  const [allowlist] = await pool.query(
    `SELECT allowlist_id, tenant_id, adapter_key, channel, match_type, recipient_pattern,
            status, readiness_status, approval_hold_id, expires_at, secrets_included
       FROM v_external_delivery_recipient_allowlist_readiness
      WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000', '*')
      ORDER BY updated_at DESC
      LIMIT ?`,
    [tenantId, safeLimit]
  );
  const [gmailConnections] = await pool.query(
    `SELECT connection_id, user_id, tenant_id, app_key, account_label, status, validation_status,
            scopes_granted, is_primary, connected_at, last_used_at
       FROM user_app_connections
      WHERE app_key IN ('gmail_user_oauth','google_cloud','gmail','gmail_api')
         OR scopes_granted LIKE '%gmail.send%'
      ORDER BY connected_at DESC
      LIMIT ?`,
    [safeLimit]
  );
  const [recentEvents] = await pool.query(
    `SELECT event_id, ticket_id, tenant_id, summary,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.provider_result.adapter_key')) AS adapter_key,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.provider_result.runtime')) AS runtime,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.provider_result.provider_status')) AS provider_status,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.provider_result.provider_message_id')) AS provider_message_id,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.idempotency_key')) AS idempotency_key,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.external_send_performed')) AS external_send_performed,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.secrets_included')) AS secrets_included,
            created_at
       FROM ticket_lifecycle_events
      WHERE event_type = 'external_send_provider_dispatch_succeeded'
      ORDER BY created_at DESC
      LIMIT ?`,
    [safeLimit]
  );
  const [pendingTasks] = await pool.query(
    `SELECT task_key, title, status, blocker_level, priority, source_ref, due_at, updated_at
       FROM platform_pending_tasks
      WHERE task_key LIKE 'support_ticket_external_delivery%'
      ORDER BY FIELD(status, 'blocked','in_progress','pending','deferred','done','cancelled'), updated_at DESC
      LIMIT ?`,
    [safeLimit]
  );
  return {
    ok: true,
    mode: "external_delivery_admin_overview",
    tenant_id: tenantId,
    adapters,
    allowlist,
    gmail_connections: gmailConnections.map((row) => ({ ...row, secret_value_included: false, secrets_included: false })),
    recent_events: recentEvents,
    pending_tasks: pendingTasks,
    secret_value_included: false,
    secrets_included: false,
  };
}

export async function upsertExternalDeliveryRecipientAllowlist({ tenant_id = null, adapter_key = "*", channel = "email", match_type = "exact_email", recipient_pattern, approval_hold_id = null, reason = null, expires_at = null, actor_id = "admin_system" } = {}) {
  const pool = getPool();
  const tenantId = normalizeTenantId(tenant_id);
  const adapterKey = clean(adapter_key || "*", 160) || "*";
  const safeChannel = clean(channel || "email", 64);
  if (!VALID_CHANNELS.has(safeChannel)) {
    const err = new Error("channel must be email or webhook.");
    err.status = 400;
    err.code = "external_delivery_allowlist_channel_invalid";
    throw err;
  }
  const matchType = clean(match_type || "exact_email", 32);
  const pattern = ensureEmailPattern(matchType, recipient_pattern);
  await pool.query(
    `INSERT INTO external_delivery_recipient_allowlist_registry
       (allowlist_id, tenant_id, adapter_key, channel, match_type, recipient_pattern, status, approval_hold_id, created_by, reason, expires_at)
     VALUES
       (UUID(), ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status='active', approval_hold_id=VALUES(approval_hold_id), created_by=VALUES(created_by), reason=VALUES(reason), expires_at=VALUES(expires_at), updated_at=CURRENT_TIMESTAMP`,
    [tenantId, adapterKey, safeChannel, matchType, pattern, approval_hold_id || null, actor_id || "admin_system", reason || null, expires_at || null]
  );
  const [rows] = await pool.query(
    `SELECT allowlist_id, tenant_id, adapter_key, channel, match_type, recipient_pattern, status, expires_at
       FROM external_delivery_recipient_allowlist_registry
      WHERE tenant_id=? AND adapter_key=? AND channel=? AND match_type=? AND recipient_pattern=?
      LIMIT 1`,
    [tenantId, adapterKey, safeChannel, matchType, pattern]
  );
  return { ok: true, mode: "allowlist_upsert", allowlist: rows[0] || null, external_send_performed: false, secret_value_included: false, secrets_included: false };
}

export async function disableExternalDeliveryRecipientAllowlist({ allowlist_id = null, tenant_id = null, adapter_key = null, recipient_pattern = null, reason = null, actor_id = "admin_system" } = {}) {
  const pool = getPool();
  const params = [];
  let where = "1=1";
  if (allowlist_id) { where += " AND allowlist_id = ?"; params.push(clean(allowlist_id, 36)); }
  if (tenant_id) { where += " AND tenant_id = ?"; params.push(normalizeTenantId(tenant_id)); }
  if (adapter_key) { where += " AND adapter_key = ?"; params.push(clean(adapter_key, 160)); }
  if (recipient_pattern) { where += " AND recipient_pattern = ?"; params.push(clean(recipient_pattern, 320).toLowerCase().replace(/^@/, "")); }
  if (!allowlist_id && !recipient_pattern) {
    const err = new Error("allowlist_id or recipient_pattern is required to disable an allowlist row.");
    err.status = 400;
    err.code = "external_delivery_allowlist_disable_target_required";
    throw err;
  }
  const [result] = await pool.query(
    `UPDATE external_delivery_recipient_allowlist_registry
        SET status='disabled', reason=COALESCE(?, reason), updated_at=CURRENT_TIMESTAMP
      WHERE ${where}`,
    [reason || `disabled_by:${actor_id || "admin_system"}`, ...params]
  );
  return { ok: true, mode: "allowlist_disable", affected_rows: result.affectedRows || 0, external_send_performed: false, secret_value_included: false, secrets_included: false };
}

export async function setExternalDeliveryAdapterDispatch({ adapter_key, dispatch_enabled = false, provider_dispatch_enabled = false, reason = null, actor_id = "admin_system" } = {}) {
  const pool = getPool();
  const adapterKey = clean(adapter_key, 160);
  if (!adapterKey) {
    const err = new Error("adapter_key is required.");
    err.status = 400;
    err.code = "external_delivery_adapter_key_required";
    throw err;
  }
  await pool.query(
    `UPDATE external_delivery_provider_adapter_contract_registry
        SET dispatch_enabled=?, provider_dispatch_enabled=?,
            safety_json=JSON_SET(COALESCE(safety_json, JSON_OBJECT()), '$.last_admin_control_update', JSON_OBJECT('actor_id', ?, 'reason', ?, 'dispatch_enabled', ?, 'provider_dispatch_enabled', ?, 'secrets_included', false)),
            updated_at=CURRENT_TIMESTAMP
      WHERE adapter_key=?`,
    [dispatch_enabled ? 1 : 0, provider_dispatch_enabled ? 1 : 0, actor_id || "admin_system", reason || null, Boolean(dispatch_enabled), Boolean(provider_dispatch_enabled), adapterKey]
  );
  const [rows] = await pool.query(
    `SELECT adapter_key, dispatch_enabled, provider_dispatch_enabled, status, updated_at
       FROM external_delivery_provider_adapter_contract_registry
      WHERE adapter_key=? LIMIT 1`,
    [adapterKey]
  );
  return { ok: true, mode: "adapter_dispatch_set", adapter: rows[0] || null, external_send_performed: false, secret_value_included: false, secrets_included: false };
}

export async function revokeGmailUserConnection({ connection_id, reason = null, actor_id = "admin_system" } = {}) {
  const pool = getPool();
  const connectionId = clean(connection_id, 36);
  if (!connectionId) {
    const err = new Error("connection_id is required.");
    err.status = 400;
    err.code = "gmail_connection_revoke_connection_id_required";
    throw err;
  }
  const [result] = await pool.query(
    `UPDATE user_app_connections
        SET status='revoked', validation_status='revoked_by_admin_control',
            account_metadata=JSON_SET(CASE WHEN JSON_VALID(account_metadata) THEN account_metadata ELSE JSON_OBJECT() END, '$.revoked_by', ?, '$.revoke_reason', ?, '$.secrets_included', false)
      WHERE connection_id=? AND (app_key='gmail_user_oauth' OR scopes_granted LIKE '%gmail.send%')`,
    [actor_id || "admin_system", reason || null, connectionId]
  );
  return { ok: true, mode: "gmail_connection_revoke", affected_rows: result.affectedRows || 0, external_send_performed: false, secret_value_included: false, secrets_included: false };
}
