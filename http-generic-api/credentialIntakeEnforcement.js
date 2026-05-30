import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MINUTES = 30;
const MAX_TTL_MINUTES = 24 * 60;
const ALLOWED_AUTH_TYPES = new Set([
  "api_key",
  "webhook",
  "mcp",
  "basic_auth",
  "bearer_token",
  "oauth2",
  "custom_headers",
  "client_credentials",
]);

function str(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function clampTtlMinutes(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MINUTES;
  return Math.min(Math.max(parsed, 1), MAX_TTL_MINUTES);
}

function normalizeFieldName(name) {
  return String(name || "")
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function roleText(input = {}, effective = {}) {
  return str(input.credential_role || input.credentialRole || input.role || effective.credential_role).toLowerCase();
}

export function shouldCreateCredentialIntake(input = {}, effective = {}) {
  const enabled = input.enforce_intake === true
    || input.enforceIntake === true
    || input.auto_intake === true
    || input.autoIntake === true
    || input.require_credential_intake_on_missing === true
    || input.requireCredentialIntakeOnMissing === true;
  if (!enabled) return false;
  return ["blocked_missing_secret", "missing_credential_role"].includes(str(effective.status));
}

function inferAuthType(input = {}, effective = {}) {
  const requested = str(input.auth_type || input.authType || effective.auth_type);
  if (ALLOWED_AUTH_TYPES.has(requested)) return requested;
  const role = roleText(input, effective);
  if (role.includes("bearer")) return "bearer_token";
  if (role.includes("webhook")) return "webhook";
  if (role.includes("mcp")) return "mcp";
  if (role.includes("basic") || role.includes("password") || role.includes("wordpress")) return "basic_auth";
  return "api_key";
}

function inferAppKey(input = {}, effective = {}) {
  return str(input.app_key || input.appKey || effective.app_key || effective.connector_family || effective.provider_family || "api_key") || "api_key";
}

function inferCredentialField(input = {}, effective = {}, authType = "api_key") {
  const requested = normalizeFieldName(input.credential_field || input.credentialField || effective.missing_secret_key || "");
  const role = roleText(input, effective);
  if (requested && requested !== "api_key" && requested !== "secret" && requested !== "token") return requested;
  if (role.includes("wordpress") || role.includes("app_password")) return "application_password";
  if (role.includes("mcp")) return "mcp_bearer";
  if (role.includes("bearer")) return "bearer_token";
  if (authType === "basic_auth") return "password";
  if (authType === "webhook") return "webhook_secret";
  if (authType === "mcp") return "mcp_bearer";
  if (authType === "bearer_token") return "bearer_token";
  return "api_key";
}

function credentialSchemaForRequirement(input = {}, effective = {}, authType = "api_key") {
  const fieldName = inferCredentialField(input, effective, authType);
  const label = str(input.credential_label || input.credentialLabel)
    || fieldName.toUpperCase();
  if (authType === "basic_auth") {
    return {
      fields: [
        { name: "username", label: "Username", type: "text", target: "credentials", required: !roleText(input, effective).includes("wordpress"), secret: false, autocomplete: "username" },
        { name: fieldName, label, type: "password", target: "credentials", required: true, secret: true },
      ],
    };
  }
  if (authType === "mcp") {
    return {
      fields: [
        { name: "mcp_endpoint", label: "MCP endpoint URL", type: "url", target: "connection", required: false, secret: false },
        { name: fieldName, label, type: "password", target: "credentials", required: true, secret: true },
      ],
    };
  }
  return {
    fields: [
      { name: fieldName, label, type: "password", target: "credentials", required: true, secret: true },
      { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
    ],
  };
}

function absoluteBaseUrl(input = {}, req = null) {
  const explicit = str(input.intake_base_url || input.intakeBaseUrl || process.env.PUBLIC_BASE_URL || process.env.AUTH_BASE_URL);
  if (explicit) return explicit.replace(/\/$/, "");
  if (req) {
    const proto = req.headers?.["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers?.["x-forwarded-host"] || req.headers?.host;
    if (host) return `${proto}://${host}`;
  }
  return "https://auth.mad4b.com";
}

function requirementKey(input = {}, effective = {}, appKey = "", authType = "") {
  return [
    str(input.tenant_id || input.tenantId),
    str(input.user_id || input.userId),
    appKey,
    authType,
    str(input.action_key || input.actionKey),
    str(input.target_key || input.targetKey),
    str(input.connection_id || input.connectionId),
    str(input.credential_role || input.credentialRole || input.role || effective.credential_role),
    str(effective.missing_secret_key),
  ].join("|");
}

async function appExists(pool, appKey) {
  const [rows] = await pool.query("SELECT app_key FROM `app_integrations` WHERE app_key = ? LIMIT 1", [appKey]).catch(() => [[]]);
  return Boolean(rows?.[0]);
}

async function findPendingSession(pool, key) {
  const [rows] = await pool.query(
    `SELECT session_id, expires_at
       FROM credential_intake_sessions
      WHERE status = 'pending'
        AND expires_at > NOW()
        AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.intake_requirement_key')) = ?
      ORDER BY expires_at DESC
      LIMIT 1`,
    [key]
  ).catch(() => [[]]);
  return rows?.[0] || null;
}

export async function createCredentialIntakeRequirement(input = {}, effective = {}, options = {}) {
  const tenantId = str(input.tenant_id || input.tenantId);
  const userId = str(input.user_id || input.userId);
  if (!tenantId || !userId) {
    return {
      status: "credential_intake_unavailable",
      reason: !tenantId ? "tenant_id_required" : "user_id_required",
      secrets_included: false,
    };
  }

  const pool = options.pool || getPool();
  const requestedAppKey = inferAppKey(input, effective);
  const appKey = await appExists(pool, requestedAppKey) ? requestedAppKey : "api_key";
  const authType = inferAuthType(input, effective);
  const schema = input.credential_schema || input.credentialSchema || credentialSchemaForRequirement(input, effective, authType);
  const ttl = clampTtlMinutes(input.expires_in_minutes || input.expiresInMinutes || 30);
  const key = requirementKey(input, effective, appKey, authType);
  const existing = await findPendingSession(pool, key);
  if (existing) {
    return {
      status: "credential_intake_required",
      session_id: existing.session_id,
      intake_url: null,
      expires_at: existing.expires_at,
      app_key: appKey,
      auth_type: authType,
      reused_pending_session: true,
      reason: effective.status || "blocked_missing_secret",
      missing_secret_key: effective.missing_secret_key || null,
      secrets_included: false,
    };
  }

  const token = randomToken();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString().slice(0, 19).replace("T", " ");
  const metadata = {
    ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
    intake_enforcement: true,
    intake_requirement_key: key,
    requested_app_key: requestedAppKey,
    action_key: str(input.action_key || input.actionKey) || null,
    target_key: str(input.target_key || input.targetKey) || null,
    connection_id: str(input.connection_id || input.connectionId) || null,
    credential_role: str(input.credential_role || input.credentialRole || input.role || effective.credential_role) || null,
    missing_secret_key: effective.missing_secret_key || null,
    resolver_status: effective.status || null,
    secrets_must_not_be_returned: true,
  };

  await pool.query(
    `INSERT INTO credential_intake_sessions
       (session_id, token_hash, user_id, tenant_id, app_key, auth_type, display_label,
        mcp_endpoint, webhook_url, api_base_url, workspace_id, credential_schema_json,
        metadata_json, status, expires_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    [
      sessionId,
      sha256(token),
      userId,
      tenantId,
      appKey,
      authType,
      str(input.display_label || input.displayLabel) || `Credential required for ${appKey}`,
      str(input.mcp_endpoint || input.mcpEndpoint) || null,
      str(input.webhook_url || input.webhookUrl) || null,
      str(input.api_base_url || input.apiBaseUrl) || null,
      str(input.workspace_id || input.workspaceId) || null,
      JSON.stringify(schema),
      JSON.stringify(metadata),
      expiresAt,
      str(input.created_by || input.createdBy || "credential_intake_enforcement"),
    ]
  );

  return {
    status: "credential_intake_required",
    session_id: sessionId,
    intake_url: `${absoluteBaseUrl(input, options.req)}/credential-intake/${encodeURIComponent(token)}`,
    expires_at: expiresAt,
    app_key: appKey,
    auth_type: authType,
    field_count: Array.isArray(schema?.fields) ? schema.fields.length : null,
    reused_pending_session: false,
    reason: effective.status || "blocked_missing_secret",
    missing_secret_key: effective.missing_secret_key || null,
    secrets_included: false,
  };
}

export async function maybeCreateCredentialIntakeRequirement(input = {}, effective = {}, options = {}) {
  if (!shouldCreateCredentialIntake(input, effective)) return null;
  return createCredentialIntakeRequirement(input, effective, options);
}

export const __test__ = {
  credentialSchemaForRequirement,
  inferAuthType,
  inferCredentialField,
  requirementKey,
  shouldCreateCredentialIntake,
};
