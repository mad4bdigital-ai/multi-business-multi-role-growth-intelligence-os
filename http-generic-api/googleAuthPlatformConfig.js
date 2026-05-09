import { getPool } from "./db.js";
import { listPlatformCredentialClientConfigs } from "./platformCredentialClientsConfig.js";

export const GOOGLE_AUTH_PLATFORM_CONFIG_PREFIX = "google_auth_platform";

export const GOOGLE_AUTH_PLATFORM_TABS = Object.freeze([
  "overview",
  "branding",
  "audience",
  "clients",
  "data_access",
  "verification_center",
  "settings",
  "api_credentials",
]);

const VALID_TABS = new Set(GOOGLE_AUTH_PLATFORM_TABS);

function cleanKey(value, fallback = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function cleanText(value, fallback = "", max = 255) {
  const normalized = String(value || "").trim().slice(0, max);
  return normalized || fallback;
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJsonConfig(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeTab(value) {
  const tab = cleanKey(value, "");
  if (!VALID_TABS.has(tab)) {
    const err = new Error(`tab must be one of: ${GOOGLE_AUTH_PLATFORM_TABS.join(", ")}.`);
    err.status = 400;
    err.code = "invalid_google_auth_platform_tab";
    throw err;
  }
  return tab;
}

export function buildGoogleAuthPlatformConfigKey(config = {}) {
  const ownerType = cleanKey(config.owner_type, "platform").slice(0, 16);
  const ownerId = ownerType === "tenant" ? cleanKey(config.tenant_id, "unassigned").slice(0, 24) : "global";
  const projectKey = cleanKey(config.project_key || config.project_id, "growth-intelligence-os").slice(0, 32);
  const tab = normalizeTab(config.tab);
  return `${GOOGLE_AUTH_PLATFORM_CONFIG_PREFIX}.${ownerType}.${ownerId}.${projectKey}.${tab}`;
}

export function defaultGoogleAuthPlatformTabs(args = {}) {
  const projectKey = cleanKey(args.project_key || args.project_id, "growth-intelligence-os");
  const projectDisplayName = cleanText(args.project_display_name, "Growth-Intelligence-OS");
  return {
    overview: {
      tab: "overview",
      console_path: "Google Auth Platform / Overview",
      cards: [
        { key: "oauth_app_verification", status: "needs_verification", action_path: "verification_center" },
        { key: "billing_account_verification", status: "verified" },
        { key: "updated_contact_information", status: "verified" },
        { key: "project_contacts", status: "verified" },
        { key: "webviews_usage", status: "verified" },
        { key: "use_secure_flows", status: "verified" },
        { key: "oauth_client_usage", status: "active" },
      ],
    },
    branding: {
      tab: "branding",
      console_path: "Google Auth Platform / Branding",
      app_information: {
        app_name: cleanText(args.app_name, "Growth Intelligence Platform"),
        user_support_email: cleanText(args.user_support_email, "mad4b.digital@gmail.com"),
        logo_ref: cleanText(args.logo_ref, "platform_brand_logo"),
      },
      verification_status: "verified",
    },
    audience: {
      tab: "audience",
      console_path: "Google Auth Platform / Audience",
      publishing_status: "in_production",
      user_type: "external",
      oauth_user_cap_applies: false,
    },
    clients: {
      tab: "clients",
      console_path: "Google Auth Platform / Clients",
      credential_client_registry_prefix: "platform_credential_client.",
      supported_client_types: ["web", "desktop", "api_key", "service_account"],
    },
    data_access: {
      tab: "data_access",
      console_path: "Google Auth Platform / Data Access",
      verification_required: true,
      scopes: [
        {
          api: "Google Drive API",
          scope: "https://www.googleapis.com/auth/drive.file",
          sensitivity: "non_sensitive",
          user_facing_description: "See, edit, create, and delete only the specific Google Drive files you use with this app",
        },
        {
          api: "Google Drive API",
          scope: "https://www.googleapis.com/auth/drive.appdata",
          sensitivity: "non_sensitive",
          user_facing_description: "See, create, and delete its own configuration data in your Google Drive",
        },
        {
          api: "Google OAuth2 API",
          scope: "https://www.googleapis.com/auth/userinfo.email",
          sensitivity: "non_sensitive",
          user_facing_description: "See your primary Google Account email address",
        },
      ],
    },
    verification_center: {
      tab: "verification_center",
      console_path: "Google Auth Platform / Verification center",
      branding_status: "verified",
      data_access_status: "needs_verification",
      required_actions: ["prepare_data_access_verification"],
    },
    settings: {
      tab: "settings",
      console_path: "Google Auth Platform / Settings",
      project_key: projectKey,
      project_display_name: projectDisplayName,
      managed_by: "mad4b-platform",
    },
    api_credentials: {
      tab: "api_credentials",
      console_path: "APIs & Services / Credentials",
      credential_client_registry_prefix: "platform_credential_client.",
      supported_credential_types: ["api_key", "oauth_client", "service_account"],
    },
  };
}

export function normalizeGoogleAuthPlatformConfig(args = {}) {
  const tab = normalizeTab(args.tab);
  const defaults = defaultGoogleAuthPlatformTabs(args)[tab] || {};
  return {
    owner_type: cleanKey(args.owner_type, "platform"),
    tenant_id: cleanText(args.tenant_id, "", 128) || null,
    project_key: cleanKey(args.project_key || args.project_id, "growth-intelligence-os"),
    project_id: cleanText(args.project_id, "", 128) || null,
    project_display_name: cleanText(args.project_display_name, "Growth-Intelligence-OS"),
    tab,
    path: cleanText(args.path, defaults.console_path || tab, 255),
    state: {
      ...defaults,
      ...cleanObject(args.state),
    },
    notes: cleanText(args.notes || args.note, "", 500) || null,
    updated_at: new Date().toISOString(),
  };
}

export async function ensureGoogleAuthPlatformConfigTable(pool = getPool()) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`platform_runtime_config\` (
      \`config_key\`  VARCHAR(128) NOT NULL,
      \`config_json\` JSON         NOT NULL,
      \`status\`      ENUM('active','disabled') NOT NULL DEFAULT 'active',
      \`note\`        VARCHAR(255) NULL,
      \`created_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`config_key\`),
      KEY \`idx_prc_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

export async function upsertGoogleAuthPlatformConfig(args = {}) {
  const config = normalizeGoogleAuthPlatformConfig(args);
  const pool = args.pool || getPool();
  const configKey = buildGoogleAuthPlatformConfigKey(config);
  const note = cleanText(args.note, "google_auth_platform_config", 255);
  await ensureGoogleAuthPlatformConfigTable(pool);
  await pool.query(
    `INSERT INTO \`platform_runtime_config\`
       (config_key, config_json, status, note)
     VALUES (?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       config_json = VALUES(config_json),
       status = 'active',
       note = VALUES(note),
       updated_at = CURRENT_TIMESTAMP`,
    [configKey, JSON.stringify(config), note]
  );
  return { ok: true, config_key: configKey, config };
}

export async function getGoogleAuthPlatformConfig(args = {}) {
  const projectKey = cleanKey(args.project_key || args.project_id, "growth-intelligence-os").slice(0, 32);
  const ownerType = cleanKey(args.owner_type, "platform").slice(0, 16);
  const ownerId = ownerType === "tenant" ? cleanKey(args.tenant_id, "unassigned").slice(0, 24) : "global";
  const tab = args.tab ? normalizeTab(args.tab) : "";
  const prefix = [GOOGLE_AUTH_PLATFORM_CONFIG_PREFIX, ownerType, ownerId, projectKey, tab].filter(Boolean).join(".");
  const defaults = defaultGoogleAuthPlatformTabs({ ...args, project_key: projectKey });
  let saved = [];
  try {
    const like = `${prefix}%`;
    const [rows] = await getPool().query(
      `SELECT config_key, config_json, status, note, updated_at
         FROM \`platform_runtime_config\`
        WHERE config_key LIKE ?
        ORDER BY config_key ASC`,
      [like]
    );
    saved = rows.map((row) => ({
      config_key: row.config_key,
      status: row.status,
      note: row.note,
      updated_at: row.updated_at,
      config: parseJsonConfig(row.config_json),
    }));
  } catch (err) {
    if (err.code !== "DB_CONFIG_MISSING") throw err;
  }
  const byTab = new Map(saved.map((row) => [row.config?.tab, row]));
  let credentialClients = [];
  if (!tab || tab === "clients" || tab === "api_credentials") {
    try {
      const result = await listPlatformCredentialClientConfigs({
        owner_type: args.owner_type || "platform",
        tenant_id: args.tenant_id,
        limit: 200,
      });
      credentialClients = result.clients || [];
    } catch (err) {
      if (err.code !== "DB_CONFIG_MISSING") throw err;
    }
  }
  const tabs = (tab ? [tab] : GOOGLE_AUTH_PLATFORM_TABS).map((tabKey) => {
    const row = byTab.get(tabKey);
    const resolved = row || {
      config_key: `${GOOGLE_AUTH_PLATFORM_CONFIG_PREFIX}.${ownerType}.${ownerId}.${projectKey}.${tabKey}`,
      status: "default",
      note: "default_google_auth_platform_tab",
      updated_at: null,
      config: normalizeGoogleAuthPlatformConfig({ ...args, tab: tabKey, state: defaults[tabKey] }),
    };
    if (tabKey === "clients" || tabKey === "api_credentials") {
      return {
        ...resolved,
        config: {
          ...resolved.config,
          state: {
            ...(resolved.config?.state || {}),
            linked_credential_clients: credentialClients,
          },
        },
      };
    }
    return resolved;
  });

  return {
    ok: true,
    project_key: projectKey,
    console_root: "/admin/apis-services/google-auth-platform",
    tabs,
  };
}
