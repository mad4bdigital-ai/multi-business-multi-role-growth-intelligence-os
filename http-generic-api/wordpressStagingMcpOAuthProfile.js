import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from "node:crypto";
import { readFileSync } from "node:fs";
import {
  envFlag,
  remoteMcpOAuthEnabled,
  resolveRemoteMcpAllowedRedirectOrigins,
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpEnvironment,
} from "./remoteMcpOAuthProfile.js";

export const WORDPRESS_STAGING_MCP_SCOPE = "mad4b:read";
export const WORDPRESS_STAGING_MCP_OFFLINE_SCOPE = "offline_access";
export const WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES = Object.freeze([
  WORDPRESS_STAGING_MCP_SCOPE,
  WORDPRESS_STAGING_MCP_OFFLINE_SCOPE,
]);
export const WORDPRESS_STAGING_MCP_RESOURCE = "https://staging.egypttourgates.com/wp-json/mcp/mad4b-read";
export const WORDPRESS_STAGING_MCP_ISSUER_SUFFIX = "/wordpress-staging";
export const WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG = "RS256";
export const WORDPRESS_STAGING_MCP_PRIVATE_KEY_FILE = "/app/data/oauth/wordpress-staging-rs256-private.pem";
export const WORDPRESS_STAGING_MCP_CLIENT_ID_PREFIX = "mcp_stg_wp_";
export const WORDPRESS_STAGING_MCP_CLIENT_PROFILE_PREFIX = "wordpress_staging_mcp:";

function normalizeHttpsUrlWithPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
    return `${url.origin}${pathname}`;
  } catch {
    return "";
  }
}

function boundedSubjectComponent(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 128 || /[\s,]/u.test(normalized)) return "";
  return normalized;
}

export function buildWordpressStagingMcpSubject(userId, tenantId = null) {
  const user = boundedSubjectComponent(userId);
  if (!user) return "";
  const tenant = boundedSubjectComponent(tenantId);
  return tenant ? `tenant:${tenant}:user:${user}` : `user:${user}`;
}

export function resolveWordpressStagingMcpAllowedSubjects(env = process.env) {
  const entries = String(env.REMOTE_MCP_WORDPRESS_STAGING_ALLOWED_SUBJECTS || "")
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value.length <= 512 && (value.startsWith("user:") || value.startsWith("tenant:")));
  return new Set(entries);
}

export function wordpressStagingMcpSubjectAuthorizationConfigured(env = process.env) {
  return resolveWordpressStagingMcpAllowedSubjects(env).size > 0;
}

export function wordpressStagingMcpSubjectAllowed({ userId, tenantId = null } = {}, env = process.env) {
  const subject = buildWordpressStagingMcpSubject(userId, tenantId);
  return Boolean(subject) && resolveWordpressStagingMcpAllowedSubjects(env).has(subject);
}

export function generateWordpressStagingMcpClientId(env = process.env) {
  if (resolveRemoteMcpEnvironment(env) !== "staging") return "";
  return `${WORDPRESS_STAGING_MCP_CLIENT_ID_PREFIX}${randomBytes(18).toString("base64url")}`;
}

export function isWordpressStagingMcpClientId(clientId, env = process.env) {
  if (resolveRemoteMcpEnvironment(env) !== "staging") return false;
  const normalized = String(clientId || "").trim();
  if (!normalized.startsWith(WORDPRESS_STAGING_MCP_CLIENT_ID_PREFIX)) return false;
  const suffix = normalized.slice(WORDPRESS_STAGING_MCP_CLIENT_ID_PREFIX.length);
  return suffix.length >= 16 && suffix.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(suffix);
}

export function wordpressStagingMcpClientProfileKey(baseProfileKey) {
  const base = String(baseProfileKey || "generic_remote_mcp_client").trim().toLowerCase();
  const normalized = /^[a-z0-9_-]{1,96}$/u.test(base) ? base : "generic_remote_mcp_client";
  return `${WORDPRESS_STAGING_MCP_CLIENT_PROFILE_PREFIX}${normalized}`;
}

export function isWordpressStagingMcpClientRecord(client, env = process.env) {
  return Boolean(client)
    && isWordpressStagingMcpClientId(client.client_id, env)
    && String(client.client_profile_key || "").startsWith(WORDPRESS_STAGING_MCP_CLIENT_PROFILE_PREFIX)
    && Array.isArray(client.allowed_scopes)
    && client.allowed_scopes.includes(WORDPRESS_STAGING_MCP_SCOPE);
}

export function resolveWordpressStagingMcpResource(env = process.env) {
  return normalizeHttpsUrlWithPath(
    env.REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL || WORDPRESS_STAGING_MCP_RESOURCE,
  );
}

export function resolveWordpressStagingMcpIssuer(env = process.env) {
  const base = resolveRemoteMcpAuthorizationIssuer(env);
  if (!base) return "";
  return normalizeHttpsUrlWithPath(`${base}${WORDPRESS_STAGING_MCP_ISSUER_SUFFIX}`);
}

export function resolveWordpressStagingMcpPrivateKeyFile(env = process.env) {
  const configured = String(env.REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_FILE || "").trim();
  return configured || WORDPRESS_STAGING_MCP_PRIVATE_KEY_FILE;
}

export function wordpressStagingMcpOAuthConfigured(env = process.env) {
  return remoteMcpOAuthEnabled(env)
    && envFlag(env.REMOTE_MCP_WORDPRESS_STAGING_OAUTH_ENABLED)
    && resolveRemoteMcpEnvironment(env) === "staging"
    && Boolean(resolveWordpressStagingMcpIssuer(env))
    && Boolean(resolveWordpressStagingMcpResource(env));
}

export function wordpressStagingMcpDcrEnabled(env = process.env) {
  return wordpressStagingMcpOAuthConfigured(env)
    && envFlag(env.REMOTE_MCP_WORDPRESS_STAGING_DCR_ENABLED);
}

export function wordpressStagingMcpDcrAdvertised(env = process.env) {
  if (!wordpressStagingMcpDcrEnabled(env)) return false;
  return resolveRemoteMcpAllowedRedirectOrigins(env).size > 0
    || envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
}

function privateKeyPemFromFile(env = process.env) {
  const path = resolveWordpressStagingMcpPrivateKeyFile(env);
  if (!path) return "";
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function privateKeyPemFromBase64(env = process.env) {
  const encoded = String(env.REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_B64 || "").trim();
  if (!encoded) return "";
  try {
    return Buffer.from(encoded, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

export function resolveWordpressStagingMcpPrivateKey(env = process.env) {
  // Runtime prefers the persistent private-key file under /app/data. Base64 is
  // retained only as a bounded CI/emergency compatibility input and is never
  // emitted through status or metadata.
  const pem = privateKeyPemFromFile(env) || privateKeyPemFromBase64(env);
  if (!pem) return null;
  try {
    const key = createPrivateKey({ key: pem, format: "pem" });
    if (key.asymmetricKeyType !== "rsa") return null;
    const modulusLength = Number(key.asymmetricKeyDetails?.modulusLength || 0);
    if (modulusLength && modulusLength < 2048) return null;
    return key;
  } catch {
    return null;
  }
}

export function resolveWordpressStagingMcpPublicKey(env = process.env) {
  const privateKey = resolveWordpressStagingMcpPrivateKey(env);
  if (!privateKey) return null;
  try {
    return createPublicKey(privateKey);
  } catch {
    return null;
  }
}

export function resolveWordpressStagingMcpKeyId(env = process.env) {
  const publicKey = resolveWordpressStagingMcpPublicKey(env);
  if (!publicKey) return "";
  try {
    const der = publicKey.export({ type: "spki", format: "der" });
    return createHash("sha256").update(der).digest("base64url").slice(0, 32);
  } catch {
    return "";
  }
}

export function buildWordpressStagingMcpJwks(env = process.env) {
  const publicKey = resolveWordpressStagingMcpPublicKey(env);
  const kid = resolveWordpressStagingMcpKeyId(env);
  if (!publicKey || !kid) return { keys: [] };
  try {
    const jwk = publicKey.export({ format: "jwk" });
    if (!jwk?.n || !jwk?.e || jwk.kty !== "RSA") return { keys: [] };
    return {
      keys: [{
        kty: "RSA",
        n: jwk.n,
        e: jwk.e,
        use: "sig",
        alg: WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG,
        kid,
      }],
    };
  } catch {
    return { keys: [] };
  }
}

export function wordpressStagingMcpOAuthReady(env = process.env) {
  if (!wordpressStagingMcpOAuthConfigured(env)) return false;
  return Boolean(
    resolveWordpressStagingMcpPrivateKey(env)
    && resolveWordpressStagingMcpKeyId(env)
    && wordpressStagingMcpSubjectAuthorizationConfigured(env)
  );
}

export function getWordpressStagingMcpOAuthStatus(env = process.env) {
  const issuer = resolveWordpressStagingMcpIssuer(env);
  const resource = resolveWordpressStagingMcpResource(env);
  const kid = resolveWordpressStagingMcpKeyId(env);
  const keyFile = resolveWordpressStagingMcpPrivateKeyFile(env);
  const allowedSubjects = resolveWordpressStagingMcpAllowedSubjects(env);
  return {
    configured: wordpressStagingMcpOAuthConfigured(env),
    ready: wordpressStagingMcpOAuthReady(env),
    dcr_enabled: wordpressStagingMcpDcrEnabled(env),
    dcr_advertised: wordpressStagingMcpDcrAdvertised(env),
    environment: resolveRemoteMcpEnvironment(env),
    issuer,
    resource,
    resource_scope: WORDPRESS_STAGING_MCP_SCOPE,
    authorization_scopes: [...WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES],
    refresh_token_supported: true,
    access_token_alg: WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG,
    private_key_file_configured: Boolean(keyFile),
    private_key_loaded: Boolean(resolveWordpressStagingMcpPrivateKey(env)),
    jwks_ready: Boolean(kid),
    kid: kid || null,
    subject_authorization_required: true,
    subject_authorization_configured: allowedSubjects.size > 0,
    allowed_subject_count: allowedSubjects.size,
    subject_authorization_mode: "exact-subject-allowlist",
    client_id_namespace: WORDPRESS_STAGING_MCP_CLIENT_ID_PREFIX,
    client_profile_namespace: WORDPRESS_STAGING_MCP_CLIENT_PROFILE_PREFIX,
    secrets_included: false,
  };
}