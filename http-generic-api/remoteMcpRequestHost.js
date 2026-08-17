import {
  REMOTE_MCP_RESOURCE,
  normalizeRemoteMcpResource,
} from "./remoteMcpOAuthProfile.js";
import {
  normalizeTrustedRequestHost,
  resolveTrustedRequestHost,
  trustedProxyHostHeadersEnabled,
} from "./trustedRequestHost.js";

export function normalizeRemoteMcpRequestHost(value) {
  return normalizeTrustedRequestHost(value);
}

export function remoteMcpTrustedProxyHostHeadersEnabled(env = process.env) {
  return trustedProxyHostHeadersEnabled(env);
}

export function resolveRemoteMcpEffectiveRequestHost(requestOrHeaders = {}, env = process.env) {
  return resolveTrustedRequestHost(requestOrHeaders, env);
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
