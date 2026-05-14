import { google } from "googleapis";
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { findGoogleUserAppConnection, markUserAppConnectionUsed, normalizeEmailKey, parseOauthConfigRef } from "./userAppConnectionCredentials.js";

const GOOGLE_WORKSPACE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive"];

const cache = new Map();
let fetchingGlobal = false, warned = false, logged = false;

function normalizeAuthMode(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeSaCredentials(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (typeof obj.private_key === "string" && !obj.private_key.includes("\n")) {
    return { ...obj, private_key: obj.private_key.replace(/\\n/g, "\n") };
  }
  return obj;
}

function parseSaJson(raw) {
  if (!raw) return null;
  try {
    const s = raw.trim();
    const parsed = JSON.parse(s.startsWith("{") ? s : Buffer.from(s, "base64").toString("utf8"));
    return normalizeSaCredentials(parsed);
  } catch {
    return null;
  }
}

function loadSaFile(filePath) {
  if (!filePath) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    return normalizeSaCredentials(JSON.parse(raw));
  } catch {
    return null;
  }
}

function tokenFromResponse(resp) {
  return typeof resp === "string" ? resp : resp?.token || "";
}

function read(obj, ...keys) {
  for (const k of keys) if (obj?.[k]) return obj[k];
  return "";
}

function normalizeRefreshCredentials(c = {}) {
  const n = c.credentials || c.oauth || {};
  return {
    refresh_token: read(c, "refresh_token", "refreshToken") || read(n, "refresh_token", "refreshToken"),
    client_id: read(c, "client_id", "clientId") || read(n, "client_id", "clientId") || process.env.GOOGLE_CLIENT_ID,
    client_secret: read(c, "client_secret", "clientSecret") || read(n, "client_secret", "clientSecret") || process.env.GOOGLE_CLIENT_SECRET
  };
}

async function accessTokenFromRefreshCredentials(c = {}) {
  const x = normalizeRefreshCredentials(c);
  if (!x.refresh_token || !x.client_id || !x.client_secret) {
    const e = new Error("Missing Google OAuth refresh token/client id/client secret.");
    e.code = "oauth_credential_incomplete";
    e.status = 403;
    throw e;
  }
  const oauth2 = new google.auth.OAuth2(x.client_id, x.client_secret);
  oauth2.setCredentials({ refresh_token: x.refresh_token });
  const token = tokenFromResponse(await oauth2.getAccessToken());
  if (!token) {
    const e = new Error("Google OAuth refresh returned no access token.");
    e.code = "oauth_token_refresh_failed";
    e.status = 403;
    throw e;
  }
  return token;
}

function envMemberCredentials(email = "") {
  const k = normalizeEmailKey(email);
  const rt = k ? process.env[`GOOGLE_REFRESH_TOKEN_${k}`] : "";
  return rt ? {
    refresh_token: rt,
    client_id: process.env[`GOOGLE_CLIENT_ID_${k}`] || process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env[`GOOGLE_CLIENT_SECRET_${k}`] || process.env.GOOGLE_CLIENT_SECRET,
    source: `env_member:${String(email).toLowerCase()}`
  } : null;
}

export function getGoogleAuthCredentialSourcesForEnv(env = process.env) {
  const sources = [];
  const authMode = normalizeAuthMode(env.GOOGLE_AUTH_MODE);
  const hasExplicitServiceAccount = Boolean(
    env.GOOGLE_APPLICATION_CREDENTIALS || env.GOOGLE_CREDENTIALS_PATH || parseSaJson(env.GOOGLE_SA_JSON)
  );
  const hasRefreshToken = Boolean(env.GOOGLE_REFRESH_TOKEN);

  if (authMode === "refresh_token") {
    if (hasRefreshToken) sources.push("refresh_token");
    return sources;
  }

  if (hasExplicitServiceAccount) {
    sources.push("explicit_service_account");
  } else {
    sources.push("managed_service_account_adc");
  }

  if (hasRefreshToken && authMode === "") {
    sources.push("refresh_token");
  }

  return [...new Set(sources)];
}

function cacheKey(options = {}) {
  const action = options.action || {};
  const ref = parseOauthConfigRef(options.oauth_config_ref || action.oauth_config_ref || "");
  return ref.mode ? `ref:${action.action_key || ""}:${action.oauth_config_ref || ""}` : `global:${action.action_key || ""}`;
}

async function getMemberScopedToken(options = {}) {
  const action = options.action || {};
  const ref = parseOauthConfigRef(options.oauth_config_ref || action.oauth_config_ref || "");
  if (!["member_email", "member_user_id", "tenant_primary"].includes(ref.mode)) return "";
  if (ref.mode === "member_email") {
    const envCreds = envMemberCredentials(ref.value);
    if (envCreds) {
      const token = await accessTokenFromRefreshCredentials(envCreds);
      console.log(`[googleAuth] Access token obtained via ${envCreds.source}.`);
      return token;
    }
  }
  const connection = await findGoogleUserAppConnection({ action, oauthConfigRef: options.oauth_config_ref || action.oauth_config_ref || "" });
  if (!connection) {
    const e = new Error(`No active Google OAuth connection found for ${action.oauth_config_ref || ref.mode}.`);
    e.code = "google_oauth_connection_not_found";
    e.status = 403;
    throw e;
  }
  const token = await accessTokenFromRefreshCredentials(connection.credentials);
  await markUserAppConnectionUsed(connection.row.connection_id);
  console.log(`[googleAuth] Access token obtained via user_app_connections for ${connection.row.member_email || connection.row.account_label || "unknown account"}.`);
  return token;
}

async function saJsonToAccessToken(saJson, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = saJson.token_uri || "https://oauth2.googleapis.com/token";
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: saJson.private_key_id })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: saJson.client_email, scope: scopes.join(" "), aud: tokenUri, exp: now + 3600, iat: now })).toString("base64url");
  const sigInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(sigInput);
  const sig = sign.sign(saJson.private_key).toString("base64url");
  const jwt = `${sigInput}.${sig}`;
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) {
    const e = new Error(`SA token exchange failed (HTTP ${res.status}): ${data.error || JSON.stringify(data)}`);
    e.code = "sa_token_exchange_failed";
    e.status = 403;
    throw e;
  }
  return data.access_token;
}

async function fetchGlobalGoogleToken() {
  if (fetchingGlobal) return "";
  fetchingGlobal = true;
  try {
    const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS_PATH;
    const saJson = parseSaJson(process.env.GOOGLE_SA_JSON) || loadSaFile(credFile);
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const attempts = [];

    for (const source of getGoogleAuthCredentialSourcesForEnv(process.env)) {
      if (source === "explicit_service_account") {
        attempts.push({
          source: "explicit service account",
          run: async () => saJson
            ? saJsonToAccessToken(saJson, GOOGLE_WORKSPACE_SCOPES)
            : (() => { throw new Error("No SA JSON loaded and no keyFilename fallback."); })()
        });
      }

      if (source === "managed_service_account_adc") {
        attempts.push({
          source: "managed service account ADC",
          run: async () => {
            // ADC attempts the GCP metadata server (169.254.169.254) which hangs
            // indefinitely on non-GCP hosts like Hostinger. Hard-cap at 5s.
            const auth = new google.auth.GoogleAuth({ scopes: GOOGLE_WORKSPACE_SCOPES });
            const deadline = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("ADC metadata server timeout (non-GCP host)")), 5000)
            );
            return Promise.race([
              (async () => {
                const client = await auth.getClient();
                return client.getAccessToken();
              })(),
              deadline
            ]);
          }
        });
      }

      if (source === "refresh_token") {
        attempts.push({
          source: "refresh token",
          run: async () => accessTokenFromRefreshCredentials({
            refresh_token: refreshToken,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET
          })
        });
      }
    }

    let last = null;
    for (const a of attempts) {
      try {
        const token = tokenFromResponse(await a.run());
        if (token) {
          if (!logged) {
            logged = true;
            console.log(`[googleAuth] Access token obtained via ${a.source}.`);
          }
          return token;
        }
      } catch (e) {
        last = e;
      }
    }

    if (!warned) {
      warned = true;
      const sourceSummary = getGoogleAuthCredentialSourcesForEnv(process.env).join(", ") || "none";
      console.warn("[googleAuth] Could not obtain a Google access token." + (last?.message ? ` Last error: ${last.message}` : "") + ` Sources attempted: ${sourceSummary}`);
    }
    return "";
  } finally {
    fetchingGlobal = false;
  }
}

export function getGoogleAccessTokenSync(options = {}) {
  const hit = cache.get(cacheKey(options));
  if (hit?.token && hit.expiresAt > Date.now() + 60000) return hit.token;
  getGoogleAccessToken(options).catch(() => {});
  return hit?.token || "";
}

export async function getGoogleAccessToken(options = {}) {
  const key = cacheKey(options);
  const hit = cache.get(key);
  if (hit?.token && hit.expiresAt > Date.now() + 60000) return hit.token;
  const action = options.action || {};
  const ref = parseOauthConfigRef(options.oauth_config_ref || action.oauth_config_ref || "");
  const token = ref.mode ? await getMemberScopedToken(options) : await fetchGlobalGoogleToken();
  if (token) cache.set(key, { token, expiresAt: Date.now() + 55 * 60000 });
  return token;
}

if (String(process.env.GOOGLE_AUTH_DISABLE_PREWARM || "").trim().toLowerCase() !== "true") {
  fetchGlobalGoogleToken().catch(() => {});
  setInterval(() => fetchGlobalGoogleToken().catch(() => {}), 50 * 60000).unref();
}
