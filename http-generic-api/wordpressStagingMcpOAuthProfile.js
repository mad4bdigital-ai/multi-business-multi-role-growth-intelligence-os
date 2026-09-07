import {
  createHash,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import {
  envFlag,
  remoteMcpOAuthEnabled,
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
  return Boolean(resolveWordpressStagingMcpPrivateKey(env) && resolveWordpressStagingMcpKeyId(env));
}

export function getWordpressStagingMcpOAuthStatus(env = process.env) {
  const issuer = resolveWordpressStagingMcpIssuer(env);
  const resource = resolveWordpressStagingMcpResource(env);
  const kid = resolveWordpressStagingMcpKeyId(env);
  const keyFile = resolveWordpressStagingMcpPrivateKeyFile(env);
  return {
    configured: wordpressStagingMcpOAuthConfigured(env),
    ready: wordpressStagingMcpOAuthReady(env),
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
    secrets_included: false,
  };
}
