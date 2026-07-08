import { getPool } from "./db.js";

export const LOCAL_CONNECTOR_ROUTE_CHANNELS = Object.freeze({
  ADMIN_BREAK_GLASS: "admin_break_glass",
  TENANT_AUTH_HOST: "tenant_auth_host",
});

export const LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES = Object.freeze({
  PROVISIONED: "provisioned",
  PAIRED: "paired",
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNREACHABLE: "unreachable",
  STALE: "stale",
  REPROVISION_REQUIRED: "reprovision_required",
  REVOKED: "revoked",
});

export const LOCAL_CONNECTOR_RECOVERY_REASONS = Object.freeze({
  DEVICE_FORMATTED: "device_formatted",
  WINDOWS_REINSTALLED: "windows_reinstalled",
  DEVICE_REPLACED: "device_replaced",
  MULTIPLE_DEVICES_TARGET_SELECTION: "multiple_devices_target_selection",
  AUTH_HOST_UNREACHABLE: "auth_host_unreachable",
  BREAK_GLASS_UNREACHABLE: "break_glass_unreachable",
  ROUTE_BINDING_MISMATCH: "route_binding_mismatch",
  SAVED_DEVICE_TOKEN_STALE: "saved_device_token_stale",
});

const DEFAULT_ROUTE_CHANNEL_CATALOG = Object.freeze({
  [LOCAL_CONNECTOR_ROUTE_CHANNELS.ADMIN_BREAK_GLASS]: Object.freeze({
    channel: LOCAL_CONNECTOR_ROUTE_CHANNELS.ADMIN_BREAK_GLASS,
    authority: "platform_admin",
    host: "connector.mad4b.com",
    auth_barrier: "admin_break_glass_connector_secret",
    intended_for: ["emergency_recovery", "route_diagnostics", "device_repair", "admin_forensics"],
    forbidden_for: ["tenant_workflow_dispatch", "user_scoped_auto_install"],
    disaster_recovery_role: "recover_or_revoke_when_auth_host_or_tenant_route_is_unavailable",
  }),
  [LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST]: Object.freeze({
    channel: LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST,
    authority: "tenant_user_or_managed_service",
    host: "auth.mad4b.com",
    auth_barrier: "user_jwt_or_fresh_local_manager_device_token",
    intended_for: ["tenant_status", "tenant_device_action", "target_device_selection", "auto_install", "capability_installer"],
    forbidden_for: ["admin_break_glass_without_user_or_tenant_context"],
    disaster_recovery_role: "relink_or_reprovision_after_format_windows_reinstall_or_device_replacement",
  }),
});

const DEFAULT_RECOVERY_MATRIX = Object.freeze({
  [LOCAL_CONNECTOR_RECOVERY_REASONS.DEVICE_FORMATTED]: "create_new_config_or_relink_alias_then_revoke_old_routes_after_readback",
  [LOCAL_CONNECTOR_RECOVERY_REASONS.WINDOWS_REINSTALLED]: "reissue_installer_with_fresh_local_manager_authorization_and_rotate_device_token",
  [LOCAL_CONNECTOR_RECOVERY_REASONS.DEVICE_REPLACED]: "bind_new_canonical_device_and_keep_old_device_disabled_until_admin_cleanup",
  [LOCAL_CONNECTOR_RECOVERY_REASONS.MULTIPLE_DEVICES_TARGET_SELECTION]: "select_by_tenant_user_canonical_device_id_not_last_seen_alias",
  [LOCAL_CONNECTOR_RECOVERY_REASONS.AUTH_HOST_UNREACHABLE]: "use_admin_break_glass_for_diagnostics_only_then_restore_auth_host_route",
  [LOCAL_CONNECTOR_RECOVERY_REASONS.BREAK_GLASS_UNREACHABLE]: "do_not_escalate_tenant_route_to_admin_route_repair_tunnel_or_dns",
});

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function jsonString(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "{}";
  }
}

function mergeObjects(base = {}, override = {}) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined || value === null) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = mergeObjects(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function defaultLifecycleProfile() {
  return {
    profile_version: 1,
    profile_source: "code_default_seed",
    route_channel_catalog: DEFAULT_ROUTE_CHANNEL_CATALOG,
    recovery_matrix: DEFAULT_RECOVERY_MATRIX,
    target_selection: {
      selection_barrier: "tenant_id+user_id+canonical_device_id",
      supports_aliases: true,
      supports_multiple_devices: true,
      preferred_channel: LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST,
      require_explicit_device_selector: true,
      allow_last_seen_fallback: false,
    },
    lifecycle_defaults: {
      stale_when_not_healthy: true,
      requires_fresh_authorization_for_installers: true,
      auto_install_channel: LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST,
      break_glass_admin_only: true,
    },
  };
}

export function localConnectorRouteChannelCatalog(profile = null) {
  return safeJson(profile?.route_channel_catalog, DEFAULT_ROUTE_CHANNEL_CATALOG);
}

export function normalizeLocalConnectorRouteChannel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === LOCAL_CONNECTOR_ROUTE_CHANNELS.ADMIN_BREAK_GLASS) return normalized;
  if (normalized === LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST) return normalized;
  return null;
}

export async function ensureLocalConnectorRouteLifecycleProfilesTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS \`local_connector_route_lifecycle_profiles\` (
      \`profile_id\` VARCHAR(128) NOT NULL,
      \`scope_type\` ENUM('global','tenant','user','device') NOT NULL DEFAULT 'global',
      \`tenant_id\` VARCHAR(64) NULL,
      \`user_id\` VARCHAR(64) NULL,
      \`device_id\` VARCHAR(128) NULL,
      \`profile_json\` JSON NOT NULL,
      \`priority\` INT NOT NULL DEFAULT 100,
      \`status\` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`profile_id\`),
      KEY \`idx_lc_route_lifecycle_scope\` (\`status\`, \`scope_type\`, \`tenant_id\`, \`user_id\`, \`device_id\`, \`priority\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export async function seedLocalConnectorRouteLifecycleProfiles() {
  await ensureLocalConnectorRouteLifecycleProfilesTable();
  await getPool().query(
    `INSERT INTO \`local_connector_route_lifecycle_profiles\`
      (profile_id, scope_type, tenant_id, user_id, device_id, profile_json, priority, status)
     VALUES ('global-default-route-lifecycle-v1', 'global', NULL, NULL, NULL, ?, 10, 'active')
     ON DUPLICATE KEY UPDATE
       profile_json = VALUES(profile_json), priority = VALUES(priority), status = 'active', updated_at = NOW()`,
    [jsonString(defaultLifecycleProfile())]
  );
}

function scopeMatches(row, { tenant_id, user_id, device_id }) {
  if (row.scope_type === "global") return true;
  if (row.scope_type === "tenant") return String(row.tenant_id || "") === String(tenant_id || "");
  if (row.scope_type === "user") return String(row.tenant_id || "") === String(tenant_id || "") && String(row.user_id || "") === String(user_id || "");
  if (row.scope_type === "device") {
    return String(row.tenant_id || "") === String(tenant_id || "") && String(row.user_id || "") === String(user_id || "") && String(row.device_id || "") === String(device_id || "");
  }
  return false;
}

export async function loadLocalConnectorRouteLifecycleProfile({ tenant_id, user_id, device_id } = {}) {
  try {
    await seedLocalConnectorRouteLifecycleProfiles();
    const [rows] = await getPool().query(
      `SELECT profile_id, scope_type, tenant_id, user_id, device_id, profile_json, priority
         FROM \`local_connector_route_lifecycle_profiles\`
        WHERE status = 'active'
          AND (
            scope_type = 'global'
            OR (scope_type = 'tenant' AND tenant_id = ?)
            OR (scope_type = 'user' AND tenant_id = ? AND user_id = ?)
            OR (scope_type = 'device' AND tenant_id = ? AND user_id = ? AND device_id = ?)
          )
        ORDER BY FIELD(scope_type, 'global', 'tenant', 'user', 'device'), priority ASC, updated_at ASC`,
      [tenant_id || null, tenant_id || null, user_id || null, tenant_id || null, user_id || null, device_id || null]
    );
    let profile = defaultLifecycleProfile();
    const appliedProfiles = [];
    for (const row of rows) {
      if (!scopeMatches(row, { tenant_id, user_id, device_id })) continue;
      profile = mergeObjects(profile, safeJson(row.profile_json, {}));
      appliedProfiles.push({ profile_id: row.profile_id, scope_type: row.scope_type, priority: row.priority });
    }
    return {
      ...profile,
      profile_source: appliedProfiles.length ? "db:local_connector_route_lifecycle_profiles" : "code_default_seed",
      applied_profiles: appliedProfiles,
      secrets_included: false,
    };
  } catch (err) {
    return {
      ...defaultLifecycleProfile(),
      profile_source: "fallback:local_connector_route_lifecycle_profiles_unavailable",
      profile_error: { code: err?.code || "route_lifecycle_profile_unavailable", message: err?.message || String(err) },
      applied_profiles: [],
      secrets_included: false,
    };
  }
}

export function localConnectorTargetSelectionPolicy({ tenant_id, user_id, requested_device_id, canonical_device_id, config_id, profile = null } = {}) {
  const targetProfile = safeJson(profile?.target_selection, defaultLifecycleProfile().target_selection);
  const tenantId = firstNonEmpty(tenant_id, "unknown_tenant");
  const userId = firstNonEmpty(user_id, "unknown_user");
  const requestedDeviceId = firstNonEmpty(requested_device_id, canonical_device_id, config_id, "unknown_device");
  const canonicalDeviceId = firstNonEmpty(canonical_device_id, requestedDeviceId);
  return {
    target_key: `${tenantId}:${userId}:${canonicalDeviceId}`,
    requested_device_id: requestedDeviceId,
    canonical_device_id: canonicalDeviceId,
    config_id: firstNonEmpty(config_id, null),
    selection_barrier: targetProfile.selection_barrier || "tenant_id+user_id+canonical_device_id",
    preferred_channel: normalizeLocalConnectorRouteChannel(targetProfile.preferred_channel) || LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST,
    require_explicit_device_selector: targetProfile.require_explicit_device_selector !== false,
    allow_last_seen_fallback: targetProfile.allow_last_seen_fallback === true,
    supports_aliases: targetProfile.supports_aliases !== false,
    supports_multiple_devices: targetProfile.supports_multiple_devices !== false,
    disaster_recovery_alias_reasons: [
      LOCAL_CONNECTOR_RECOVERY_REASONS.DEVICE_FORMATTED,
      LOCAL_CONNECTOR_RECOVERY_REASONS.WINDOWS_REINSTALLED,
      LOCAL_CONNECTOR_RECOVERY_REASONS.DEVICE_REPLACED,
      LOCAL_CONNECTOR_RECOVERY_REASONS.MULTIPLE_DEVICES_TARGET_SELECTION,
    ],
  };
}

export function buildLocalConnectorRouteLifecycle({
  config_id,
  user_id,
  tenant_id,
  device_id,
  device_runtime_url,
  public_gateway_url,
  admin_recovery_url,
  tunnel_url,
  health_status = "unknown",
  profile = null,
} = {}) {
  const lifecycleProfile = profile || defaultLifecycleProfile();
  const channelCatalog = localConnectorRouteChannelCatalog(lifecycleProfile);
  const lifecycleDefaults = safeJson(lifecycleProfile.lifecycle_defaults, defaultLifecycleProfile().lifecycle_defaults);
  const target = localConnectorTargetSelectionPolicy({
    tenant_id,
    user_id,
    requested_device_id: device_id,
    canonical_device_id: device_id,
    config_id,
    profile: lifecycleProfile,
  });
  return {
    version: 1,
    profile_source: lifecycleProfile.profile_source || "code_default_seed",
    applied_profiles: Array.isArray(lifecycleProfile.applied_profiles) ? lifecycleProfile.applied_profiles : [],
    target,
    channels: [
      {
        ...channelCatalog[LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST],
        endpoint_url: firstNonEmpty(public_gateway_url, "https://auth.mad4b.com"),
        device_runtime_url: firstNonEmpty(device_runtime_url, tunnel_url),
        lifecycle_state: health_status === "healthy" ? LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES.HEALTHY : LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES.STALE,
        requires_user_barrier: true,
        requires_fresh_authorization_for_installers: lifecycleDefaults.requires_fresh_authorization_for_installers !== false,
      },
      {
        ...channelCatalog[LOCAL_CONNECTOR_ROUTE_CHANNELS.ADMIN_BREAK_GLASS],
        endpoint_url: firstNonEmpty(admin_recovery_url, "https://connector.mad4b.com"),
        tunnel_url: firstNonEmpty(tunnel_url, device_runtime_url),
        lifecycle_state: health_status === "healthy" ? LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES.HEALTHY : LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES.STALE,
        requires_user_barrier: false,
        admin_only: lifecycleDefaults.break_glass_admin_only !== false,
      },
    ],
    recovery_matrix: mergeObjects(DEFAULT_RECOVERY_MATRIX, safeJson(lifecycleProfile.recovery_matrix, {})),
    secrets_included: false,
  };
}

export async function buildLocalConnectorRouteLifecycleFromDb(context = {}) {
  const profile = await loadLocalConnectorRouteLifecycleProfile({
    tenant_id: context.tenant_id,
    user_id: context.user_id,
    device_id: context.device_id,
  });
  return buildLocalConnectorRouteLifecycle({ ...context, profile });
}

export function routeChannelForLocalConnectorIntent(intent, profile = null) {
  const normalized = String(intent || "").trim().toLowerCase();
  if (["admin_recovery", "break_glass", "forensics", "route_repair"].includes(normalized)) {
    return LOCAL_CONNECTOR_ROUTE_CHANNELS.ADMIN_BREAK_GLASS;
  }
  if (["tenant_status", "tenant_action", "auto_install", "capability_installer", "device_select"].includes(normalized)) {
    return normalizeLocalConnectorRouteChannel(profile?.target_selection?.preferred_channel) || LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST;
  }
  return null;
}
