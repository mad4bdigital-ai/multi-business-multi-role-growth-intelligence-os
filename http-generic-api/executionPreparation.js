import { enforceBrandLiveMutationPreflight } from "./brandLiveMutationPreflight.js";
import { buildGovernedExecutionContext } from "./governedContextResolution.js";
import { loadPathResolverRowsForRequest } from "./pathResolverRowsLoader.js";
import { resolveEndpointLocalSchemaContract } from "./endpointSchemaResolver.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function prepareExecutionRequest(input = {}, deps = {}) {
  const {
    requestPayload,
    action,
    endpoint,
    brand,
    drive,
    hostingAccounts,
    policies,
    callerHeaders,
    query,
    body,
    pathParams,
    provider_domain,
    parent_action_key,
    endpoint_key,
    resolvedMethodPath,
    execution_trace_id,
    sync_execution_started_at
  } = input;

  const {
    debugLog,
    resolveProviderDomain,
    normalizeAuthContract,
    resolveAccountKey,
    isGoogleApiHost,
    enforceSupportedAuthMode,
    mintGoogleAccessTokenForEndpoint,
    isDelegatedTransportTarget,
    ensureWritePermissions,
    fetchSchemaContract,
    resolveSchemaOperation,
    injectAuthForSchemaValidation,
    getAdditionalStaticAuthHeaders,
    validateParameters,
    validateRequestBody,
    performUniversalServerWriteback,
    logValidationRunWriteback,
    policyValue,
    jsonParseSafe,
    injectAuthIntoHeaders,
    buildUrl,
    appendQuery
  } = deps;

  debugLog("REQUEST_PAYLOAD_TARGET_KEY:", requestPayload.target_key || "");
  debugLog("REQUEST_PAYLOAD_BRAND:", requestPayload.brand || "");
  debugLog("REQUEST_PAYLOAD_BRAND_DOMAIN:", requestPayload.brand_domain || "");

  const {
    providerDomain: resolvedProviderDomain,
    resolvedProviderDomainMode,
    placeholderResolutionSource
  } = resolveProviderDomain({
    requestedProviderDomain: provider_domain,
    endpoint,
    brand,
    parentActionKey: parent_action_key,
    policies,
    requestBody: requestPayload
  });
  debugLog("RESOLVED_PROVIDER_DOMAIN:", resolvedProviderDomain);
  debugLog("RESOLVED_PROVIDER_DOMAIN_MODE:", resolvedProviderDomainMode);
  debugLog("PLACEHOLDER_RESOLUTION_SOURCE:", placeholderResolutionSource);

  const requestBody = requestPayload;
  const resolvedTargetKey = String(
    requestPayload.target_key || brand?.target_key || ""
  ).trim();

  const authContract = await normalizeAuthContract({
    action,
    brand,
    hostingAccounts,
    targetKey: requestBody.target_key || resolvedTargetKey || ""
  });

  if (String(action.action_key || "").trim() === "hostinger_api") {
    debugLog("HOSTINGER_BRAND_TARGET_KEY:", brand?.target_key || "");
    debugLog(
      "HOSTINGER_EFFECTIVE_ACCOUNT_KEY:",
      resolveAccountKey({
        brand,
        targetKey: requestBody.target_key || resolvedTargetKey || "",
        hostingAccounts
      })
    );
    debugLog("HOSTINGER_REQUEST_TARGET_KEY:", requestBody.target_key || resolvedTargetKey || "");
  }

  debugLog("INFERRED_AUTH_MODE:", authContract.mode);
  enforceSupportedAuthMode(policies, authContract.mode);

  if (authContract.mode === "oauth_gpt_action") {
    const handling = policyValue(
      policies,
      "HTTP Execution Governance",
      "OAuth GPT Action Transport Handling",
      "NATIVE_ONLY"
    );

    const allowDelegatedGoogleOAuth = String(
      policyValue(
        policies,
        "HTTP Google Auth",
        "Allow Delegated Google OAuth",
        "TRUE"
      )
    ).trim().toUpperCase() === "TRUE";

    const delegatedGoogleEndpoint =
      isDelegatedTransportTarget(endpoint) &&
      isGoogleApiHost(resolvedProviderDomain);

    if (!allowDelegatedGoogleOAuth || !delegatedGoogleEndpoint) {
      const err = new Error(
        `Resolved auth mode ${authContract.mode} must use governed native connector path (${handling}).`
      );
      err.code = "native_connector_required";
      err.status = 403;
      throw err;
    }

    try {
      authContract.mode = "bearer_token";
      authContract.header_name = "Authorization";
      authContract.secret = await mintGoogleAccessTokenForEndpoint({
        drive,
        policies,
        action,
        endpoint
      });
    } catch (err) {
      debugLog("DELEGATED_GOOGLE_OAUTH_FALLBACK:", {
        action_key: action.action_key,
        endpoint_key: endpoint.endpoint_key,
        provider_domain: resolvedProviderDomain,
        message: err?.message || String(err)
      });
      const authErr = new Error("Delegated Google OAuth token mint failed.");
      authErr.code = "auth_resolution_failed";
      authErr.status = err?.status || 500;
      throw authErr;
    }
  } else if (
    authContract.mode === "none" &&
    isDelegatedTransportTarget(endpoint) &&
    isGoogleApiHost(resolvedProviderDomain)
  ) {
    try {
      authContract.mode = "bearer_token";
      authContract.header_name = "Authorization";
      authContract.secret = await mintGoogleAccessTokenForEndpoint({
        drive,
        policies,
        action,
        endpoint
      });
    } catch (err) {
      debugLog("DELEGATED_GOOGLE_OAUTH_FALLBACK:", {
        action_key: action.action_key,
        endpoint_key: endpoint.endpoint_key,
        provider_domain: resolvedProviderDomain,
        message: err?.message || String(err)
      });
      const authErr = new Error("Delegated Google OAuth token mint failed.");
      authErr.code = "auth_resolution_failed";
      authErr.status = err?.status || 500;
      throw authErr;
    }
  }

  ensureWritePermissions(brand, resolvedMethodPath.method);

  const pathResolverLoad = await loadPathResolverRowsForRequest(requestPayload, deps);

  // GAP 21: load task routes from DB when a loader is available.
  // task_routes rows are keyed by intent_key / task_key, not parent_action_key.
  let taskRouteRows = [];
  if (typeof deps.loadTaskRouteRows === "function") {
    try {
      const intentKey = String(requestPayload.intent_key || requestPayload.task_key || endpoint_key || "").trim();
      taskRouteRows = await deps.loadTaskRouteRows({ intent_key: intentKey });
    } catch {
      // Non-blocking — task_route context will show resolution_status: "not_loaded"
    }
  }

  const governedExecutionContext = buildGovernedExecutionContext({
    requestPayload,
    brand,
    endpoint,
    action,
    pathResolverRows: pathResolverLoad.rows || {},
    taskRouteRows
  });

  // Conditionally resolve knowledge surfaces for brand/business-type requests
  {
    const { isBrandOrBusinessTypeRequest, resolveKnowledgeSurfaces } = await import("./knowledgeSurfaceResolver.js");
    if (isBrandOrBusinessTypeRequest(requestPayload, governedExecutionContext)) {
      const businessTypeKey =
        governedExecutionContext.path_resolution?.business_type_key ||
        governedExecutionContext.path_resolution?.businessType?.businessTypeKey ||
        String(requestPayload.business_type_key || "").trim();
      const brandKey =
        governedExecutionContext.brand?.brand_key ||
        String(requestPayload.brand_key || requestPayload.brand_name || "").trim();
      try {
        const result = await resolveKnowledgeSurfaces({ business_type_key: businessTypeKey, brand_key: brandKey });
        governedExecutionContext.knowledge_surfaces = {
          requested: true,
          resolved: true,
          ...result
        };
      } catch {
        governedExecutionContext.knowledge_surfaces = {
          requested: true,
          resolved: false,
          surfaces: [],
          reason: "resolution_failed"
        };
      }
    }
  }

  debugLog(
    "GOVERNED_EXECUTION_CONTEXT_PATH_RESOLUTION:",
    JSON.stringify({
      requested: governedExecutionContext.path_resolution?.requested,
      attempted: governedExecutionContext.path_resolution?.attempted,
      resolution_status: governedExecutionContext.path_resolution?.resolution_status,
      loader_requested: pathResolverLoad.requested,
      loader_loaded: pathResolverLoad.loaded,
      loader_reason: pathResolverLoad.reason,
      business_type_key:
        governedExecutionContext.path_resolution?.businessType?.businessTypeKey ||
        governedExecutionContext.path_resolution?.business_type_key ||
        "",
      brand_key:
        governedExecutionContext.path_resolution?.brand?.brandKey ||
        governedExecutionContext.path_resolution?.brand_key ||
        "",
      target_key:
        governedExecutionContext.path_resolution?.executionTarget?.targetKey ||
        governedExecutionContext.path_resolution?.target_key ||
        ""
    })
  );

  const contextValidationState = String(
    governedExecutionContext?.validation_state || ""
  ).trim().toLowerCase();
  if (contextValidationState === "blocked") {
    const blockedReason = String(
      governedExecutionContext?.blocked_reason || "governed_context_blocked"
    ).trim();
    const err = new Error(
      `Governed execution context is blocked: ${blockedReason}`
    );
    err.code = "context_resolution_blocked";
    err.status = 422;
    err.details = { validation_state: "blocked", blocked_reason: blockedReason };
    throw err;
  }

  // WordPress publish contract pre-execution enforcement (GAPs 16, 17, 18)
  let wordpressPublishContractResult = { enforced: false };
  if (
    String(parent_action_key || "").trim() === "wordpress_api" &&
    WRITE_METHODS.has(String(resolvedMethodPath?.method || "").toUpperCase())
  ) {
    const { enforceWordpressPublishContract } = await import("./wordpressPublishContractEnforcer.js");
    wordpressPublishContractResult = enforceWordpressPublishContract({
      parent_action_key,
      endpoint,
      resolvedMethodPath,
      requestPayload,
      brand,
      governedExecutionContext
    });
  }

  const brandMutationPreflight = enforceBrandLiveMutationPreflight({
    parent_action_key,
    endpoint,
    resolvedMethodPath,
    requestPayload,
    brand,
    governedExecutionContext
  });
  debugLog("BRAND_MUTATION_PREFLIGHT:", JSON.stringify(brandMutationPreflight));

  // For getSheetValues, query.range is only accepted as an input alias. The
  // outbound URL keeps range in the path, matching Google Sheets REST:
  // /v4/spreadsheets/{spreadsheetId}/values/{range}.
  const schemaLookupPath =
    String(parent_action_key || "").trim() === "google_sheets_api" &&
    String(endpoint_key || "").trim() === "getSheetValues"
      ? String(endpoint.endpoint_path_or_function || "").trim() || resolvedMethodPath.path
      : resolvedMethodPath.path;

  const localSchemaJsonAssets = (deps && Array.isArray(deps.jsonAssets)) ? deps.jsonAssets :
    ((deps && Array.isArray(deps.registryJsonAssets)) ? deps.registryJsonAssets : []);
  const endpointLocalSchemaContract = resolveEndpointLocalSchemaContract(endpoint, { jsonAssets: localSchemaJsonAssets });
  const schemaContract = endpointLocalSchemaContract ||
    await fetchSchemaContract(drive, action.openai_schema_file_id);
  const schemaSource = schemaContract?.source ||
    (endpointLocalSchemaContract ? "endpoint_local" : "action_openai_schema_file");
  const schemaContractFileId = schemaContract?.fileId || action.openai_schema_file_id || "";
  debugLog("SCHEMA_CONTRACT_SOURCE:", JSON.stringify({
    source: schemaSource,
    schema_name: schemaContract?.name || "",
    schema_contract_file_id: schemaContractFileId,
    action_openai_schema_file_id: action.openai_schema_file_id || ""
  }));
  const schemaOperationInfo = await resolveSchemaOperation(schemaContract, resolvedMethodPath.method, schemaLookupPath);
  if (!schemaOperationInfo) {
    const err = new Error(`Method/path not found in authoritative schema for ${parent_action_key}.`);
    err.code = "schema_path_method_mismatch";
    err.status = 422;
    throw err;
  }

  debugLog("NORMALIZED_QUERY:", query);
  const schemaValidationInput = injectAuthForSchemaValidation(
    query,
    callerHeaders,
    authContract
  );

  const queryWithAuth = schemaValidationInput.query;
  const headersWithAuthForValidation = {
    ...schemaValidationInput.headers,
    ...getAdditionalStaticAuthHeaders(action, authContract)
  };

  const schemaValidationErrors = [
    ...validateParameters(schemaOperationInfo.operation, {
      query: queryWithAuth,
      headers: headersWithAuthForValidation,
      path_params: pathParams
    }),
    ...validateRequestBody(schemaOperationInfo.operation, body)
  ];

  const route_id = String(endpoint?.endpoint_id || "").trim();
  const target_module = String(endpoint?.module_binding || "").trim();
  const target_workflow = String(action?.action_key || "").trim();
  const brand_name = String(brand?.brand_name || requestPayload.brand || "").trim();

  const callerAuthTrust = policyValue(policies, "HTTP Execution Governance", "Caller Authorization Header Trust", "FALSE");
  if (
    String(callerAuthTrust).toUpperCase() === "FALSE" &&
    (requestPayload.headers?.Authorization || requestPayload.headers?.authorization)
  ) {
    const err = new Error("Caller-supplied Authorization is not trusted by policy.");
    err.code = "forbidden_header";
    err.status = 403;
    throw err;
  }

  if (schemaValidationErrors.length) {
    const responsePayload = {
      ok: false,
      error: {
        code: "request_schema_mismatch",
        message: "Request failed schema alignment.",
        details: {
          request_schema_alignment_status: "degraded",
          errors: schemaValidationErrors,
          openai_schema_file_id: action.openai_schema_file_id,
          schema_contract_file_id: schemaContractFileId,
          schema_source: schemaSource,
          schema_name: schemaContract.name
        }
      }
    };

    await performUniversalServerWriteback({
      mode: "sync",
      job_id: undefined,
      target_key: requestPayload.target_key,
      parent_action_key,
      endpoint_key,
      route_id,
      target_module,
      target_workflow,
      source_layer: "http_client_backend",
      entry_type: "sync_execution",
      execution_class: "sync",
      attempt_count: 1,
      status_source: "failed",
      responseBody: responsePayload,
      error_code: "request_schema_mismatch",
      error_message_short: "Request failed schema alignment.",
      http_status: 422,
      brand_name,
      execution_trace_id,
      started_at: sync_execution_started_at
    });

    return { ok: false, response: { status: 422, body: responsePayload } };
  }

  await logValidationRunWriteback({
    target_key: requestPayload.target_key,
    parent_action_key,
    endpoint_key,
    route_id,
    target_module,
    target_workflow,
    validationStatus: "succeeded",
    validationPayload: {
      request_schema_alignment_status: "validated",
      openai_schema_file_id: action.openai_schema_file_id,
      schema_name: schemaContract.name
    },
    error_code: undefined,
    error_message_short: undefined,
    brand_name,
    execution_trace_id,
    started_at: sync_execution_started_at
  });

  if (brandMutationPreflight?.preflight_status === "dry_run_preflight_only") {
    const responsePayload = {
      ok: true,
      dry_run: true,
      preflight_only: true,
      outbound_request_executed: false,
      execution_blocked: true,
      parent_action_key,
      endpoint_key,
      route_id,
      target_module,
      target_workflow,
      brand_name,
      mutation_class: brandMutationPreflight.mutation_class,
      brand_mutation_preflight: brandMutationPreflight,
      request_schema_alignment_status: "validated",
      message:
        "Dry-run/preflight-only request validated. No outbound WordPress mutation request was executed."
    };

    await performUniversalServerWriteback({
      mode: "sync",
      job_id: undefined,
      target_key: requestPayload.target_key,
      parent_action_key,
      endpoint_key,
      route_id,
      target_module,
      target_workflow,
      source_layer: "http_client_backend",
      entry_type: "sync_execution",
      execution_class: "sync",
      attempt_count: 1,
      status_source: "succeeded",
      responseBody: responsePayload,
      error_code: undefined,
      error_message_short: undefined,
      http_status: 200,
      brand_name,
      execution_trace_id,
      started_at: sync_execution_started_at
    });

    return { ok: false, response: { status: 200, body: responsePayload } };
  }

  const finalQuery = queryWithAuth;
  let finalHeaders = {
    Accept: "application/json",
    ...(brand ? jsonParseSafe(brand.default_headers_json, {}) : {}),
    ...callerHeaders
  };
  finalHeaders = injectAuthIntoHeaders(finalHeaders, authContract);
  finalHeaders = {
    ...finalHeaders,
    ...getAdditionalStaticAuthHeaders(action, authContract)
  };

  if (body !== undefined && !finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
    finalHeaders["Content-Type"] = "application/json";
  }

  const baseUrl = buildUrl(resolvedProviderDomain, resolvedMethodPath.path);
  const requestUrl = appendQuery(baseUrl, finalQuery);

  debugLog("OUTBOUND_URL:", requestUrl);
  debugLog("AUTH_MODE:", authContract.mode);
  debugLog("HAS_AUTH_HEADER:", !!(finalHeaders["Authorization"] || finalHeaders["authorization"]));
  debugLog("AUTH_HEADER_NAME:", authContract.header_name || "");
  debugLog("HAS_CUSTOM_API_HEADER:", authContract.header_name ? !!finalHeaders[authContract.header_name] : false);

  return {
    ok: true,
    resolvedProviderDomain,
    resolvedProviderDomainMode,
    placeholderResolutionSource,
    authContract,
    brandMutationPreflight,
    wordpressPublishContractResult,
    governedExecutionContext,
    pathResolverLoad,
    schemaContract,
    schemaSource,
    schemaContractFileId,
    schemaOperationInfo,
    route_id,
    target_module,
    target_workflow,
    brand_name,
    finalQuery,
    finalHeaders,
    baseUrl,
    requestUrl
  };
}
