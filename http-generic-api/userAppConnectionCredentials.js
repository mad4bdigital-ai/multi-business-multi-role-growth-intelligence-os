import crypto from "crypto";
import { getPool } from "./db.js";

export function parseOauthConfigRef(raw = "") {
  const out = { mode: "", value: "", params: {} };
  const parts = String(raw || "").split(";").map(v => v.trim()).filter(Boolean);
  if (!parts.length) return out;
  const i = parts[0].indexOf(":");
  if (i >= 0) {
    out.mode = parts[0].slice(0, i).trim();
    out.value = parts[0].slice(i + 1).trim();
  } else {
    out.mode = parts[0].trim();
  }
  for (const p of parts.slice(1)) {
    const j = p.indexOf("=");
    if (j > 0) out.params[p.slice(0, j).trim()] = p.slice(j + 1).trim();
  }
  return out;
}

export function normalizeEmailKey(email = "") {
  return String(email || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function splitList(value = "") {
  return String(value || "").split(/[,\s|]+/).map(v => v.trim()).filter(Boolean);
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  const raw = String(value).trim();
  for (const candidate of [raw, (() => { try { return Buffer.from(raw, "base64").toString("utf8"); } catch { return ""; } })()]) {
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

function keyMaterial() {
  const material = process.env.USER_CREDENTIALS_ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.BACKEND_API_KEY || "";
  return material ? crypto.createHash("sha256").update(String(material)).digest() : null;
}

function decryptAesGcm(payload) {
  const key = keyMaterial();
  if (!key) return null;
  const iv = payload.iv || payload.nonce;
  const tag = payload.tag || payload.authTag || payload.auth_tag;
  const ciphertext = payload.ciphertext || payload.encrypted || payload.data;
  if (!iv || !tag || !ciphertext) return null;
  const enc = payload.encoding || "base64";
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, enc));
  decipher.setAuthTag(Buffer.from(tag, enc));
  const clear = Buffer.concat([decipher.update(Buffer.from(ciphertext, enc)), decipher.final()]).toString("utf8");
  return parseJsonMaybe(clear);
}

export function decryptUserAppCredentials(value) {
  const parsed = parseJsonMaybe(value);
  if (!parsed) return null;
  if (parsed.ciphertext || parsed.encrypted || String(parsed.algorithm || parsed.alg || "").includes("gcm")) {
    return decryptAesGcm(parsed) || null;
  }
  return parsed;
}

export function buildEncryptedCredentialsForStorage(credentials = {}) {
  const key = keyMaterial();
  if (!key) throw new Error("Missing credential encryption key material.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ algorithm: "aes-256-gcm", encoding: "base64", iv: iv.toString("base64"), tag: tag.toString("base64"), ciphertext: ciphertext.toString("base64") });
}

function appKeys(action = {}, ref = {}) {
  return [...new Set([ref.params?.app_key, action.action_key, action.module_binding, action.connector_family, "google_cloud", "google", "gcloud_api"].map(v => String(v || "").trim()).filter(Boolean))];
}

function scopeOk(granted = "", required = "") {
  const req = splitList(required);
  if (!req.length) return true;
  const got = splitList(granted);
  if (!got.length) return false;
  return req.some(r => got.some(g => g === r || g === "https://www.googleapis.com/auth/cloud-platform" || (g === "https://www.googleapis.com/auth/cloud-platform.read-only" && r.endsWith(".readonly"))));
}

function parseRuntimeBindingProfile(action = {}) {
  const profile = parseJsonMaybe(action.runtime_binding_profile);
  return profile && typeof profile === "object" ? profile : {};
}

function candidateAppKeys(action = {}, authContext = {}, explicitAppKey = "") {
  const profile = parseRuntimeBindingProfile(action);
  const strategy = profile.auth_strategy && typeof profile.auth_strategy === "object" ? profile.auth_strategy : {};
  return [...new Set([
    explicitAppKey,
    authContext.app_key,
    strategy.app_key,
    action.action_key,
    action.module_binding,
    action.connector_family,
  ].map(v => String(v || "").trim()).filter(Boolean))];
}

function normalizeAuthTypes(authType = "") {
  if (Array.isArray(authType)) return authType.map(v => String(v || "").trim()).filter(Boolean);
  return splitList(authType);
}

export function extractCredentialValue(credentials = {}, ...keys) {
  const sources = [credentials, credentials?.credentials, credentials?.oauth, credentials?.auth].filter(Boolean);
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return "";
}

export function extractCredentialHeaders(credentials = {}) {
  const headers = credentials?.headers || credentials?.custom_headers || credentials?.customHeaders || credentials?.credentials?.headers || {};
  return headers && typeof headers === "object" && !Array.isArray(headers) ? headers : {};
}

export async function findUserAppConnection({
  action = {},
  authContext = {},
  credentialScope = "",
  userId = "",
  tenantId = "",
  appKey = "",
  authType = "",
  connectionId = "",
  requiredScopes = ""
} = {}) {
  const scope = String(authContext.credential_scope || credentialScope || "").trim().toLowerCase();
  const resolvedUserId = String(authContext.user_id || userId || "").trim();
  const resolvedTenantId = String(authContext.tenant_id || tenantId || "").trim();
  const resolvedConnectionId = String(authContext.connection_id || connectionId || "").trim();
  const keys = candidateAppKeys(action, authContext, appKey);
  const authTypes = normalizeAuthTypes(authContext.auth_type || authType);
  const scopesRequired = String(authContext.scopes || requiredScopes || "").trim();

  const filters = ["uac.status='active'"];
  const params = [];

  if (resolvedConnectionId) {
    filters.push("CAST(uac.connection_id AS CHAR)=CAST(? AS CHAR)");
    params.push(resolvedConnectionId);
  } else if (["user", "member_user_id"].includes(scope)) {
    if (!resolvedUserId) return null;
    filters.push("CAST(uac.user_id AS CHAR)=CAST(? AS CHAR)");
    params.push(resolvedUserId);
  } else if (["tenant", "tenant_primary"].includes(scope)) {
    if (!resolvedTenantId) return null;
    filters.push("CAST(uac.tenant_id AS CHAR)=CAST(? AS CHAR)");
    params.push(resolvedTenantId);
  } else {
    return null;
  }

  if (keys.length) {
    filters.push(`uac.app_key IN (${keys.map(() => "?").join(",")})`);
    params.push(...keys);
  }
  if (authTypes.length) {
    filters.push(`uac.auth_type IN (${authTypes.map(() => "?").join(",")})`);
    params.push(...authTypes);
  }

  const [rows] = await getPool().query(
    `SELECT uac.*, u.email AS member_email
       FROM user_app_connections uac
       LEFT JOIN users u ON CAST(u.user_id AS CHAR)=CAST(uac.user_id AS CHAR)
      WHERE ${filters.join(" AND ")}
      ORDER BY uac.is_primary DESC, COALESCE(uac.last_used_at,uac.connected_at) DESC
      LIMIT 10`,
    params
  );

  for (const row of rows || []) {
    if (!scopeOk(row.scopes_granted, scopesRequired)) continue;
    const credentials = decryptUserAppCredentials(row.encrypted_credentials) || {};
    return { row, credentials, scope, authContext };
  }
  return null;
}

export async function findGoogleUserAppConnection({ action = {}, oauthConfigRef = "" } = {}) {
  const ref = parseOauthConfigRef(oauthConfigRef || action.oauth_config_ref || "");
  const keys = appKeys(action, ref);
  const ph = keys.map(() => "?").join(",");
  const requiredScopes = ref.params?.scopes || action.required_oauth_scopes || "";
  let sql = "", params = [];
  if (ref.mode === "member_email") {
    sql = `SELECT uac.*, u.email AS member_email FROM user_app_connections uac JOIN users u ON CAST(u.user_id AS CHAR)=CAST(uac.user_id AS CHAR) WHERE LOWER(u.email)=LOWER(?) AND uac.auth_type='oauth2' AND uac.status='active' AND uac.app_key IN (${ph}) ORDER BY uac.is_primary DESC, COALESCE(uac.last_used_at,uac.connected_at) DESC LIMIT 10`;
    params = [ref.value, ...keys];
  } else if (ref.mode === "member_user_id") {
    sql = `SELECT uac.*, u.email AS member_email FROM user_app_connections uac LEFT JOIN users u ON CAST(u.user_id AS CHAR)=CAST(uac.user_id AS CHAR) WHERE CAST(uac.user_id AS CHAR)=CAST(? AS CHAR) AND uac.auth_type='oauth2' AND uac.status='active' AND uac.app_key IN (${ph}) ORDER BY uac.is_primary DESC, COALESCE(uac.last_used_at,uac.connected_at) DESC LIMIT 10`;
    params = [ref.value, ...keys];
  } else if (ref.mode === "tenant_primary") {
    sql = "SELECT uac.*, u.email AS member_email FROM user_app_connections uac LEFT JOIN users u ON CAST(u.user_id AS CHAR)=CAST(uac.user_id AS CHAR) WHERE uac.tenant_id=? AND uac.app_key=? AND uac.auth_type='oauth2' AND uac.status='active' ORDER BY uac.is_primary DESC, COALESCE(uac.last_used_at,uac.connected_at) DESC LIMIT 10";
    params = [ref.params?.tenant_id || action.tenant_id || process.env.DEFAULT_TENANT_ID || "", ref.value || ref.params?.app_key || "google_cloud"];
  } else return null;
  const [rows] = await getPool().query(sql, params);
  for (const row of rows || []) {
    if (!scopeOk(row.scopes_granted, requiredScopes)) continue;
    const credentials = decryptUserAppCredentials(row.encrypted_credentials);
    if (credentials?.refresh_token || credentials?.refreshToken || credentials?.credentials?.refresh_token) return { row, credentials, ref };
  }
  return null;
}

export async function markUserAppConnectionUsed(connectionId) {
  if (!connectionId) return;
  try { await getPool().query("UPDATE user_app_connections SET last_used_at=CURRENT_TIMESTAMP WHERE connection_id=?", [connectionId]); } catch {}
}
