import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const REMOTE_MCP_RESOURCE = "https://mcp.mad4b.com";
export const REMOTE_MCP_AUTHORIZATION_SERVER = "https://auth.mad4b.com/auth/mcp";
export const REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REMOTE_MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REMOTE_MCP_AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
export const REMOTE_MCP_AUTHORIZATION_REQUEST_TTL_SECONDS = 5 * 60;
export const REMOTE_MCP_SCOPES = Object.freeze([
  "workspaces.read",
  "brands.read",
]);

const TOKEN_ENDPOINT_AUTH_METHODS = new Set([
  "none",
  "client_secret_basic",
  "client_secret_post",
]);

export function envFlag(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function normalizeRemoteMcpResource(value = REMOTE_MCP_RESOURCE) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    if (url.pathname.replace(/\/+$/u, "")) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function resolveRemoteMcpOAuthResource(env = process.env) {
  return normalizeRemoteMcpResource(env.REMOTE_MCP_RESOURCE_URL || REMOTE_MCP_RESOURCE);
}

export function resolveRemoteMcpAuthorizationIssuer(env = process.env) {
  const raw = String(env.REMOTE_MCP_AUTHORIZATION_SERVER_URL || REMOTE_MCP_AUTHORIZATION_SERVER)
    .trim()
    .replace(/\/+$/u, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return "";
  }
}

export function resolveRemoteMcpOAuthSigningSecret(env = process.env) {
  return String(env.REMOTE_MCP_OAUTH_SIGNING_SECRET || "").trim();
}

export function remoteMcpOAuthEnabled(env = process.env) {
  return envFlag(env.REMOTE_MCP_OAUTH_ENABLED);
}

export function remoteMcpDynamicClientRegistrationEnabled(env = process.env) {
  return envFlag(env.REMOTE_MCP_OAUTH_DCR_ENABLED);
}

export function normalizeRemoteMcpRedirectUri(value, env = process.env) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash) return "";
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:" && envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK))) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function resolveRemoteMcpAllowedRedirectOrigins(env = process.env) {
  const origins = String(env.REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS || "")
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return "";
        return url.origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return new Set(origins);
}

export function remoteMcpDynamicRedirectUriAllowed(value, env = process.env) {
  const normalized = normalizeRemoteMcpRedirectUri(value, env);
  if (!normalized) return false;
  const url = new URL(normalized);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
  if (loopback) return url.protocol === "http:" && envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
  return resolveRemoteMcpAllowedRedirectOrigins(env).has(url.origin);
}

export function normalizeRemoteMcpScopes(value, allowedScopes = REMOTE_MCP_SCOPES) {
  const requested = Array.isArray(value)
    ? value
    : String(value || "").split(/\s+/u);
  const allowed = new Set(allowedScopes.map((scope) => String(scope || "").trim()).filter(Boolean));
  const normalized = [...new Set(requested.map((scope) => String(scope || "").trim()).filter(Boolean))];
  if (!normalized.length) return { ok: true, scopes: [...allowed] };
  const rejected = normalized.filter((scope) => !allowed.has(scope));
  if (rejected.length) return { ok: false, scopes: [], rejected };
  return { ok: true, scopes: normalized };
}

export function normalizeTokenEndpointAuthMethod(value) {
  const normalized = String(value || "none").trim().toLowerCase();
  return TOKEN_ENDPOINT_AUTH_METHODS.has(normalized) ? normalized : "";
}

export function classifyRemoteMcpClientProfile({ clientName, redirectUris = [] } = {}) {
  const haystack = [clientName, ...redirectUris].join(" ").toLowerCase();
  if (haystack.includes("claude") || haystack.includes("anthropic")) return "anthropic_claude";
  if (haystack.includes("chatgpt") || haystack.includes("openai") || haystack.includes("codex")) return "openai_chatgpt";
  return "generic_remote_mcp_client";
}

export function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function verifyPkceS256(codeVerifier, expectedChallenge) {
  const verifier = String(codeVerifier || "");
  const expected = String(expectedChallenge || "");
  if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier) || !/^[A-Za-z0-9_-]{43}$/u.test(expected)) return false;
  const actual = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function fixedTimeSecretEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
