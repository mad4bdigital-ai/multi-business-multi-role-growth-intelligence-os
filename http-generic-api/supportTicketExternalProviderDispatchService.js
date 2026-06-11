import crypto from "node:crypto";
import { checkSupportTicketLiveSendReadiness, executeSupportTicketLiveSend } from "./supportTicketExternalLiveSendService.js";

const ALLOWED_DISPATCH_MODES = new Set(["dry_run", "record_only", "provider_send_blocked", "sandbox", "live_send"]);
const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|client_secret|private_key|raw_secret|secret_value|api_key|bearer_token|smtp_password|authorization)/i;
const SAFE_SECRET_MARKER_KEYS = new Set(["secrets_included", "secret_value_included"]);

function assertNoRawSecretPayload(value, path = "payload") {
  if (value == null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SAFE_SECRET_MARKER_KEYS.has(String(key))) continue;
    if (SENSITIVE_KEY_PATTERN.test(String(key))) {
      const err = new Error("Raw secret values or secret-bearing fields are not accepted by external provider dispatch.");
      err.status = 400;
      err.code = "support_ticket_external_provider_dispatch_raw_value_rejected";
      err.path = `${path}.${key}`;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoRawSecretPayload(nested, `${path}.${key}`);
  }
}

function normalizeDispatchMode(mode = "dry_run") {
  const normalized = String(mode || "dry_run").trim().toLowerCase();
  if (!ALLOWED_DISPATCH_MODES.has(normalized)) {
    const err = new Error("Unsupported external provider dispatch mode.");
    err.status = 400;
    err.code = "support_ticket_external_provider_dispatch_mode_invalid";
    throw err;
  }
  return normalized;
}

function normalizeProviderPlan(providerPlan = {}) {
  const adapter = providerPlan.provider_adapter || providerPlan.adapter || {};
  const payload = providerPlan.payload_json || {};
  assertNoRawSecretPayload(providerPlan, "provider_plan");
  return { ...providerPlan, provider_adapter: adapter, payload_json: { ...payload, external_send_performed: false, secrets_included: false }, external_send_performed: false, secret_value_included: false, secrets_included: false };
}

function adapterKind(adapter = {}) {
  const key = String(adapter.adapter_key || adapter.provider_key || "").trim().toLowerCase();
  const channel = String(adapter.channel || "").trim().toLowerCase();
  if (key.includes("webhook") || channel === "webhook") return "webhook";
  if (key.includes("smtp") || key.includes("email") || channel === "email") return "email";
  return "generic";
}

function buildAdapterCapabilities(adapter = {}) {
  const kind = adapterKind(adapter);
  const adapterKey = String(adapter.adapter_key || adapter.provider_key || "").trim();
  const isGmailUserOAuth = adapterKey === "gmail_user_oauth_adapter";
  const isHostingerSmtp = adapterKey === "hostinger_smtp_adapter";
  const liveSendRuntimeReady = kind === "email" && (Boolean(process.env.SMTP_URL || process.env.HOSTINGER_SMTP_URL) || isGmailUserOAuth);
  return { adapter_key: adapter.adapter_key || adapter.provider_key || null, channel: adapter.channel || kind, kind, provider_runtime: isGmailUserOAuth ? "gmail_user_oauth" : (isHostingerSmtp ? "hostinger_smtp" : kind), supports_validate: true, supports_plan: true, supports_dry_run: true, supports_sandbox: kind === "email" || kind === "webhook", supports_live_send: kind === "email", live_send_runtime_ready: liveSendRuntimeReady, external_network_allowed: liveSendRuntimeReady, reads_raw_secret_values: false, implementation_status: adapter.implementation_status || "not_implemented", dispatch_enabled: Boolean(adapter.dispatch_enabled), provider_dispatch_enabled: Boolean(adapter.provider_dispatch_enabled), external_send_performed: false, secrets_included: false };
}

function buildBlockers(providerPlan = {}, mode = "dry_run") {
  const adapter = providerPlan.provider_adapter || {};
  const blockers = [...(Array.isArray(providerPlan.blockers) ? providerPlan.blockers : [])];
  if (!providerPlan.execution_ready_for_record && mode !== "dry_run") blockers.push("external_send_execution_plan_not_ready");
  if (!providerPlan.send_mode && mode !== "dry_run") blockers.push("external_send_mode_missing");
  if (!adapter.send_mode_allowed && !["dry_run", "provider_send_blocked"].includes(mode)) blockers.push("external_send_mode_not_allowed_by_adapter_policy");
  if (mode === "sandbox" && adapter.provider_dispatch_enabled) blockers.push("sandbox_mode_requires_provider_dispatch_disabled");
  if (mode === "live_send") {
    if (!providerPlan.ready_for_provider_dispatch) blockers.push("live_send_provider_plan_not_ready");
    if (!adapter.provider_dispatch_enabled) blockers.push("live_send_provider_dispatch_disabled");
    if (!adapter.dispatch_enabled) blockers.push("live_send_adapter_dispatch_disabled");
    if (!providerPlan.approval_hold_id) blockers.push("live_send_delivery_approval_required");
    if (!providerPlan.credential_ref) blockers.push("live_send_credential_ref_required");
    if (!providerPlan.idempotency_key && !providerPlan.payload_json?.idempotency_key) blockers.push("live_send_idempotency_key_required");
  }
  return Array.from(new Set(blockers));
}

function mockProviderResponse({ providerPlan = {}, mode = "dry_run" } = {}) {
  const adapter = providerPlan.provider_adapter || {};
  const eventId = crypto.createHash("sha256").update(JSON.stringify({ adapter_key: adapter.adapter_key || adapter.provider_key || null, mode, ticket_id: providerPlan.payload_json?.ticket_id || providerPlan.ticket_id || null, send_mode: providerPlan.send_mode || null })).digest("hex").slice(0, 24);
  return { provider_response_id: `mock_${eventId}`, provider_status: mode === "sandbox" ? "sandbox_recorded" : "planned_not_sent", provider_message_id: null, network_request_performed: false, external_send_performed: false, secrets_included: false };
}

export function createSupportTicketExternalProviderDispatcher({ adapter = {} } = {}) {
  const capabilities = buildAdapterCapabilities(adapter);
  return {
    adapter_key: capabilities.adapter_key,
    channel: capabilities.channel,
    capabilities,
    validate(providerPlan = {}, { mode = "dry_run" } = {}) {
      const normalizedMode = normalizeDispatchMode(mode);
      const normalizedPlan = normalizeProviderPlan(providerPlan);
      const blockers = buildBlockers(normalizedPlan, normalizedMode);
      return { ok: blockers.length === 0 || ["dry_run", "provider_send_blocked"].includes(normalizedMode), mode: normalizedMode, blockers, capabilities, external_send_performed: false, secret_value_included: false, secrets_included: false };
    },
    plan(providerPlan = {}, options = {}) {
      const validation = this.validate(providerPlan, options);
      return { ok: true, mode: validation.mode, dispatch_status: validation.blockers.length ? "blocked_by_policy" : "ready_for_safe_non_external_dispatch", validation, provider_response: mockProviderResponse({ providerPlan, mode: validation.mode }), external_send_performed: false, secret_value_included: false, secrets_included: false };
    },
    dryRun(providerPlan = {}) { return this.plan(providerPlan, { mode: "dry_run" }); },
    sandbox(providerPlan = {}) { return this.plan(providerPlan, { mode: "sandbox" }); },
    async send(providerPlan = {}, options = {}) {
      const validation = this.validate(providerPlan, { mode: "live_send" });
      const readiness = await checkSupportTicketLiveSendReadiness(providerPlan, options);
      if (!validation.ok || !readiness.ok) {
        const err = new Error("Live external provider dispatch is blocked by validation or readiness gates.");
        err.status = 409;
        err.code = "support_ticket_external_provider_live_dispatch_blocked";
        err.validation = validation;
        err.readiness = readiness;
        err.external_send_performed = false;
        err.secrets_included = false;
        throw err;
      }
      return executeSupportTicketLiveSend(providerPlan, options);
    },
  };
}

export function planSupportTicketExternalProviderDispatch({ provider_plan = {}, mode = null } = {}) {
  const normalizedPlan = normalizeProviderPlan(provider_plan);
  const dispatchMode = normalizeDispatchMode(mode || normalizedPlan.send_mode || "dry_run");
  const dispatcher = createSupportTicketExternalProviderDispatcher({ adapter: normalizedPlan.provider_adapter || {} });
  const plan = dispatchMode === "sandbox" ? dispatcher.sandbox(normalizedPlan) : dispatcher.plan(normalizedPlan, { mode: dispatchMode });
  return { ok: true, mode: dispatchMode, adapter_key: dispatcher.adapter_key, channel: dispatcher.channel, dispatch_plan: plan, live_send_supported: false, external_network_allowed: false, external_send_performed: false, secret_value_included: false, secrets_included: false };
}
