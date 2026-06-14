import crypto from "node:crypto";
import { getPool } from "./db.js";
import { createAgentHandoffState } from "./agentGovernanceRuntime.js";

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function compactTicket(row = {}) {
  return {
    ticket_id: row.ticket_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id || null,
    title: row.title,
    ticket_type: row.ticket_type || null,
    category: row.category,
    priority: row.priority,
    severity: row.severity || null,
    status: row.status,
    lifecycle_state: row.lifecycle_state || null,
    customer_status: row.customer_status || null,
    queue_key: row.queue_key || null,
    assignment_status: row.assignment_status || null,
    assigned_to: row.assigned_to || null,
    service_mode: row.service_mode || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata_json: parseJsonObject(row.metadata_json, null),
    secrets_included: false,
  };
}

const EXTERNAL_CHANNELS = new Set(["email", "webhook"]);
const ALLOWED_AUDIENCES = new Set(["admin", "customer", "both"]);
const VALID_EXTERNAL_SECRET_VALIDATION_STATUSES = new Set(["valid", "validated", "ready", "passed"]);
const VALID_EXTERNAL_SECRET_CONSENT_STATUSES = new Set(["not_required", "granted"]);
const DEFAULT_ADMIN_GPT_REPAIR_LINK_BASE_URL = "https://chatgpt.com/g/g-69c82c73bd6081918c52e38525b2d154-growth-intelligence-platform-admin-assistant/";
const DEFAULT_ADMIN_GPT_AGENT_NAME = "admin_gpt_assistant";

async function resolveAdminGptRepairLinkBaseUrl(connection) {
  const envValue = String(process.env.ADMIN_GPT_REPAIR_LINK_BASE_URL || process.env.ADMIN_GPT_URL || "").trim();
  if (envValue) return envValue;
  try {
    const [rows] = await connection.query(
      `SELECT config_json
         FROM platform_runtime_config
        WHERE config_key = 'support_ticket.admin_gpt_repair_link'
          AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1`
    );
    const config = parseJsonObject(rows?.[0]?.config_json, {});
    const configured = String(config?.base_url || config?.admin_gpt_url || "").trim();
    if (configured) return configured;
  } catch {
    // Keep approval creation resilient; the link is a support additive, not a gate.
  }
  return DEFAULT_ADMIN_GPT_REPAIR_LINK_BASE_URL;
}

async function resolveAdminGptTargetAgentId(connection) {
  const [rows] = await connection.query(
    `SELECT agent_id
       FROM agents
      WHERE name = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1`,
    [DEFAULT_ADMIN_GPT_AGENT_NAME]
  );
  return rows?.[0]?.agent_id || null;
}

function buildAdminGptRepairPromptState({ tenant_id, ticket_id, approval_hold_id, channel, audience, credential_ref, action = "review_external_delivery" } = {}) {
  return {
    action,
    tenant_id,
    ticket_id,
    approval_hold_id,
    channel,
    audience,
    credential_ref: credential_ref || null,
    resume_hint: "ابدأ من هذه الحالة: اقرأ التذكرة، افحص readiness، راجع approval hold، ثم اقترح أو نفذ الإصلاح الآمن بدون كشف أسرار.",
    required_checks: ["support_ticket_admin_get", "support_ticket_external_delivery_readiness", "support_ticket_external_send_provider_gate_plan"],
    external_send_performed: false,
    secrets_included: false,
  };
}

async function buildAdminGptRepairLink(connection, resumeStateId, requestedAction = "review_external_delivery") {
  const baseUrl = await resolveAdminGptRepairLinkBaseUrl(connection);
  const prompt = [
    "ابدأ إصلاح Support Ticket من governed handoff state.",
    "اقرأ resume_state_id من المنصة ولا تطلب من المستخدم إعادة شرح السياق.",
    `resume_state_id=${resumeStateId}`,
    `requested_action=${requestedAction}`,
  ].join("\n");
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}prompt=${encodeURIComponent(prompt)}`;
}

function normalizeExternalChannel(channel = "email") {
  const key = String(channel || "email").trim().toLowerCase();
  if (!EXTERNAL_CHANNELS.has(key)) {
    const err = new Error("External delivery approval supports email or webhook only.");
    err.status = 400;
    err.code = "support_ticket_external_delivery_channel_invalid";
    throw err;
  }
  return key;
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

async function lookupCredentialByRef(connection, { tenant_id, credential_ref }) {
  if (!credential_ref) return null;
  const normalizedRef = String(credential_ref || "").trim();
  if (normalizedRef.startsWith("user_app_connection:")) {
    const connectionId = normalizedRef.slice("user_app_connection:".length);
    const [connectionRows] = await connection.query(
      `SELECT connection_id AS credential_ref, tenant_id, 'user_app_connections' AS provider,
              app_key AS label, status, connected_at AS created_at, 'granted' AS consent_status,
              validation_status, 'user_oauth' AS owner_type, 'encrypted_user_app_connection' AS store_type,
              scopes_granted
         FROM user_app_connections
        WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000')
          AND connection_id = ?
          AND status = 'active'
          AND auth_type = 'oauth2'
          AND scopes_granted LIKE '%gmail.send%'
        ORDER BY tenant_id = ? DESC, connected_at DESC
        LIMIT 1`,
      [tenant_id, connectionId, tenant_id]
    );
    if (connectionRows[0]) return { source_table: "user_app_connections", ...connectionRows[0], credential_ref: normalizedRef, secret_value_included: false };
  }
  const [secretRows] = await connection.query(
    `SELECT ref_id AS credential_ref, tenant_id, provider_family AS provider, credential_type AS label,
            status, created_at, consent_status, validation_status, owner_type, store_type
       FROM secret_references
      WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000')
        AND ref_id = ?
        AND status = 'active'
        AND validation_status IN ('valid','validated','ready','passed')
        AND consent_status IN ('not_required','granted')
      ORDER BY tenant_id = ? DESC, created_at DESC
      LIMIT 1`,
    [tenant_id, credential_ref, tenant_id]
  );
  if (secretRows[0]) return { source_table: "secret_references", ...secretRows[0], secret_value_included: false };
  const [apiRows] = await connection.query(
    `SELECT credential_id AS credential_ref, tenant_id, 'api_credentials' AS provider, label,
            status, created_at, NULL AS consent_status, NULL AS validation_status, 'api_credential' AS owner_type, NULL AS store_type
       FROM api_credentials
      WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000')
        AND credential_id = ?
        AND status = 'active'
      ORDER BY tenant_id = ? DESC, created_at DESC
      LIMIT 1`,
    [tenant_id, credential_ref, tenant_id]
  );
  if (apiRows[0]) return { source_table: "api_credentials", ...apiRows[0], secret_value_included: false };
  return null;
}

async function findApprovedCredentialBinding(connection, { tenant_id, ticket_id, channel, audience }) {
  const [rows] = await connection.query(
    `SELECT ah.hold_id,
            JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.credential_ref')) AS credential_ref,
            JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.channel')) AS channel,
            JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.audience')) AS audience,
            ah.decided_at
       FROM approval_holds ah
       JOIN ticket_workflow_links twl ON twl.approval_hold_id = ah.hold_id AND twl.tenant_id = ah.tenant_id
      WHERE ah.tenant_id = ?
        AND twl.ticket_id = ?
        AND twl.relationship = 'external_delivery_credential_binding'
        AND ah.status = 'approved'
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.approval_type')) = 'external_delivery_credential_binding'
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.channel')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.audience')) = ?
      ORDER BY ah.decided_at DESC, ah.created_at DESC
      LIMIT 1`,
    [tenant_id, ticket_id, channel, audience]
  );
  return rows[0] || null;
}

async function findCredentialBinding(connection, { tenant_id, ticket_id, channel, audience = "admin", credential_ref = null }) {
  if (credential_ref) return lookupCredentialByRef(connection, { tenant_id, credential_ref });
  const approvedBinding = await findApprovedCredentialBinding(connection, { tenant_id, ticket_id, channel, audience });
  if (approvedBinding?.credential_ref) {
    const resolved = await lookupCredentialByRef(connection, { tenant_id, credential_ref: approvedBinding.credential_ref });
    if (resolved) return { ...resolved, binding_hold_id: approvedBinding.hold_id, binding_source: "approved_ticket_binding" };
  }
  const providerLike = channel === "email" ? "%mail%" : "%webhook%";
  const [secretRows] = await connection.query(
    `SELECT ref_id AS credential_ref, tenant_id, provider_family AS provider, credential_type AS label,
            status, created_at, consent_status, validation_status, owner_type, store_type
       FROM secret_references
      WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000')
        AND status = 'active'
        AND validation_status IN ('valid','validated','ready','passed')
        AND consent_status IN ('not_required','granted')
        AND (provider_family LIKE ? OR credential_type LIKE ? OR description LIKE ?)
      ORDER BY tenant_id = ? DESC, created_at DESC
      LIMIT 1`,
    [tenant_id, providerLike, providerLike, providerLike, tenant_id]
  );
  if (secretRows[0]) return { source_table: "secret_references", ...secretRows[0], secret_value_included: false };
  const [apiRows] = await connection.query(
    `SELECT credential_id AS credential_ref, tenant_id, 'api_credentials' AS provider, label,
            status, created_at, NULL AS consent_status, NULL AS validation_status, 'api_credential' AS owner_type, NULL AS store_type
       FROM api_credentials
      WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000')
        AND status = 'active'
        AND (label LIKE ? OR scopes LIKE ?)
      ORDER BY tenant_id = ? DESC, created_at DESC
      LIMIT 1`,
    [tenant_id, providerLike, providerLike, tenant_id]
  );
  if (apiRows[0]) return { source_table: "api_credentials", ...apiRows[0], secret_value_included: false };
  return null;
}

export async function checkSupportTicketExternalDeliveryReadiness({ tenant_id, ticket_id, channel = "email", audience = "admin", credential_ref = null } = {}, options = {}) {
  const externalChannel = normalizeExternalChannel(channel);
  if (!ALLOWED_AUDIENCES.has(String(audience || "admin"))) {
    const err = new Error("Unsupported support ticket external delivery audience.");
    err.status = 400;
    err.code = "support_ticket_external_delivery_audience_invalid";
    throw err;
  }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const credential = await findCredentialBinding(connection, { tenant_id, ticket_id, channel: externalChannel, audience, credential_ref });
    const ready = Boolean(credential);
    return {
      ok: true,
      mode: "external_delivery_readiness",
      ready,
      channel: externalChannel,
      audience,
      credential_binding_present: ready,
      credential: credential ? { credential_ref: credential.credential_ref, tenant_id: credential.tenant_id, provider: credential.provider, label: credential.label, status: credential.status, source_table: credential.source_table, secret_value_included: false } : null,
      blockers: ready ? [] : ["external_delivery_credential_binding_missing"],
      external_send_performed: false,
      ticket: compactTicket(ticket),
      secrets_included: false,
    };
  } finally { if (ownsConnection) connection.release(); }
}

export async function requestSupportTicketExternalDeliveryApproval({ tenant_id, ticket_id, channel = "email", audience = "admin", credential_ref = null, preview_subject = null, preview_body = null, reason = null, actor_id = null, actor_type = "admin", evidence_json = {} } = {}, options = {}) {
  const externalChannel = normalizeExternalChannel(channel);
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const readiness = await checkSupportTicketExternalDeliveryReadiness({ tenant_id, ticket_id, channel: externalChannel, audience, credential_ref }, { connection });
    const holdId = crypto.randomUUID();
    const resolvedCredentialRef = credential_ref || readiness.credential?.credential_ref || null;
    const repairPromptState = buildAdminGptRepairPromptState({
      tenant_id,
      ticket_id,
      approval_hold_id: holdId,
      channel: externalChannel,
      audience,
      credential_ref: resolvedCredentialRef,
      action: "review_external_delivery",
    });
    const adminGptRepairLink = await buildAdminGptRepairLink(connection, repairPromptState);
    const payload = {
      approval_type: "external_notification_delivery",
      channel: externalChannel,
      audience,
      credential_ref: resolvedCredentialRef,
      credential_binding_present: readiness.credential_binding_present,
      preview_subject,
      preview_body,
      reason,
      evidence_json,
      admin_gpt_repair_link: adminGptRepairLink,
      admin_gpt_repair_prompt_state: repairPromptState,
      external_send_performed: false,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO approval_holds (hold_id, run_id, tenant_id, hold_type, actor_id, actor_type, request_id, correlation_id, execution_context_json, required_role, status, expires_at)
       VALUES (?, ?, ?, 'supervisor_approval', ?, ?, ?, ?, ?, 'platform_admin', 'open', DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [holdId, holdId, tenant_id, actor_id, actor_type, holdId, `external_delivery:${ticket_id}:${externalChannel}`, JSON.stringify(payload)]
    );
    await connection.query(
      `INSERT INTO ticket_workflow_links (link_id, tenant_id, ticket_id, approval_hold_id, relationship, evidence_json)
       VALUES (UUID(), ?, ?, ?, 'external_notification_delivery_approval', ?)`,
      [tenant_id, ticket_id, holdId, JSON.stringify(payload)]
    );
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'external_delivery_approval_requested', NULL, NULL, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, actor_id, actor_type, reason || "External notification delivery approval requested.", JSON.stringify(payload)]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, approval_hold_id: holdId, status: "open", readiness, external_send_performed: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export async function decideSupportTicketExternalDeliveryApproval({ tenant_id, ticket_id, approval_hold_id, decision, decision_note = null, actor_id = null, actor_type = "admin" } = {}, options = {}) {
  const normalized = String(decision || "").trim().toLowerCase();
  if (!["approved", "rejected"].includes(normalized)) {
    const err = new Error("External delivery approval decision must be approved or rejected.");
    err.status = 400;
    err.code = "support_ticket_external_delivery_decision_invalid";
    throw err;
  }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const [holds] = await connection.query("SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(execution_context_json, '$.approval_type')) = 'external_notification_delivery' LIMIT 1", [tenant_id, approval_hold_id]);
    const hold = holds[0];
    if (!hold) {
      const err = new Error("External delivery approval hold not found.");
      err.status = 404;
      err.code = "support_ticket_external_delivery_hold_not_found";
      throw err;
    }
    if (hold.status !== "open") {
      const err = new Error("External delivery approval hold is not open.");
      err.status = 409;
      err.code = "support_ticket_external_delivery_hold_not_open";
      throw err;
    }
    await connection.query(
      "UPDATE approval_holds SET status = ?, decision_by = ?, decision_note = ?, decided_at = NOW() WHERE tenant_id = ? AND hold_id = ?",
      [normalized, actor_id, decision_note, tenant_id, approval_hold_id]
    );
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'external_delivery_approval_decided', NULL, NULL, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, actor_id, actor_type, decision_note || `External delivery approval ${normalized}.`, JSON.stringify({ approval_hold_id, decision: normalized, external_send_performed: false, secrets_included: false })]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, approval_hold_id, decision: normalized, external_send_performed: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
