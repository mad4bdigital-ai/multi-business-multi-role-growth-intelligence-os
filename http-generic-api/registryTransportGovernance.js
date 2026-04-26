import { policyValue, policyList } from "./registryPolicyAccess.js";

function defaultBoolFromSheet(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function getBoolFromSheet(deps = {}) {
  return deps.boolFromSheet || defaultBoolFromSheet;
}

function getDebugLog(deps = {}) {
  return deps.debugLog || (() => {});
}

export function isDelegatedTransportTarget(endpoint = {}, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  return (
    String(endpoint.execution_mode || "").trim().toLowerCase() === "http_delegated" &&
    boolFromSheet(endpoint.transport_required) &&
    String(endpoint.transport_action_key || "").trim() !== ""
  );
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
    const transportExecutorKey = String(action.action_key || "").trim();
    const isTransportExecutor = transportExecutorKey === allowedTransport;

    if (!isTransportExecutor && normalizedPrimaryExecutor !== "http_client_backend") {
      const err = new Error(
        `Delegated endpoint requires allowed transport executor ${allowedTransport} or http_client_backend as parent executor: ${action.action_key}`
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
