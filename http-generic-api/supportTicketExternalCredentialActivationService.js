import crypto from "node:crypto";
import { getPool } from "./db.js";
import { activateSupportTicketExternalSecretReference } from "./supportTicketExternalSecretIntakeService.js";

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
const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|client_secret|private_key|raw_secret|secret_value|api_key|bearer_token|smtp_password)/i;
const SAFE_SECRET_MARKER_KEYS = new Set(["secrets_included", "secret_value_included"]);

function assertNoRawSecretPayload(value, path = "payload") {
  if (value == null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SAFE_SECRET_MARKER_KEYS.has(String(key))) continue;
    if (SENSITIVE_KEY_PATTERN.test(String(key))) {
      const err = new Error("Raw secret values or secret-bearing fields are not accepted by credential activation.");
      err.status = 400;
      err.code = "support_ticket_external_credential_activation_raw_value_rejected";
      err.path = `${path}.${key}`;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoRawSecretPayload(nested, `${path}.${key}`);
  }
}

function normalizeChannel(channel = "email") {
  const key = String(channel || "email").trim().toLowerCase();
  if (!EXTERNAL_CHANNELS.has(key)) {
    const err = new Error("External credential activation supports email or webhook only.");
    err.status = 400;
    err.code = "support_ticket_external_credential_activation_channel_invalid";
    throw err;
  }
  return key;
}

function normalizeAudience(audience = "admin") {
  const value = String(audience || "admin").trim().toLowerCase();
  if (!ALLOWED_AUDIENCES.has(value)) {
    const err = new Error("Unsupported external credential activation audience.");
    err.status = 400;
    err.code = "support_ticket_external_credential_activation_audience_invalid";
    throw err;
  }
  return value;
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

async function fetchSecretReference(connection, tenant_id, ref_id) {
  const [rows] = await connection.query(
    `SELECT ref_id, tenant_id, owner_type, owner_id, action_key, provider_family, connector_family,
            credential_type, scope_json, consent_status, rotation_status, validation_status,
            status, secret_key, store_type, env_var_name, vault_path, description, created_at, last_validated_at
       FROM secret_references
      WHERE tenant_id = ? AND ref_id = ?
      LIMIT 1`,
    [tenant_id, ref_id]
  );
  const row = rows[0] || null;
  if (!row) return null;
  return { ...row, scope_json: parseJsonObject(row.scope_json, {}), secret_value_included: false, secrets_included: false };
}

async function resolveApprovedIntakeHold(connection, { tenant_id, ticket_id, approval_hold_id, ref_id, channel }) {
  const filters = [
    "ah.tenant_id = ?",
    "twl.ticket_id = ?",
    "ah.status = 'approved'",
    "JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.approval_type')) IN ('external_delivery_credential_intake','external_delivery_credential_binding')",
  ];
  const params = [tenant_id, ticket_id];
  if (approval_hold_id) { filters.push("ah.hold_id = ?"); params.push(approval_hold_id); }
  const [rows] = await connection.query(
    `SELECT ah.hold_id, ah.status, ah.decision_by, ah.decision_note, ah.decided_at,
            JSON_EXTRACT(ah.execution_context_json, '$') AS approval_context_json
       FROM approval_holds ah
       JOIN ticket_workflow_links twl ON twl.approval_hold_id = ah.hold_id AND twl.tenant_id = ah.tenant_id
      WHERE ${filters.join(" AND ")}
      ORDER BY ah.decided_at DESC, ah.created_at DESC
      LIMIT 10`,
    params
  );
  for (const row of rows) {
    const ctx = parseJsonObject(row.approval_context_json, {});
    const ctxCredential = ctx.credential_ref || ctx.ref_id || null;
    const ctxChannel = ctx.channel || null;
    if (ctxCredential && ctxCredential !== ref_id) continue;
    if (ctxChannel && ctxChannel !== channel) continue;
    return { ...row, approval_context_json: ctx, secrets_included: false };
  }
  return null;
}

function buildActivationPlan({ ticket, secret_ref, approved_hold, channel, audience, validation_evidence = {} }) {
  assertNoRawSecretPayload(validation_evidence, "validation_evidence");
  const blockers = [];
  if (!ticket) blockers.push("support_ticket_not_found");
  if (!secret_ref) blockers.push("external_secret_reference_not_found");
  if (secret_ref && secret_ref.status !== "disabled") blockers.push("external_secret_reference_must_be_disabled_before_activation");
  if (secret_ref && secret_ref.validation_status !== "pending_validation") blockers.push("external_secret_reference_must_be_pending_validation_before_activation");
  if (secret_ref && secret_ref.connector_family && secret_ref.connector_family !== channel) blockers.push("external_secret_reference_channel_mismatch");
  if (!approved_hold) blockers.push("external_credential_intake_or_binding_approval_required");
  if (!validation_evidence || Object.keys(validation_evidence).length === 0) blockers.push("external_credential_validation_evidence_required");
  return {
    ready_to_activate_and_bind: blockers.length === 0,
    channel,
    audience,
    ticket_id: ticket?.ticket_id || null,
    tenant_id: ticket?.tenant_id || secret_ref?.tenant_id || null,
    ref_id: secret_ref?.ref_id || null,
    approval_hold_id: approved_hold?.hold_id || null,
    validation_evidence,
    blockers,
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

async function readVerifiedBinding(connection, { tenant_id, ticket_id, ref_id, channel, audience }) {
  const [rows] = await connection.query(
    `SELECT ah.hold_id, ah.status,
            JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.credential_ref')) AS credential_ref,
            JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.channel')) AS channel,
            JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.audience')) AS audience
       FROM approval_holds ah
       JOIN ticket_workflow_links twl ON twl.approval_hold_id = ah.hold_id AND twl.tenant_id = ah.tenant_id
      WHERE ah.tenant_id = ?
        AND twl.ticket_id = ?
        AND twl.relationship = 'external_delivery_credential_binding'
        AND ah.status = 'approved'
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.approval_type')) = 'external_delivery_credential_binding'
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.credential_ref')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.channel')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.audience')) = ?
      ORDER BY ah.decided_at DESC, ah.created_at DESC
      LIMIT 1`,
    [tenant_id, ticket_id, ref_id, channel, audience]
  );
  return rows[0] || null;
}

export async function planSupportTicketExternalCredentialActivation({ tenant_id, ticket_id, ref_id, channel = "email", audience = "admin", approval_hold_id = null, validation_evidence = {} } = {}, options = {}) {
  const externalChannel = normalizeChannel(channel);
  const normalizedAudience = normalizeAudience(audience);
  assertNoRawSecretPayload(validation_evidence, "validation_evidence");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    const secretRef = await fetchSecretReference(connection, tenant_id, ref_id);
    const approvedHold = await resolveApprovedIntakeHold(connection, { tenant_id, ticket_id, approval_hold_id, ref_id, channel: externalChannel });
    const plan = buildActivationPlan({ ticket, secret_ref: secretRef, approved_hold: approvedHold, channel: externalChannel, audience: normalizedAudience, validation_evidence });
    return { ok: true, mode: "dry_run", plan, ticket: ticket ? compactTicket(ticket) : null, secret_reference: secretRef, approved_hold: approvedHold, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function activateAndBindSupportTicketExternalCredential({ tenant_id, ticket_id, ref_id, channel = "email", audience = "admin", approval_hold_id = null, validation_evidence = {}, decision_note = null, mode = "dry_run", actor_id = null, actor_type = "admin" } = {}, options = {}) {
  const externalChannel = normalizeChannel(channel);
  const normalizedAudience = normalizeAudience(audience);
  const runMode = mode === "activate_and_bind" ? "activate_and_bind" : "dry_run";
  assertNoRawSecretPayload(validation_evidence, "validation_evidence");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "activate_and_bind") await connection.beginTransaction();
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    const secretRef = await fetchSecretReference(connection, tenant_id, ref_id);
    const approvedHold = await resolveApprovedIntakeHold(connection, { tenant_id, ticket_id, approval_hold_id, ref_id, channel: externalChannel });
    const plan = buildActivationPlan({ ticket, secret_ref: secretRef, approved_hold: approvedHold, channel: externalChannel, audience: normalizedAudience, validation_evidence });
    if (runMode !== "activate_and_bind") {
      return { ok: true, mode: "dry_run", plan, ticket: ticket ? compactTicket(ticket) : null, secret_reference: secretRef, approved_hold: approvedHold, external_send_performed: false, secret_value_included: false, secrets_included: false };
    }
    if (!plan.ready_to_activate_and_bind) {
      const err = new Error("External credential activation and binding is not ready under approval and validation policy.");
      err.status = 409;
      err.code = "support_ticket_external_credential_activation_not_ready";
      err.plan = plan;
      throw err;
    }
    await activateSupportTicketExternalSecretReference({
      tenant_id,
      ticket_id,
      ref_id,
      approval_hold_id: approvedHold.hold_id,
      validation_evidence,
      decision_note: decision_note || "External credential activated as part of activate-and-bind flow.",
      actor_id,
      actor_type,
    }, { connection });

    const bindingHoldId = crypto.randomUUID();
    const bindingPayload = {
      approval_type: "external_delivery_credential_binding",
      source: "external_credential_activation_flow",
      source_approval_hold_id: approvedHold.hold_id,
      credential_ref: ref_id,
      channel: externalChannel,
      audience: normalizedAudience,
      validation_evidence,
      external_send_performed: false,
      secret_value_included: false,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO approval_holds (hold_id, run_id, tenant_id, hold_type, actor_id, actor_type, request_id, correlation_id, execution_context_json, required_role, status, decision_by, decision_note, decided_at, expires_at)
       VALUES (?, ?, ?, 'supervisor_approval', ?, ?, ?, ?, ?, 'platform_admin', 'approved', ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [bindingHoldId, bindingHoldId, tenant_id, actor_id, actor_type, bindingHoldId, `external_delivery_credential_binding:${ticket_id}:${externalChannel}:${normalizedAudience}`, JSON.stringify(bindingPayload), actor_id, decision_note || "Credential binding approved by activation flow."]
    );
    await connection.query(
      `INSERT INTO ticket_workflow_links (link_id, tenant_id, ticket_id, approval_hold_id, relationship, evidence_json)
       VALUES (UUID(), ?, ?, ?, 'external_delivery_credential_binding', ?)`,
      [tenant_id, ticket_id, bindingHoldId, JSON.stringify(bindingPayload)]
    );
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'external_credential_activated_and_bound', ?, ?, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, ticket.lifecycle_state || null, ticket.lifecycle_state || null, actor_id, actor_type, decision_note || "External credential activated and bound to ticket.", JSON.stringify(bindingPayload)]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_external_credential_activated_and_bound', 'ticket', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify(bindingPayload)]
    );
    const activated = await fetchSecretReference(connection, tenant_id, ref_id);
    const verifiedBinding = await readVerifiedBinding(connection, { tenant_id, ticket_id, ref_id, channel: externalChannel, audience: normalizedAudience });
    if (!activated || activated.status !== "active" || activated.validation_status !== "validated" || !verifiedBinding) {
      const err = new Error("External credential activation readback failed.");
      err.status = 409;
      err.code = "support_ticket_external_credential_activation_readback_failed";
      err.plan = plan;
      throw err;
    }
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "activate_and_bind", ref_id, binding_hold_id: bindingHoldId, status: activated.status, validation_status: activated.validation_status, verified_binding: verifiedBinding, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "activate_and_bind") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
