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

export function chooseDevice(rows, requestedDeviceId = "", now = Date.now()) {
  const requested = str(requestedDeviceId);
  if (requested && !/^[a-z0-9][a-z0-9_-]{1,127}$/i.test(requested)) {
    throw targetError("device_id_invalid", "Invalid device ID.", 400);
  }
  const examined = rows.map(row => ({ row, state: describeDevice(row, now).state }));
  const candidates = requested ?
    examined.filter(item => str(item.row.device_id).toLowerCase() === requested.toLowerCase()) :
    examined.filter(item => item.state === "ACTIVE");
  if (candidates.length > 1) throw targetError("device_target_ambiguous",
    "Multiple device configurations match; select one canonical device explicitly.");
  if (!candidates.length) throw targetError(
    requested ? "device_target_not_found" : "device_target_unavailable",
    "No unique fresh active device matches the exact authenticated user and tenant.");
  if (candidates[0].state !== "ACTIVE") throw targetError("device_target_not_trusted",
    "The device is offline/stale, disabled, revoked, or archived; canonical re-enrollment is required.");
  return { row: candidates[0].row,
    selection_source: requested ? "explicit_canonical_id" : "unique_fresh_device" };
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
  localApiKeySql = "NULL AS connector_local_api_key",
}) {
  const requested = str(requestedDeviceId);
  if (requested) {
    const [aliases] = await pool.query(
      "SELECT canonical_device_id FROM local_connector_device_aliases " +
      "WHERE alias_device_id = ? AND user_id = ? AND tenant_id = ? LIMIT 2",
      [requested, scope.user_id, scope.tenant_id]);
    if (aliases.length) throw targetError("historical_device_alias",
      "A historical device alias cannot be a privileged execution target; select the canonical ID.");
  }
  const selected = chooseDevice(await scopedRows(pool, scope), requested, now);
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
  const verified = chooseDevice(rows, selected.row.device_id, now);
  const row = verified.row;
  if (!str(row.connector_secret)) throw targetError("device_credential_missing",
    "The selected device lacks a scoped connector identity credential.");
  if (!str(row.tunnel_url)) throw targetError("device_route_missing",
    "The selected device has no verified registered route.");
  return {...verified, selection_source: selected.selection_source,
    credentials: {
      cf_token: row.cf_token || "", connector_secret: row.connector_secret,
      connector_local_api_key: row.connector_local_api_key || "",
      cf_tunnel_id: row.cf_tunnel_id || null, cf_tunnel_name: row.cf_tunnel_name || null,
      tunnel_url: row.tunnel_url,
    }};
}
