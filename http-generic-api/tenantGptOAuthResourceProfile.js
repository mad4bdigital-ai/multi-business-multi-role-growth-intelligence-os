import {
  TENANT_GPT_BASE_URL,
  TENANT_GPT_IS_STAGING_RUNTIME,
  TENANT_GPT_OAUTH_CLIENT_ID,
} from "./tenantGptOAuthPreset.js";

export const TENANT_GPT_ACTIVATION_OAUTH_CLIENT_ID = TENANT_GPT_IS_STAGING_RUNTIME
  ? (process.env.TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_ID || "mad4b-tenant-gpt-activation-staging")
  : TENANT_GPT_OAUTH_CLIENT_ID;
export const TENANT_GPT_AUTHORIZATION_SERVER = TENANT_GPT_BASE_URL;
export const TENANT_GPT_CORE_RESOURCE = TENANT_GPT_BASE_URL;
const ACTIVATION_STAGING_ENABLED = TENANT_GPT_IS_STAGING_RUNTIME
  && String(process.env.ACTIVATION_STAGING_GATEWAY_ENABLED || "").trim().toLowerCase() === "true";
export const TENANT_GPT_ACTIVATION_RESOURCE = TENANT_GPT_IS_STAGING_RUNTIME
  ? (ACTIVATION_STAGING_ENABLED ? (process.env.TENANT_GPT_STAGING_ACTIVATION_RESOURCE_URL || "https://activation-dev.mad4b.com") : "")
  : "https://activation.mad4b.com";
export const TENANT_GPT_ACTIVATION_AUTHORIZATION_SERVER = TENANT_GPT_IS_STAGING_RUNTIME
  ? (ACTIVATION_STAGING_ENABLED ? TENANT_GPT_AUTHORIZATION_SERVER : "")
  : "https://auth.mad4b.com";
export const TENANT_GPT_LEGACY_AUDIENCE = "mad4b-tenant-gpt";
export const TENANT_GPT_ACTIVATION_LEGACY_AUDIENCE_CUTOFF =
  process.env.TENANT_GPT_ACTIVATION_LEGACY_AUDIENCE_CUTOFF || "2026-10-31T23:59:59.000Z";

const RESOURCE_BY_HOST = new Map([
  [new URL(TENANT_GPT_CORE_RESOURCE).hostname, TENANT_GPT_CORE_RESOURCE],
  ...(TENANT_GPT_ACTIVATION_RESOURCE
    ? [[new URL(TENANT_GPT_ACTIVATION_RESOURCE).hostname, TENANT_GPT_ACTIVATION_RESOURCE]]
    : []),
]);

export function normalizeTenantGptRequestHost(value) {
  return String(value || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function tenantGptRequestHostFromHeaders(headers = {}) {
  const originalHost = normalizeTenantGptRequestHost(headers["x-original-host"]);
  const forwardedHost = normalizeTenantGptRequestHost(headers["x-forwarded-host"]);
  if (originalHost && forwardedHost && originalHost !== forwardedHost) return "";
  const candidates = [
    originalHost,
    forwardedHost,
    normalizeTenantGptRequestHost(headers["x-host"]),
    normalizeTenantGptRequestHost(headers[":authority"]),
    normalizeTenantGptRequestHost(headers.host),
  ];
  return candidates.find(Boolean) || "";
}

export function normalizeTenantGptOAuthResource(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    if (url.pathname.replace(/\/+$/, "")) return "";
    return [...RESOURCE_BY_HOST.values()].includes(url.origin) ? url.origin : "";
  } catch {
    return "";
  }
}

export function resolveTenantGptOAuthResourceProfile({
  clientId,
  requestHost,
  requestedResource = "",
} = {}) {
  const normalizedClientId = String(clientId || "").trim();
  const host = normalizeTenantGptRequestHost(requestHost);
  const resource = RESOURCE_BY_HOST.get(host) || "";
  const expectedClientId = resource === TENANT_GPT_ACTIVATION_RESOURCE
    ? TENANT_GPT_ACTIVATION_OAUTH_CLIENT_ID
    : TENANT_GPT_OAUTH_CLIENT_ID;
  if (!resource) {
    return { ok: false, error: "invalid_target", message: "The OAuth request host is not registered as a Tenant GPT protected resource." };
  }
  if (normalizedClientId !== expectedClientId) {
    return { ok: false, error: "invalid_client", message: "OAuth client_id is not allowed for the requested Tenant GPT resource." };
  }

  const explicitResource = String(requestedResource || "").trim();
  const normalizedExplicitResource = normalizeTenantGptOAuthResource(explicitResource);
  if (explicitResource && (!normalizedExplicitResource || normalizedExplicitResource !== resource)) {
    return { ok: false, error: "invalid_target", message: "The requested OAuth resource does not match the registered Action server resource." };
  }

  return {
    ok: true,
    profile_key: resource === TENANT_GPT_ACTIVATION_RESOURCE ? "tenant_activation" : "tenant_core",
    client_id: normalizedClientId,
    authorization_server: resource === TENANT_GPT_ACTIVATION_RESOURCE
      ? TENANT_GPT_ACTIVATION_AUTHORIZATION_SERVER
      : TENANT_GPT_AUTHORIZATION_SERVER,
    request_host: host,
    resource,
    audience: resource,
    requested_resource_present: Boolean(explicitResource),
    secrets_included: false,
  };
}

export function resolveTenantGptOAuthIssuer(resource) {
  const normalizedResource = normalizeTenantGptOAuthResource(resource);
  if (!normalizedResource) return "";
  if (normalizedResource === TENANT_GPT_ACTIVATION_RESOURCE) return TENANT_GPT_ACTIVATION_AUTHORIZATION_SERVER;
  if (normalizedResource === TENANT_GPT_CORE_RESOURCE) return TENANT_GPT_AUTHORIZATION_SERVER;
  return "";
}

export function tenantGptLegacyAudienceCutoffMs() {
  const parsed = Date.parse(TENANT_GPT_ACTIVATION_LEGACY_AUDIENCE_CUTOFF);
  return Number.isFinite(parsed) ? parsed : 0;
}
