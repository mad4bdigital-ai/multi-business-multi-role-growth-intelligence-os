import { READ_POLICIES } from "./registryReadPolicies.js";
export { READ_POLICIES };
import { policyValue, policyList } from "./registryPolicyAccess.js";
export { policyValue, policyList };
import {
  requireRuntimeCallableAction,
  requireEndpointExecutionEligibility,
  requireExecutionModeCompatibility
} from "./registryExecutionEligibility.js";
export { requireRuntimeCallableAction, requireEndpointExecutionEligibility, requireExecutionModeCompatibility };
import {
  isDelegatedTransportTarget,
  requireNativeFamilyBoundary,
  requireTransportIfDelegated,
  requireNoFallbackDirectExecution,
  getPlaceholderResolutionSources,
  resolveRuntimeProviderDomainSource,
  resolveProviderDomain
} from "./registryTransportGovernance.js";
export {
  isDelegatedTransportTarget,
  requireNativeFamilyBoundary,
  requireTransportIfDelegated,
  requireNoFallbackDirectExecution,
  getPlaceholderResolutionSources,
  resolveRuntimeProviderDomainSource,
  resolveProviderDomain
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

function getAllowedTransport(deps = {}) {
  return String(deps.allowedTransportKey || deps.allowedTransport || "http_generic_api").trim();
}

function getDebugLog(deps = {}) {
  return deps.debugLog || (() => {});
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
  const allowedTransport = getAllowedTransport(deps);
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

  if (row.transport_action_key && row.transport_action_key !== allowedTransport) {
    const err = new Error(`Unsupported transport_action_key: ${row.transport_action_key}; expected ${allowedTransport}`);
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
