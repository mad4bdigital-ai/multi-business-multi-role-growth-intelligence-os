import assert from "node:assert/strict";
import { prepareExecutionRequest } from "./executionPreparation.js";

const sheetData = {
  "Business Activity Type Registry": [
    [
      "business_activity_type_key",
      "default_knowledge_profile_key",
      "supported_route_keys",
      "supported_workflows",
      "brand_core_required",
      "status"
    ],
    [
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "content_generation; seo_strategy",
      "wf_content_authority",
      "TRUE",
      "active"
    ]
  ],
  "Business Type Knowledge Profiles": [
    [
      "business_type",
      "knowledge_profile_key",
      "supported_engine_categories",
      "authoritative_read_home",
      "business_type_specific_read_home",
      "shared_knowledge_read_home",
      "compatible_route_keys",
      "compatible_workflows",
      "profile_status",
      "notes"
    ],
    [
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "Brand Intelligence|Content Engines",
      "surface.business_type_hvac_shared_drive_folder",
      "Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services",
      "Growth Intelligence OS - Knowledge Assets/Business Type Assets/Shared",
      "content_generation; seo_strategy",
      "wf_content_authority",
      "profile_registered",
      "FINAL GOVERNED SHARED DRIVE PATH"
    ]
  ],
  "Brand Registry": [
    [
      "brand_key",
      "Brand Name",
      "Normalized Brand Name",
      "business_type_key",
      "knowledge_profile_key",
      "brand_folder_id",
      "target_key",
      "base_url",
      "brand_domain",
      "auth_status",
      "validation_state",
      "status"
    ],
    [
      "arab_cooling",
      "Arab Cooling",
      "Arab Cooling",
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "brand-folder-id",
      "arab_cooling",
      "https://arabcooling.com/",
      "arabcooling.com",
      "ready",
      "ready",
      "active"
    ]
  ],
  "Brand Path Resolver": [
    [
      "brand_key",
      "normalized_brand_name",
      "business_type_key",
      "knowledge_profile_key",
      "brand_folder_id",
      "brand_folder_path",
      "brand_core_docs_json",
      "target_key",
      "base_url",
      "status"
    ],
    [
      "arab_cooling",
      "Arab Cooling",
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "brand-folder-id",
      "Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/arab_cooling",
      "{\"profile\":\"brand-profile-doc-id\"}",
      "arab_cooling",
      "https://arabcooling.com/",
      "active"
    ]
  ],
  "Brand Core Registry": [
    ["brand_key", "asset_key", "doc_id", "status"],
    ["arab_cooling", "profile", "brand-profile-doc-id", "active"]
  ],
  "Validation & Repair Registry": [
    [
      "validation_id",
      "entity_key",
      "surface_id",
      "validation_status",
      "readiness_state",
      "status",
      "last_validated_at"
    ],
    [
      "VAL-ARAB-COOLING",
      "arab_cooling",
      "surface.business_type_hvac_shared_drive_folder",
      "validated",
      "ready",
      "active",
      "2026-05-01T00:00:00Z"
    ]
  ]
};

function makeDeps() {
  return {
    DATA_SOURCE: "sheets",
    REGISTRY_SPREADSHEET_ID: "registry-sheet-id",
    debugLog() {},
    async getGoogleClientsForSpreadsheet() {
      return {
        sheets: {
          spreadsheets: {
            values: {
              async get({ range }) {
                const match = range.match(/^'(.+)'!/);
                const sheetName = match ? match[1].replace(/''/g, "'") : "";
                return {
                  data: {
                    values: sheetData[sheetName] || []
                  }
                };
              }
            }
          }
        }
      };
    },
    resolveProviderDomain() {
      return {
        providerDomain: "https://example.com",
        resolvedProviderDomainMode: "fixed_domain",
        placeholderResolutionSource: ""
      };
    },
    normalizeAuthContract() {
      return {
        mode: "none"
      };
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
      return {
        name: "test-schema",
        document: {
          paths: {
            "/test": {
              post: {
                operationId: "testOperation",
                parameters: [],
                requestBody: {
                  required: false
                }
              }
            }
          }
        }
      };
    },
    resolveSchemaOperation() {
      return {
        operation: {
          parameters: [],
          requestBody: {
            required: false
          }
        }
      };
    },
    injectAuthForSchemaValidation(query, headers) {
      return {
        query,
        headers
      };
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
    }
  };
}

const baseInput = {
  requestPayload: {
    business_type_key: "hvac_air_conditioning_services",
    brand_key: "arab_cooling",
    target_key: "arab_cooling",
    mutation_intent: "create_brand_folder"
  },
  action: {
    action_key: "test_action",
    openai_schema_file_id: "schema-file-id"
  },
  endpoint: {
    endpoint_key: "testEndpoint",
    endpoint_id: "testEndpoint",
    parent_action_key: "test_action",
    endpoint_path_or_function: "/test",
    method: "POST",
    module_binding: "test_module",
    schema_json: JSON.stringify({
      operationId: "testOperation",
      method: "POST",
      path: "/test",
      bodySchema: {
        type: "object",
        additionalProperties: true
      },
      response: {
        type: "object",
        additionalProperties: true
      }
    })
  },
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
  provider_domain: "https://example.com",
  parent_action_key: "test_action",
  endpoint_key: "testEndpoint",
  resolvedMethodPath: {
    method: "POST",
    path: "/test"
  },
  execution_trace_id: "trace-id",
  sync_execution_started_at: "2026-05-01T00:00:00Z"
};

{
  const result = await prepareExecutionRequest(baseInput, makeDeps());

  assert.equal(result.ok, true);
  assert.equal(result.pathResolverLoad.requested, true);
  assert.equal(result.pathResolverLoad.loaded, true);
  assert.equal(result.governedExecutionContext.path_resolution.resolution_status, "ready");
  assert.equal(
    result.governedExecutionContext.path_resolution.businessType.businessTypeKey,
    "hvac_air_conditioning_services"
  );
  assert.equal(
    result.governedExecutionContext.path_resolution.brand.brandKey,
    "arab_cooling"
  );
}

{
  await assert.rejects(
    () =>
      prepareExecutionRequest(
        {
          ...baseInput,
          requestPayload: {
            business_type_key: "hvac_air_conditioning_services",
            brand_key: "arab_cooling",
            mutation_intent: "create_brand_folder"
          }
        },
        {
          ...makeDeps(),
          REGISTRY_SPREADSHEET_ID: ""
        }
      ),
    /resolver rows/
  );
}

{
  const result = await prepareExecutionRequest(baseInput, {
    ...makeDeps(),
    async resolveActionEndpointToolManifest(args) {
      assert.equal(args.action_key, "test_action");
      assert.equal(args.endpoint_key, "testEndpoint");
      assert.equal(args.include_denied, true);
      return {
        ok: true,
        resolver: "shared_action_endpoint_tool_manifest_resolver",
        mode: "read_model_only",
        requested: args,
        count: 1,
        surface_authority: {
          action_registry: { ok: true, resolved_surface_key: "surface.actions_registry_sheet", secrets_included: false },
          endpoint_registry: { ok: true, resolved_surface_key: "surface.endpoint_registry_sheet", secrets_included: false },
          tool_manifest: { ok: true, resolved_surface_key: "surface.platform_tool_manifest", secrets_included: false },
        },
        authority_chain: [
          "task_route_authority_resolver",
          "workflow_registry_authority_resolver",
          "action_registry_authority_resolver",
          "endpoint_registry",
          "platform_tool_manifest",
        ],
        manifests: [
          {
            action: {
              action_key: "test_action",
              plugin: { plugin_key: "test_plugin" },
              evaluation: { allowed: true, reasons: [] },
            },
            endpoints: [{ endpoint_key: "testEndpoint" }],
            tools: [{ tool_key: "test_tool" }],
            readiness: {
              endpoint_count: 1,
              tool_count: 1,
              manifest_complete: true,
            },
            secrets_included: false,
          },
        ],
        secrets_included: false,
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.governedExecutionContext.execution_authority_manifest.requested, true);
  assert.equal(result.governedExecutionContext.execution_authority_manifest.attempted, true);
  assert.equal(result.governedExecutionContext.execution_authority_manifest.resolution_status, "ready");
  assert.equal(result.governedExecutionContext.execution_authority_manifest.first_manifest_complete, true);
  assert.equal(result.governedExecutionContext.execution_authority_manifest.manifests[0].action_key, "test_action");
  assert.equal(result.governedExecutionContext.execution_authority_manifest.manifests[0].tool_keys[0], "test_tool");
  assert.equal(result.governedExecutionContext.execution_authority_manifest.secrets_included, false);
}

{
  const result = await prepareExecutionRequest(
    {
      ...baseInput,
      requestPayload: {
        ...baseInput.requestPayload,
        execution_authority_manifest_enforce: true
      }
    },
    {
      ...makeDeps(),
      async resolveActionEndpointToolManifest(args) {
        assert.equal(args.action_key, "test_action");
        assert.equal(args.endpoint_key, "testEndpoint");
        assert.equal(args.include_denied, true);
        return {
          ok: true,
          resolver: "shared_action_endpoint_tool_manifest_resolver",
          mode: "read_model_only",
          requested: args,
          count: 1,
          surface_authority: {
            action_registry: { ok: true, resolved_surface_key: "surface.actions_registry_sheet", secrets_included: false },
            endpoint_registry: { ok: true, resolved_surface_key: "surface.endpoint_registry_sheet", secrets_included: false },
            tool_manifest: { ok: true, resolved_surface_key: "surface.platform_tool_manifest", secrets_included: false },
          },
          authority_chain: [
            "task_route_authority_resolver",
            "workflow_registry_authority_resolver",
            "action_registry_authority_resolver",
            "endpoint_registry",
            "platform_tool_manifest",
          ],
          manifests: [
            {
              action: {
                action_key: "test_action",
                plugin: {
                  plugin_key: "test_plugin",
                  binding: { status: "active", credential_source: "tenant_connection" },
                  tenant_policy: { status: "active" },
                  connection_summary: { active_connection_count: 1, primary_connection_available: true },
                },
                evaluation: { allowed: true, reasons: [] },
              },
              endpoints: [{ endpoint_key: "testEndpoint", readiness: { active: true, execution_readiness: "ready" } }],
              tools: [{ tool_key: "test_tool", is_enabled: true, binding: { active: true } }],
              readiness: {
                endpoint_count: 1,
                tool_count: 1,
                manifest_complete: true,
              },
              secrets_included: false,
            },
          ],
          secrets_included: false,
        };
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.governedExecutionContext.execution_authority_guard.enforced, true);
  assert.equal(result.governedExecutionContext.execution_authority_guard.guard_status, "passed");
  assert.equal(result.governedExecutionContext.execution_authority_manifest.manifests[0].endpoints_active, true);
  assert.equal(result.governedExecutionContext.execution_authority_manifest.manifests[0].tools_active, true);
  assert.equal(result.governedExecutionContext.execution_authority_manifest.manifests[0].plugin_binding_active, true);
  assert.equal(result.governedExecutionContext.execution_authority_manifest.manifests[0].tenant_policy_active, true);
  assert.equal(result.governedExecutionContext.execution_authority_manifest.manifests[0].active_connection_count, 1);
}

{
  await assert.rejects(
    () => prepareExecutionRequest(
      {
        ...baseInput,
        requestPayload: {
          ...baseInput.requestPayload,
          execution_authority_manifest_enforce: true
        }
      },
      {
        ...makeDeps(),
        async resolveActionEndpointToolManifest(args) {
          return {
            ok: true,
            resolver: "shared_action_endpoint_tool_manifest_resolver",
            mode: "read_model_only",
            requested: args,
            count: 1,
            surface_authority: {
              action_registry: { ok: true, resolved_surface_key: "surface.actions_registry_sheet", secrets_included: false },
              endpoint_registry: { ok: true, resolved_surface_key: "surface.endpoint_registry_sheet", secrets_included: false },
              tool_manifest: { ok: true, resolved_surface_key: "surface.platform_tool_manifest", secrets_included: false },
            },
            authority_chain: ["action_registry_authority_resolver", "endpoint_registry", "platform_tool_manifest"],
            manifests: [
              {
                action: {
                  action_key: "test_action",
                  plugin: { plugin_key: "test_plugin", binding: { status: "active" } },
                  evaluation: { allowed: false, reasons: ["actor_role_not_allowed"] },
                },
                endpoints: [{ endpoint_key: "testEndpoint", readiness: { active: true, execution_readiness: "ready" } }],
                tools: [],
                readiness: {
                  action_allowed: false,
                  endpoint_count: 1,
                  tool_count: 0,
                  manifest_complete: false,
                },
                secrets_included: false,
              },
            ],
            secrets_included: false,
          };
        },
      }
    ),
    (err) => {
      assert.equal(err.code, "execution_authority_action_not_allowed");
      assert.equal(err.status, 403);
      assert.equal(err.details.guard_status, "blocked");
      assert(err.details.block_codes.includes("execution_authority_action_not_allowed"));
      assert.equal(err.details.secrets_included, false);
      return true;
    }
  );
}

{
  for (const passiveFlags of [
    { preflight_only: true },
    { preflight_only: "true" },
    { dry_run: "true" }
  ]) {
    const authResolutionCalls = [];
    let tokenMintCalls = 0;
    const deps = {
      ...makeDeps(),
      normalizeAuthContract(args = {}) {
        authResolutionCalls.push(args.resolve_credentials);
        return {
          mode: "none",
          materialized: args.resolve_credentials !== false
        };
      },
      async mintGoogleAccessTokenForEndpoint() {
        tokenMintCalls += 1;
        return "token";
      }
    };

    await prepareExecutionRequest(
      {
        ...baseInput,
        requestPayload: {
          ...baseInput.requestPayload,
          ...passiveFlags
        }
      },
      deps
    );

    assert.deepEqual(
      authResolutionCalls,
      [false],
      `passive request ${JSON.stringify(passiveFlags)} must not materialize credentials`
    );
    assert.equal(tokenMintCalls, 0);
  }
}

console.log("execution preparation path resolver tests passed");
