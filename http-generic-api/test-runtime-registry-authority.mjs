import assert from "node:assert/strict";
import {
  resolveRuntimeRegistry
} from "./runtimeRegistryAuthority.js";
import { resolveExecutionRequest } from "./executionResolution.js";

const registry = {
  drive: null,
  brandRows: [],
  hostingAccounts: [],
  actionRows: [],
  endpointRows: [],
  policies: {},
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
    loadSqlRegistry: async () => registry,
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

{
  let sheetsCalls = 0;
  const result = await resolveRuntimeRegistry({
    authority: "sql",
    registrySpreadsheetId: "",
    loadSqlRegistry: async () => registry,
    getSheetsRegistry: async () => {
      sheetsCalls += 1;
      return registry;
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.metadata.runtime_authority, "sql");
  assert.equal(sheetsCalls, 0);
}

{
  const result = await resolveRuntimeRegistry({
    authority: "dual",
    registrySpreadsheetId: "",
    loadSqlRegistry: async () => registry
  });

  assert.equal(result.ok, true);
  assert.equal(result.metadata.runtime_authority, "sql");
  assert.equal(result.metadata.sheets_fallback_attempted, false);
  assert.equal(result.metadata.degraded_dependencies[0]?.code, "registry_spreadsheet_id_not_configured");
}

{
  const result = await resolveRuntimeRegistry({
    authority: "sheets",
    registrySpreadsheetId: ""
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 503);
  assert.equal(result.response.body.error.code, "registry_spreadsheet_id_required");
  assert.equal(result.response.body.error.details.operation_class, "registry_sheet_read");
}

{
  let sheetsCalls = 0;
  const result = await resolveRuntimeRegistry({
    authority: "dual",
    registrySpreadsheetId: "configured-but-recovery-not-authorized",
    loadSqlRegistry: async () => {
      const error = new Error("sql unavailable");
      error.code = "sql_unavailable";
      throw error;
    },
    getSheetsRegistry: async () => {
      sheetsCalls += 1;
      return registry;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.body.error.code, "registry_sql_unavailable");
  assert.equal(result.response.body.error.details.sheets_fallback_attempted, false);
  assert.equal(sheetsCalls, 0);
}

{
  const result = await resolveRuntimeRegistry({ authority: "unsupported" });
  assert.equal(result.ok, false);
  assert.equal(result.response.body.error.code, "invalid_registry_data_source");
}

{
  const result = await resolveExecutionRequest(
    {
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_get_branch_reference",
      method: "GET"
    },
    makeExecutionDeps()
  );

  assert.equal(result.ok, true);
  assert.equal(result.parent_action_key, "github_api_mcp");
  assert.equal(result.endpoint_key, "github_get_branch_reference");
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
