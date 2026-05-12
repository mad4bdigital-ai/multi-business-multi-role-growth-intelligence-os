import { google } from "googleapis";
import { findGoogleUserAppConnection, markUserAppConnectionUsed, normalizeEmailKey, parseOauthConfigRef } from "./userAppConnectionCredentials.js";

const GOOGLE_WORKSPACE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive"];
const GOOGLE_SCOPES = [...GOOGLE_WORKSPACE_SCOPES, "https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/analytics", "https://www.googleapis.com/auth/analytics.edit", "https://www.googleapis.com/auth/analytics.manage.users", "https://www.googleapis.com/auth/analytics.manage.users.readonly", "https://www.googleapis.com/auth/analytics.provision", "https://www.googleapis.com/auth/doubleclicksearch", "https://www.googleapis.com/auth/webmasters", "https://www.googleapis.com/auth/tagmanager.readonly", "https://www.googleapis.com/auth/tagmanager.edit.containers", "https://www.googleapis.com/auth/tagmanager.edit.containers.readonly", "https://www.googleapis.com/auth/tagmanager.manage.accounts", "https://www.googleapis.com/auth/tagmanager.manage.users", "https://www.googleapis.com/auth/tagmanager.delete.containers", "https://www.googleapis.com/auth/tagmanager.edit.containerversions", "https://www.googleapis.com/auth/tagmanager.publish", "https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/cloud-platform.read-only", "https://www.googleapis.com/auth/cloudplatformprojects", "https://www.googleapis.com/auth/cloudplatformprojects.readonly"];
const cache = new Map();
let fetchingGlobal = false, warned = false, logged = false;

function parseSaJson(raw) { if (!raw) return null; try { const s = raw.trim(); return JSON.parse(s.startsWith("{") ? s : Buffer.from(s, "base64").toString("utf8")); } catch { return null; } }
function tokenFromResponse(resp) { return typeof resp === "string" ? resp : resp?.token || ""; }
function read(obj, ...keys) { for (const k of keys) if (obj?.[k]) return obj[k]; return ""; }
function normalizeRefreshCredentials(c = {}) { const n = c.credentials || c.oauth || {}; return { refresh_token: read(c, "refresh_token", "refreshToken") || read(n, "refresh_token", "refreshToken"), client_id: read(c, "client_id", "clientId") || read(n, "client_id", "clientId") || process.env.GOOGLE_CLIENT_ID, client_secret: read(c, "client_secret", "clientSecret") || read(n, "client_secret", "clientSecret") || process.env.GOOGLE_CLIENT_SECRET }; }
async function accessTokenFromRefreshCredentials(c = {}) { const x = normalizeRefreshCredentials(c); if (!x.refresh_token || !x.client_id || !x.client_secret) { const e = new Error("Missing Google OAuth refresh token/client id/client secret."); e.code = "oauth_credential_incomplete"; e.status = 403; throw e; } const oauth2 = new google.auth.OAuth2(x.client_id, x.client_secret); oauth2.setCredentials({ refresh_token: x.refresh_token }); const token = tokenFromResponse(await oauth2.getAccessToken()); if (!token) { const e = new Error("Google OAuth refresh returned no access token."); e.code = "oauth_token_refresh_failed"; e.status = 403; throw e; } return token; }
function envMemberCredentials(email = "") { const k = normalizeEmailKey(email); const rt = k ? process.env[`GOOGLE_REFRESH_TOKEN_${k}`] : ""; return rt ? { refresh_token: rt, client_id: process.env[`GOOGLE_CLIENT_ID_${k}`] || process.env.GOOGLE_CLIENT_ID, client_secret: process.env[`GOOGLE_CLIENT_SECRET_${k}`] || process.env.GOOGLE_CLIENT_SECRET, source: `env_member:${String(email).toLowerCase()}` } : null; }

export function getGoogleAuthCredentialSourcesForEnv(env = process.env) { const sources = []; if (String(env.GOOGLE_AUTH_MODE || "").toLowerCase() === "refresh_token" && env.GOOGLE_REFRESH_TOKEN) sources.push("refresh_token"); if (env.GOOGLE_APPLICATION_CREDENTIALS || parseSaJson(env.GOOGLE_SA_JSON)) sources.push("explicit_service_account"); else sources.push("managed_service_account_adc"); if (env.GOOGLE_REFRESH_TOKEN && !sources.includes("refresh_token")) sources.push("refresh_token"); return sources; }
function cacheKey(options = {}) { const action = options.action || {}; const ref = parseOauthConfigRef(options.oauth_config_ref || action.oauth_config_ref || ""); return ref.mode ? `ref:${action.action_key || ""}:${action.oauth_config_ref || ""}` : `global:${action.action_key || ""}`; }

async function getMemberScopedToken(options = {}) {
  const action = options.action || {};
  const ref = parseOauthConfigRef(options.oauth_config_ref || action.oauth_config_ref || "");
  if (!["member_email", "member_user_id", "tenant_primary"].includes(ref.mode)) return "";
  if (ref.mode === "member_email") {
    const envCreds = envMemberCredentials(ref.value);
    if (envCreds) { const token = await accessTokenFromRefreshCredentials(envCreds); console.log(`[googleAuth] Access token obtained via ${envCreds.source}.`); return token; }
  }
  const connection = await findGoogleUserAppConnection({ action, oauthConfigRef: options.oauth_config_ref || action.oauth_config_ref || "" });
  if (!connection) { const e = new Error(`No active Google OAuth connection found for ${action.oauth_config_ref || ref.mode}.`); e.code = "google_oauth_connection_not_found"; e.status = 403; throw e; }
  const token = await accessTokenFromRefreshCredentials(connection.credentials);
  await markUserAppConnectionUsed(connection.row.connection_id);
  console.log(`[googleAuth] Access token obtained via user_app_connections for ${connection.row.member_email || connection.row.account_label || "unknown account"}.`);
  return token;
}

async function fetchGlobalGoogleToken() {
  if (fetchingGlobal) return ""; fetchingGlobal = true;
  try {
    const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS, saJson = parseSaJson(process.env.GOOGLE_SA_JSON), refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const attempts = [];
    for (const source of getGoogleAuthCredentialSourcesForEnv(process.env)) {
      if (source === "explicit_service_account") attempts.push({ source: "explicit service account", run: async () => { const opts = { scopes: GOOGLE_SCOPES }; if (saJson) opts.credentials = saJson; else opts.keyFilename = credFile; const auth = new google.auth.GoogleAuth(opts); return (await auth.getClient()).getAccessToken(); } });
      if (source === "managed_service_account_adc") attempts.push({ source: "managed service account ADC", run: async () => { const auth = new google.auth.GoogleAuth({ scopes: GOOGLE_WORKSPACE_SCOPES }); return (await auth.getClient()).getAccessToken(); } });
      if (source === "refresh_token") attempts.push({ source: "refresh token", run: async () => accessTokenFromRefreshCredentials({ refresh_token: refreshToken, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET }) });
    }
    let last = null;
    for (const a of attempts) { try { const token = tokenFromResponse(await a.run()); if (token) { if (!logged) { logged = true; console.log(`[googleAuth] Access token obtained via ${a.source}.`); } return token; } } catch (e) { last = e; } }
    if (!warned) { warned = true; console.warn("[googleAuth] Could not obtain a Google access token." + (last?.message ? ` Last error: ${last.message}` : "")); }
    return "";
  } finally { fetchingGlobal = false; }
}

export function getGoogleAccessTokenSync(options = {}) { const hit = cache.get(cacheKey(options)); if (hit?.token && hit.expiresAt > Date.now() + 60000) return hit.token; getGoogleAccessToken(options).catch(() => {}); return hit?.token || ""; }
export async function getGoogleAccessToken(options = {}) { const key = cacheKey(options); const hit = cache.get(key); if (hit?.token && hit.expiresAt > Date.now() + 60000) return hit.token; const action = options.action || {}; const ref = parseOauthConfigRef(options.oauth_config_ref || action.oauth_config_ref || ""); const token = ref.mode ? await getMemberScopedToken(options) : await fetchGlobalGoogleToken(); if (token) cache.set(key, { token, expiresAt: Date.now() + 55 * 60000 }); return token; }

if (String(process.env.GOOGLE_AUTH_DISABLE_PREWARM || "").trim().toLowerCase() !== "true") { fetchGlobalGoogleToken().catch(() => {}); setInterval(() => fetchGlobalGoogleToken().catch(() => {}), 50 * 60000).unref(); }
