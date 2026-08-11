import {
  REMOTE_MCP_RESOURCE,
  envFlag,
  normalizeRemoteMcpResource,
} from "./remoteMcpOAuthProfile.js";

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const lowered = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== lowered) continue;
    if (Array.isArray(value)) return value.length === 1 ? String(value[0] ?? "") : "";
    return String(value ?? "");
  }
  return "";
}

export function normalizeRemoteMcpRequestHost(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes(",") || /[\s/?#@\\]/u.test(raw)) return "";
  try {
    const url = new URL(`https://${raw}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function remoteMcpTrustedProxyHostHeadersEnabled(env = process.env) {
  return envFlag(env.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS);
}

export function resolveRemoteMcpEffectiveRequestHost(requestOrHeaders = {}, env = process.env) {
  const headers = requestOrHeaders?.headers || requestOrHeaders || {};

  if (remoteMcpTrustedProxyHostHeadersEnabled(env)) {
    const originalHost = headerValue(headers, "x-original-host");
    if (originalHost) return normalizeRemoteMcpRequestHost(originalHost);

    const forwardedHost = headerValue(headers, "x-forwarded-host");
    if (forwardedHost) return normalizeRemoteMcpRequestHost(forwardedHost);
  }

  return normalizeRemoteMcpRequestHost(
    headerValue(headers, ":authority") || headerValue(headers, "host"),
  );
}

export function resolveRemoteMcpConfiguredResource(env = process.env) {
  return normalizeRemoteMcpResource(
    env.REMOTE_MCP_RESOURCE_URL
      || env.CHATGPT_MCP_RESOURCE_URL
      || REMOTE_MCP_RESOURCE,
  );
}

export function resolveRemoteMcpConfiguredHost(env = process.env) {
  const resource = resolveRemoteMcpConfiguredResource(env);
  if (!resource) return "";
  try {
    return new URL(resource).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function remoteMcpRequestUsesCanonicalHost(requestOrHeaders = {}, env = process.env) {
  const configuredHost = resolveRemoteMcpConfiguredHost(env);
  const requestHost = resolveRemoteMcpEffectiveRequestHost(requestOrHeaders, env);
  return Boolean(configuredHost && requestHost && configuredHost === requestHost);
}
