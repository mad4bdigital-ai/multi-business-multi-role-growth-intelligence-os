import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  REMOTE_MCP_SCOPES as CATALOG_REMOTE_MCP_SCOPES,
  REMOTE_MCP_SUPPORTED_SCOPES as CATALOG_REMOTE_MCP_SUPPORTED_SCOPES,
} from "./remoteMcpScopeCatalog.js";
import { TENANT_GPT_SCOPE_AUTHORITY_URL } from "./tenantGptOAuthPreset.js";
import {
  getRemoteMcpClientProfile,
  remoteMcpProfileConfigKey,
  remoteMcpProfileSecretRef,
} from "./remoteMcpClientProfileRegistry.js";

export const REMOTE_MCP_RESOURCE = "https://mcp.mad4b.com";
export const REMOTE_MCP_AUTHORIZATION_SERVER = "https://auth.mad4b.com/auth/mcp";
export const REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REMOTE_MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REMOTE_MCP_AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
export const REMOTE_MCP_AUTHORIZATION_REQUEST_TTL_SECONDS = 5 * 60;
export const REMOTE_MCP_SCOPES = CATALOG_REMOTE_MCP_SCOPES;
export const REMOTE_MCP_SUPPORTED_SCOPES = CATALOG_REMOTE_MCP_SUPPORTED_SCOPES;

const TOKEN_ENDPOINT_AUTH_METHODS = new Set([
  "none",
  "client_secret_basic",
  "client_secret_post",
]);

export const REMOTE_MCP_CLIENT_SECRET_REF_PREFIX = "platform_secret:REMOTE_MCP_";

export function remoteMcpScopeAuthority() {
  return `${TENANT_GPT_SCOPE_AUTHORITY_URL}/scopes/*`;
}

export function remoteMcpClientConfigKey(environment, profileKey = "generic_remote_mcp_client") {
  return remoteMcpProfileConfigKey(environment, profileKey);
}

const REMOTE_MCP_ENVIRONMENT_KEYS = new Set(["staging", "production"]);

export function normalizeRemoteMcpEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return REMOTE_MCP_ENVIRONMENT_KEYS.has(normalized) ? normalized : "unknown";
}

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

export function resolveRemoteMcpEnvironment(env = process.env) {
  const explicit = normalizeRemoteMcpEnvironment(env.REMOTE_MCP_ENVIRONMENT);
  if (explicit !== "unknown") return explicit;

  const resource = resolveRemoteMcpOAuthResource(env);
  try {
    const resourceHost = new URL(resource).hostname.toLowerCase();
    if (resourceHost === "mcp-dev.mad4b.com") return "staging";
    if (resourceHost === "mcp.mad4b.com") return "production";
  } catch {}

  const issuer = resolveRemoteMcpAuthorizationIssuer(env);
  try {
    const issuerHost = new URL(issuer).hostname.toLowerCase();
    if (issuerHost === "dev.mad4b.com") return "staging";
    if (issuerHost === "auth.mad4b.com") return "production";
  } catch {}

  return "unknown";
}

export function getRemoteMcpEnvironmentProfile(env = process.env, profileKey = env.REMOTE_MCP_CLIENT_PROFILE_KEY || "generic_remote_mcp_client") {
  const environment = resolveRemoteMcpEnvironment(env);
  const profile = getRemoteMcpClientProfile(profileKey);
  return {
    environment,
    profile_key: profile.profile_key,
    profile,
    resource: resolveRemoteMcpOAuthResource(env),
    authorization_server: resolveRemoteMcpAuthorizationIssuer(env),
    scope_authority: remoteMcpScopeAuthority(),
    client_config_key: remoteMcpClientConfigKey(environment, profile.profile_key),
    client_secret_ref: environment === "unknown" ? "" : remoteMcpProfileSecretRef(environment, profile.profile_key),
    client_id_prefix: remoteMcpClientIdPrefix(environment),
    secrets_included: false,
  };
}

export function remoteMcpClientIdPrefix(environment) {
  const normalized = normalizeRemoteMcpEnvironment(environment);
  if (normalized === "staging") return "mcp_stg_";
  if (normalized === "production") return "mcp_prd_";
  return "mcp_";
}

export function generateRemoteMcpClientId(env = process.env) {
  return `${remoteMcpClientIdPrefix(resolveRemoteMcpEnvironment(env))}${randomBytes(18).toString("base64url")}`;
}

export function isRemoteMcpClientIdForEnvironment(clientId, env = process.env) {
  const normalizedClientId = String(clientId || "").trim();
  if (!/^mcp_[A-Za-z0-9_-]{4,128}$/u.test(normalizedClientId)) return false;
  const environment = resolveRemoteMcpEnvironment(env);
  if (environment === "unknown") return true;
  if (normalizedClientId.startsWith("mcp_stg_") || normalizedClientId.startsWith("mcp_prd_")) {
    const prefix = remoteMcpClientIdPrefix(environment);
    return normalizedClientId.startsWith(prefix)
      && normalizedClientId.slice(prefix.length).length >= 16;
  }
  // Existing unprefixed DCR identities remain valid for backward compatibility;
  // all newly provisioned identities use the environment-specific prefix above.
  return normalizedClientId.startsWith("mcp_");
}

export function resolveRemoteMcpOAuthSigningSecret(env = process.env) {
  const secret = String(env.REMOTE_MCP_OAUTH_SIGNING_SECRET || "").trim();
  const platformJwtSecret = String(env.JWT_SECRET || "").trim();
  if (secret.length < 32) return "";
  if (platformJwtSecret && secret === platformJwtSecret) return "";
  return secret;
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

export function remoteMcpDynamicClientRegistrationAdvertised(env = process.env) {
  if (!remoteMcpDynamicClientRegistrationEnabled(env)) return false;
  return resolveRemoteMcpAllowedRedirectOrigins(env).size > 0
    || envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
}

export function remoteMcpDynamicRedirectUriAllowed(value, env = process.env) {
  const normalized = normalizeRemoteMcpRedirectUri(value, env);
  if (!normalized) return false;
  const url = new URL(normalized);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
  if (loopback) return url.protocol === "http:" && envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
  return resolveRemoteMcpAllowedRedirectOrigins(env).has(url.origin);
}

export function normalizeRemoteMcpScopes(
  value,
  allowedScopes = REMOTE_MCP_SUPPORTED_SCOPES,
  defaultScopes = REMOTE_MCP_SCOPES,
) {
  const requested = Array.isArray(value)
    ? value
    : String(value || "").split(/\s+/u);
  const allowed = new Set(allowedScopes.map((scope) => String(scope || "").trim()).filter(Boolean));
  const normalized = [...new Set(requested.map((scope) => String(scope || "").trim()).filter(Boolean))];
  if (!normalized.length) {
    return { ok: true, scopes: [...new Set(defaultScopes)].filter((scope) => allowed.has(scope)) };
  }
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
