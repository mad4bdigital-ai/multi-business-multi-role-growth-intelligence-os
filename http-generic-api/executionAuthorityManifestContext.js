function compact(value = "", max = 800) {
  return String(value || "").trim().slice(0, max);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function bool(value) {
  if (value === true || value === false) return value;
  return ["true", "1", "yes", "y", "enabled", "active"].includes(String(value || "").trim().toLowerCase());
}

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function summarizeManifestItem(item = {}) {
  const endpoints = Array.isArray(item.endpoints) ? item.endpoints : [];
  const tools = Array.isArray(item.tools) ? item.tools : [];
  const action = item.action || null;
  const plugin = action?.plugin || null;
  const endpointReadinessStates = unique(endpoints.map((endpoint) => endpoint.readiness?.execution_readiness || endpoint.status || "unknown"));
  const endpointsActive = endpoints.length ? endpoints.every((endpoint) => endpoint.readiness?.active !== false) : false;
  const toolsActive = tools.length ? tools.every((tool) => tool.binding?.active !== false && tool.is_enabled !== false) : true;
  return {
    action_key: action?.action_key || null,
    plugin_key: plugin?.plugin_key || null,
    action_allowed: action?.evaluation?.allowed === true,
    action_reasons: action?.evaluation?.reasons || [],
    plugin_binding_status: plugin?.binding?.status || null,
    plugin_binding_active: plugin?.binding?.status ? normalize(plugin.binding.status) === "active" : null,
    plugin_credential_source: plugin?.binding?.credential_source || null,
    tenant_policy_status: plugin?.tenant_policy?.status || null,
    tenant_policy_active: plugin?.tenant_policy?.status ? normalize(plugin.tenant_policy.status) === "active" : null,
    active_connection_count: Number(plugin?.connection_summary?.active_connection_count || 0),
    primary_connection_available: plugin?.connection_summary?.primary_connection_available === true,
    endpoint_count: endpoints.length,
    endpoint_keys: endpoints.map((endpoint) => endpoint.endpoint_key).filter(Boolean).slice(0, 20),
    endpoint_readiness_states: endpointReadinessStates,
    endpoints_active: endpointsActive,
    tool_count: tools.length,
    tool_keys: tools.map((tool) => tool.tool_key).filter(Boolean).slice(0, 20),
    tools_active: toolsActive,
    manifest_complete: item.readiness?.manifest_complete === true,
    secrets_included: false,
  };
}

function summarizeManifestResult(result = {}) {
  const manifests = Array.isArray(result.manifests) ? result.manifests : [];
  const first = manifests[0] || null;
  const summaries = manifests.map(summarizeManifestItem);
  const blockedReasons = summaries.flatMap((item) => item.action_reasons || []);
  return {
    manifest_requested: result.requested || {},
    resolver: result.resolver || null,
    mode: result.mode || null,
    count: Number(result.count || manifests.length || 0),
    surface_authority: result.surface_authority || null,
    authority_chain: result.authority_chain || [],
    first_manifest_complete: first?.readiness?.manifest_complete === true,
    action_allowed: first?.action?.evaluation?.allowed === true,
    endpoint_count: first?.readiness?.endpoint_count || 0,
    tool_count: first?.readiness?.tool_count || 0,
    blocked_reasons: [...new Set(blockedReasons)].slice(0, 20),
    manifests: summaries.slice(0, 10),
    secrets_included: false,
  };
}

function shouldAttemptManifest(requestPayload = {}, deps = {}) {
  if (typeof deps.resolveActionEndpointToolManifest !== "function") return false;
  if (Object.prototype.hasOwnProperty.call(requestPayload, "execution_authority_manifest_enabled")) {
    return bool(requestPayload.execution_authority_manifest_enabled);
  }
  return true;
}

export async function resolveExecutionAuthorityManifestContext(input = {}, deps = {}) {
  const {
    requestPayload = {},
    action = {},
    endpoint = {},
    parent_action_key = "",
    endpoint_key = "",
  } = input;

  const actionKey = firstNonEmpty(
    parent_action_key,
    requestPayload.parent_action_key,
    action.action_key,
    endpoint.parent_action_key
  );
  const endpointKey = firstNonEmpty(
    endpoint_key,
    requestPayload.endpoint_key,
    endpoint.endpoint_key
  );
  const pluginKey = firstNonEmpty(
    requestPayload.plugin_key,
    requestPayload.app_key,
    requestPayload.auth_context?.app_key,
    action.plugin_key,
    endpoint.plugin_key
  );
  const toolKey = firstNonEmpty(
    requestPayload.tool_key,
    requestPayload.toolKey,
    endpoint.tool_key,
    action.tool_key
  );

  if (!actionKey && !endpointKey && !pluginKey && !toolKey) {
    return {
      requested: false,
      attempted: false,
      resolution_status: "not_requested",
      reason: "missing_action_endpoint_or_plugin_identity",
      secrets_included: false,
    };
  }

  if (!shouldAttemptManifest(requestPayload, deps)) {
    return {
      requested: true,
      attempted: false,
      resolution_status: "not_loaded",
      reason: "execution_authority_manifest_resolver_not_provided",
      action_key: actionKey || null,
      endpoint_key: endpointKey || null,
      plugin_key: pluginKey || null,
      tool_key: toolKey || null,
      secrets_included: false,
    };
  }

  try {
    const result = await deps.resolveActionEndpointToolManifest({
      action_key: actionKey || null,
      endpoint_key: endpointKey || null,
      plugin_key: pluginKey || null,
      tenant_id: firstNonEmpty(requestPayload.tenant_id, requestPayload.auth_context?.tenant_id),
      user_id: firstNonEmpty(requestPayload.user_id, requestPayload.auth_context?.user_id),
      actor_role: firstNonEmpty(requestPayload.actor_role, requestPayload.auth_context?.actor_role),
      governance_level: firstNonEmpty(requestPayload.governance_level, requestPayload.auth_context?.governance_level),
      client_key: firstNonEmpty(requestPayload.client_key, requestPayload.tenant_id, requestPayload.auth_context?.tenant_id),
      team_key: firstNonEmpty(requestPayload.team_key, requestPayload.auth_context?.team_key),
      is_admin: bool(requestPayload.is_admin) || String(requestPayload._principal?.role || "").toLowerCase() === "admin",
      include_denied: true,
      include_disabled: false,
      limit: 20,
    });

    const summary = summarizeManifestResult(result);
    const resolutionStatus = summary.count > 0
      ? (summary.first_manifest_complete ? "ready" : "validating")
      : "no_manifest_candidates";

    return {
      requested: true,
      attempted: true,
      resolution_status: resolutionStatus,
      action_key: actionKey || null,
      endpoint_key: endpointKey || null,
      plugin_key: pluginKey || null,
      ...summary,
      secrets_included: false,
    };
  } catch (err) {
    return {
      requested: true,
      attempted: true,
      resolution_status: "degraded",
      action_key: actionKey || null,
      endpoint_key: endpointKey || null,
      plugin_key: pluginKey || null,
      error_code: compact(err?.code || "execution_authority_manifest_resolution_failed", 160),
      error_message: compact(err?.message || "Execution authority manifest resolution failed.", 1000),
      error_status: err?.status || null,
      secrets_included: false,
    };
  }
}
