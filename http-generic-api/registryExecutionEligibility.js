import { policyValue } from "./registryPolicyAccess.js";

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

const ENDPOINT_ALIASES = {
  getSpreadsheet: ["getSpreadsheet"],
  getSheetValues: ["getSheetValues"],
  appendSheetValues: ["appendSheetValues"],
  clearSheetValues: ["clearSheetValues"],
  getDocument: ["getDocument"],
  createDocument: ["createDocument"],
  updateDocument: ["updateDocument"],
  listDriveFiles: ["listDriveFiles"]
};

const GOOGLE_WORKSPACE_ENDPOINT_GUARDS = {
  getSpreadsheet: {
    providerDomains: ["sheets.googleapis.com"],
    method: "GET",
    pathIncludes: ["/v4/spreadsheets/"]
  },
  getSheetValues: {
    providerDomains: ["sheets.googleapis.com"],
    method: "GET",
    pathIncludes: ["/v4/spreadsheets/", "/values/"]
  },
  appendSheetValues: {
    providerDomains: ["sheets.googleapis.com"],
    method: "POST",
    pathIncludes: ["/v4/spreadsheets/", "/values/"],
    pathEndsWith: ":append"
  },
  clearSheetValues: {
    providerDomains: ["sheets.googleapis.com"],
    method: "POST",
    pathIncludes: ["/v4/spreadsheets/", "/values/"],
    pathEndsWith: ":clear"
  },
  getDocument: {
    providerDomains: ["docs.googleapis.com"],
    method: "GET",
    pathIncludes: ["/v1/documents/"]
  },
  createDocument: {
    providerDomains: ["docs.googleapis.com"],
    method: "POST",
    pathIncludes: ["/v1/documents"]
  },
  updateDocument: {
    providerDomains: ["docs.googleapis.com"],
    method: "POST",
    pathIncludes: ["/v1/documents/"],
    pathEndsWith: ":batchUpdate"
  },
  listDriveFiles: {
    providerDomains: ["www.googleapis.com", "drive.googleapis.com"],
    method: "GET",
    pathIncludes: ["/drive/v3/files"]
  }
};

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeLower(value = "") {
  return normalizeText(value).toLowerCase();
}

function stripUrlPrefix(value = "") {
  return normalizeLower(value).replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function endpointAliasesFor(endpointKey = "") {
  const key = normalizeText(endpointKey);
  return ENDPOINT_ALIASES[key] || [key];
}

export function validateEndpointRowConsistency(row = {}, expected = {}) {
  const endpointKey = normalizeText(expected.endpoint_key || row.endpoint_key);
  const parentActionKey = normalizeText(expected.parent_action_key || row.parent_action_key);
  const mismatches = [];

  const rowParentActionKey = normalizeText(row.parent_action_key);
  if (parentActionKey && rowParentActionKey && rowParentActionKey !== parentActionKey) {
    mismatches.push({
      field: "parent_action_key",
      expected: parentActionKey,
      actual: rowParentActionKey
    });
  }

  const rowEndpointKey = normalizeText(row.endpoint_key);
  if (endpointKey && rowEndpointKey && rowEndpointKey !== endpointKey) {
    mismatches.push({
      field: "endpoint_key",
      expected: endpointKey,
      actual: rowEndpointKey
    });
  }

  const hasExplicitAliasPolicy = Object.prototype.hasOwnProperty.call(
    ENDPOINT_ALIASES,
    endpointKey
  );
  const allowedOperationAliases = endpointAliasesFor(endpointKey);
  const endpointOperation = normalizeText(row.endpoint_operation);
  if (
    hasExplicitAliasPolicy &&
    endpointOperation &&
    !allowedOperationAliases.includes(endpointOperation)
  ) {
    mismatches.push({
      field: "endpoint_operation",
      expected: allowedOperationAliases.join("|"),
      actual: endpointOperation
    });
  }

  const openaiActionName = normalizeText(row.openai_action_name);
  if (
    hasExplicitAliasPolicy &&
    openaiActionName &&
    !allowedOperationAliases.includes(openaiActionName)
  ) {
    mismatches.push({
      field: "openai_action_name",
      expected: allowedOperationAliases.join("|"),
      actual: openaiActionName
    });
  }

  const routeTarget = normalizeText(row.route_target);
  if (routeTarget && parentActionKey && routeTarget !== parentActionKey) {
    mismatches.push({
      field: "route_target",
      expected: parentActionKey,
      actual: routeTarget
    });
  }

  const guard = GOOGLE_WORKSPACE_ENDPOINT_GUARDS[endpointKey];
  if (guard) {
    const providerDomain = stripUrlPrefix(row.provider_domain);
    if (!providerDomain) {
      mismatches.push({
        field: "provider_domain",
        expected: guard.providerDomains.join("|"),
        actual: ""
      });
    } else if (!guard.providerDomains.map(stripUrlPrefix).includes(providerDomain)) {
      mismatches.push({
        field: "provider_domain",
        expected: guard.providerDomains.join("|"),
        actual: normalizeText(row.provider_domain)
      });
    }

    const method = normalizeText(row.method).toUpperCase();
    if (!method) {
      mismatches.push({
        field: "method",
        expected: guard.method,
        actual: ""
      });
    } else if (method !== guard.method) {
      mismatches.push({
        field: "method",
        expected: guard.method,
        actual: method
      });
    }

    const path = normalizeLower(row.endpoint_path_or_function || row.path);
    if (!path) {
      mismatches.push({
        field: "endpoint_path_or_function",
        expected: "google_workspace_endpoint_path",
        actual: ""
      });
    }
    for (const fragment of guard.pathIncludes || []) {
      if (path && !path.includes(fragment.toLowerCase())) {
        mismatches.push({
          field: "endpoint_path_or_function",
          expected: `contains ${fragment}`,
          actual: normalizeText(row.endpoint_path_or_function || row.path)
        });
      }
    }
    if (guard.pathEndsWith && path && !path.endsWith(guard.pathEndsWith.toLowerCase())) {
      mismatches.push({
        field: "endpoint_path_or_function",
        expected: `ends_with ${guard.pathEndsWith}`,
        actual: normalizeText(row.endpoint_path_or_function || row.path)
      });
    }
  }

  return {
    valid: mismatches.length === 0,
    mismatches
  };
}

function isDelegatedTransportTarget(endpoint = {}, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  return (
    String(endpoint.execution_mode || "").trim().toLowerCase() === "http_delegated" &&
    boolFromSheet(endpoint.transport_required) &&
    String(endpoint.transport_action_key || "").trim() !== ""
  );
}

function getEndpointExecutionSnapshot(endpoint = {}, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  return {
    endpoint_id: String(endpoint.endpoint_id || "").trim(),
    endpoint_key: String(endpoint.endpoint_key || "").trim(),
    parent_action_key: String(endpoint.parent_action_key || "").trim(),
    endpoint_operation: String(endpoint.endpoint_operation || "").trim(),
    route_target: String(endpoint.route_target || "").trim(),
    openai_action_name: String(endpoint.openai_action_name || "").trim(),
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
