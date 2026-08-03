import assert from "node:assert/strict";
import { resolveExecutionRequest } from "./executionResolution.js";

const registry = {
  drive: null,
  brandRows: [],
  hostingAccounts: [],
  actionRows: [],
  endpointRows: [],
  policies: [],
  siteRuntimeInventoryRows: [],
  siteSettingsInventoryRows: [],
  pluginInventoryRows: [],
  taskRouteRows: [],
  workflowRows: []
};

function makeExecutionDeps(overrides = {}) {
  return {
    requireEnv: () => {
      throw new Error("global REGISTRY_SPREADSHEET_ID guard must not run");
    },
    createExecutionTraceId: () => "trace_runtime_registry_authority",
    debugLog: () => {},
    promoteDelegatedExecutionPayload: payload => payload,
    normalizeExecutionPayload: payload => payload,
    validateAssetHomePayloadRules: () => ({ ok: true }),
    normalizeAssetType: value => value,
    classifyAssetHome: () => "external",
    assertHostingerTargetTier: () => {},
    validatePayloadIntegrity: () => ({ ok: true }),
    normalizeTopLevelRoutingFields: payload => payload,
    isDelegatedHttpExecuteWrapper: () => false,
    validateTopLevelRoutingFields: () => ({ ok: true }),
    dataSourceMode: "sql",
    registrySpreadsheetId: "",
    getRegistry: async () => registry,
    reloadRegistry: async () => registry,
    getRequiredHttpExecutionPolicyKeys: () => [],
    requirePolicySet: () => ({ ok: true }),
    policyValue: (_policies, _group, _key, fallback = "") => fallback,
    resolveHttpExecutionContext: ({ requestPayload }) => ({
      action: {},
      endpoint: {},
      brand: {},
      sameServiceNativeTarget: false,
      resolvedMethodPath: {
        method: requestPayload.method || "GET",
        path: requestPayload.path || ""
      }
    }),
    boolFromSheet: value => String(value || "").trim().toUpperCase() === "TRUE",
    resolveAction: () => ({}),
    resolveEndpoint: () => ({}),
    getEndpointExecutionSnapshot: () => ({}),
    resolveBrand: () => ({}),
    requireRuntimeCallableAction: () => {},
    requireEndpointExecutionEligibility: () => ({}),
    requireExecutionModeCompatibility: () => {},
    requireNativeFamilyBoundary: () => {},
    requireTransportIfDelegated: () => {},
    requireNoFallbackDirectExecution: () => {},
    isDelegatedTransportTarget: () => false,
    ensureMethodAndPathMatchEndpoint: () => ({ method: "GET", path: "" }),
    sanitizeCallerHeaders: headers => headers || {},
    ...overrides
  };
}

const githubRequest = {
  parent_action_key: "github_api_mcp",
  endpoint_key: "github_get_branch_reference",
  method: "GET"
};

{
  let registryReads = 0;
  const result = await resolveExecutionRequest(
    githubRequest,
    makeExecutionDeps({
      dataSourceMode: "sql",
      registrySpreadsheetId: "",
      getRegistry: async () => {
        registryReads += 1;
        return registry;
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.parent_action_key, "github_api_mcp");
  assert.equal(result.endpoint_key, "github_get_branch_reference");
  assert.equal(registryReads, 1);
}

{
  let registryReads = 0;
  const result = await resolveExecutionRequest(
    githubRequest,
    makeExecutionDeps({
      dataSourceMode: "dual",
      registrySpreadsheetId: "",
      getRegistry: async () => {
        registryReads += 1;
        return registry;
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(registryReads, 1);
}

{
  let registryReads = 0;
  const result = await resolveExecutionRequest(
    githubRequest,
    makeExecutionDeps({
      dataSourceMode: "sheets",
      registrySpreadsheetId: "",
      getRegistry: async () => {
        registryReads += 1;
        return registry;
      }
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 503);
  assert.equal(result.response.body.error.code, "registry_spreadsheet_id_required");
  assert.equal(result.response.body.error.details.data_source, "sheets");
  assert.equal(result.response.body.error.details.operation_class, "registry_sheet_read");
  assert.equal(registryReads, 0);
}

{
  let registryReads = 0;
  const result = await resolveExecutionRequest(
    githubRequest,
    makeExecutionDeps({
      dataSourceMode: "unsupported",
      getRegistry: async () => {
        registryReads += 1;
        return registry;
      }
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 503);
  assert.equal(result.response.body.error.code, "invalid_registry_data_source");
  assert.equal(registryReads, 0);
}

{
  let normalReads = 0;
  let refreshReads = 0;
  const result = await resolveExecutionRequest(
    { ...githubRequest, force_refresh: true },
    makeExecutionDeps({
      dataSourceMode: "sql",
      registrySpreadsheetId: "",
      getRegistry: async () => {
        normalReads += 1;
        return registry;
      },
      reloadRegistry: async () => {
        refreshReads += 1;
        return registry;
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(normalReads, 0);
  assert.equal(refreshReads, 1);
}

{
  let registryReads = 0;
  const result = await resolveExecutionRequest(
    githubRequest,
    makeExecutionDeps({
      dataSourceMode: "sheets",
      registrySpreadsheetId: "configured-registry-workbook",
      getRegistry: async () => {
        registryReads += 1;
        return registry;
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(registryReads, 1);
}

{
  const spreadsheetId = "explicit-request-spreadsheet";
  const range = "Sheet1!A1:B2";
  const result = await resolveExecutionRequest(
    {
      parent_action_key: "google_sheets_api",
      endpoint_key: "getSheetValues",
      method: "GET",
      path_params: { spreadsheetId, range }
    },
    makeExecutionDeps({
      dataSourceMode: "sql",
      registrySpreadsheetId: "",
      resolveHttpExecutionContext: ({ requestPayload }) => ({
        action: {},
        endpoint: {},
        brand: {},
        sameServiceNativeTarget: false,
        resolvedMethodPath: {
          method: "GET",
          path: `/v4/spreadsheets/${encodeURIComponent(requestPayload.path_params.spreadsheetId)}/values/${encodeURIComponent(requestPayload.path_params.range)}`
        }
      })
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.pathParams.spreadsheetId, spreadsheetId);
  assert.equal(result.pathParams.range, range);
}

console.log("runtime registry authority regression tests passed");
