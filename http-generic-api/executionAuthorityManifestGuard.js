function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function bool(value) {
  if (value === true || value === false) return value;
  return ["true", "1", "yes", "y", "enabled", "active", "enforced", "required"].includes(normalize(value));
}

function policyBool(policies = [], group = "", key = "", fallback = "FALSE", deps = {}) {
  if (typeof deps.policyValue !== "function") return bool(fallback);
  try {
    return bool(deps.policyValue(policies, group, key, fallback));
  } catch {
    return bool(fallback);
  }
}

function requestBool(requestPayload = {}, key = "") {
  if (!Object.prototype.hasOwnProperty.call(requestPayload, key)) return null;
  return bool(requestPayload[key]);
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function surfaceOk(surface = {}) {
  return surface?.ok === true;
}

function collectManifestBlocks(manifest = {}, options = {}) {
  const blocks = [];
  const status = normalize(manifest.resolution_status);
  const surfaces = manifest.surface_authority || {};
  const manifests = Array.isArray(manifest.manifests) ? manifest.manifests : [];

  if (!manifest || typeof manifest !== "object") {
    blocks.push({ code: "execution_authority_manifest_missing", message: "Execution authority manifest is missing." });
    return blocks;
  }

  if (manifest.requested !== true) {
    blocks.push({ code: "execution_authority_manifest_not_requested", message: "Execution authority manifest was not requested for this execution." });
  }

  if (manifest.attempted !== true) {
    blocks.push({ code: "execution_authority_manifest_not_loaded", message: "Execution authority manifest resolver did not run before dispatch." });
  }

  if (["degraded", "failed", "error"].includes(status)) {
    blocks.push({
      code: manifest.error_code || "execution_authority_manifest_degraded",
      message: manifest.error_message || "Execution authority manifest resolution degraded before dispatch.",
    });
  }

  if (status === "no_manifest_candidates") {
    blocks.push({ code: "execution_authority_manifest_no_candidates", message: "No execution authority manifest candidates were resolved." });
  }

  if (options.strictReadiness && status && status !== "ready") {
    blocks.push({ code: "execution_authority_manifest_not_ready", message: `Execution authority manifest status is ${status || "unknown"}, not ready.` });
  }

  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    if (!surfaceOk(surface)) {
      blocks.push({
        code: "execution_authority_surface_not_authoritative",
        message: `Execution authority surface is not authoritative: ${surfaceName}`,
        surface: surfaceName,
        surface_code: surface?.code || null,
        resolved_surface_key: surface?.resolved_surface_key || null,
      });
    }
  }

  if (manifest.action_allowed === false) {
    blocks.push({
      code: "execution_authority_action_not_allowed",
      message: "Resolved action is not allowed by Action Registry authority.",
      reasons: manifest.blocked_reasons || [],
    });
  }

  if (manifest.endpoint_count === 0) {
    blocks.push({ code: "execution_authority_endpoint_missing", message: "No endpoint registry row is available for the resolved action." });
  }

  if (manifest.first_manifest_complete === false) {
    blocks.push({ code: "execution_authority_manifest_incomplete", message: "Execution authority manifest is incomplete before dispatch." });
  }

  for (const item of manifests) {
    if (item.action_allowed === false) {
      blocks.push({
        code: "execution_authority_action_candidate_denied",
        message: `Action candidate is denied: ${item.action_key || "unknown_action"}`,
        action_key: item.action_key || null,
        reasons: item.action_reasons || [],
      });
    }
    if (item.endpoint_count === 0) {
      blocks.push({
        code: "execution_authority_endpoint_candidate_missing",
        message: `Action candidate has no endpoint authority rows: ${item.action_key || "unknown_action"}`,
        action_key: item.action_key || null,
      });
    }
    if (item.endpoints_active === false) {
      blocks.push({
        code: "execution_authority_endpoint_not_ready",
        message: `Endpoint authority rows are not ready for action: ${item.action_key || "unknown_action"}`,
        action_key: item.action_key || null,
        endpoint_keys: item.endpoint_keys || [],
        endpoint_readiness_states: item.endpoint_readiness_states || [],
      });
    }
    if (item.tools_active === false) {
      blocks.push({
        code: "execution_authority_tool_binding_not_ready",
        message: `Tool bindings are not ready for plugin/action: ${item.action_key || "unknown_action"}`,
        action_key: item.action_key || null,
        plugin_key: item.plugin_key || null,
        tool_keys: item.tool_keys || [],
      });
    }
    if (item.plugin_binding_active === false) {
      blocks.push({
        code: "execution_authority_plugin_binding_inactive",
        message: `Plugin action binding is inactive for action: ${item.action_key || "unknown_action"}`,
        action_key: item.action_key || null,
        plugin_key: item.plugin_key || null,
        plugin_binding_status: item.plugin_binding_status || null,
      });
    }
    if (item.tenant_policy_active === false) {
      blocks.push({
        code: "execution_authority_tenant_policy_inactive",
        message: `Tenant plugin policy is inactive for plugin: ${item.plugin_key || "unknown_plugin"}`,
        action_key: item.action_key || null,
        plugin_key: item.plugin_key || null,
        tenant_policy_status: item.tenant_policy_status || null,
      });
    }
    if (options.requirePluginConnection && item.plugin_key && Number(item.active_connection_count || 0) <= 0) {
      blocks.push({
        code: "execution_authority_plugin_connection_missing",
        message: `No active plugin connection is available for plugin: ${item.plugin_key}`,
        action_key: item.action_key || null,
        plugin_key: item.plugin_key || null,
      });
    }
  }

  return blocks;
}

export function enforceExecutionAuthorityManifestGuard({
  requestPayload = {},
  policies = [],
  manifest = null,
} = {}, deps = {}) {
  const requestOverride = requestBool(requestPayload, "execution_authority_manifest_enforce");
  const enforce = requestOverride === null
    ? policyBool(
        policies,
        "Execution Authority Manifest Governance",
        "Enforce Manifest Before Dispatch",
        "FALSE",
        deps
      )
    : requestOverride;

  const strictReadiness = policyBool(
    policies,
    "Execution Authority Manifest Governance",
    "Require Ready Manifest Before Dispatch",
    "TRUE",
    deps
  );
  const requirePluginConnection = requestBool(requestPayload, "execution_authority_require_plugin_connection") ??
    policyBool(
      policies,
      "Execution Authority Manifest Governance",
      "Require Plugin Connection Before Dispatch",
      "FALSE",
      deps
    );

  if (!enforce) {
    return {
      enforced: false,
      guard_status: "not_enforced",
      reason: "execution_authority_manifest_enforcement_disabled",
      strict_readiness: strictReadiness,
      require_plugin_connection: requirePluginConnection,
      secrets_included: false,
    };
  }

  const blocks = collectManifestBlocks(manifest || {}, {
    strictReadiness,
    requirePluginConnection,
  });

  if (blocks.length) {
    const codes = unique(blocks.map((block) => block.code));
    const err = new Error(`Execution authority manifest guard blocked dispatch: ${codes.join(", ")}`);
    err.code = codes[0] || "execution_authority_manifest_guard_blocked";
    err.status = 403;
    err.details = {
      guard_status: "blocked",
      enforced: true,
      strict_readiness: strictReadiness,
      require_plugin_connection: requirePluginConnection,
      block_codes: codes,
      blocks,
      action_key: manifest?.action_key || null,
      endpoint_key: manifest?.endpoint_key || null,
      plugin_key: manifest?.plugin_key || null,
      secrets_included: false,
    };
    throw err;
  }

  return {
    enforced: true,
    guard_status: "passed",
    strict_readiness: strictReadiness,
    require_plugin_connection: requirePluginConnection,
    block_codes: [],
    action_key: manifest?.action_key || null,
    endpoint_key: manifest?.endpoint_key || null,
    plugin_key: manifest?.plugin_key || null,
    secrets_included: false,
  };
}
