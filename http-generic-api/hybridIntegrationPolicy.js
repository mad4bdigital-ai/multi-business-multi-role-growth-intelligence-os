import { getPool } from "./db.js";

export const CANONICAL_INTEGRATION_SOURCE_MODES = Object.freeze(["managed", "dedicated"]);

const APP_MODE_DEFAULTS = Object.freeze({
  cloudflare: { capability: "cloudflare", label: "Cloudflare" },
  hostinger: { capability: "hostinger", label: "Hostinger" },
  n8n: { capability: "n8n", label: "n8n" },
  google: { capability: "google_auth", label: "Google" },
  google_drive: { capability: "google_auth", label: "Google Drive" },
  google_sheets: { capability: "google_auth", label: "Google Sheets" },
  google_search_console: { capability: "google_auth", label: "Google Search Console" },
  google_ads: { capability: "google_auth", label: "Google Ads" },
  github: { capability: "connection", label: "GitHub" },
  slack: { capability: "connection", label: "Slack" },
  notion: { capability: "connection", label: "Notion" },
  wordpress_rest: { capability: "connection", label: "WordPress REST" },
  makecom: { capability: "connection", label: "Make" },
  makecom_mcp: { capability: "connection", label: "Make MCP" },
  whatsapp: { capability: "connection", label: "WhatsApp" },
  shopify: { capability: "connection", label: "Shopify" },
});

const LOCAL_CONNECTOR_APPS = new Set(["cloudflare", "hostinger"]);

function normalize(value = "") {
  return String(value || "").trim();
}

function normalizeKey(value = "") {
  return normalize(value).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_");
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = normalize(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function modeFromValue(value, fallback = "managed") {
  const normalized = normalizeKey(value);
  if (["dedicated", "tenant", "tenant_owned", "customer", "customer_owned", "self_hosted", "self_hosted_local", "local"].includes(normalized)) return "dedicated";
  if (["managed", "platform", "platform_managed", "hosted", "shared", "managed_main_server"].includes(normalized)) return "managed";
  return fallback;
}

function connectionDefaultMode(connection = null) {
  return modeFromValue(connection?.connection_mode, "managed");
}

function defaultModeForApp(appKey, connection = null) {
  const key = normalizeKey(appKey);
  if (key === "cloudflare") return modeFromValue(connection?.cloudflare_mode, connectionDefaultMode(connection));
  if (key === "hostinger") return modeFromValue(connection?.hostinger_mode, modeFromValue(connection?.cloudflare_mode, connectionDefaultMode(connection)));
  if (key === "n8n") return modeFromValue(connection?.n8n_activation_mode, connectionDefaultMode(connection));
  const descriptor = APP_MODE_DEFAULTS[key];
  if (descriptor?.capability === "google_auth") return modeFromValue(connection?.google_auth_mode, connectionDefaultMode(connection));
  return connectionDefaultMode(connection);
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

function normalizeIntegrationModesObject(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const appKey = normalizeKey(rawKey);
    if (!appKey) continue;
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      normalized[appKey] = {
        source_mode: modeFromValue(rawValue.source_mode ?? rawValue.mode ?? rawValue.credential_source, "managed"),
        fallback_allowed: boolValue(rawValue.fallback_allowed, false),
        required_for_device_install: boolValue(rawValue.required_for_device_install, LOCAL_CONNECTOR_APPS.has(appKey)),
        notes: normalize(rawValue.notes || ""),
      };
    } else {
      normalized[appKey] = {
        source_mode: modeFromValue(rawValue, "managed"),
        fallback_allowed: false,
        required_for_device_install: LOCAL_CONNECTOR_APPS.has(appKey),
        notes: "",
      };
    }
  }
  return normalized;
}

async function readPolicyRows(tenantId) {
  if (!tenantId) return [];
  try {
    const [rows] = await getPool().query(
      `SELECT app_key, source_mode, fallback_allowed, required_for_device_install, notes, updated_at
         FROM \`tenant_integration_policies\`
        WHERE tenant_id = ? AND status = 'active'
        ORDER BY app_key ASC`,
      [tenantId]
    );
    return rows || [];
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return [];
    throw err;
  }
}

export async function upsertTenantIntegrationPolicies({ tenantId, userId, integrationModes = {}, source = "connect", db = null } = {}) {
  const modes = normalizeIntegrationModesObject(integrationModes);
  if (!tenantId || !Object.keys(modes).length) return { updated: 0, skipped: true };
  const executor = db || getPool();
  let updated = 0;
  for (const [appKey, policy] of Object.entries(modes)) {
    try {
      await executor.query(
        `INSERT INTO \`tenant_integration_policies\`
           (tenant_id, app_key, source_mode, fallback_allowed, required_for_device_install, notes, status, created_by, updated_by, source)
         VALUES (?,?,?,?,?,?,'active',?,?,?)
         ON DUPLICATE KEY UPDATE
           source_mode = VALUES(source_mode),
           fallback_allowed = VALUES(fallback_allowed),
           required_for_device_install = VALUES(required_for_device_install),
           notes = VALUES(notes),
           status = 'active',
           updated_by = VALUES(updated_by),
           source = VALUES(source),
           updated_at = CURRENT_TIMESTAMP`,
        [
          tenantId,
          appKey,
          policy.source_mode,
          policy.fallback_allowed ? 1 : 0,
          policy.required_for_device_install ? 1 : 0,
          policy.notes || "",
          userId || null,
          userId || null,
          source,
        ]
      );
      updated += 1;
    } catch (err) {
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return { updated: 0, skipped: true, reason: err.code };
      throw err;
    }
  }
  return { updated, skipped: false };
}

export async function resolveHybridIntegrationPolicy({ tenantId, connection = null, requestedApps = [] } = {}) {
  const rows = await readPolicyRows(tenantId);
  const rowMap = new Map(rows.map((row) => [normalizeKey(row.app_key), row]));
  const keys = new Set([
    "cloudflare",
    "hostinger",
    "n8n",
    "google_drive",
    "google_sheets",
    "google_search_console",
    "github",
    ...requestedApps.map(normalizeKey).filter(Boolean),
    ...rows.map((row) => normalizeKey(row.app_key)).filter(Boolean),
  ]);

  const policies = {};
  for (const key of keys) {
    const row = rowMap.get(key);
    const sourceMode = row ? modeFromValue(row.source_mode, "managed") : defaultModeForApp(key, connection);
    policies[key] = {
      app_key: key,
      display_name: APP_MODE_DEFAULTS[key]?.label || key,
      source_mode: sourceMode,
      policy_source: row ? "tenant_policy" : "connection_default",
      fallback_allowed: row ? Boolean(row.fallback_allowed) : false,
      required_for_device_install: row ? Boolean(row.required_for_device_install) : LOCAL_CONNECTOR_APPS.has(key),
      notes: row?.notes || "",
      updated_at: row?.updated_at || null,
    };
  }

  const sourceModes = new Set(Object.values(policies).map((item) => item.source_mode));
  return {
    mode: sourceModes.size > 1 ? "mixed" : (sourceModes.values().next().value || "managed"),
    canonical_modes: CANONICAL_INTEGRATION_SOURCE_MODES,
    policies,
  };
}

export async function assessHybridIntegrationReadiness({ tenantId, userId, connection = null, requestedApps = [] } = {}) {
  const policy = await resolveHybridIntegrationPolicy({ tenantId, connection, requestedApps });
  const dedicatedPolicies = Object.values(policy.policies).filter((item) => item.source_mode === "dedicated");
  const appKeys = dedicatedPolicies.map((item) => item.app_key);
  let connectionRows = [];
  if (tenantId && appKeys.length) {
    const [rows] = await getPool().query(
      `SELECT connection_id, tenant_id, user_id, app_key, auth_type, display_label,
              account_label, validation_status, status, is_primary,
              last_validated_at, last_used_at,
              COALESCE(last_used_at, last_validated_at, connected_at) AS updated_at
         FROM \`user_app_connections\`
        WHERE tenant_id = ?
          AND app_key IN (?)
          AND status = 'active'
          AND (? = '' OR user_id = ? OR is_primary = 1)
        ORDER BY app_key ASC, (user_id = ?) DESC, is_primary DESC,
                 COALESCE(last_used_at, last_validated_at, connected_at) DESC`,
      [tenantId, appKeys, userId || "", userId || "", userId || ""]
    );
    connectionRows = rows || [];
  }

  const bestByApp = new Map();
  for (const row of connectionRows) {
    if (!bestByApp.has(row.app_key)) bestByApp.set(row.app_key, row);
  }

  const perApp = {};
  const missing = [];
  for (const item of Object.values(policy.policies)) {
    const row = bestByApp.get(item.app_key);
    const ready = item.source_mode === "managed" || Boolean(row);
    const entry = {
      ...item,
      ready,
      connection: row ? safeConnection(row) : null,
      next_action: ready ? null : "connect_credential_intake_create",
    };
    perApp[item.app_key] = entry;
    if (!ready) missing.push({
      app_key: item.app_key,
      display_name: item.display_name,
      source_mode: item.source_mode,
      required_for_device_install: item.required_for_device_install,
      fallback_allowed: item.fallback_allowed,
      connect_tool: "connect_credential_intake_create",
      catalog_tool: "connect_app_integrations_list",
    });
  }

  const deviceBlockingMissing = missing.filter((item) => item.required_for_device_install && !item.fallback_allowed);
  return {
    required: dedicatedPolicies.length > 0,
    mode: policy.mode,
    policy,
    per_app: perApp,
    missing_integrations: missing,
    ready: missing.length === 0,
    ready_for_device_install: deviceBlockingMissing.length === 0,
    provisioning_credential_mode: ["cloudflare", "hostinger"].some((key) => perApp[key]?.source_mode === "dedicated") ? "dedicated" : "managed",
    device_install_blockers: deviceBlockingMissing,
    next_actions: missing.length
      ? ["connect_app_integrations_list", "connect_credential_intake_create", "connect_app_connections_list"]
      : ["connect_device_install"],
  };
}

export function hybridIntegrationCatalog() {
  return {
    mode: "mixed",
    canonical_source_modes: CANONICAL_INTEGRATION_SOURCE_MODES,
    storage_table: "tenant_integration_policies",
    connection_table: "user_app_connections",
    rule: "Activation mode remains managed|dedicated. Mixed behavior is configured per app through integration_modes and tenant_integration_policies.",
    examples: {
      managed_with_dedicated_infra: {
        mode: "managed",
        integration_modes: { cloudflare: "dedicated", hostinger: "dedicated", google_drive: "managed" },
      },
      dedicated_with_managed_google: {
        mode: "dedicated",
        integration_modes: { cloudflare: "dedicated", hostinger: "dedicated", google_drive: "managed", google_sheets: "managed" },
      },
    },
    tools: {
      update_policy: "connect_integration_policy_update",
      list_catalog: "connect_app_integrations_list",
      create_intake: "connect_credential_intake_create",
      list_connections: "connect_app_connections_list",
      install_device: "connect_device_install",
    },
    secret_handling: "Dedicated app secrets must be entered through OAuth or credential intake; never paste secrets into GPT chat.",
  };
}
