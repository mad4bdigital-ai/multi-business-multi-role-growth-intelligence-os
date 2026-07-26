import assert from "node:assert/strict";
import { prepareExecutionRequest } from "./executionPreparation.js";
import { resolveSchemaOperationTwoLayer } from "./schemaOverlayResolver.js";

const overlayEndpoint = {
  endpoint_key: "create_post",
  endpoint_id: "create_post",
  parent_action_key: "wordpress_api",
  endpoint_path_or_function: "/wp/v2/posts",
  method: "POST",
  module_binding: "wordpress_module",
  schema_json: JSON.stringify({
    operationId: "createPostBase",
    method: "POST",
    path: "/wp/v2/posts",
    bodySchema: {
      type: "object",
      properties: {
        title: { type: "string" }
      }
    },
    response: {
      type: "object",
      properties: {
        id: { type: "integer" }
      }
    }
  }),
  schema_overlay_mode: "endpoint_child_schema",
  schema_overlay_status: "validated",
  child_openai_schema_file_id: "overlay-asset-001"
};

const childAsset = {
  asset_json: JSON.stringify({
    method: "POST",
    path: "/wp/v2/posts",
    operation: {
      operationId: "createPost",
      summary: "Create a WordPress post",
      parameters: []
    },
    requestBody: {
      type: "object",
      properties: {
        title: { type: "string" }
      }
    },
    response: {
      type: "object",
      properties: {
        id: { type: "integer" }
      }
    }
  })
};

function makeDeps(overrides = {}) {
  const parentSchemaContract = {
    name: "wordpress-schema",
    document: {
      paths: {}
    }
  };

  return {
    REGISTRY_SPREADSHEET_ID: "",
    debugLog() {},
    async getGoogleClientsForSpreadsheet() {
      return { sheets: { spreadsheets: { values: { async get() { return { data: { values: [] } }; } } } } };
    },
    resolveProviderDomain() {
      return {
        providerDomain: "https://arabcooling.com",
        resolvedProviderDomainMode: "fixed_domain",
        placeholderResolutionSource: ""
      };
    },
    normalizeAuthContract() {
      return { mode: "none" };
    },
    resolveAccountKey() {
      return "";
    },
    isGoogleApiHost() {
      return false;
    },
    enforceSupportedAuthMode() {},
    async mintGoogleAccessTokenForEndpoint() {
      return "token";
    },
    isDelegatedTransportTarget() {
      return false;
    },
    ensureWritePermissions() {},
    async fetchSchemaContract() {
      return parentSchemaContract;
    },
    resolveSchemaOperation(schemaContract, method, path) {
      return resolveSchemaOperationTwoLayer({
        schemaContract,
        method,
        path,
        endpoint: overlayEndpoint,
        parentActionKey: "wordpress_api",
        resolveSchemaOperation: () => null,
        deps: {
          loadJsonAssetById: async () => childAsset
        }
      });
    },
    injectAuthForSchemaValidation(query, headers) {
      return { query, headers };
    },
    getAdditionalStaticAuthHeaders() {
      return {};
    },
    validateParameters() {
      return [];
    },
    validateRequestBody() {
      return [];
    },
    async performUniversalServerWriteback() {},
    async logValidationRunWriteback() {},
    policyValue() {
      return "FALSE";
    },
    jsonParseSafe(value, fallback) {
      try {
        return value ? JSON.parse(value) : fallback;
      } catch {
        return fallback;
      }
    },
    injectAuthIntoHeaders(headers) {
      return headers;
    },
    buildUrl(providerDomain, path) {
      return `${providerDomain}${path}`;
    },
    appendQuery(url) {
      return url;
    },
    ...overrides
  };
}

const baseInput = {
  requestPayload: {
    target_key: "arab_cooling",
    operator_approved: "TRUE",
    mutation_approval: { approved: true },
    dry_run_preflight_completed: true,
    live_execution_approved: true
  },
  action: {
    action_key: "wordpress_api",
    openai_schema_file_id: "parent-schema-file"
  },
  endpoint: overlayEndpoint,
  brand: {
    brand_name: "Arab Cooling",
    target_key: "arab_cooling",
    brand_domain: "arabcooling.com",
    write_allowed: "TRUE",
    transport_enabled: "TRUE"
  },
  drive: {},
  hostingAccounts: [],
  policies: [],
  callerHeaders: {},
  query: {},
  body: {},
  pathParams: {},
  provider_domain: "https://arabcooling.com",
  parent_action_key: "wordpress_api",
  endpoint_key: "create_post",
  resolvedMethodPath: {
    method: "POST",
    path: "/wp/v2/posts"
  },
  execution_trace_id: "trace-overlay-001",
  sync_execution_started_at: "2026-05-01T00:00:00Z"
};

// 1 — overlay schema resolves, execution preparation succeeds
{
  const result = await prepareExecutionRequest(baseInput, makeDeps());

  assert.equal(result.ok, true, "ok is true with overlay schema");
  assert.ok(result.schemaOperationInfo, "schemaOperationInfo present");
  assert.equal(result.schemaOperationInfo.schema_overlay_applied, true, "overlay was applied");
  assert.equal(result.schemaOperationInfo.schema_resolution_layer, "endpoint_child_schema");
  assert.equal(result.schemaOperationInfo.child_schema_asset_id, "overlay-asset-001");
  assert.ok(result.schemaOperationInfo.operation, "operation is present");
  assert.equal(result.schemaOperationInfo.operation.operationId, "createPost");
}

// 2 — overlay asset missing → preparation throws schema path mismatch
{
  const depsNoAsset = makeDeps({
    resolveSchemaOperation(schemaContract, method, path) {
      return resolveSchemaOperationTwoLayer({
        schemaContract,
        method,
        path,
        endpoint: overlayEndpoint,
        parentActionKey: "wordpress_api",
        resolveSchemaOperation: () => null,
        deps: {
          loadJsonAssetById: async () => null
        }
      });
    }
  });

  await assert.rejects(
    () => prepareExecutionRequest(baseInput, depsNoAsset),
    (err) => {
      assert.equal(err.code, "child_schema_overlay_asset_missing");
      return true;
    }
  );
}

// 3 — endpoint without overlay but parent schema has the operation → still ok
{
  const plainEndpoint = {
    ...overlayEndpoint,
    schema_overlay_mode: "",
    schema_overlay_status: "",
    child_openai_schema_file_id: ""
  };

  const depsParent = makeDeps({
    resolveSchemaOperation() {
      return {
        operation: {
          operationId: "createPost",
          parameters: [],
          requestBody: { required: false }
        },
        schema_resolution_layer: "parent_action_schema",
        schema_overlay_applied: false
      };
    }
  });

  const result = await prepareExecutionRequest(
    { ...baseInput, endpoint: plainEndpoint },
    depsParent
  );

  assert.equal(result.ok, true, "ok with parent schema");
  assert.equal(result.schemaOperationInfo.schema_overlay_applied, false);
}

console.log("execution preparation schema overlay tests passed");
