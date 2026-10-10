// Admin-only canonical target resolution. This module is read-only and never moves credentials.
export const PLATFORM_ADMIN_USER_ID = "00000000-0000-4000-a000-000000000002";
export const PLATFORM_TENANT_ID = "00000000-0000-4000-a000-000000000001";
export const MAX_HEARTBEAT_AGE_MS = 10 * 60 * 1000;
const str = value => String(value ?? "").trim();
const enabled = row => row.is_enabled === true || Number(row.is_enabled) === 1;

export function targetError(code, message, status = 409) {
  const err = new Error(message); err.code = code; err.status = status; return err;
}

export function adminConnectorScope(req = {}, input = {}) {
  const auth = req.auth || {};
  const requestedUser = str(input.user_id), requestedTenant = str(input.tenant_id);
  if (["user_jwt", "api_credential"].includes(auth.mode) &&
    (!str(auth.user_id) || !str(auth.tenant_id))) {
    throw targetError("device_signed_identity_missing",
      "A tenant-scoped identity requires a signed user and tenant.", 403);
  }
  if (["user_jwt", "api_credential"].includes(auth.mode) &&
    ((requestedUser && requestedUser !== str(auth.user_id)) ||
     (requestedTenant && requestedTenant !== str(auth.tenant_id)))) {
    throw targetError("device_scope_mismatch", "Requested user/tenant differs from authenticated identity.", 403);
  }
  const user_id = requestedUser || str(auth.user_id) || PLATFORM_ADMIN_USER_ID;
  const tenant_id = requestedTenant || str(auth.tenant_id) ||
    (user_id === PLATFORM_ADMIN_USER_ID ? PLATFORM_TENANT_ID : "");
  if (!tenant_id) throw targetError("device_tenant_scope_required",
    "tenant_id must be explicit when selecting a non-platform user.", 400);
  return { user_id, tenant_id };
}

export function describeDevice(row, now = Date.now()) {
  const raw = row.last_health_at ? new Date(row.last_health_at).getTime() : NaN;
  const age = Number.isFinite(raw) ? now - raw : null;
  const life = str(row.lifecycle_state).toLowerCase();
  let state = "ACTIVE";
  if (row.revoked_at || life === "revoked") state = "REVOKED";
  else if (row.archived_at || life === "archived") state = "ARCHIVED";
  else if (!enabled(row) || life !== "active") state = "DISABLED";
  else if (age === null || age < -30000 || age > MAX_HEARTBEAT_AGE_MS) state = "STALE";
  return {
    config_id: str(row.config_id), device_id: str(row.device_id), state,
    last_health_at: Number.isFinite(raw) ? new Date(raw).toISOString() : null,
    heartbeat_age_ms: age, secrets_included: false,
  };
}

export function chooseDevice(rows, requestedDeviceId = "", now = Date.now(), {intent = "execution"} = {}) {
  const requested = str(requestedDeviceId);
  if (requested && !/^[a-z0-9][a-z0-9_-]{1,127}$/i.test(requested)) {
    throw targetError("device_id_invalid", "Invalid device ID.", 400);
  }
  if (!["execution", "diagnosis", "installer"].includes(intent)) {
    throw targetError("device_target_intent_invalid", "Unsupported connector target intent.", 400);
  }
  // Diagnostic and installer paths must name the canonical device explicitly.
  // A stale device never becomes an automatic selection or a command target.
  if (intent !== "execution" && !requested) {
    throw targetError("target_device_required",
      "Explicit canonical device selection is required for recovery or installer operations.");
  }
  const examined = rows.map(row => ({ row, state: describeDevice(row, now).state }));
  const candidates = requested ?
    examined.filter(item => str(item.row.device_id).toLowerCase() === requested.toLowerCase()) :
    examined.filter(item => item.state === "ACTIVE");
  if (candidates.length > 1) throw targetError("device_target_ambiguous",
    "Multiple device configurations match; select one canonical device explicitly.");
  if (!candidates.length) throw targetError(
    requested ? "device_target_not_found" : "device_target_unavailable",
    "No unique eligible device matches the exact authenticated user and tenant.");
  const state = candidates[0].state;
  const permissible = state === "ACTIVE" ||
    ((intent === "diagnosis" || intent === "installer") && state === "STALE");
  if (!permissible) throw targetError("device_target_not_trusted",
    "This device is disabled, revoked, archived, or unavailable for the requested operation.");
  return { row: candidates[0].row, state,
    selection_source: requested ? "explicit_canonical_id" : "unique_fresh_device",
    intent, execution_allowed: state === "ACTIVE" && intent === "execution" };
}

export function validateAdminRecoveryEndpoint(tunnelUrl, cfTunnelId = null, configId = null) {
  let url;
  try { url = new URL(str(tunnelUrl)); }
  catch { throw targetError("connector_route_untrusted", "Connector runtime URL is missing or invalid."); }
  const hostname = url.hostname.toLowerCase();
  const tunnel = str(cfTunnelId).toLowerCase();
  // Shared admin/break-glass hosts can be healthy while the selected device
  // is unavailable; never interpret their health as this device's own route.
  const authorized =
    (Boolean(str(configId)) && hostname === `lc-${str(configId).split("-")[0].toLowerCase()}.mad4b.com`) ||
    (/^[0-9a-f-]{36}\.cfargotunnel\.com$/.test(hostname) && hostname === tunnel + ".cfargotunnel.com");
  if (url.protocol !== "https:" || !authorized || url.port || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw targetError("connector_route_untrusted",
      "Connector runtime endpoint must be an exact trusted HTTPS device route.");
  }
  return url.origin;
}

export function classifyAdminRecoveryReadback({deviceState, publicStatus, authenticatedStatus,
  observedDeviceId = null, expectedDeviceId = null,
  observedConfigId = null, expectedConfigId = null,
  deviceGenerationAttested = false} = {}) {
  const heartbeatFresh = deviceState === "ACTIVE";
  const routeReachable = publicStatus === "pass";
  const authHealthy = authenticatedStatus === "pass";
  const attestedIdentity = Boolean(expectedDeviceId && observedDeviceId &&
    str(expectedDeviceId).toLowerCase() === str(observedDeviceId).toLowerCase());
  const attestedConfig = Boolean(expectedConfigId && observedConfigId &&
    str(expectedConfigId) === str(observedConfigId));
  const operationalVerified = heartbeatFresh && routeReachable && authHealthy
    && attestedIdentity && attestedConfig;
  // An authenticated /policy response proves possession of the connector
  // credential, not possession of the original non-exportable device key.
  // Only a separate trusted device-generation verifier may set this flag.
  const generationVerified = deviceGenerationAttested === true;
  const recovered = operationalVerified && generationVerified;
  return {
    status: recovered ? "recovered" : (!heartbeatFresh ? "heartbeat_stale" :
      !routeReachable ? "route_unverified" : !authHealthy ? "auth_unverified" :
      !attestedIdentity || !attestedConfig ? "identity_unverified" : "generation_attestation_required"),
    recovered, requires_same_cycle_verification: !recovered,
    heartbeat_fresh: heartbeatFresh, route_reachable: routeReachable,
    operational_verified: operationalVerified,
    device_generation_attested: generationVerified,
    authenticated_probe_passed: authHealthy, device_identity_attested: attestedIdentity,
    config_identity_attested: attestedConfig,
    secrets_included: false,
  };
}

async function scopedRows(pool, scope) {
  const [rows] = await pool.query(
    "SELECT config_id, user_id, tenant_id, device_id, is_enabled, lifecycle_state, " +
    "revoked_at, archived_at, last_health_at FROM local_connector_user_configs " +
    "WHERE user_id = ? AND tenant_id = ? ORDER BY updated_at DESC LIMIT 101",
    [scope.user_id, scope.tenant_id]);
  if (rows.length > 100) throw targetError("device_inventory_limit_exceeded",
    "Inventory is too large for safe automatic device selection.");
  return rows;
}

export async function adminConnectorInventory({pool, scope, now = Date.now()}) {
  const rows = await scopedRows(pool, scope);
  return { ok: true, user_id: scope.user_id, tenant_id: scope.tenant_id,
    observed_at: new Date(now).toISOString(),
    devices: rows.map(row => describeDevice(row, now)), secrets_included: false };
}

export async function resolveAdminConnectorTarget({
  pool, scope, requestedDeviceId = "", now = Date.now(), includeCredentials = false,
  localApiKeySql = "NULL AS connector_local_api_key", intent = "execution",
  allowMissingCredentials = false,
}) {
  const requested = str(requestedDeviceId);
  if (requested) {
    const [aliases] = await pool.query(
      "SELECT canonical_device_id FROM local_connector_device_aliases " +
      "WHERE alias_device_id = ? AND (user_id = ? OR user_id IS NULL) " +
      "AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 2",
      [requested, scope.user_id, scope.tenant_id]);
    if (aliases.length) throw targetError("historical_device_alias",
      "A historical device alias cannot be a privileged execution target; select the canonical ID.");
  }
  const selected = chooseDevice(await scopedRows(pool, scope), requested, now, {intent});
  if (!includeCredentials) return {...selected, credentials: null};
  // The second read prevents target switching and rules out revoked/archived rows.
  const [rows] = await pool.query(
    "SELECT config_id, user_id, tenant_id, device_id, is_enabled, lifecycle_state, " +
    "revoked_at, archived_at, last_health_at, tunnel_url, cf_tunnel_id, cf_tunnel_name, " +
    "cf_token, connector_secret, " + localApiKeySql + " FROM local_connector_user_configs " +
    "WHERE config_id = ? AND user_id = ? AND tenant_id = ? AND device_id = ? " +
    "AND is_enabled = 1 AND lifecycle_state = 'active' " +
    "AND revoked_at IS NULL AND archived_at IS NULL LIMIT 2",
    [selected.row.config_id, scope.user_id, scope.tenant_id, selected.row.device_id]);
  if (rows.length !== 1) throw targetError("device_target_changed", "Device changed during selection.");
  const verified = chooseDevice(rows, selected.row.device_id, now, {intent});
  const row = verified.row;
  if (!allowMissingCredentials && !str(row.connector_secret)) throw targetError("device_credential_missing",
    "The selected device lacks a scoped connector identity credential.");
  if (!allowMissingCredentials && !str(row.tunnel_url)) throw targetError("device_route_missing",
    "The selected device has no verified registered route.");
  return {...verified, selection_source: selected.selection_source,
    credentials: {
      cf_token: row.cf_token || "", connector_secret: row.connector_secret,
      connector_local_api_key: row.connector_local_api_key || "",
      cf_tunnel_id: row.cf_tunnel_id || null, cf_tunnel_name: row.cf_tunnel_name || null,
      tunnel_url: row.tunnel_url,
    }};
}
