import { getPool } from "./db.js";

export const DEDICATED_REQUIRED_INTEGRATIONS = Object.freeze([
  {
    app_key: "cloudflare",
    display_name: "Cloudflare",
    auth_type: "api_key",
    purpose: "Provision tenant-owned Cloudflare Tunnel and DNS routing for dedicated/local connector runtime.",
    required_for: ["dedicated", "local_connector", "dns", "tunnel"],
  },
  {
    app_key: "hostinger",
    display_name: "Hostinger",
    auth_type: "api_key",
    purpose: "Manage tenant-owned Hostinger DNS/hosting records used by dedicated connector routing.",
    required_for: ["dedicated", "local_connector", "dns", "hosting"],
  },
]);

function normalize(value = "") {
  return String(value || "").trim();
}

function isDedicatedConnection(connection = null) {
  if (!connection) return false;
  return [
    connection.connection_mode,
    connection.cloudflare_mode,
    connection.google_auth_mode,
  ].some((value) => normalize(value).toLowerCase() === "dedicated") ||
    normalize(connection.n8n_activation_mode).toLowerCase() === "self_hosted_local";
}

function safeConnection(row = {}) {
  return {
    connection_id: row.connection_id,
    app_key: row.app_key,
    auth_type: row.auth_type,
    display_label: row.display_label || null,
    account_label: row.account_label || null,
    validation_status: row.validation_status || null,
    status: row.status,
    is_primary: Boolean(row.is_primary),
    last_validated_at: row.last_validated_at || null,
    last_used_at: row.last_used_at || null,
    updated_at: row.updated_at || null,
  };
}

export function dedicatedRequiredIntegrations({ connection = null } = {}) {
  if (!isDedicatedConnection(connection)) return [];
  return DEDICATED_REQUIRED_INTEGRATIONS.map((item) => ({ ...item }));
}

export async function assessDedicatedIntegrationReadiness({ tenantId, userId, connection = null } = {}) {
  const required = dedicatedRequiredIntegrations({ connection });
  if (!tenantId || !required.length) {
    return {
      required: false,
      ready: true,
      mode: connection?.connection_mode || "managed",
      required_integrations: [],
      connected_integrations: [],
      missing_integrations: [],
      next_actions: [],
    };
  }

  const appKeys = required.map((item) => item.app_key);
  const [rows] = await getPool().query(
    `SELECT connection_id, tenant_id, user_id, app_key, auth_type, display_label,
            account_label, validation_status, status, is_primary,
            last_validated_at, last_used_at, updated_at
       FROM \`user_app_connections\`
      WHERE tenant_id = ?
        AND app_key IN (?)
        AND status = 'active'
        AND (? = '' OR user_id = ? OR is_primary = 1)
      ORDER BY app_key ASC, (user_id = ?) DESC, is_primary DESC, updated_at DESC`,
    [tenantId, appKeys, userId || "", userId || "", userId || ""]
  );

  const bestByApp = new Map();
  for (const row of rows || []) {
    if (!bestByApp.has(row.app_key)) bestByApp.set(row.app_key, row);
  }

  const connected = required
    .map((item) => bestByApp.get(item.app_key))
    .filter(Boolean)
    .map(safeConnection);
  const connectedKeys = new Set(connected.map((item) => item.app_key));
  const missing = required
    .filter((item) => !connectedKeys.has(item.app_key))
    .map((item) => ({
      app_key: item.app_key,
      display_name: item.display_name,
      auth_type: item.auth_type,
      purpose: item.purpose,
      required_for: item.required_for,
      connect_tool: "connect_credential_intake_create",
      catalog_tool: "connect_app_integrations_list",
    }));

  return {
    required: true,
    ready: missing.length === 0,
    mode: connection?.connection_mode || "dedicated",
    required_integrations: required,
    connected_integrations: connected,
    missing_integrations: missing,
    next_actions: missing.length
      ? ["connect_app_integrations_list", "connect_credential_intake_create", "connect_app_connections_list"]
      : ["connect_device_install"],
  };
}

export function dedicatedIntegrationCatalog() {
  return {
    mode: "dedicated",
    required_integrations: DEDICATED_REQUIRED_INTEGRATIONS.map((item) => ({ ...item })),
    user_owned_connection_table: "user_app_connections",
    secret_handling: "Secrets must be entered through OAuth or credential intake. Never paste secrets into GPT chat.",
    tools: {
      list_catalog: "connect_app_integrations_list",
      create_intake: "connect_credential_intake_create",
      list_connections: "connect_app_connections_list",
      revoke_connection: "connect_app_connection_revoke",
      install_device: "connect_device_install",
    },
  };
}
