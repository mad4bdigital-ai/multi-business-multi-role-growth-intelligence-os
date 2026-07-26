import { resolvePlatformGraphMemory } from "./services/platformGraphMemoryResolver.js";

function normalize(value = "") {
  return String(value ?? "").trim();
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = normalize(value).toLowerCase();
  if (["true", "1", "yes", "y", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "disabled"].includes(normalized)) return false;
  return fallback;
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

function buildExecutionMemoryInput({ requestPayload = {}, action = {}, endpoint = {}, brand = null, resolvedMethodPath = {}, providerDomain = "", parentActionKey = "", endpointKey = "" } = {}) {
  return {
    request_type: "endpoint_execution",
    diagnostic_surface: "execution_context",
    parent_action_key: normalize(parentActionKey || requestPayload.parent_action_key || action.action_key),
    action_key: normalize(parentActionKey || requestPayload.parent_action_key || action.action_key),
    endpoint_key: normalize(endpointKey || requestPayload.endpoint_key || endpoint.endpoint_key),
    route_id: normalize(endpoint.endpoint_id || requestPayload.route_id),
    workflow_key: normalize(action.action_key || requestPayload.workflow_key),
    provider_domain: normalize(providerDomain || requestPayload.provider_domain || endpoint.provider_domain),
    method: normalize(resolvedMethodPath.method || endpoint.method || requestPayload.method).toUpperCase(),
    path: normalize(resolvedMethodPath.path || endpoint.endpoint_path_or_function || requestPayload.path),
    tenant_id: normalize(requestPayload.tenant_id || requestPayload.auth_context?.tenant_id || requestPayload._principal?.tenant_id),
    user_id: normalize(requestPayload.user_id || requestPayload.auth_context?.user_id || requestPayload._principal?.user_id),
    device_id: normalize(requestPayload.device_id || requestPayload.auth_context?.device_id),
    brand_name: normalize(brand?.brand_name || requestPayload.brand || requestPayload.brand_name),
    asset_id: normalize(requestPayload.asset_id || requestPayload.json_asset_id),
    depth: 2,
    memory_limit: 5,
  };
}

export async function resolveExecutionGraphMemoryContext({ requestPayload = {}, action = {}, endpoint = {}, brand = null, resolvedMethodPath = {}, providerDomain = "", parentActionKey = "", endpointKey = "" } = {}) {
  const enabled = boolValue(requestPayload.graph_memory_enabled ?? requestPayload.execution_context?.graph_memory_enabled, true);
  if (!enabled) {
    return {
      requested: false,
      resolved: false,
      disabled: true,
      reason: "graph_memory_disabled_by_request",
      asset_count: 0,
      assets: [],
      selection_policy: {},
      secrets_included: false,
    };
  }

  const input = buildExecutionMemoryInput({ requestPayload, action, endpoint, brand, resolvedMethodPath, providerDomain, parentActionKey, endpointKey });

  try {
    const memory = await resolvePlatformGraphMemory({ input, limit: 5 });
    return {
      requested: Boolean(memory.requested),
      resolved: Boolean(memory.resolved),
      source: "platform_graph_memory",
      usage: "execution_context_advisory",
      applied_to_transport: false,
      parent_action_key: input.parent_action_key,
      endpoint_key: input.endpoint_key,
      graph_node_ids: memory.graph_node_ids || [],
      asset_count: Number(memory.asset_count || 0),
      assets: Array.isArray(memory.assets) ? memory.assets.slice(0, 5).map(compactAsset) : [],
      selection_policy: memory.selection_policy || {},
      reason: memory.reason || null,
      secrets_included: false,
    };
  } catch (err) {
    return {
      requested: true,
      resolved: false,
      source: "platform_graph_memory",
      usage: "execution_context_advisory",
      applied_to_transport: false,
      parent_action_key: input.parent_action_key,
      endpoint_key: input.endpoint_key,
      asset_count: 0,
      assets: [],
      selection_policy: {},
      error: {
        code: err?.code || "execution_graph_memory_failed",
        message: err?.message || "Graph memory execution context could not be resolved.",
      },
      secrets_included: false,
    };
  }
}
