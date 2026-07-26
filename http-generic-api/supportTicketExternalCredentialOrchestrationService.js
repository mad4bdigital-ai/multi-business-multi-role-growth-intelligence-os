import { getPool } from "./db.js";
import { activateAndBindSupportTicketExternalCredential } from "./supportTicketExternalCredentialActivationService.js";
import { checkSupportTicketExternalDeliveryReadiness } from "./supportTicketExternalDeliveryPolicyService.js";

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
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
      const err = new Error("Raw secret values or secret-bearing fields are not accepted by credential orchestration.");
      err.status = 400;
      err.code = "support_ticket_external_credential_orchestration_raw_value_rejected";
      err.path = `${path}.${key}`;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoRawSecretPayload(nested, `${path}.${key}`);
  }
}

function normalizeChannel(channel = "email") {
  const key = String(channel || "email").trim().toLowerCase();
  if (!EXTERNAL_CHANNELS.has(key)) {
    const err = new Error("External credential orchestration supports email or webhook only.");
    err.status = 400;
    err.code = "support_ticket_external_credential_orchestration_channel_invalid";
    throw err;
  }
  return key;
}

function normalizeAudience(audience = "admin") {
  const value = String(audience || "admin").trim().toLowerCase();
  if (!ALLOWED_AUDIENCES.has(value)) {
    const err = new Error("Unsupported external credential orchestration audience.");
    err.status = 400;
    err.code = "support_ticket_external_credential_orchestration_audience_invalid";
    throw err;
  }
  return value;
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT ticket_id, tenant_id, status, lifecycle_state, customer_status, title FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

async function fetchHold(connection, { tenant_id, ticket_id, approval_hold_id }) {
  const [rows] = await connection.query(
    `SELECT ah.hold_id, ah.tenant_id, ah.status, ah.hold_type, ah.decision_by, ah.decision_note, ah.decided_at,
            JSON_EXTRACT(ah.execution_context_json, '$') AS execution_context_json
       FROM approval_holds ah
       JOIN ticket_workflow_links twl ON twl.approval_hold_id = ah.hold_id AND twl.tenant_id = ah.tenant_id
      WHERE ah.tenant_id = ?
        AND twl.ticket_id = ?
        AND ah.hold_id = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.approval_type')) IN ('external_delivery_credential_intake','external_delivery_credential_binding')
      LIMIT 1`,
    [tenant_id, ticket_id, approval_hold_id]
  );
  const hold = rows[0] || null;
  if (!hold) return null;
  return { ...hold, execution_context_json: parseJsonObject(hold.execution_context_json, {}), secrets_included: false };
}

function buildOrchestrationPlan({ ticket, hold, ref_id, channel, audience, validation_evidence = {}, approve_first = true }) {
  assertNoRawSecretPayload(validation_evidence, "validation_evidence");
  const blockers = [];
  if (!ticket) blockers.push("support_ticket_not_found");
  if (!ref_id) blockers.push("external_secret_reference_required");
  if (!hold) blockers.push("external_credential_intake_or_binding_hold_not_found");
  if (hold && hold.status !== "open" && hold.status !== "approved") blockers.push("external_credential_intake_or_binding_hold_not_open_or_approved");
  if (hold && hold.status === "open" && !approve_first) blockers.push("external_credential_intake_or_binding_hold_approval_required");
  if (!validation_evidence || Object.keys(validation_evidence).length === 0) blockers.push("external_credential_validation_evidence_required");
  const holdRef = hold?.execution_context_json?.credential_ref || hold?.execution_context_json?.ref_id || null;
  const holdChannel = hold?.execution_context_json?.channel || null;
  if (holdRef && holdRef !== ref_id) blockers.push("external_credential_hold_ref_mismatch");
  if (holdChannel && holdChannel !== channel) blockers.push("external_credential_hold_channel_mismatch");
  return {
    ready_to_orchestrate: blockers.length === 0,
    approve_first: Boolean(approve_first),
    would_approve_hold: Boolean(hold && hold.status === "open" && approve_first),
    channel,
    audience,
    ticket_id: ticket?.ticket_id || null,
    tenant_id: ticket?.tenant_id || hold?.tenant_id || null,
    ref_id: ref_id || null,
    approval_hold_id: hold?.hold_id || null,
    hold_status: hold?.status || null,
    validation_evidence,
    blockers,
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

export async function planSupportTicketExternalCredentialOrchestration({ tenant_id, ticket_id, ref_id, approval_hold_id, channel = "email", audience = "admin", approve_first = true, validation_evidence = {} } = {}, options = {}) {
  const externalChannel = normalizeChannel(channel);
  const normalizedAudience = normalizeAudience(audience);
  assertNoRawSecretPayload(validation_evidence, "validation_evidence");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    const hold = approval_hold_id ? await fetchHold(connection, { tenant_id, ticket_id, approval_hold_id }) : null;
    const orchestration_plan = buildOrchestrationPlan({ ticket, hold, ref_id, channel: externalChannel, audience: normalizedAudience, validation_evidence, approve_first });
    const activation_dry_run = orchestration_plan.ready_to_orchestrate
      ? await activateAndBindSupportTicketExternalCredential({ tenant_id, ticket_id, ref_id, channel: externalChannel, audience: normalizedAudience, approval_hold_id, validation_evidence, mode: "dry_run" }, { connection })
      : null;
    return { ok: true, mode: "dry_run", orchestration_plan, activation_dry_run, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function approveActivateBindAndVerifySupportTicketExternalCredential({ tenant_id, ticket_id, ref_id, approval_hold_id, channel = "email", audience = "admin", approve_first = true, validation_evidence = {}, decision_note = null, mode = "dry_run", actor_id = null, actor_type = "admin" } = {}, options = {}) {
  const externalChannel = normalizeChannel(channel);
  const normalizedAudience = normalizeAudience(audience);
  const runMode = mode === "approve_activate_bind_verify" ? "approve_activate_bind_verify" : "dry_run";
  assertNoRawSecretPayload(validation_evidence, "validation_evidence");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "approve_activate_bind_verify") await connection.beginTransaction();
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    const hold = approval_hold_id ? await fetchHold(connection, { tenant_id, ticket_id, approval_hold_id }) : null;
    const orchestration_plan = buildOrchestrationPlan({ ticket, hold, ref_id, channel: externalChannel, audience: normalizedAudience, validation_evidence, approve_first });
    if (runMode !== "approve_activate_bind_verify") {
      return { ok: true, mode: "dry_run", orchestration_plan, external_send_performed: false, secret_value_included: false, secrets_included: false };
    }
    if (!orchestration_plan.ready_to_orchestrate) {
      const err = new Error("External credential orchestration is not ready under approval and validation policy.");
      err.status = 409;
      err.code = "support_ticket_external_credential_orchestration_not_ready";
      err.plan = orchestration_plan;
      throw err;
    }
    if (hold.status === "open") {
      await connection.query(
        "UPDATE approval_holds SET status = 'approved', decision_by = ?, decision_note = ?, decided_at = NOW() WHERE tenant_id = ? AND hold_id = ? AND status = 'open'",
        [actor_id, decision_note || "Credential intake/binding hold approved by orchestration flow.", tenant_id, approval_hold_id]
      );
    }
    const activation = await activateAndBindSupportTicketExternalCredential({
      tenant_id,
      ticket_id,
      ref_id,
      channel: externalChannel,
      audience: normalizedAudience,
      approval_hold_id,
      validation_evidence,
      decision_note: decision_note || "Credential activated and bound by orchestration flow.",
      mode: "activate_and_bind",
      actor_id,
      actor_type,
    }, { connection });
    const readiness_by_ref = await checkSupportTicketExternalDeliveryReadiness({ tenant_id, ticket_id, channel: externalChannel, audience: normalizedAudience, credential_ref: ref_id }, { connection });
    const readiness_by_binding = await checkSupportTicketExternalDeliveryReadiness({ tenant_id, ticket_id, channel: externalChannel, audience: normalizedAudience }, { connection });
    const verified = Boolean(activation?.ok && readiness_by_ref?.ready && readiness_by_binding?.ready);
    if (!verified) {
      const err = new Error("External credential orchestration readback failed.");
      err.status = 409;
      err.code = "support_ticket_external_credential_orchestration_readback_failed";
      err.activation = activation;
      err.readiness_by_ref = readiness_by_ref;
      err.readiness_by_binding = readiness_by_binding;
      throw err;
    }
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'external_credential_orchestration_verified', ?, ?, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, ticket.status || null, ticket.status || null, actor_id, actor_type, decision_note || "External credential orchestration verified readiness.", JSON.stringify({ ref_id, approval_hold_id, channel: externalChannel, audience: normalizedAudience, readiness_by_ref: readiness_by_ref.ready, readiness_by_binding: readiness_by_binding.ready, external_send_performed: false, secret_value_included: false, secrets_included: false })]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "approve_activate_bind_verify", activation, readiness_by_ref, readiness_by_binding, verified, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "approve_activate_bind_verify") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
