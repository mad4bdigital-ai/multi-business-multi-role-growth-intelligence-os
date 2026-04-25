export const READ_POLICIES = {
  CACHED_NORMAL: "cached_normal",
  VALIDATION_BYPASS: "validation_bypass_cache",
  FORCED_REFRESH: "forced_refresh"
};

function defaultBoolFromSheet(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function defaultJsonParseSafe(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getBoolFromSheet(deps = {}) {
  return deps.boolFromSheet || defaultBoolFromSheet;
}

function getJsonParseSafe(deps = {}) {
  return deps.jsonParseSafe || defaultJsonParseSafe;
}

function getDebugLog(deps = {}) {
  return deps.debugLog || (() => {});
}

export function policyValue(policies, group, key, fallback = "", deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const row = (policies || []).find(
    policy =>
      policy.policy_group === group &&
      policy.policy_key === key &&
      boolFromSheet(policy.active)
  );
  return row ? row.policy_value : fallback;
}

export function policyList(policies, group, key, deps = {}) {
  return String(policyValue(policies, group, key, "", deps))
    .split("|")
    .map(value => value.trim())
    .filter(Boolean);
}

export function isDelegatedTransportTarget(endpoint = {}, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  return (
    String(endpoint.execution_mode || "").trim().toLowerCase() === "http_delegated" &&
    boolFromSheet(endpoint.transport_required) &&
    String(endpoint.transport_action_key || "").trim() !== ""
  );
}

export function getEndpointExecutionSnapshot(endpoint = {}, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  return {
    endpoint_id: String(endpoint.endpoint_id || "").trim(),
    endpoint_key: String(endpoint.endpoint_key || "").trim(),
    parent_action_key: String(endpoint.parent_action_key || "").trim(),
    endpoint_role: String(endpoint.endpoint_role || "").trim(),
    inventory_role: String(endpoint.inventory_role || "").trim(),
    inventory_source: String(endpoint.inventory_source || "").trim(),
    execution_mode: String(endpoint.execution_mode || "").trim(),
    transport_required_raw: endpoint.transport_required ?? "",
    transport_required: boolFromSheet(endpoint.transport_required),
    transport_action_key: String(endpoint.transport_action_key || "").trim(),
    delegated_transport_target: isDelegatedTransportTarget(endpoint, deps),
    status: String(endpoint.status || "").trim(),
    execution_readiness: String(endpoint.execution_readiness || "").trim(),
    provider_domain: String(endpoint.provider_domain || "").trim(),
    endpoint_path_or_function: String(endpoint.endpoint_path_or_function || "").trim(),
    notes: String(endpoint.notes || "").trim()
  };
}

export function resolveBrand(rows, requestPayload = {}, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const jsonParseSafe = getJsonParseSafe(deps);
  const normalizeProviderDomain = deps.normalizeProviderDomain || (value => String(value || "").trim());
  const safeNormalizeProviderDomain = deps.safeNormalizeProviderDomain || (value => String(value || "").trim());
  const requestedProviderDomain = requestPayload.provider_domain
    ? safeNormalizeProviderDomain(requestPayload.provider_domain)
    : "";

  const targetKey = String(requestPayload.target_key || "").trim().toLowerCase();
  const brandName = String(requestPayload.brand || "").trim().toLowerCase();
  const brandDomain = String(requestPayload.brand_domain || "").trim().toLowerCase();

  const normalizedRows = (rows || []).map(row => {
    const aliases = jsonParseSafe(row.site_aliases_json, []).map(value =>
      String(value).toLowerCase()
    );
    let rowBaseUrl = "";
    try {
      rowBaseUrl = row.base_url ? normalizeProviderDomain(row.base_url) : "";
    } catch {}
    return {
      ...row,
      _aliases: aliases,
      _normalized_brand_name: String(row.normalized_brand_name || "").toLowerCase(),
      _display_name: String(row.brand_name || "").toLowerCase(),
      _target_key: String(row.target_key || "").toLowerCase(),
      _brand_domain: String(row.brand_domain || "").toLowerCase(),
      _base_url: rowBaseUrl
    };
  });

  let row = null;

  if (targetKey) {
    row = normalizedRows.find(candidate => candidate._target_key === targetKey) || null;
  }

  if (!row && brandName) {
    row =
      normalizedRows.find(
        candidate =>
          candidate._normalized_brand_name === brandName ||
          candidate._display_name === brandName ||
          candidate._aliases.includes(brandName)
      ) || null;
  }

  if (!row && brandDomain) {
    row = normalizedRows.find(candidate => candidate._brand_domain === brandDomain) || null;
  }

  if (!row && requestedProviderDomain && requestedProviderDomain !== "target_resolved") {
    row = normalizedRows.find(candidate => candidate._base_url === requestedProviderDomain) || null;
  }

  if (!row) return null;

  if (!boolFromSheet(row.transport_enabled)) {
    const err = new Error(`Transport is not enabled for resolved brand ${row.brand_name}.`);
    err.code = "transport_disabled";
    err.status = 403;
    throw err;
  }

  if (row.transport_action_key && row.transport_action_key !== "http_generic_api") {
    const err = new Error(`Unsupported transport_action_key: ${row.transport_action_key}`);
    err.code = "unsupported_transport";
    err.status = 403;
    throw err;
  }

  return row;
}

export function resolveAction(rows, parentActionKey, deps = {}) {
  const debugLog = getDebugLog(deps);
  const matches = (rows || []).filter(row => row.action_key === parentActionKey);

  debugLog(
    "ACTION_RESOLUTION_REQUEST:",
    JSON.stringify({
      parent_action_key: parentActionKey,
      match_count: matches.length
    })
  );

  if (!matches.length) {
    const err = new Error(`Parent action not found: ${parentActionKey}`);
    err.code = "parent_action_not_found";
    err.status = 403;
    throw err;
  }

  const active = matches.find(
    row => String(row.status || "").trim().toLowerCase() === "active"
  );

  const action = active || matches[0];

  debugLog(
    "ACTION_RESOLUTION_SELECTED:",
    JSON.stringify({
      action_key: action.action_key,
      status: action.status || "",
      runtime_capability_class: action.runtime_capability_class || "",
      runtime_callable: action.runtime_callable || "",
      primary_executor: action.primary_executor || "",
      openai_schema_storage_surface: action.openai_schema_storage_surface || ""
    })
  );

  if (String(action.status || "").trim().toLowerCase() !== "active") {
    const err = new Error(`Parent action is not active: ${parentActionKey}`);
    err.code = "parent_action_inactive";
    err.status = 403;
    throw err;
  }
  return action;
}

export function resolveEndpoint(rows, parentActionKey, endpointKey, deps = {}) {
  const debugLog = getDebugLog(deps);
  const matches = (rows || []).filter(
    row =>
      row.parent_action_key === parentActionKey &&
      row.endpoint_key === endpointKey
  );

  debugLog(
    "ENDPOINT_RESOLUTION_REQUEST:",
    JSON.stringify({
      parent_action_key: parentActionKey,
      endpoint_key: endpointKey,
      match_count: matches.length
    })
  );

  if (!matches.length) {
    const err = new Error(`Endpoint not found: ${endpointKey}`);
    err.code = "endpoint_not_found";
    err.status = 403;
    throw err;
  }

  const activeReady = matches.find(
    row =>
      String(row.status || "").trim().toLowerCase() === "active" &&
      String(row.execution_readiness || "").trim().toLowerCase() === "ready"
  );

  const endpoint = activeReady || matches[0];

  debugLog(
    "ENDPOINT_RESOLUTION_SELECTED:",
    JSON.stringify(getEndpointExecutionSnapshot(endpoint, deps))
  );

  if (String(endpoint.status || "").trim().toLowerCase() !== "active") {
    const err = new Error(`Endpoint is not active: ${endpointKey}`);
    err.code = "endpoint_inactive";
    err.status = 403;
    throw err;
  }

  if (String(endpoint.execution_readiness || "").trim().toLowerCase() !== "ready") {
    const err = new Error(`Endpoint is not execution-ready: ${endpointKey}`);
    err.code = "endpoint_not_ready";
    err.status = 403;
    throw err;
  }

  return endpoint;
}

export function requireRuntimeCallableAction(policies, action, endpoint, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const requireCallable =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Require Runtime Callable For Direct Execution",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const disallowPending =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Disallow Pending Binding Execution",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const allowRegistryOnlyDirect =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Allow Registry Only Actions Direct Execution",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const runtimeCallable = boolFromSheet(action.runtime_callable);
  const capabilityClass = String(action.runtime_capability_class || "").trim().toLowerCase();
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint, deps);

  if (disallowPending && capabilityClass === "pending_binding") {
    const err = new Error(`Action is pending binding and cannot execute: ${action.action_key}`);
    err.code = "action_pending_binding";
    err.status = 403;
    throw err;
  }

  if (
    requireCallable &&
    !delegatedTransportTarget &&
    primaryExecutor !== "http_client_backend" &&
    !runtimeCallable
  ) {
    const err = new Error(`Action is not runtime callable: ${action.action_key}`);
    err.code = "action_not_runtime_callable";
    err.status = 403;
    throw err;
  }

  if (
    !allowRegistryOnlyDirect &&
    !delegatedTransportTarget &&
    capabilityClass === "external_action_only" &&
    primaryExecutor !== "http_client_backend"
  ) {
    const err = new Error(
      `Registry-only external action cannot execute directly: ${action.action_key}`
    );
    err.code = "external_action_direct_execution_blocked";
    err.status = 403;
    throw err;
  }
}

export function requireEndpointExecutionEligibility(policies, endpoint, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const debugLog = getDebugLog(deps);
  const blockInventoryOnly =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Block Inventory Only Endpoints",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const endpointRole = String(endpoint.endpoint_role || "").trim().toLowerCase();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const transportRequired = boolFromSheet(endpoint.transport_required);
  const inventoryRole = String(endpoint.inventory_role || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint, deps);

  const snapshot = {
    ...getEndpointExecutionSnapshot(endpoint, deps),
    block_inventory_only: blockInventoryOnly
  };

  debugLog("ENDPOINT_EXECUTION_ELIGIBILITY_INPUT:", JSON.stringify(snapshot));

  if (blockInventoryOnly && !delegatedTransportTarget && endpointRole && endpointRole !== "primary") {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "endpoint_role_blocked" })
    );

    const err = new Error(
      `Endpoint is not a primary executable endpoint: ${endpoint.endpoint_key}`
    );
    err.code = "endpoint_role_blocked";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  if (
    blockInventoryOnly &&
    !delegatedTransportTarget &&
    inventoryRole &&
    inventoryRole !== "endpoint_inventory"
  ) {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "inventory_only_endpoint" })
    );

    const err = new Error(
      `Non-executable inventory role cannot execute directly: ${endpoint.endpoint_key}`
    );
    err.code = "inventory_only_endpoint";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  debugLog("ENDPOINT_EXECUTION_ELIGIBILITY_PASS:", JSON.stringify(snapshot));

  return {
    endpointRole,
    executionMode,
    transportRequired,
    delegatedTransportTarget
  };
}

export function requireExecutionModeCompatibility(action, endpoint) {
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();

  if (executionMode === "native_direct") {
    const err = new Error(
      `Native-direct endpoint must use native GPT execution path, not http-execute: ${endpoint.endpoint_key}`
    );
    err.code = "native_direct_requires_native_path";
    err.status = 403;
    throw err;
  }

  if (executionMode === "http_delegated" && primaryExecutor !== "http_client_backend") {
    const err = new Error(
      `Execution mode mismatch: endpoint ${endpoint.endpoint_key} is http_delegated but parent executor is ${primaryExecutor || "unset"}.`
    );
    err.code = "execution_mode_mismatch";
    err.status = 403;
    throw err;
  }
}

export function requireNativeFamilyBoundary(policies, action, endpoint, deps = {}) {
  const nativeFamilies = policyList(
    policies,
    "HTTP Transport Routing",
    "Native Google Families Allowed",
    deps
  );

  const httpFamilies = policyList(
    policies,
    "HTTP Transport Routing",
    "HTTP Client Required Google Families",
    deps
  );

  const actionKey = String(action.action_key || "").trim();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint, deps);
  const isTransportExecutor = actionKey === "http_generic_api";

  if (nativeFamilies.includes(actionKey) && !delegatedTransportTarget) {
    throw Object.assign(
      new Error(
        `Native family ${actionKey} must not execute through http-execute unless delegated.`
      ),
      { code: "native_family_http_execution_blocked", status: 403 }
    );
  }

  if (httpFamilies.includes(actionKey) && !isTransportExecutor && !delegatedTransportTarget) {
    throw Object.assign(
      new Error(`HTTP-governed family ${actionKey} must use delegated transport.`),
      { code: "http_family_requires_delegation", status: 403 }
    );
  }
}

export function requireTransportIfDelegated(policies, action, endpoint, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const requireTransport =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Require Transport For Delegated Actions",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const transportRequired = boolFromSheet(endpoint.transport_required);
  const allowedTransport = String(
    policyValue(
      policies,
      "HTTP Execution Governance",
      "Allowed Transport",
      "http_generic_api",
      deps
    )
  ).trim();

  if (requireTransport && executionMode === "http_delegated") {
    const transportActionKey = String(endpoint.transport_action_key || "").trim();
    if (transportRequired && transportActionKey !== allowedTransport) {
      const err = new Error(
        `Delegated endpoint requires supported transport_action_key ${allowedTransport}; received ${transportActionKey || "unset"}.`
      );
      err.code = "transport_required";
      err.status = 403;
      throw err;
    }

    const normalizedPrimaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
    const isTransportExecutor = String(action.action_key || "").trim() === "http_generic_api";

    if (!isTransportExecutor && normalizedPrimaryExecutor !== "http_client_backend") {
      const err = new Error(
        `Delegated endpoint requires http_client_backend as parent executor: ${action.action_key}`
      );
      err.code = "transport_executor_mismatch";
      err.status = 403;
      throw err;
    }
  }
}

export function requireNoFallbackDirectExecution(policies, endpoint, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const fallbackRequiresPrimaryFailure =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Fallback Requires Primary Failure",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  if (!fallbackRequiresPrimaryFailure) return;

  const fallbackAllowed = boolFromSheet(endpoint.fallback_allowed);
  const endpointRole = String(endpoint.endpoint_role || "").trim().toLowerCase();

  if (fallbackAllowed && endpointRole === "fallback") {
    const err = new Error(
      `Fallback endpoint cannot execute directly without primary failure: ${endpoint.endpoint_key}`
    );
    err.code = "fallback_requires_primary_failure";
    err.status = 403;
    throw err;
  }
}

export function getPlaceholderResolutionSources(policies = [], deps = {}) {
  return policyList(
    policies,
    "HTTP Execution Governance",
    "Placeholder Resolution Sources",
    deps
  ).map(value => String(value || "").trim().toLowerCase());
}

export function resolveRuntimeProviderDomainSource(input = {}, deps = {}) {
  const debugLog = getDebugLog(deps);
  const safeNormalizeProviderDomain = deps.safeNormalizeProviderDomain || (value => String(value || "").trim());
  const normalizeProviderDomain = deps.normalizeProviderDomain || (value => String(value || "").trim());
  const requestBody = input.requestBody || {};
  const brand = input.brand || null;
  const parentActionKey = input.parentActionKey || "";

  debugLog("RUNTIME_REQUEST_BODY:", JSON.stringify(requestBody));

  const directProviderDomain = safeNormalizeProviderDomain(requestBody.provider_domain);
  if (directProviderDomain && directProviderDomain !== "target_resolved") {
    return {
      resolvedProviderDomain: directProviderDomain,
      placeholderResolutionSource: "provider_domain"
    };
  }

  if (String(parentActionKey || "").trim() === "hostinger_api") {
    return {
      resolvedProviderDomain: "",
      placeholderResolutionSource: ""
    };
  }

  if (brand?.base_url) {
    return {
      resolvedProviderDomain: normalizeProviderDomain(brand.base_url),
      placeholderResolutionSource:
        String(requestBody.target_key || "").trim()
          ? "target_key"
          : String(requestBody.brand || "").trim()
            ? "brand"
            : String(requestBody.brand_domain || "").trim()
              ? "brand_domain"
              : "brand"
    };
  }

  return {
    resolvedProviderDomain: "",
    placeholderResolutionSource: ""
  };
}

export function resolveProviderDomain(input = {}, deps = {}) {
  const port = deps.port;
  const debugLog = getDebugLog(deps);
  const normalizeProviderDomain = deps.normalizeProviderDomain || (value => String(value || "").trim());
  const normalizeEndpointProviderDomain =
    deps.normalizeEndpointProviderDomain || (value => String(value || "").trim());
  const safeNormalizeProviderDomain = deps.safeNormalizeProviderDomain || (value => String(value || "").trim());
  const isVariablePlaceholder = deps.isVariablePlaceholder || (() => false);
  const requestedProviderDomain = input.requestedProviderDomain;
  const endpoint = input.endpoint || {};
  const brand = input.brand || null;
  const parentActionKey = input.parentActionKey || "";
  const policies = input.policies || [];
  const requestBody = input.requestBody || {};
  const endpointProviderDomain = String(endpoint.provider_domain || "").trim();

  if (
    String(endpoint.execution_mode || "").trim().toLowerCase() === "native_controller" ||
    endpointProviderDomain === "same_service_native"
  ) {
    return {
      providerDomain: `http://127.0.0.1:${port}`,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource: ""
    };
  }

  const {
    resolvedProviderDomain: runtimeResolvedProviderDomain,
    placeholderResolutionSource
  } = resolveRuntimeProviderDomainSource(
    {
      requestBody,
      brand,
      parentActionKey
    },
    deps
  );

  if (parentActionKey === "wordpress_api") {
    if (!brand || !brand.base_url) {
      const err = new Error("wordpress_api requires a brand-resolved base_url.");
      err.code = "provider_domain_not_allowed";
      err.status = 403;
      throw err;
    }

    return {
      providerDomain: normalizeProviderDomain(brand.base_url),
      resolvedProviderDomainMode: "brand_bound_domain",
      placeholderResolutionSource: placeholderResolutionSource || "brand"
    };
  }

  if (!endpointProviderDomain) {
    if (!runtimeResolvedProviderDomain) {
      const fallbackRequested = safeNormalizeProviderDomain(requestedProviderDomain);
      if (!fallbackRequested) {
        const err = new Error("provider_domain is required.");
        err.code = "provider_domain_not_resolved";
        err.status = 400;
        throw err;
      }

      return {
        providerDomain: fallbackRequested,
        resolvedProviderDomainMode: "fixed_domain",
        placeholderResolutionSource: ""
      };
    }

    return {
      providerDomain: runtimeResolvedProviderDomain,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource
    };
  }

  if (isVariablePlaceholder(endpointProviderDomain, policies)) {
    const allowPlaceholderResolution =
      String(
        policyValue(
          policies,
          "HTTP Execution Governance",
          "Allow Placeholder Provider Domain Resolution",
          "FALSE",
          deps
        )
      )
        .trim()
        .toUpperCase() === "TRUE";

    if (!allowPlaceholderResolution) {
      const err = new Error("Placeholder provider_domain resolution is disabled by policy.");
      err.code = "provider_domain_placeholder_blocked";
      err.status = 403;
      throw err;
    }

    if (!requestBody.target_key && !requestBody.brand && !requestBody.brand_domain) {
      debugLog("MISSING_PLACEHOLDER_SOURCES_AT_RUNTIME:", JSON.stringify(requestBody));
    }

    const allowedSources = getPlaceholderResolutionSources(policies, deps);
    const hasAllowedSource =
      (allowedSources.includes("brand_domain") && !!String(requestBody.brand_domain || "").trim()) ||
      (allowedSources.includes("target_key") && !!String(requestBody.target_key || "").trim()) ||
      (allowedSources.includes("brand") && !!String(requestBody.brand || "").trim());

    if (allowedSources.length && !hasAllowedSource) {
      debugLog("MISSING_PLACEHOLDER_SOURCES_AT_RUNTIME:", JSON.stringify(requestBody));
      const err = new Error(
        `provider_domain placeholder resolution requires one of: ${allowedSources.join(", ")}`
      );
      err.code = "provider_domain_resolution_source_missing";
      err.status = 400;
      throw err;
    }

    if (!runtimeResolvedProviderDomain) {
      const err = new Error("provider_domain must resolve from governed runtime input.");
      err.code = "provider_domain_not_resolved";
      err.status = 400;
      throw err;
    }

    return {
      providerDomain: runtimeResolvedProviderDomain,
      resolvedProviderDomainMode: "placeholder_runtime_resolved",
      placeholderResolutionSource
    };
  }

  const normalizedEndpointProviderDomain = normalizeEndpointProviderDomain(endpointProviderDomain);
  const normalizedRequested = safeNormalizeProviderDomain(requestedProviderDomain);

  if (!normalizedRequested) {
    return {
      providerDomain: normalizedEndpointProviderDomain,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource: ""
    };
  }

  if (normalizedRequested !== normalizedEndpointProviderDomain) {
    const err = new Error("provider_domain does not match endpoint definition.");
    err.code = "provider_domain_mismatch";
    err.status = 403;
    throw err;
  }

  return {
    providerDomain: normalizedEndpointProviderDomain,
    resolvedProviderDomainMode: "fixed_domain",
    placeholderResolutionSource: ""
  };
}
