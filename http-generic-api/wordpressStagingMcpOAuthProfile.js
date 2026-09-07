import {
  createHash,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import {
  envFlag,
  remoteMcpOAuthEnabled,
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpEnvironment,
} from "./remoteMcpOAuthProfile.js";

export const WORDPRESS_STAGING_MCP_SCOPE = "mad4b:read";
export const WORDPRESS_STAGING_MCP_RESOURCE = "https://staging.egypttourgates.com/wp-json/mcp/mad4b-read";
export const WORDPRESS_STAGING_MCP_ISSUER_SUFFIX = "/wordpress-staging";
export const WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG = "RS256";

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

export function wordpressStagingMcpOAuthConfigured(env = process.env) {
  return remoteMcpOAuthEnabled(env)
    && envFlag(env.REMOTE_MCP_WORDPRESS_STAGING_OAUTH_ENABLED)
    && resolveRemoteMcpEnvironment(env) === "staging"
    && Boolean(resolveWordpressStagingMcpIssuer(env))
    && Boolean(resolveWordpressStagingMcpResource(env));
}

function decodePrivateKeyPem(env = process.env) {
  const encoded = String(env.REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_B64 || "").trim();
  if (!encoded) return "";
  try {
    return Buffer.from(encoded, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

export function resolveWordpressStagingMcpPrivateKey(env = process.env) {
  const pem = decodePrivateKeyPem(env);
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
  const privateKey = resolveWordpressStagingMcpPrivateKey(env);
  const kid = resolveWordpressStagingMcpKeyId(env);
  return Boolean(privateKey && kid);
}

export function getWordpressStagingMcpOAuthStatus(env = process.env) {
  const issuer = resolveWordpressStagingMcpIssuer(env);
  const resource = resolveWordpressStagingMcpResource(env);
  const kid = resolveWordpressStagingMcpKeyId(env);
  return {
    configured: wordpressStagingMcpOAuthConfigured(env),
    ready: wordpressStagingMcpOAuthReady(env),
    environment: resolveRemoteMcpEnvironment(env),
    issuer,
    resource,
    scope: WORDPRESS_STAGING_MCP_SCOPE,
    access_token_alg: WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG,
    private_key_configured: Boolean(String(env.REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_B64 || "").trim()),
    jwks_ready: Boolean(kid),
    kid: kid || null,
    secrets_included: false,
  };
}
