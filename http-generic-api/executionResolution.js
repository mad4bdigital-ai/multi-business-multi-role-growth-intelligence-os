export async function resolveExecutionRequest(reqBody = {}, deps = {}) {
  const {
    requireEnv,
    createExecutionTraceId,
    debugLog,
    promoteDelegatedExecutionPayload,
    normalizeExecutionPayload,
    validateAssetHomePayloadRules,
    normalizeAssetType,
    classifyAssetHome,
    assertHostingerTargetTier,
    validatePayloadIntegrity,
    normalizeTopLevelRoutingFields,
    isDelegatedHttpExecuteWrapper,
    validateTopLevelRoutingFields,
    getRegistry,
    reloadRegistry,
    getRequiredHttpExecutionPolicyKeys,
    requirePolicySet,
    policyValue,
    resolveHttpExecutionContext,
    boolFromSheet,
    resolveAction,
    resolveEndpoint,
    getEndpointExecutionSnapshot,
    resolveBrand,
    requireRuntimeCallableAction,
    requireEndpointExecutionEligibility,
    requireExecutionModeCompatibility,
    requireNativeFamilyBoundary,
    requireTransportIfDelegated,
    requireNoFallbackDirectExecution,
    isDelegatedTransportTarget,
    ensureMethodAndPathMatchEndpoint,
    sanitizeCallerHeaders
  } = deps;

  requireEnv("REGISTRY_SPREADSHEET_ID");

  let execution_trace_id =
    String(reqBody?.execution_trace_id || "").trim() || createExecutionTraceId();

  const originalPayload = reqBody || {};
  const originalPayloadPromoted =
    promoteDelegatedExecutionPayload(originalPayload);

  const normalized = normalizeExecutionPayload(originalPayloadPromoted);
  const normalizedPromoted =
    promoteDelegatedExecutionPayload(normalized);
  const normalizedAssetHomeValidation = validateAssetHomePayloadRules(
    normalizedPromoted,
    { normalizeAssetType, classifyAssetHome }
  );
  if (!normalizedAssetHomeValidation.ok) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "normalized_asset_home_validation_failed",
            message: "Normalized asset home validation failed.",
            details: normalizedAssetHomeValidation.errors
          }
        }
      },
      execution_trace_id
    };
  }
  assertHostingerTargetTier(normalizedPromoted);

  const payloadIntegrity = validatePayloadIntegrity(
    normalizeTopLevelRoutingFields(originalPayloadPromoted),
    normalizeTopLevelRoutingFields(normalizedPromoted)
  );
  if (!payloadIntegrity.ok) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "payload_integrity_violation",
            message: "Normalized payload does not preserve required top-level routing fields.",
            details: {
              mismatches: payloadIntegrity.mismatches
            }
          },
          execution_guardrail: true
        }
      },
      execution_trace_id
    };
  }

  const requestPayload = normalizedPromoted;
  execution_trace_id =
    String(requestPayload.execution_trace_id || execution_trace_id || "").trim() ||
    createExecutionTraceId();
  requestPayload.execution_trace_id = execution_trace_id;

  debugLog("IS_DELEGATED_HTTP_EXECUTE_WRAPPER:", isDelegatedHttpExecuteWrapper(requestPayload));
  debugLog("PROMOTED_ROUTING_FIELDS:", JSON.stringify({
    target_key: requestPayload.target_key || "",
    brand: requestPayload.brand || "",
    brand_domain: requestPayload.brand_domain || ""
  }));
  debugLog("PROMOTED_EXECUTION_TARGET:", JSON.stringify({
    provider_domain: requestPayload.provider_domain || "",
    parent_action_key: requestPayload.parent_action_key || "",
    endpoint_key: requestPayload.endpoint_key || "",
    method: requestPayload.method || "",
    path: requestPayload.path || ""
  }));

  const provider_domain = requestPayload.provider_domain;
  const parent_action_key = requestPayload.parent_action_key;
  const endpoint_key = requestPayload.endpoint_key;

  if (!parent_action_key || !endpoint_key) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "invalid_request",
            message: "parent_action_key and endpoint_key are required."
          }
        }
      },
      requestPayload,
      execution_trace_id
    };
  }

  const forceRefresh = requestPayload.force_refresh === true || String(requestPayload.force_refresh || "").toLowerCase() === "true";
  if (forceRefresh) {
    debugLog("REGISTRY_FORCE_REFRESH:", true);
  }
  const registry = forceRefresh ? await reloadRegistry() : await getRegistry();
  const { drive, brandRows, hostingAccounts, actionRows, endpointRows, policies } = registry;

  const requiredHttpExecutionPolicyKeys =
    getRequiredHttpExecutionPolicyKeys(policies);

  const requiredHttpExecutionPolicyCheck =
    requirePolicySet(
      policies,
      "HTTP Execution Governance",
      requiredHttpExecutionPolicyKeys
    );

  if (!requiredHttpExecutionPolicyCheck.ok) {
    return {
      ok: false,
      response: {
        status: 403,
        body: {
          ok: false,
          error: {
            code: "missing_required_http_execution_policy",
            message: "Required HTTP Execution Governance policies are not fully enabled.",
            details: {
              policy_group: "HTTP Execution Governance",
              missing_keys: requiredHttpExecutionPolicyCheck.missing,
              handling: String(
                policyValue(
                  policies,
                  "HTTP Execution Governance",
                  "Missing Required Policy Handling",
                  "BLOCK"
                )
              ).trim()
            }
          },
          execution_guardrail: true,
          repair_action: "restore_required_http_execution_governance_rows",
          execution_trace_id
        }
      },
      requestPayload,
      execution_trace_id
    };
  }

  const topLevelRoutingValidation = validateTopLevelRoutingFields(
    requestPayload,
    policies,
    { policyValue }
  );
  if (!topLevelRoutingValidation.ok) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "top_level_routing_schema_violation",
            message: "Top-level routing fields failed validation.",
            details: {
              errors: topLevelRoutingValidation.errors
            }
          },
          execution_guardrail: true
        }
      },
      requestPayload,
      execution_trace_id
    };
  }

  const assetHomeValidation = validateAssetHomePayloadRules(
    requestPayload,
    { normalizeAssetType, classifyAssetHome }
  );

  if (!assetHomeValidation.ok) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "asset_home_validation_failed",
            message: "Asset home validation failed.",
            details: assetHomeValidation.errors
          }
        }
      },
      requestPayload,
      execution_trace_id
    };
  }

  const callerHeaders = sanitizeCallerHeaders(requestPayload.headers || {});
  const query = requestPayload.query && typeof requestPayload.query === "object"
    ? { ...requestPayload.query }
    : {};
  const body = requestPayload.body;
  const pathParams = requestPayload.path_params || {};

  debugLog("NORMALIZED_TOP_LEVEL_ROUTING_FIELDS:", JSON.stringify({
    provider_domain: requestPayload.provider_domain || "",
    parent_action_key: requestPayload.parent_action_key || "",
    endpoint_key: requestPayload.endpoint_key || "",
    method: requestPayload.method || "",
    path: requestPayload.path || "",
    target_key: requestPayload.target_key || "",
    brand: requestPayload.brand || "",
    brand_domain: requestPayload.brand_domain || ""
  }));

  const executionContext = resolveHttpExecutionContext(
    {
      requestPayload,
      parent_action_key,
      endpoint_key,
      actionRows,
      endpointRows,
      brandRows,
      policies,
      allowedTransport: process.env.HTTP_ALLOWED_TRANSPORT
    },
    {
      debugLog,
      boolFromSheet,
      policyValue,
      resolveAction,
      resolveEndpoint,
      getEndpointExecutionSnapshot,
      resolveBrand,
      requireRuntimeCallableAction,
      requireEndpointExecutionEligibility,
      requireExecutionModeCompatibility,
      requireNativeFamilyBoundary,
      requireTransportIfDelegated,
      requireNoFallbackDirectExecution,
      isDelegatedTransportTarget,
      ensureMethodAndPathMatchEndpoint
    }
  );

  return {
    ok: true,
    requestPayload,
    execution_trace_id,
    provider_domain,
    parent_action_key,
    endpoint_key,
    drive,
    hostingAccounts,
    policies,
    callerHeaders,
    query,
    body,
    pathParams,
    ...executionContext
  };
}
