import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";

export const LOCAL_CONNECTOR_INSTALLER_CAPABILITY_CONTRACT = "mad4b.local-connector-installer-capability.v1";
export const LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS = 10 * 60;
export const LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MIN_TTL_SECONDS = 5 * 60;
export const LOCAL_CONNECTOR_INSTALLER_DOWNLOAD_PURPOSE = "local_connector_installer_download";
export const LOCAL_CONNECTOR_INSTALLER_REDEEM_PURPOSE = "local_connector_installer_secret_redeem";

function capabilityError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.details = { secrets_included: false };
  return err;
}

function compact(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function installerTokenSecret(env = process.env) {
  const secret = compact(env?.BACKEND_API_KEY, 4096);
  if (!secret) throw capabilityError(500, "installer_token_secret_missing", "BACKEND_API_KEY is required for installer capabilities.");
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function installerControlPlaneBinding(env = process.env) {
  const runtime = resolveRuntimeEnvironmentStrict(env);
  if (!runtime.ok || !["staging", "production"].includes(runtime.environment_key)) {
    throw capabilityError(503, "installer_runtime_environment_unresolved", `Installer runtime environment is not exact: ${runtime.reason || "unknown"}.`);
  }
  const host = runtime.environment_key === "staging" ? "dev.mad4b.com" : "auth.mad4b.com";
  return Object.freeze({
    environment: runtime.environment_key,
    runtime_class: runtime.runtime_class,
    baseUrl: `https://${host}`,
    host,
    secrets_included: false,
  });
}

export function assertNoInstallerAuthorityOverrides(source = {}) {
  const capabilities = Array.isArray(source?.capabilities)
    ? source.capabilities.filter((value) => String(value || "").trim())
    : String(source?.capabilities || "").split(",").filter((value) => String(value || "").trim());
  const grants = source?.permission_grants && typeof source.permission_grants === "object" && !Array.isArray(source.permission_grants)
    ? source.permission_grants
    : {};
  const hasGrantValues = Object.values(grants).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return Boolean(String(value || "").trim());
  });
  if (capabilities.length > 0 || hasGrantValues) {
    throw capabilityError(
      403,
      "installer_permission_grants_server_managed",
      "Installer capabilities and permission grants are server-managed by the canonical Local Connector policy and cannot be supplied by the caller.",
    );
  }
}

export function createInstallerCapability({
  config_id,
  user_id,
  tenant_id,
  device_id,
  format = "ps1",
  app_managed = false,
  purpose = LOCAL_CONNECTOR_INSTALLER_DOWNLOAD_PURPOSE,
  ttl_minutes = 10,
  env = process.env,
  now_seconds = Math.floor(Date.now() / 1000),
} = {}) {
  const binding = installerControlPlaneBinding(env);
  const normalizedFormat = compact(format, 16).toLowerCase();
  if (![LOCAL_CONNECTOR_INSTALLER_DOWNLOAD_PURPOSE, LOCAL_CONNECTOR_INSTALLER_REDEEM_PURPOSE].includes(purpose)) {
    throw capabilityError(400, "installer_capability_purpose_invalid", "Installer capability purpose is not supported.");
  }
  if (!["ps1", "bat"].includes(normalizedFormat)) {
    throw capabilityError(400, "unsupported_format", "Only ps1 or bat installer capabilities are supported.");
  }
  const configId = compact(config_id, 64);
  const userId = compact(user_id, 64);
  const tenantId = compact(tenant_id, 64);
  const deviceId = compact(device_id, 128);
  if (!configId || !userId || !tenantId || !deviceId) {
    throw capabilityError(400, "installer_capability_scope_incomplete", "Installer capability requires exact config, user, tenant, and device scope.");
  }
  const requestedTtl = Math.floor(Number(ttl_minutes || 10) * 60);
  const ttlSeconds = Math.max(
    LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MIN_TTL_SECONDS,
    Math.min(LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS, Number.isFinite(requestedTtl) ? requestedTtl : LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS),
  );
  const issuedAt = Math.floor(Number(now_seconds));
  return Object.freeze({
    version: 1,
    contract: LOCAL_CONNECTOR_INSTALLER_CAPABILITY_CONTRACT,
    purpose,
    aud: "connector_agent",
    environment: binding.environment,
    config_id: configId,
    user_id: userId,
    tenant_id: tenantId,
    device_id: deviceId,
    format: normalizedFormat,
    app_managed: app_managed === true,
    jti: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  });
}

export function signInstallerDownloadToken(payload, { env = process.env } = {}) {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", installerTokenSecret(env)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyInstallerDownloadToken(token, { env = process.env, expectedFormat = null, expectedPurpose = LOCAL_CONNECTOR_INSTALLER_DOWNLOAD_PURPOSE, now_seconds = Math.floor(Date.now() / 1000) } = {}) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) throw capabilityError(401, "invalid_download_token", "Invalid installer capability.");
  const expected = createHmac("sha256", installerTokenSecret(env)).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw capabilityError(401, "invalid_download_token", "Invalid installer capability signature.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw capabilityError(401, "invalid_download_token", "Invalid installer capability payload.");
  }
  const binding = installerControlPlaneBinding(env);
  const now = Math.floor(Number(now_seconds));
  const issuedAt = Number(payload?.iat || 0);
  const expiresAt = Number(payload?.exp || 0);
  const requiredStrings = [payload?.config_id, payload?.user_id, payload?.tenant_id, payload?.device_id, payload?.jti]
    .every((value) => Boolean(compact(value, 128)));
  if (
    payload?.version !== 1 ||
    payload?.contract !== LOCAL_CONNECTOR_INSTALLER_CAPABILITY_CONTRACT ||
    payload?.purpose !== expectedPurpose ||
    payload?.aud !== "connector_agent" ||
    payload?.environment !== binding.environment ||
    !requiredStrings ||
    !["ps1", "bat"].includes(compact(payload?.format, 16).toLowerCase()) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS ||
    issuedAt > now + 60 ||
    expiresAt < now
  ) {
    throw capabilityError(401, "installer_capability_invalid", "Installer capability claims are invalid, expired, or outside the current environment.");
  }
  if (expectedFormat && compact(payload.format, 16).toLowerCase() !== compact(expectedFormat, 16).toLowerCase()) {
    throw capabilityError(400, "unsupported_format", `Installer capability must target ${expectedFormat}.`);
  }
  return Object.freeze({ ...payload, format: compact(payload.format, 16).toLowerCase() });
}
