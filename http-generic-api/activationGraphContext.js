import { resolvePlatformGraphMemory } from "./services/platformGraphMemoryResolver.js";
import { logGraphMemoryUsage } from "./graphMemoryTelemetry.js";

function normalize(value = "") {
  return String(value ?? "").trim();
}

function compactAsset(asset = {}) {
  return {
    asset_id: asset.asset_id || null,
    asset_key: asset.asset_key || null,
    asset_type: asset.asset_type || null,
    graph_rank: Number(asset.graph_rank || 0),
    validation_status: asset.validation_status || null,
    payload_summary: asset.payload_summary || {},
  };
}

function modeHints({ modePolicy = null, connection = null, hybridIntegrationReadiness = null } = {}) {
  const hints = new Set();
  if (modePolicy?.mode) hints.add(modePolicy.mode);
  if (connection?.connection_mode) hints.add(connection.connection_mode);
  if (connection?.cloudflare_mode) hints.add(`cloudflare:${connection.cloudflare_mode}`);
  if (connection?.google_auth_mode) hints.add(`google:${connection.google_auth_mode}`);
  if (connection?.n8n_activation_mode) hints.add(`n8n:${connection.n8n_activation_mode}`);
  if (hybridIntegrationReadiness?.mode) hints.add(hybridIntegrationReadiness.mode);
  if (!hints.size) hints.add("managed");
  return [...hints].filter(Boolean);
}

function integrationSummary(readiness = null) {
  const perApp = readiness?.per_app && typeof readiness.per_app === "object" ? readiness.per_app : {};
  return Object.values(perApp).slice(0, 25).map((entry) => ({
    app_key: entry.app_key,
    source_mode: entry.source_mode,
    ready: Boolean(entry.ready),
    required_for_device_install: Boolean(entry.required_for_device_install),
  }));
}

function buildActivationMemoryInput({ user = null, tenantId = null, membership = null, connection = null, devices = [], modePolicy = null, dedicatedIntegrationReadiness = null, hybridIntegrationReadiness = null, surface = "connect_status" } = {}) {
  return {
    request_type: "activation_resolver",
    diagnostic_surface: surface,
    node_id: tenantId ? undefined : "platform.global",
    tenant_id: normalize(tenantId),
    user_id: normalize(user?.user_id),
    device_id: normalize(devices?.[0]?.device_id),
    role: normalize(membership?.role),
    connection_mode: normalize(modePolicy?.mode || connection?.connection_mode),
    cloudflare_mode: normalize(modePolicy?.cloudflare_mode || connection?.cloudflare_mode),
    google_auth_mode: normalize(modePolicy?.google_auth_mode || connection?.google_auth_mode),
    n8n_activation_mode: normalize(modePolicy?.n8n_activation_mode || connection?.n8n_activation_mode),
    dedicated_ready: dedicatedIntegrationReadiness?.ready,
    hybrid_mode: hybridIntegrationReadiness?.mode,
    depth: 2,
    memory_limit: 5,
  };
}

export async function resolveActivationGraphContext({ user = null, tenantId = null, membership = null, connection = null, devices = [], modePolicy = null, dedicatedIntegrationReadiness = null, hybridIntegrationReadiness = null, onboarding = null, surface = "connect_status" } = {}) {
  const input = buildActivationMemoryInput({
    user,
    tenantId,
    membership,
    connection,
    devices,
    modePolicy,
    dedicatedIntegrationReadiness,
    hybridIntegrationReadiness,
    surface,
  });

  try {
    const memory = await resolvePlatformGraphMemory({ input, limit: 5 });
    const assets = Array.isArray(memory.assets) ? memory.assets.slice(0, 5).map(compactAsset) : [];
    return {
      requested: Boolean(memory.requested),
      resolved: Boolean(memory.resolved),
      source: "platform_graph_memory",
      usage: "activation_resolver_advisory",
      applied_to_authority: false,
      surface,
      tenant_node: tenantId ? `tenant.${tenantId}` : null,
      user_node: user?.user_id ? `user.${user.user_id}` : null,
      device_nodes: Array.isArray(devices) ? devices.map((device) => `device.${device.device_id}`).filter(Boolean).slice(0, 25) : [],
      mode_hints: modeHints({ modePolicy, connection, hybridIntegrationReadiness }),
      onboarding_state: onboarding?.state || null,
      integration_summary: integrationSummary(hybridIntegrationReadiness),
      graph_node_ids: memory.graph_node_ids || [],
      asset_count: Number(memory.asset_count || 0),
      policy_asset_keys: assets.map((asset) => asset.asset_key).filter(Boolean),
      assets,
      selection_policy: memory.selection_policy || {},
      reason: memory.reason || null,
      secrets_included: false,
    };
  } catch (err) {
    return {
      requested: true,
      resolved: false,
      source: "platform_graph_memory",
      usage: "activation_resolver_advisory",
      applied_to_authority: false,
      surface,
      tenant_node: tenantId ? `tenant.${tenantId}` : null,
      user_node: user?.user_id ? `user.${user.user_id}` : null,
      device_nodes: Array.isArray(devices) ? devices.map((device) => `device.${device.device_id}`).filter(Boolean).slice(0, 25) : [],
      mode_hints: modeHints({ modePolicy, connection, hybridIntegrationReadiness }),
      onboarding_state: onboarding?.state || null,
      integration_summary: integrationSummary(hybridIntegrationReadiness),
      asset_count: 0,
      policy_asset_keys: [],
      assets: [],
      selection_policy: {},
      error: {
        code: err?.code || "activation_graph_context_failed",
        message: err?.message || "Activation graph context could not be resolved.",
      },
      secrets_included: false,
    };
  }
}
