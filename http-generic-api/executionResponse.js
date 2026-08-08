import { isRawTextResponseRequest } from "./upstreamResponseParser.js";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isEffectivelyRuntimeCallable(action = {}, endpoint = {}, deps = {}) {
  const boolFromSheet = deps.boolFromSheet || (value => {
    if (value === true || value === false) return value;
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  });

  const runtimeCallable = boolFromSheet(action.runtime_callable);
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const transportRequired = boolFromSheet(endpoint.transport_required);
  const transportActionKey = String(endpoint.transport_action_key || "").trim();

  return (
    runtimeCallable ||
    primaryExecutor === "http_client_backend" ||
    (executionMode === "http_delegated" && transportRequired && transportActionKey !== "")
  );
}

function isPotentiallyMutatingRequest(resolvedMethodPath = {}) {
  const method = String(resolvedMethodPath?.method || "").trim().toUpperCase();
  return Boolean(method) && !SAFE_HTTP_METHODS.has(method);
}

function buildPostMutationSchemaDriftPayload({
  schemaErrorCode,
  schemaErrorMessage,
  upstreamStatus,
  openaiSchemaFileId,
  drift,
  errors = undefined,
}) {
  return {
    ok: false,
    error: {
      code: "UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED",
      message: "Provider mutation returned success, but response validation could not safely confirm the final outcome. Governed reconciliation is required before retry.",
      details: {
        outcome_classification: "unknown_outcome",
        reconciliation_required: true,
        retry_allowed: false,
        automatic_retry_performed: false,
        upstream_success_confirmed: true,
        upstream_status: upstreamStatus,
        original_schema_error_code: schemaErrorCode,
        original_schema_error_message: schemaErrorMessage,
        ...(errors ? { errors } : {}),
        ...drift,
        schema_learning_candidate_emitted: true,
        openai_schema_file_id: openaiSchemaFileId,
        secrets_included: false,
      },
    },
  };
}

export async function validateAndShapeExecutionResponse(dispatchResult, context, deps) {
  const {
    upstream,
    data,
    responseHeaders,
    contentType,
    effectiveRequestUrl,
    finalAttemptQuery,
    resilienceApplies
  } = dispatchResult;

  const {
    requestPayload,
    action,
    endpoint,
    parent_action_key,
    endpoint_key,
    authContract,
    schemaContract,
    schemaOperationInfo,
    route_id,
    target_module,
    target_workflow,
    brand_name,
    resolvedProviderDomain,
    resolvedProviderDomainMode,
    placeholderResolutionSource,
    execution_trace_id,
    sync_execution_started_at,
    resolvedMethodPath,
    policies,
    graphMemoryContext = null
  } = context;

  const {
    policyValue,
    policyList,
    validateByJsonSchema,
    classifySchemaDrift,
    boolFromSheet,
    performUniversalServerWriteback
  } = deps;

  let responseSchemaAlignmentStatus = "not_declared";
  const registryRuntimeCallable = boolFromSheet(action.runtime_callable);
  const effectiveRuntimeCallable = isEffectivelyRuntimeCallable(action, endpoint, deps);
  const safeGraphMemoryContext = graphMemoryContext ? {
    requested: Boolean(graphMemoryContext.requested),
    resolved: Boolean(graphMemoryContext.resolved),
    source: graphMemoryContext.source || "platform_graph_memory",
    usage: graphMemoryContext.usage || "execution_context_advisory",
    applied_to_transport: Boolean(graphMemoryContext.applied_to_transport),
    asset_count: Number(graphMemoryContext.asset_count || 0),
    assets: Array.isArray(graphMemoryContext.assets) ? graphMemoryContext.assets : [],
    selection_policy: graphMemoryContext.selection_policy || {},
    secrets_included: false,
  } : null;

  const responseSchemaEnforcementEnabled = String(
    policyValue(
      policies,
      "HTTP Response Schema Enforcement",
      "Response Schema Enforcement Enabled",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const enforcedContentTypes = policyList(
    policies,
    "HTTP Response Schema Enforcement",
    "Response Content Type Enforcement"
  ).map(v => v.toLowerCase());

  const currentContentType = String(contentType || "").toLowerCase();
  const rawTextResponse = isRawTextResponseRequest(requestPayload, currentContentType);
  const mutationMayHaveOccurred = upstream.ok && isPotentiallyMutatingRequest(resolvedMethodPath);

  const responseContent =
    schemaOperationInfo.operation?.responses?.[String(upstream.status)]?.content ||
    schemaOperationInfo.operation?.responses?.default?.content ||
    {};

  const responseJsonSchema =
    responseContent["application/json"]?.schema ||
    responseContent["application/problem+json"]?.schema ||
    null;

  const contentTypeEligible = !rawTextResponse && (
    enforcedContentTypes.length
      ? enforcedContentTypes.some(ct => currentContentType.includes(ct))
      : currentContentType.includes("application/json")
  );

  if (rawTextResponse) responseSchemaAlignmentStatus = "not_applicable_raw_text";

  if (responseSchemaEnforcementEnabled && contentTypeEligible) {
    if (!responseJsonSchema) {
      responseSchemaAlignmentStatus = "degraded";
      const drift = {
        schema_drift_detected: true,
        schema_drift_type: "structure_mismatch",
        schema_drift_scope: "response",
      };

      if (mutationMayHaveOccurred) {
        const responsePayload = buildPostMutationSchemaDriftPayload({
          schemaErrorCode: "response_schema_missing",
          schemaErrorMessage: "Response schema could not be resolved for schema-bound endpoint.",
          upstreamStatus: upstream.status,
          openaiSchemaFileId: action.openai_schema_file_id,
          drift,
        });

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
          status_source: "unknown_outcome",
          responseBody: responsePayload,
          error_code: "UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED",
          error_message_short: responsePayload.error.message,
          http_status: upstream.status,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return { status: 409, body: responsePayload };
      }

      const responsePayload = {
        ok: false,
        error: {
          code: "response_schema_missing",
          message: "Response schema could not be resolved for schema-bound endpoint.",
          details: {
            ...drift,
            schema_learning_candidate_emitted: true,
            upstream_status: upstream.status,
            openai_schema_file_id: action.openai_schema_file_id
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
        error_code: "response_schema_missing",
        error_message_short: "Response schema could not be resolved for schema-bound endpoint.",
        http_status: 422,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return { status: 422, body: responsePayload };
    }

    responseSchemaAlignmentStatus = "validated";
    const responseErrors = validateByJsonSchema(responseJsonSchema, data, "response");
    if (responseErrors.length) {
      const drift = classifySchemaDrift(responseJsonSchema, data, "response") || {
        schema_drift_detected: true,
        schema_drift_type: "type_mismatch",
        schema_drift_scope: "response"
      };

      responseSchemaAlignmentStatus = "degraded";

      if (mutationMayHaveOccurred) {
        const responsePayload = buildPostMutationSchemaDriftPayload({
          schemaErrorCode: "response_schema_mismatch",
          schemaErrorMessage: "Response failed strict schema validation.",
          upstreamStatus: upstream.status,
          openaiSchemaFileId: action.openai_schema_file_id,
          drift,
          errors: responseErrors,
        });

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
          status_source: "unknown_outcome",
          responseBody: responsePayload,
          error_code: "UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED",
          error_message_short: responsePayload.error.message,
          http_status: upstream.status,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return { status: 409, body: responsePayload };
      }

      const responsePayload = {
        ok: false,
        error: {
          code: "response_schema_mismatch",
          message: "Response failed strict schema validation.",
          details: {
            errors: responseErrors,
            ...drift,
            schema_learning_candidate_emitted: true,
            upstream_status: upstream.status,
            openai_schema_file_id: action.openai_schema_file_id
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
        error_code: "response_schema_mismatch",
        error_message_short: "Response failed strict schema validation.",
        http_status: 422,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return { status: 422, body: responsePayload };
    }
  }

  const compactWordPressCreate =
    parent_action_key === "wordpress_api" && endpoint_key === "wordpress_create_post";
  if (compactWordPressCreate) {
    const success = upstream.status === 201 && data && typeof data === "object" && data.id;
    if (success) {
      const responsePayload = {
        ok: true,
        upstream_status: upstream.status,
        provider_domain: resolvedProviderDomain,
        parent_action_key,
        endpoint_key,
        method: resolvedMethodPath.method,
        path: resolvedMethodPath.path,
        openai_schema_file_id: action.openai_schema_file_id,
        schema_name: schemaContract.name,
        resolved_auth_mode: authContract.mode,
        runtime_capability_class: action.runtime_capability_class || "",
        runtime_callable: effectiveRuntimeCallable,
        registry_runtime_callable: registryRuntimeCallable,
        primary_executor: action.primary_executor || "",
        endpoint_role: endpoint.endpoint_role || "",
        execution_mode: endpoint.execution_mode || "",
        transport_required: boolFromSheet(endpoint.transport_required),
        request_schema_alignment_status: "validated",
        response_schema_alignment_status: responseSchemaAlignmentStatus,
        transport_request_contract_status: "validated",
        resolved_provider_domain_mode: resolvedProviderDomainMode,
        placeholder_resolution_source: placeholderResolutionSource,
        resilience_applied: resilienceApplies,
        final_query: finalAttemptQuery,
        request_url: effectiveRequestUrl,
        graph_memory_context: safeGraphMemoryContext,
        post_id: data.id,
        status: data.status,
        link: data.link || ""
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
        responseBody: data,
        error_code: data?.error?.code,
        error_message_short: data?.error?.message,
        http_status: upstream.status,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return { status: 200, body: responsePayload };
    }

    const responsePayload = {
      ok: false,
      upstream_status: upstream.status,
      provider_domain: resolvedProviderDomain,
      parent_action_key,
      endpoint_key,
      method: resolvedMethodPath.method,
      path: resolvedMethodPath.path,
      openai_schema_file_id: action.openai_schema_file_id,
      schema_name: schemaContract.name,
      resolved_auth_mode: authContract.mode,
      runtime_capability_class: action.runtime_capability_class || "",
      runtime_callable: effectiveRuntimeCallable,
      registry_runtime_callable: registryRuntimeCallable,
      primary_executor: action.primary_executor || "",
      endpoint_role: endpoint.endpoint_role || "",
      execution_mode: endpoint.execution_mode || "",
      transport_required: boolFromSheet(endpoint.transport_required),
      request_schema_alignment_status: "validated",
      response_schema_alignment_status: responseSchemaAlignmentStatus,
      transport_request_contract_status: "validated",
      resolved_provider_domain_mode: resolvedProviderDomainMode,
      placeholder_resolution_source: placeholderResolutionSource,
      resilience_applied: resilienceApplies,
      final_query: finalAttemptQuery,
      request_url: effectiveRequestUrl,
      graph_memory_context: safeGraphMemoryContext,
      error: {
        code: "wordpress_request_failed",
        message: "WordPress did not confirm post creation.",
        details: {
          upstream_status: upstream.status,
          data
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
      responseBody: data,
      error_code: "wordpress_request_failed",
      error_message_short: "WordPress did not confirm post creation.",
      http_status: upstream.status,
      brand_name,
      execution_trace_id,
      started_at: sync_execution_started_at
    });

    return { status: 200, body: responsePayload };
  }

  const responsePayload = {
    ok: upstream.ok,
    status: upstream.status,
    provider_domain: resolvedProviderDomain,
    parent_action_key,
    endpoint_key,
    method: resolvedMethodPath.method,
    path: resolvedMethodPath.path,
    openai_schema_file_id: action.openai_schema_file_id,
    schema_name: schemaContract.name,
    resolved_auth_mode: authContract.mode,
    runtime_capability_class: action.runtime_capability_class || "",
    runtime_callable: effectiveRuntimeCallable,
    registry_runtime_callable: registryRuntimeCallable,
    primary_executor: action.primary_executor || "",
    endpoint_role: endpoint.endpoint_role || "",
    execution_mode: endpoint.execution_mode || "",
    transport_required: boolFromSheet(endpoint.transport_required),
    request_schema_alignment_status: "validated",
    response_schema_alignment_status: responseSchemaAlignmentStatus,
    transport_request_contract_status: "validated",
    resolved_provider_domain_mode: resolvedProviderDomainMode,
    placeholder_resolution_source: placeholderResolutionSource,
    resilience_applied: resilienceApplies,
    final_query: finalAttemptQuery,
    request_url: effectiveRequestUrl,
    graph_memory_context: safeGraphMemoryContext,
    response_headers: responseHeaders,
    data
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
    status_source: upstream.ok ? "succeeded" : "failed",
    responseBody: data,
    error_code: data?.error?.code,
    error_message_short: data?.error?.message,
    http_status: upstream.status,
    brand_name,
    execution_trace_id,
    started_at: sync_execution_started_at,
    // auth + classification evidence
    credential_resolution_status: authContract?.credential_resolution_status ?? "",
    runtime_capability_class: String(action?.runtime_capability_class || ""),
    primary_executor: String(action?.primary_executor || ""),
    endpoint_role: String(endpoint?.endpoint_role || ""),
    transport_action_key: String(endpoint?.transport_action_key || ""),
    schema_contract_validation_status: schemaContract ? "validated" : "not_declared",
    transport_request_contract_status: "validated"
  });

  return { status: upstream.ok ? 200 : upstream.status, body: responsePayload };
}
