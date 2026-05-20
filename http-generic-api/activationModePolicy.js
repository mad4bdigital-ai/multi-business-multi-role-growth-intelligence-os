const CONNECTION_MODE_ALIASES = new Map([
  ["managed", "managed"],
  ["manage", "managed"],
  ["platform", "managed"],
  ["platform_managed", "managed"],
  ["managed_main_server", "managed"],
  ["hosted", "managed"],
  ["shared", "managed"],
  ["dedicated", "dedicated"],
  ["dedicate", "dedicated"],
  ["tenant", "dedicated"],
  ["tenant_dedicated", "dedicated"],
  ["customer", "dedicated"],
  ["customer_owned", "dedicated"],
  ["self_hosted", "dedicated"],
  ["self_hosted_local", "dedicated"],
  ["local", "dedicated"],
]);

const N8N_MODE_ALIASES = new Map([
  ["managed", "managed_main_server"],
  ["managed_main_server", "managed_main_server"],
  ["platform", "managed_main_server"],
  ["platform_managed", "managed_main_server"],
  ["dedicated", "self_hosted_local"],
  ["self_hosted", "self_hosted_local"],
  ["self_hosted_local", "self_hosted_local"],
  ["local", "self_hosted_local"],
]);

export const CANONICAL_CONNECTION_MODES = Object.freeze(["managed", "dedicated"]);
export const CANONICAL_N8N_ACTIVATION_MODES = Object.freeze(["managed_main_server", "self_hosted_local"]);

function cleanMode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function firstString(...values) {
  for (const value of values) {
    const str = String(value || "").trim();
    if (str) return str;
  }
  return "";
}

function modeError(code, message, details = {}) {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  err.details = details;
  return err;
}

export function normalizeConnectionMode(value, { required = true, defaultMode = "" } = {}) {
  const raw = firstString(value, defaultMode);
  const normalized = cleanMode(raw);
  if (!normalized) {
    if (!required) return "";
    throw modeError(
      "activation_mode_required",
      "Activation mode is required. Use mode 'managed' or 'dedicated'.",
      { accepted_modes: CANONICAL_CONNECTION_MODES }
    );
  }
  const canonical = CONNECTION_MODE_ALIASES.get(normalized);
  if (!canonical) {
    throw modeError(
      "invalid_mode",
      "mode must be 'managed' or 'dedicated'.",
      { received: raw, accepted_modes: CANONICAL_CONNECTION_MODES }
    );
  }
  return canonical;
}

export function normalizeConnectionModeFromBody(body = {}, options = {}) {
  return normalizeConnectionMode(
    firstString(
      body.mode,
      body.connection_mode,
      body.activation_mode,
      body.service_mode,
      body.tenant_activation_mode
    ),
    options
  );
}

export function normalizeN8nActivationMode(value, connectionMode = "managed") {
  const raw = firstString(value, connectionMode === "dedicated" ? "self_hosted_local" : "managed_main_server");
  const normalized = cleanMode(raw);
  const canonical = N8N_MODE_ALIASES.get(normalized);
  if (!canonical) {
    throw modeError(
      "invalid_n8n_activation_mode",
      "n8n_activation_mode must be 'managed_main_server' or 'self_hosted_local'.",
      { received: raw, accepted_modes: CANONICAL_N8N_ACTIVATION_MODES }
    );
  }
  return canonical;
}

export function resolveActivationModePolicy(body = {}) {
  const connectionMode = normalizeConnectionModeFromBody(body, { required: true });
  const cloudflareMode = normalizeConnectionMode(
    firstString(body.cloudflare_mode, body.cloudflare_connection_mode),
    { required: false, defaultMode: connectionMode }
  ) || connectionMode;
  const googleAuthMode = normalizeConnectionMode(
    firstString(body.google_auth_mode, body.google_connection_mode),
    { required: false, defaultMode: connectionMode }
  ) || connectionMode;
  const n8nActivationMode = normalizeN8nActivationMode(body.n8n_activation_mode, connectionMode);
  const provisioningCredentialMode = normalizeConnectionMode(
    firstString(body.provisioning_credential_mode, body.credential_mode),
    { required: false, defaultMode: cloudflareMode }
  ) || cloudflareMode;

  return {
    mode: connectionMode,
    connection_mode: connectionMode,
    cloudflare_mode: cloudflareMode,
    google_auth_mode: googleAuthMode,
    n8n_activation_mode: n8nActivationMode,
    provisioning_credential_mode: provisioningCredentialMode,
    managed: connectionMode === "managed",
    dedicated: connectionMode === "dedicated",
    requires_customer_credentials: connectionMode === "dedicated" || cloudflareMode === "dedicated" || googleAuthMode === "dedicated",
    local_connector_required: connectionMode === "dedicated" || n8nActivationMode === "self_hosted_local",
  };
}

export function activationModeCatalog() {
  return {
    canonical_modes: CANONICAL_CONNECTION_MODES,
    n8n_activation_modes: CANONICAL_N8N_ACTIVATION_MODES,
    aliases: {
      managed: ["managed", "Managed", "platform", "hosted", "managed_main_server"],
      dedicated: ["dedicated", "Dedicated", "self_hosted", "self_hosted_local", "local"],
    },
    defaults: {
      managed: {
        connection_mode: "managed",
        cloudflare_mode: "managed",
        google_auth_mode: "managed",
        n8n_activation_mode: "managed_main_server",
        provisioning_credential_mode: "managed",
        credential_source: "platform_managed",
      },
      dedicated: {
        connection_mode: "dedicated",
        cloudflare_mode: "dedicated",
        google_auth_mode: "dedicated",
        n8n_activation_mode: "self_hosted_local",
        provisioning_credential_mode: "dedicated",
        credential_source: "tenant_owned_user_app_connections",
      },
    },
    governance: {
      source_of_truth: "activationModePolicy.js",
      route_contract: "POST /connect/activate accepts mode, connection_mode, activation_mode, service_mode, or tenant_activation_mode and stores canonical connection_mode.",
      tool_contract: "connect_activate must pass mode under tool_args; required mode is enforced by the tenant tool registry.",
      endpoint_contract: "Runtime endpoint dry-run/execute should preserve canonical mode fields when routing activation or device install tools.",
      mcp_contract: "MCP/action wrappers must not invent alternate mode names; they may use aliases but the platform stores managed|dedicated.",
    },
  };
}
