import {
  ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
  ACTIVATION_BOOTSTRAP_SPREADSHEET_ID
} from "./config.js";

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
    getGoogleClients,
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
  const { brandRows, hostingAccounts, actionRows, endpointRows, policies } = registry;
  let drive = null;
  try {
    const clients = await getGoogleClients();
    drive = clients.drive;
  } catch (_) {}

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

  // Normalize getSheetValues range before deriving local vars:
  // - Accept range from query.range OR path_params.range (prefer query as input alias)
  // - Decode any existing percent-encoding once (caller may pre-encode; prevent %XX→%25XX)
  // - Place normalized range in path_params.range so applyPathParams encodes it exactly
  //   once via encodeURIComponent into the /values/{range} URL path segment
  // - Strip range from query because it is only an input alias
  // - Clear requestPayload.path so applyPathParams rebuilds the URL from the template
  if (
    String(parent_action_key || "").trim() === "google_sheets_api" &&
    String(endpoint_key || "").trim() === "getSheetValues"
  ) {
    const rqQuery = requestPayload.query && typeof requestPayload.query === "object"
      ? requestPayload.query
      : {};
    const rqPath = requestPayload.path_params || {};
    const queryRange = String(rqQuery.range || "").trim();
    const pathRange = String(rqPath.range || "").trim();
    const rawRange = queryRange || pathRange;

    if (!rawRange) {
      return {
        ok: false,
        response: {
          status: 400,
          body: {
            ok: false,
            error: {
              code: "missing_required_range_param",
              message: "getSheetValues requires range — supply via query.range or path_params.range.",
              details: {
                parent_action_key,
                endpoint_key,
                path_params_received: Object.keys(rqPath),
                query_keys_received: Object.keys(rqQuery)
              }
            }
          }
        },
        requestPayload,
        execution_trace_id
      };
    }

    let normalizedRange = rawRange;
    try {
      normalizedRange = rawRange.includes("%") ? decodeURIComponent(rawRange) : rawRange;
    } catch {
      normalizedRange = rawRange;
    }

    let requestedSpreadsheetId = String(rqPath.spreadsheetId || "").trim();
    if (normalizedRange === ACTIVATION_BOOTSTRAP_CONFIG_RANGE) {
      if (
        requestedSpreadsheetId === "<activation_bootstrap_spreadsheet_id>" ||
        requestedSpreadsheetId === "{ACTIVATION_BOOTSTRAP_SPREADSHEET_ID}" ||
        /^[{<].+[>}]$/.test(requestedSpreadsheetId)
      ) {
        requestedSpreadsheetId = ACTIVATION_BOOTSTRAP_SPREADSHEET_ID;
      }
    }

    requestPayload.path_params = { ...rqPath, spreadsheetId: requestedSpreadsheetId, range: normalizedRange };
    requestPayload.query = Object.fromEntries(
      Object.entries(rqQuery).filter(([k]) => k !== "range")
    );
    delete requestPayload.path;

    debugLog("SHEETS_RANGE_SNAPSHOT:", JSON.stringify({
      requested_spreadsheetId: requestedSpreadsheetId,
      requested_range: normalizedRange,
      range_source: queryRange ? "query" : "path_params",
      routing: "path",
      force_refresh: !!requestPayload.force_refresh,
      readback_mode: requestPayload.readback?.mode || ""
    }));
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

  if (
    String(parent_action_key || "").trim() === "google_sheets_api" &&
    String(endpoint_key || "").trim() === "getSheetValues"
  ) {
    debugLog("SHEETS_RANGE_ROUTING:", JSON.stringify({
      path: executionContext.resolvedMethodPath?.path || "",
      path_range: pathParams.range || "",
      query_range: query.range || "",
      routing: "path"
    }));
  }

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
