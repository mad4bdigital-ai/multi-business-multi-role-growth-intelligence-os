import { resolveExecutionRequest } from "./executionResolution.js";
import { prepareExecutionRequest } from "./executionPreparation.js";
import { dispatchPreparedExecution } from "./executionDispatch.js";
import {
  getExecutionJob,
  pollExecutionJobResult,
  submitGenericExecutionJob,
  submitSiteMigrationJob
} from "./executionAsync.js";

export function createExecutionFacade(deps) {
  const {
    // shared
    requireEnv,
    nowIso,
    createExecutionTraceId,
    debugLog,
    performUniversalServerWriteback,
    // payload normalization
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
    // registry
    getRegistry,
    reloadRegistry,
    // policy
    getRequiredHttpExecutionPolicyKeys,
    requirePolicySet,
    policyValue,
    policyList,
    // execution context resolution
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
    // dispatch
    dispatchEndpointKeyExecution,
    inferLocalDispatchHttpStatus,
    executeSameServiceNativeEndpoint,
    // provider / auth
    resolveProviderDomain,
    normalizeAuthContract,
    resolveAccountKey,
    isGoogleApiHost,
    enforceSupportedAuthMode,
    mintGoogleAccessTokenForEndpoint,
    ensureWritePermissions,
    // schema
    fetchSchemaContract,
    resolveSchemaOperation,
    injectAuthForSchemaValidation,
    getAdditionalStaticAuthHeaders,
    validateParameters,
    validateRequestBody,
    logValidationRunWriteback,
    // auth / headers
    injectAuthIntoHeaders,
    sanitizeCallerHeaders,
    jsonParseSafe,
    buildUrl,
    appendQuery,
    // resilience
    resilienceAppliesToParentAction,
    retryMutationEnabled,
    buildProviderRetryMutations,
    shouldRetryProviderResponse,
    // transport
    executeUpstreamAttempt,
    finalizeTransportBody,
    // response validation
    classifySchemaDrift,
    validateByJsonSchema,
    // constants
    MAX_TIMEOUT_SECONDS,
    // job submission
    normalizeSiteMigrationPayload,
    validateSiteMigrationPayload,
    createSiteMigrationJobRecord,
    buildExecutionPayloadFromJobRequest,
    validateAsyncJobRequest,
    normalizeWebhookUrl,
    buildJobId,
    normalizeMaxAttempts,
    makeIdempotencyLookupKey,
    idempotencyRepository,
    getJobFromRedis,
    getJob,
    updateJob,
    jobRepository,
    enqueueJob,
    failAsyncSubmission,
    toJobSummary,
    // job read
    resolveJob,
    normalizeJobStatus,
    TERMINAL_JOB_STATUSES,
    ACTIVE_JOB_STATUSES
  } = deps;

  return {

    // ─── Sync HTTP execution ──────────────────────────────────────────────────

    async execute(reqBody) {
      let requestPayload = null;
      let action = null;
      let endpoint = null;
      let brand = null;
      let sameServiceNativeTarget = false;
      let resolvedMethodPath = null;
      const sync_execution_started_at = nowIso();
      let execution_trace_id =
        String(reqBody?.execution_trace_id || "").trim() || createExecutionTraceId();

      try {
        const resolution = await resolveExecutionRequest(reqBody, {
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
        });

        execution_trace_id = resolution.execution_trace_id || execution_trace_id;
        requestPayload = resolution.requestPayload || requestPayload;
        if (!resolution.ok) {
          return resolution.response;
        }

        const {
          provider_domain,
          parent_action_key,
          endpoint_key,
          drive,
          hostingAccounts,
          policies,
          callerHeaders,
          query,
          body,
          pathParams
        } = resolution;

        ({
          action,
          endpoint,
          brand,
          sameServiceNativeTarget,
          resolvedMethodPath
        } = resolution);

        const dispatchedEndpointResult = await dispatchEndpointKeyExecution({
          endpoint_key,
          requestPayload
        });

        if (dispatchedEndpointResult) {
          const localDispatchStatusCode =
            inferLocalDispatchHttpStatus(dispatchedEndpointResult);

          await performUniversalServerWriteback({
            mode: "sync",
            job_id: undefined,
            target_key: requestPayload.target_key,
            parent_action_key: parent_action_key,
            endpoint_key: endpoint_key,
            route_id: String(endpoint?.endpoint_id || "").trim(),
            target_module: String(endpoint?.module_binding || "").trim(),
            target_workflow: String(action?.action_key || "").trim(),
            source_layer: "http_client_backend",
            entry_type: "sync_execution",
            execution_class: "sync",
            attempt_count: 1,
            status_source: dispatchedEndpointResult.ok ? "succeeded" : "failed",
            responseBody: dispatchedEndpointResult,
            error_code: dispatchedEndpointResult?.error?.code || "",
            error_message_short: dispatchedEndpointResult?.error?.message || "",
            http_status: localDispatchStatusCode,
            brand_name: String(brand?.brand_name || requestPayload.brand || "").trim(),
            execution_trace_id,
            started_at: sync_execution_started_at
          });

          return { status: localDispatchStatusCode, body: dispatchedEndpointResult };
        }

        if (sameServiceNativeTarget) {
          const nativeOutcome = await executeSameServiceNativeEndpoint({
            method: resolvedMethodPath.method,
            path: resolvedMethodPath.path,
            body: requestPayload.body,
            timeoutSeconds: requestPayload.timeout_seconds,
            expectJson: requestPayload.expect_json
          });

          return { status: nativeOutcome.statusCode, body: nativeOutcome.payload };
        }

        const preparation = await prepareExecutionRequest(
          {
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
          },
          {
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
          }
        );
        if (!preparation.ok) {
          return preparation.response;
        }

        const {
          resolvedProviderDomain,
          resolvedProviderDomainMode,
          placeholderResolutionSource,
          authContract,
          schemaContract,
          schemaOperationInfo,
          route_id,
          target_module,
          target_workflow,
          brand_name,
          finalQuery,
          finalHeaders,
          baseUrl,
          requestUrl
        } = preparation;

        const dispatchResult = await dispatchPreparedExecution(
          {
            requestPayload,
            policies,
            parent_action_key,
            action,
            resolvedMethodPath,
            body,
            finalQuery,
            finalHeaders,
            baseUrl,
            requestUrl
          },
          {
            debugLog,
            policyValue,
            appendQuery,
            resilienceAppliesToParentAction,
            retryMutationEnabled,
            buildProviderRetryMutations,
            finalizeTransportBody,
            executeUpstreamAttempt,
            shouldRetryProviderResponse,
            MAX_TIMEOUT_SECONDS
          }
        );

        const {
          upstream,
          data,
          responseHeaders,
          contentType,
          responseText,
          effectiveRequestUrl,
          finalAttemptQuery,
          resilienceApplies
        } = dispatchResult;

        let responseSchemaAlignmentStatus = "not_declared";

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

        const responseContent =
          schemaOperationInfo.operation?.responses?.[String(upstream.status)]?.content ||
          schemaOperationInfo.operation?.responses?.default?.content ||
          {};

        const responseJsonSchema =
          responseContent["application/json"]?.schema ||
          responseContent["application/problem+json"]?.schema ||
          null;

        const contentTypeEligible = enforcedContentTypes.length
          ? enforcedContentTypes.some(ct => currentContentType.includes(ct))
          : currentContentType.includes("application/json");

        if (responseSchemaEnforcementEnabled && contentTypeEligible) {
          if (!responseJsonSchema) {
            responseSchemaAlignmentStatus = "degraded";

            const responsePayload = {
              ok: false,
              error: {
                code: "response_schema_missing",
                message: "Response schema could not be resolved for schema-bound endpoint.",
                details: {
                  schema_drift_detected: true,
                  schema_drift_type: "structure_mismatch",
                  schema_drift_scope: "response",
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

        const compactWordPressCreate = parent_action_key === "wordpress_api" && endpoint_key === "wordpress_create_post";
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
              runtime_callable: boolFromSheet(action.runtime_callable),
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
            runtime_callable: boolFromSheet(action.runtime_callable),
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
          runtime_callable: boolFromSheet(action.runtime_callable),
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
          started_at: sync_execution_started_at
        });

        return { status: upstream.ok ? 200 : upstream.status, body: responsePayload };
      } catch (err) {
        const errorPayload = {
          code: err?.code || "internal_error",
          message: err?.message || "Unexpected error.",
          status: err?.status || 500,
          details: err?.details || null
        };

        console.error(
          "HTTP_EXECUTE_ERROR:",
          JSON.stringify({
            error: errorPayload,
            request: {
              provider_domain: requestPayload?.provider_domain || reqBody?.provider_domain || "",
              parent_action_key: requestPayload?.parent_action_key || reqBody?.parent_action_key || "",
              endpoint_key: requestPayload?.endpoint_key || reqBody?.endpoint_key || "",
              method: requestPayload?.method || reqBody?.method || "",
              path: requestPayload?.path || reqBody?.path || ""
            },
            action: action
              ? {
                  action_key: action.action_key,
                  runtime_capability_class: action.runtime_capability_class,
                  runtime_callable: action.runtime_callable,
                  primary_executor: action.primary_executor
                }
              : null,
            endpoint: endpoint ? getEndpointExecutionSnapshot(endpoint) : null,
            brand: brand
              ? {
                  brand_name: brand.brand_name,
                  target_key: brand.target_key,
                  base_url: brand.base_url
                }
              : null
          })
        );

        try {
          await performUniversalServerWriteback({
            mode: "sync",
            job_id: undefined,
            target_key: requestPayload?.target_key || "",
            parent_action_key:
              requestPayload?.parent_action_key || reqBody?.parent_action_key || "",
            endpoint_key: requestPayload?.endpoint_key || reqBody?.endpoint_key || "",
            route_id: String(endpoint?.endpoint_id || "").trim(),
            target_module: String(endpoint?.module_binding || "").trim(),
            target_workflow: String(action?.action_key || "").trim(),
            source_layer: "http_client_backend",
            entry_type: "sync_execution",
            execution_class: "sync",
            attempt_count: 1,
            status_source: "failed",
            responseBody: errorPayload,
            error_code: errorPayload.code,
            error_message_short: errorPayload.message,
            http_status: errorPayload.status,
            brand_name: String(brand?.brand_name || requestPayload?.brand || reqBody?.brand || "").trim(),
            execution_trace_id,
            started_at: sync_execution_started_at
          });
        } catch (writebackErr) {
          console.error("SYNC_WRITEBACK_FAILED:", writebackErr);
        }

        return { status: errorPayload.status, body: { ok: false, error: errorPayload } };
      }
    },

    // ─── Site-migration job submission ────────────────────────────────────────

    async submitSiteMigration(reqBody, requestedBy, idempotencyKey) {
      return submitSiteMigrationJob(reqBody, requestedBy, idempotencyKey, {
        normalizeSiteMigrationPayload,
        validateSiteMigrationPayload,
        makeIdempotencyLookupKey,
        idempotencyRepository,
        getJob,
        getJobFromRedis,
        toJobSummary,
        createExecutionTraceId,
        createSiteMigrationJobRecord,
        jobRepository,
        enqueueJob,
        failAsyncSubmission
      });
    },

    // ─── Generic async job submission ─────────────────────────────────────────

    async submitJob(reqBody, requestedBy, idempotencyKey) {
      return submitGenericExecutionJob(reqBody, requestedBy, idempotencyKey, {
        normalizeSiteMigrationPayload,
        validateSiteMigrationPayload,
        buildExecutionPayloadFromJobRequest,
        validateAsyncJobRequest,
        normalizeWebhookUrl,
        makeIdempotencyLookupKey,
        idempotencyRepository,
        getJob,
        getJobFromRedis,
        toJobSummary,
        nowIso,
        createExecutionTraceId,
        buildJobId,
        normalizeMaxAttempts,
        jobRepository,
        debugLog,
        enqueueJob,
        failAsyncSubmission
      });
    },

    // ─── Job status lookup ────────────────────────────────────────────────────

    async getJob(jobId) {
      return getExecutionJob(jobId, {
        resolveJob,
        toJobSummary,
        TERMINAL_JOB_STATUSES,
        ACTIVE_JOB_STATUSES,
        normalizeJobStatus
      });
    },

    // ─── Job result polling ───────────────────────────────────────────────────

    async pollJobResult(jobId) {
      return pollExecutionJobResult(jobId, {
        resolveJob,
        nowIso,
        createExecutionTraceId,
        updateJob,
        normalizeJobStatus,
        performUniversalServerWriteback
      });
    }
  };
}
