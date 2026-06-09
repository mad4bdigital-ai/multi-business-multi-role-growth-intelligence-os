import crypto from "node:crypto";
import { getPool } from "./db.js";

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
const ALLOWED_STORE_TYPES = new Set(["env", "vault", "external"]);
const ALLOWED_OWNER_TYPES = new Set(["platform", "tenant", "user", "member", "installation", "device", "service_account"]);
const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|client_secret|private_key|raw_secret|secret_value|api_key|bearer_token|smtp_password)/i;

function normalizeChannel(channel = "email") {
  const key = String(channel || "email").trim().toLowerCase();
  if (!EXTERNAL_CHANNELS.has(key)) {
    const err = new Error("External secret intake supports email or webhook only.");
    err.status = 400;
    err.code = "support_ticket_external_secret_channel_invalid";
    throw err;
  }
  return key;
}

function normalizeStoreType(store_type = "vault") {
  const key = String(store_type || "vault").trim().toLowerCase();
  if (!ALLOWED_STORE_TYPES.has(key)) {
    const err = new Error("External secret intake supports env, vault, or external references only.");
    err.status = 400;
    err.code = "support_ticket_external_secret_store_type_invalid";
    throw err;
  }
  return key;
}

function assertNoRawSecretPayload(value, path = "payload") {
  if (value == null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(String(key))) {
      const err = new Error("Raw secret values or secret-bearing fields are not accepted by this surface.");
      err.status = 400;
      err.code = "support_ticket_external_secret_raw_value_rejected";
      err.path = `${path}.${key}`;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoRawSecretPayload(nested, `${path}.${key}`);
  }
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

function buildReferencePlan({ tenant_id, ticket_id = null, channel, store_type, owner_type = "tenant", owner_id = null, provider_family = null, credential_type = null, env_var_name = null, vault_path = null, external_ref = null, description = null, scope_json = {}, evidence_json = {} }) {
  assertNoRawSecretPayload(scope_json, "scope_json");
  assertNoRawSecretPayload(evidence_json, "evidence_json");
  const normalizedChannel = normalizeChannel(channel);
  const normalizedStoreType = normalizeStoreType(store_type);
  const normalizedOwnerType = ALLOWED_OWNER_TYPES.has(owner_type) ? owner_type : "tenant";
  if (normalizedStoreType === "env" && !env_var_name) {
    const err = new Error("env_var_name is required for env-backed secret references.");
    err.status = 400;
    err.code = "support_ticket_external_secret_env_var_required";
    throw err;
  }
  if (normalizedStoreType === "vault" && !vault_path) {
    const err = new Error("vault_path is required for vault-backed secret references.");
    err.status = 400;
    err.code = "support_ticket_external_secret_vault_path_required";
    throw err;
  }
  if (normalizedStoreType === "external" && !external_ref && !vault_path) {
    const err = new Error("external_ref or vault_path is required for external secret references.");
    err.status = 400;
    err.code = "support_ticket_external_secret_external_ref_required";
    throw err;
  }
  const refId = crypto.randomUUID();
  const provider = provider_family || (normalizedChannel === "email" ? "email_delivery" : "webhook_delivery");
  const credentialType = credential_type || (normalizedChannel === "email" ? "email_delivery_credential" : "webhook_delivery_credential");
  const scope = {
    ...(scope_json || {}),
    ticket_id: ticket_id || null,
    channel: normalizedChannel,
    external_ref: external_ref || null,
    external_send_performed: false,
    secrets_included: false,
  };
  return {
    ref_id: refId,
    tenant_id,
    ticket_id: ticket_id || null,
    channel: normalizedChannel,
    store_type: normalizedStoreType,
    owner_type: normalizedOwnerType,
    owner_id: owner_id || tenant_id,
    action_key: "support_ticket_external_delivery",
    provider_family: provider,
    connector_family: normalizedChannel,
    credential_type: credentialType,
    scope_json: scope,
    consent_status: "pending",
    rotation_status: "pending",
    validation_status: "pending_validation",
    status: "disabled",
    secret_key: `ticket_external_${normalizedChannel}_${refId.replace(/-/g, "").slice(0, 16)}`,
    env_var_name: normalizedStoreType === "env" ? env_var_name : null,
    vault_path: normalizedStoreType === "vault" ? vault_path : (normalizedStoreType === "external" ? (vault_path || external_ref) : null),
    description: description || `External ${normalizedChannel} delivery credential reference pending validation.`,
    evidence_json,
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

export async function planSupportTicketExternalSecretIntake(args = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    let ticket = null;
    if (args.ticket_id && args.tenant_id) ticket = await fetchTicket(connection, args.tenant_id, args.ticket_id);
    const plan = buildReferencePlan(args);
    return { ok: true, mode: "dry_run", plan, ticket: ticket ? compactTicket(ticket) : null, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function registerSupportTicketExternalSecretReference({ mode = "dry_run", actor_id = null, actor_type = "admin", ...args } = {}, options = {}) {
  const runMode = mode === "register" ? "register" : "dry_run";
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "register") await connection.beginTransaction();
    let ticket = null;
    if (args.ticket_id && args.tenant_id) ticket = await fetchTicket(connection, args.tenant_id, args.ticket_id);
    const plan = buildReferencePlan(args);
    if (runMode !== "register") return { ok: true, mode: "dry_run", plan, ticket: ticket ? compactTicket(ticket) : null, external_send_performed: false, secret_value_included: false, secrets_included: false };
    await connection.query(
      `INSERT INTO secret_references (
        ref_id, tenant_id, owner_type, owner_id, action_key, provider_family, connector_family, credential_type,
        scope_json, consent_status, rotation_status, validation_status, status, secret_key, store_type,
        env_var_name, vault_path, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        plan.ref_id, plan.tenant_id, plan.owner_type, plan.owner_id, plan.action_key, plan.provider_family,
        plan.connector_family, plan.credential_type, JSON.stringify(plan.scope_json), plan.consent_status,
        plan.rotation_status, plan.validation_status, plan.status, plan.secret_key, plan.store_type,
        plan.env_var_name, plan.vault_path, plan.description,
      ]
    );
    if (plan.ticket_id) {
      await connection.query(
        `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
         VALUES (UUID(), ?, ?, 'external_secret_reference_registered', NULL, NULL, ?, ?, 'internal_support', ?, ?)`,
        [plan.ticket_id, plan.tenant_id, actor_id, actor_type, plan.description, JSON.stringify({ ref_id: plan.ref_id, status: plan.status, validation_status: plan.validation_status, external_send_performed: false, secret_value_included: false, secrets_included: false })]
      );
    }
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_external_secret_reference_registered', 'secret_reference', ?, ?, 'managed')`,
      [plan.tenant_id, actor_id, actor_type, plan.ref_id, JSON.stringify({ ref_id: plan.ref_id, status: plan.status, validation_status: plan.validation_status, external_send_performed: false, secret_value_included: false, secrets_included: false })]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "register", ref_id: plan.ref_id, status: plan.status, validation_status: plan.validation_status, ticket: ticket ? compactTicket(ticket) : null, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "register") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export async function activateSupportTicketExternalSecretReference({ tenant_id, ticket_id = null, ref_id, approval_hold_id, validation_evidence = {}, decision_note = null, actor_id = null, actor_type = "admin" } = {}, options = {}) {
  assertNoRawSecretPayload(validation_evidence, "validation_evidence");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const [holds] = await connection.query(
      `SELECT * FROM approval_holds
        WHERE tenant_id = ? AND hold_id = ? AND status = 'approved'
          AND JSON_UNQUOTE(JSON_EXTRACT(execution_context_json, '$.approval_type')) IN ('external_delivery_credential_intake','external_delivery_credential_binding')
        LIMIT 1`,
      [tenant_id, approval_hold_id]
    );
    if (!holds[0]) {
      const err = new Error("Approved credential intake or binding hold is required before activating an external secret reference.");
      err.status = 409;
      err.code = "support_ticket_external_secret_activation_approved_hold_required";
      throw err;
    }
    const [rows] = await connection.query("SELECT ref_id, tenant_id, status, validation_status FROM secret_references WHERE tenant_id = ? AND ref_id = ? LIMIT 1", [tenant_id, ref_id]);
    if (!rows[0]) {
      const err = new Error("Secret reference not found.");
      err.status = 404;
      err.code = "support_ticket_external_secret_reference_not_found";
      throw err;
    }
    await connection.query(
      `UPDATE secret_references
          SET status = 'active', consent_status = 'granted', validation_status = 'validated', last_validated_at = NOW(), rotation_status = 'current'
        WHERE tenant_id = ? AND ref_id = ?`,
      [tenant_id, ref_id]
    );
    if (ticket_id) {
      await connection.query(
        `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
         VALUES (UUID(), ?, ?, 'external_secret_reference_activated', NULL, NULL, ?, ?, 'internal_support', ?, ?)`,
        [ticket_id, tenant_id, actor_id, actor_type, decision_note || "External secret reference activated after approved intake/binding hold.", JSON.stringify({ ref_id, approval_hold_id, validation_evidence, external_send_performed: false, secret_value_included: false, secrets_included: false })]
      );
    }
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_external_secret_reference_activated', 'secret_reference', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ref_id, JSON.stringify({ ref_id, approval_hold_id, validation_status: 'validated', external_send_performed: false, secret_value_included: false, secrets_included: false })]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, ref_id, status: "active", validation_status: "validated", external_send_performed: false, secret_value_included: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
