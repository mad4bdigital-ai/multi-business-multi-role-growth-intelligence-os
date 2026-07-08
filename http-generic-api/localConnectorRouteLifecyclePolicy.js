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

const ROUTE_CHANNEL_CATALOG = Object.freeze({
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

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

export function localConnectorRouteChannelCatalog() {
  return ROUTE_CHANNEL_CATALOG;
}

export function normalizeLocalConnectorRouteChannel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === LOCAL_CONNECTOR_ROUTE_CHANNELS.ADMIN_BREAK_GLASS) return normalized;
  if (normalized === LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST) return normalized;
  return null;
}

export function localConnectorTargetSelectionPolicy({ tenant_id, user_id, requested_device_id, canonical_device_id, config_id } = {}) {
  const tenantId = firstNonEmpty(tenant_id, "unknown_tenant");
  const userId = firstNonEmpty(user_id, "unknown_user");
  const requestedDeviceId = firstNonEmpty(requested_device_id, canonical_device_id, config_id, "unknown_device");
  const canonicalDeviceId = firstNonEmpty(canonical_device_id, requestedDeviceId);
  return {
    target_key: `${tenantId}:${userId}:${canonicalDeviceId}`,
    requested_device_id: requestedDeviceId,
    canonical_device_id: canonicalDeviceId,
    config_id: firstNonEmpty(config_id, null),
    selection_barrier: "tenant_id+user_id+canonical_device_id",
    supports_aliases: true,
    supports_multiple_devices: true,
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
} = {}) {
  const target = localConnectorTargetSelectionPolicy({
    tenant_id,
    user_id,
    requested_device_id: device_id,
    canonical_device_id: device_id,
    config_id,
  });
  return {
    version: 1,
    target,
    channels: [
      {
        ...ROUTE_CHANNEL_CATALOG[LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST],
        endpoint_url: firstNonEmpty(public_gateway_url, "https://auth.mad4b.com"),
        device_runtime_url: firstNonEmpty(device_runtime_url, tunnel_url),
        lifecycle_state: health_status === "healthy" ? LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES.HEALTHY : LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES.STALE,
        requires_user_barrier: true,
        requires_fresh_authorization_for_installers: true,
      },
      {
        ...ROUTE_CHANNEL_CATALOG[LOCAL_CONNECTOR_ROUTE_CHANNELS.ADMIN_BREAK_GLASS],
        endpoint_url: firstNonEmpty(admin_recovery_url, "https://connector.mad4b.com"),
        tunnel_url: firstNonEmpty(tunnel_url, device_runtime_url),
        lifecycle_state: health_status === "healthy" ? LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES.HEALTHY : LOCAL_CONNECTOR_ROUTE_LIFECYCLE_STATES.STALE,
        requires_user_barrier: false,
        admin_only: true,
      },
    ],
    recovery_matrix: {
      [LOCAL_CONNECTOR_RECOVERY_REASONS.DEVICE_FORMATTED]: "create_new_config_or_relink_alias_then_revoke_old_routes_after_readback",
      [LOCAL_CONNECTOR_RECOVERY_REASONS.WINDOWS_REINSTALLED]: "reissue_installer_with_fresh_local_manager_authorization_and_rotate_device_token",
      [LOCAL_CONNECTOR_RECOVERY_REASONS.DEVICE_REPLACED]: "bind_new_canonical_device_and_keep_old_device_disabled_until_admin_cleanup",
      [LOCAL_CONNECTOR_RECOVERY_REASONS.MULTIPLE_DEVICES_TARGET_SELECTION]: "select_by_tenant_user_canonical_device_id_not_last_seen_alias",
      [LOCAL_CONNECTOR_RECOVERY_REASONS.AUTH_HOST_UNREACHABLE]: "use_admin_break_glass_for_diagnostics_only_then_restore_auth_host_route",
      [LOCAL_CONNECTOR_RECOVERY_REASONS.BREAK_GLASS_UNREACHABLE]: "do_not_escalate_tenant_route_to_admin_route_repair_tunnel_or_dns",
    },
  };
}

export function routeChannelForLocalConnectorIntent(intent) {
  const normalized = String(intent || "").trim().toLowerCase();
  if (["admin_recovery", "break_glass", "forensics", "route_repair"].includes(normalized)) {
    return LOCAL_CONNECTOR_ROUTE_CHANNELS.ADMIN_BREAK_GLASS;
  }
  if (["tenant_status", "tenant_action", "auto_install", "capability_installer", "device_select"].includes(normalized)) {
    return LOCAL_CONNECTOR_ROUTE_CHANNELS.TENANT_AUTH_HOST;
  }
  return null;
}
