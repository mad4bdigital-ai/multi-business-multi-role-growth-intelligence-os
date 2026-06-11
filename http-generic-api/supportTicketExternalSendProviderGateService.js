import { getPool } from "./db.js";
import { assertPreflightAllowed, evaluateSupportTicketExternalProviderGatePreflight } from "./governedExecutionPreflight.js";
import { resolveSupportTicketExternalProviderAdapterContract } from "./supportTicketExternalProviderContractService.js";
import { planSupportTicketExternalSendExecution } from "./supportTicketExternalSendExecutionService.js";
import { createSupportTicketExternalProviderDispatcher } from "./supportTicketExternalProviderDispatchService.js";

const EXTERNAL_CHANNELS = new Set(["email", "webhook"]);
const ALLOWED_AUDIENCES = new Set(["admin", "customer", "both"]);
const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|client_secret|private_key|raw_secret|secret_value|api_key|bearer_token|smtp_password)/i;
const SAFE_SECRET_MARKER_KEYS = new Set(["secrets_included", "secret_value_included"]);

function assertNoRawSecretPayload(value, path = "payload") {
  if (value == null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SAFE_SECRET_MARKER_KEYS.has(String(key))) continue;
    if (SENSITIVE_KEY_PATTERN.test(String(key))) {
      const err = new Error("Raw secret values or secret-bearing fields are not accepted by provider send gate.");
      err.status = 400;
      err.code = "support_ticket_external_send_provider_gate_raw_value_rejected";
      err.path = `${path}.${key}`;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoRawSecretPayload(nested, `${path}.${key}`);
  }
}

function normalizeChannel(channel = "email") {
  const key = String(channel || "email").trim().toLowerCase();
  if (!EXTERNAL_CHANNELS.has(key)) {
    const err = new Error("External provider send gate supports email or webhook only.");
    err.status = 400;
    err.code = "support_ticket_external_send_provider_gate_channel_invalid";
    throw err;
  }
  return key;
}

function normalizeAudience(audience = "admin") {
  const value = String(audience || "admin").trim().toLowerCase();
  if (!ALLOWED_AUDIENCES.has(value)) {
    const err = new Error("Unsupported external provider send gate audience.");
    err.status = 400;
    err.code = "support_ticket_external_send_provider_gate_audience_invalid";
    throw err;
  }
  return value;
}

function adapterImplementationReady(implementationStatus = "") {
  const status = String(implementationStatus || "").trim().toLowerCase();
  return status === "implemented" || status.startsWith("implemented_") || status === "sandbox_dispatch_enabled" || status === "production_dispatch_enabled";
}

function providerAdapterFromRegistryResolution(resolution) {
  const adapter = resolution.adapter_contract;
  const modePolicy = resolution.send_mode_policy;
  const safety = adapter.safety || {};
  const providerAdapterImplemented = adapterImplementationReady(adapter.implementation_status);
  return {
    provider_key: adapter.adapter_key,
    adapter_key: adapter.adapter_key,
    family_key: adapter.family_key,
    channel: adapter.channel,
    implementation_status: adapter.implementation_status,
    status: adapter.status,
    dispatch_enabled: Boolean(adapter.dispatch_enabled),
    provider_dispatch_enabled: Boolean(adapter.provider_dispatch_enabled),
    provider_adapter_implemented: providerAdapterImplemented,
    external_send_supported: Boolean(safety.external_send_supported && adapter.dispatch_enabled && adapter.provider_dispatch_enabled),
    explicit_send_mode_required: true,
    final_provider_approval_required: Boolean(modePolicy?.final_approval_required ?? true),
    required_credential_type: adapter.required_credential_type || null,
    supported_audiences: adapter.supported_audiences || [],
    send_modes: adapter.send_modes || [],
    mode_policies: adapter.mode_policies || [],
    send_mode_policy: modePolicy,
    send_mode_allowed: Boolean(resolution.send_mode_allowed),
    mode_policy_status: modePolicy?.mode_status || null,
    mode_policy_provider_dispatch_required: Boolean(modePolicy?.provider_dispatch_required),
    source: resolution.source,
    summary: "Provider dispatch is resolved from DB registry contracts and remains blocked unless adapter contract and send-mode policy explicitly enable it.",
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

function buildProviderPlan({ tenant_id = null, ticket_id = null, execution_plan, provider_adapter, send_mode = "dry_run", payload_json = {} }) {
  assertNoRawSecretPayload(payload_json, "payload_json");
  const normalizedSendMode = String(send_mode || "dry_run").trim().toLowerCase();
  const blockers = [];
  if (!execution_plan?.plan?.ready_for_record) blockers.push("external_send_execution_plan_not_ready");
  if (!provider_adapter.send_mode_allowed) blockers.push("external_send_provider_mode_invalid");
  if (!provider_adapter.dispatch_enabled) blockers.push("external_send_provider_adapter_dispatch_not_enabled");
  if (!provider_adapter.provider_dispatch_enabled) blockers.push("external_send_provider_dispatch_not_enabled");
  if (!provider_adapter.provider_adapter_implemented) blockers.push("external_send_provider_adapter_not_implemented");
  if (provider_adapter.send_mode_policy && provider_adapter.send_mode_policy.status !== "active") blockers.push("external_send_provider_mode_policy_not_active");
  if (provider_adapter.mode_policy_provider_dispatch_required && !provider_adapter.provider_dispatch_enabled) blockers.push("external_send_provider_mode_requires_disabled_dispatch");
  return {
    tenant_id,
    ticket_id,
    ready_for_provider_dispatch: blockers.length === 0,
    send_mode: normalizedSendMode,
    channel: provider_adapter.channel,
    audience: execution_plan?.plan?.audience || null,
    approval_hold_id: execution_plan?.plan?.approval_hold_id || null,
    credential_ref: execution_plan?.plan?.credential_ref || null,
    execution_ready_for_record: Boolean(execution_plan?.plan?.ready_for_record),
    rate_limit: execution_plan?.plan?.rate_limit || null,
    retry_policy: execution_plan?.plan?.retry_policy || null,
    provider_adapter,
    blockers,
    payload_json: { ...(payload_json || {}), external_send_performed: false, secrets_included: false },
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT ticket_id, tenant_id, status, lifecycle_state, customer_status, title FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

async function resolveProviderAdapter(connection, { channel, provider_key, send_mode }) {
  const resolution = await resolveSupportTicketExternalProviderAdapterContract({ provider_key, channel, send_mode }, { connection });
  return providerAdapterFromRegistryResolution(resolution);
}

function normalizeRecipientEmail(payload_json = {}) {
  return String(payload_json.to || payload_json.recipient_email || payload_json.email_to || "").trim().toLowerCase();
}

async function recipientAllowlistAllowed(connection, { tenant_id, adapter_key, channel, payload_json = {} } = {}) {
  const recipient = normalizeRecipientEmail(payload_json);
  if (!recipient) return false;
  const [rows] = await connection.query(
    `SELECT allowlist_id, match_type, recipient_pattern
       FROM external_delivery_recipient_allowlist_registry
      WHERE status = 'active'
        AND channel = ?
        AND tenant_id IN (?, '00000000-0000-0000-0000-000000000000', '*')
        AND adapter_key IN (?, '*')
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      LIMIT 200`,
    [channel, tenant_id, adapter_key]
  );
  return (rows || []).some((row) => {
    const pattern = String(row.recipient_pattern || "").trim().toLowerCase();
    if (!pattern) return false;
    if (row.match_type === "exact_email") return recipient === pattern;
    if (row.match_type === "domain") return recipient.endsWith(`@${pattern.replace(/^@/, "")}`);
    if (row.match_type === "wildcard_domain") return recipient.endsWith(`.${pattern.replace(/^\*\.?/, "")}`) || recipient.endsWith(`@${pattern.replace(/^\*\.?/, "")}`);
    return false;
  });
}

export async function planSupportTicketExternalSendProviderGate({ tenant_id, ticket_id, channel = "email", audience = "admin", approval_hold_id = null, credential_ref = null, provider_key = null, send_mode = "dry_run", subject = null, body = null, payload_json = {} } = {}, options = {}) {
  const externalChannel = normalizeChannel(channel);
  const normalizedAudience = normalizeAudience(audience);
  assertNoRawSecretPayload(payload_json, "payload_json");
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
    const executionPlan = await planSupportTicketExternalSendExecution({ tenant_id, ticket_id, channel: externalChannel, audience: normalizedAudience, approval_hold_id, credential_ref, subject, body, payload_json }, { connection });
    const providerAdapter = await resolveProviderAdapter(connection, { channel: externalChannel, provider_key, send_mode });
    const providerPolicyPreflight = await evaluateSupportTicketExternalProviderGatePreflight({ channel: externalChannel, send_mode, provider_adapter: providerAdapter }, { connection });
    assertPreflightAllowed(providerPolicyPreflight);
    const provider_plan = buildProviderPlan({ tenant_id, ticket_id, execution_plan: executionPlan, provider_adapter: providerAdapter, send_mode, payload_json });
    return { ok: true, mode: "dry_run", provider_plan: { ...provider_plan, policy_preflight: providerPolicyPreflight }, execution_plan: executionPlan, ticket, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function recordSupportTicketExternalSendProviderGateAttempt({ tenant_id, ticket_id, channel = "email", audience = "admin", approval_hold_id = null, credential_ref = null, provider_key = null, send_mode = "dry_run", mode = "dry_run", subject = null, body = null, payload_json = {}, actor_id = null, actor_type = "admin" } = {}, options = {}) {
  const externalChannel = normalizeChannel(channel);
  const normalizedAudience = normalizeAudience(audience);
  assertNoRawSecretPayload(payload_json, "payload_json");
  const normalizedMode = String(mode || "dry_run").trim().toLowerCase();
  const runMode = normalizedMode === "live_send" ? "live_send" : (normalizedMode === "record_blocked_attempt" ? "record_blocked_attempt" : "dry_run");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "record_blocked_attempt") await connection.beginTransaction();
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const executionPlan = await planSupportTicketExternalSendExecution({ tenant_id, ticket_id, channel: externalChannel, audience: normalizedAudience, approval_hold_id, credential_ref, subject, body, payload_json }, { connection });
    const providerAdapter = await resolveProviderAdapter(connection, { channel: externalChannel, provider_key, send_mode });
    const providerPolicyPreflight = await evaluateSupportTicketExternalProviderGatePreflight({ channel: externalChannel, send_mode, provider_adapter: providerAdapter }, { connection });
    assertPreflightAllowed(providerPolicyPreflight);
    const provider_plan = { ...buildProviderPlan({ tenant_id, ticket_id, execution_plan: executionPlan, provider_adapter: providerAdapter, send_mode, payload_json }), policy_preflight: providerPolicyPreflight };
    if (runMode === "live_send") {
      const idempotencyKey = provider_plan.payload_json?.idempotency_key || payload_json?.idempotency_key || null;
      if (idempotencyKey) {
        const [existingEvents] = await connection.query(
          `SELECT event_id, created_at
             FROM ticket_lifecycle_events
            WHERE tenant_id = ?
              AND ticket_id = ?
              AND event_type = 'external_send_provider_dispatch_succeeded'
              AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.idempotency_key')) = ?
            ORDER BY created_at DESC
            LIMIT 1`,
          [tenant_id, ticket_id, idempotencyKey]
        );
        if (existingEvents[0]) {
          return { ok: true, mode: "live_send", delivery_status: "idempotent_replay_not_resent", existing_event_id: existingEvents[0].event_id, provider_plan, ticket, external_send_performed: false, secret_value_included: false, secrets_included: false };
        }
      }
      const dispatcher = createSupportTicketExternalProviderDispatcher({ adapter: provider_plan.provider_adapter || {} });
      const dispatchResult = await dispatcher.send(provider_plan, { connection });
      const eventPayload = {
        provider_plan: { ...provider_plan, payload_json: { ...(provider_plan.payload_json || {}), body: undefined, body_text: undefined, body_html: undefined } },
        provider_result: dispatchResult,
        delivery_status: "provider_dispatch_succeeded",
        idempotency_key: idempotencyKey,
        external_send_performed: true,
        secret_value_included: false,
        secrets_included: false,
      };
      await connection.query(
        `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
         VALUES (UUID(), ?, ?, 'external_send_provider_dispatch_succeeded', ?, ?, ?, ?, 'internal_support', ?, ?)`,
        [ticket_id, tenant_id, ticket.lifecycle_state || null, ticket.lifecycle_state || null, actor_id, actor_type, subject || "External provider dispatch succeeded.", JSON.stringify(eventPayload)]
      );
      await connection.query(
        `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
         VALUES (UUID(), ?, ?, ?, 'support_ticket_external_send_provider_dispatch_succeeded', 'ticket', ?, ?, 'managed')`,
        [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify(eventPayload)]
      );
      return { ok: true, mode: "live_send", delivery_status: "provider_dispatch_succeeded", provider_result: dispatchResult, provider_plan, ticket, external_send_performed: true, secret_value_included: false, secrets_included: false };
    }
    if (provider_plan.ready_for_provider_dispatch) {
      const err = new Error("Provider dispatch is ready but live_send mode was not requested.");
      err.status = 409;
      err.code = "support_ticket_external_send_provider_dispatch_requires_live_send_mode";
      err.provider_plan = provider_plan;
      throw err;
    }
    if (runMode !== "record_blocked_attempt") {
      return { ok: true, mode: "dry_run", provider_plan, execution_plan: executionPlan, ticket, external_send_performed: false, secret_value_included: false, secrets_included: false };
    }
    const eventPayload = {
      provider_plan,
      execution_ready_for_record: Boolean(executionPlan?.plan?.ready_for_record),
      delivery_status: "provider_dispatch_blocked_not_sent",
      external_send_performed: false,
      secret_value_included: false,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'external_send_provider_gate_recorded', ?, ?, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, ticket.lifecycle_state || null, ticket.lifecycle_state || null, actor_id, actor_type, subject || "External provider send gate blocked; no external send performed.", JSON.stringify(eventPayload)]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_external_send_provider_gate_recorded', 'ticket', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify(eventPayload)]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "record_blocked_attempt", delivery_status: "provider_dispatch_blocked_not_sent", provider_plan, ticket, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "record_blocked_attempt") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
