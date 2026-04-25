import { resolveExecutionRequest } from "./executionResolution.js";
import { prepareExecutionRequest } from "./executionPreparation.js";
import { dispatchPreparedExecution } from "./executionDispatch.js";

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
      const body = reqBody && typeof reqBody === "object" ? reqBody : {};
      const payload = normalizeSiteMigrationPayload(body);
      const validation = validateSiteMigrationPayload(payload);

      if (validation.errors.length) {
        return {
          status: 400,
          body: {
            ok: false,
            error: {
              code: "invalid_site_migration_request",
              message: "Invalid site migration payload.",
              details: { errors: validation.errors }
            }
          }
        };
      }

      const idempotencyLookupKey = makeIdempotencyLookupKey(requestedBy, idempotencyKey);

      if (idempotencyLookupKey && await idempotencyRepository.has(idempotencyLookupKey)) {
        const existingJobId = await idempotencyRepository.get(idempotencyLookupKey);
        const existingJob = getJob(existingJobId) || await getJobFromRedis(existingJobId);
        if (existingJob) {
          return { status: 200, body: { ...toJobSummary(existingJob), deduplicated: true } };
        }
        await idempotencyRepository.delete(idempotencyLookupKey);
      }

      const execution_trace_id =
        String(body.execution_trace_id || "").trim() || createExecutionTraceId();

      const job = createSiteMigrationJobRecord({
        payload: {
          ...payload,
          execution_trace_id
        },
        requestedBy,
        executionTraceId: execution_trace_id,
        maxAttempts: body.max_attempts,
        webhookUrl: body.webhook_url,
        callbackSecret: body.callback_secret,
        idempotencyKey
      });

      jobRepository.set(job);
      if (idempotencyLookupKey) {
        await idempotencyRepository.set(idempotencyLookupKey, job.job_id);
      }

      const enqueueResult = await enqueueJob(job.job_id);
      if (!enqueueResult?.ok) {
        const failure = await failAsyncSubmission(jobRepository, idempotencyRepository, job, enqueueResult?.error, idempotencyLookupKey);
        return { status: 503, body: failure };
      }

      return {
        status: 202,
        body: {
          ...toJobSummary(job),
          route: "/site-migrate",
          execution_class: "migration"
        }
      };
    },

    // ─── Generic async job submission ─────────────────────────────────────────

    async submitJob(reqBody, requestedBy, idempotencyKey) {
      const body = reqBody && typeof reqBody === "object" ? reqBody : {};
      const hasNestedRequestPayload =
        body.request_payload &&
        typeof body.request_payload === "object" &&
        !Array.isArray(body.request_payload);

      const topLevelExecutionFields = [
        "target_key",
        "brand",
        "brand_domain",
        "provider_domain",
        "parent_action_key",
        "endpoint_key",
        "method",
        "path",
        "path_params",
        "query",
        "headers",
        "body",
        "expect_json",
        "timeout_seconds",
        "readback",
        "force_refresh"
      ];

      const hasTopLevelExecutionFields = topLevelExecutionFields.some(
        key => body[key] !== undefined
      );

      if (hasNestedRequestPayload && hasTopLevelExecutionFields) {
        return {
          status: 400,
          body: {
            ok: false,
            error: {
              code: "invalid_job_request",
              message: "Job request is invalid.",
              details: {
                errors: [
                  "Provide either request_payload or top-level execution fields, not both."
                ]
              }
            }
          }
        };
      }

      const requestPayload = buildExecutionPayloadFromJobRequest(body);
      const requestedJobType = String(body.job_type || "http_execute").trim() || "http_execute";
      const validationErrors =
        requestedJobType === "site_migration"
          ? validateSiteMigrationPayload(normalizeSiteMigrationPayload(requestPayload)).errors
          : validateAsyncJobRequest(requestPayload);

      if (body.max_attempts !== undefined) {
        const maxAttempts = Number(body.max_attempts);
        if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
          validationErrors.push("max_attempts must be an integer between 1 and 10 when provided.");
        }
      }

      if (body.webhook_url !== undefined) {
        const normalizedWebhookUrl = normalizeWebhookUrl(body.webhook_url);
        if (String(body.webhook_url || "").trim() && !normalizedWebhookUrl) {
          validationErrors.push("webhook_url must be a valid http or https URL when provided.");
        }
      }

      if (body.callback_secret !== undefined && typeof body.callback_secret !== "string") {
        validationErrors.push("callback_secret must be a string when provided.");
      }

      if (body.idempotency_key !== undefined && typeof body.idempotency_key !== "string") {
        validationErrors.push("idempotency_key must be a string when provided.");
      }

      if (body.job_type !== undefined && typeof body.job_type !== "string") {
        validationErrors.push("job_type must be a string when provided.");
      }

      if (validationErrors.length) {
        return {
          status: 400,
          body: {
            ok: false,
            error: {
              code: "invalid_job_request",
              message: "Job request is invalid.",
              details: { errors: validationErrors }
            }
          }
        };
      }

      const idempotencyLookupKey = makeIdempotencyLookupKey(requestedBy, idempotencyKey);

      if (idempotencyLookupKey && await idempotencyRepository.has(idempotencyLookupKey)) {
        const existingJobId = await idempotencyRepository.get(idempotencyLookupKey);
        const existingJob = getJob(existingJobId) || await getJobFromRedis(existingJobId);
        if (existingJob) {
          return { status: 200, body: { ...toJobSummary(existingJob), deduplicated: true } };
        }
        await idempotencyRepository.delete(idempotencyLookupKey);
      }

      const createdAt = nowIso();
      const inboundExecutionTraceId = String(
        requestPayload.execution_trace_id || body.execution_trace_id || ""
      ).trim();
      const execution_trace_id = inboundExecutionTraceId || createExecutionTraceId();
      requestPayload.execution_trace_id = execution_trace_id;
      const normalizedJobType = String(body.job_type || "http_execute").trim() || "http_execute";
      const normalizedSiteMigrationPayload =
        normalizedJobType === "site_migration"
          ? normalizeSiteMigrationPayload(requestPayload)
          : null;

      const job = {
        job_id: buildJobId(),
        job_type: normalizedJobType,
        status: "queued",
        created_at: createdAt,
        updated_at: createdAt,
        completed_at: "",
        requested_by: requestedBy,
        target_key:
          normalizedJobType === "site_migration"
            ? String(
                normalizedSiteMigrationPayload?.destination?.target_key ||
                  normalizedSiteMigrationPayload?.source?.target_key ||
                  ""
              ).trim()
            : String(requestPayload.target_key || "").trim(),
        parent_action_key:
          normalizedJobType === "site_migration"
            ? "site_migration_controller"
            : String(requestPayload.parent_action_key || "").trim(),
        endpoint_key:
          normalizedJobType === "site_migration"
            ? "site_migrate"
            : String(requestPayload.endpoint_key || "").trim(),
        route_id:
          normalizedJobType === "site_migration"
            ? "site_migration"
            : String(requestPayload.route_id || "").trim(),
        target_module:
          normalizedJobType === "site_migration"
            ? "wordpress_site_migration"
            : String(requestPayload.target_module || "").trim(),
        target_workflow:
          normalizedJobType === "site_migration"
            ? "wf_wordpress_site_migration"
            : String(requestPayload.target_workflow || "").trim(),
        brand_name:
          normalizedJobType === "site_migration"
            ? String(
                normalizedSiteMigrationPayload?.destination?.brand ||
                  normalizedSiteMigrationPayload?.source?.brand ||
                  ""
              ).trim()
            : String(requestPayload.brand_name || requestPayload.brand || "").trim(),
        execution_trace_id,
        request_payload: normalizedJobType === "site_migration" ? normalizedSiteMigrationPayload : requestPayload,
        attempt_count: 0,
        max_attempts: normalizeMaxAttempts(body.max_attempts),
        result_payload: null,
        error_payload: null,
        next_retry_at: "",
        webhook_url: normalizeWebhookUrl(body.webhook_url),
        callback_secret: String(body.callback_secret || "").trim(),
        idempotency_key: idempotencyKey
      };

      jobRepository.set(job);
      if (idempotencyLookupKey) {
        await idempotencyRepository.set(idempotencyLookupKey, job.job_id);
      }

      debugLog("JOB_CREATED:", {
        job_id: job.job_id,
        requested_by: job.requested_by,
        parent_action_key: job.parent_action_key,
        endpoint_key: job.endpoint_key
      });

      const enqueueResult = await enqueueJob(job.job_id);
      if (!enqueueResult?.ok) {
        const failure = await failAsyncSubmission(jobRepository, idempotencyRepository, job, enqueueResult?.error, idempotencyLookupKey);
        return { status: 503, body: failure };
      }

      return { status: 202, body: toJobSummary(job) };
    },

    // ─── Job status lookup ────────────────────────────────────────────────────

    async getJob(jobId) {
      const job = await resolveJob(jobId);
      if (!job) {
        return {
          status: 404,
          body: {
            ok: false,
            error: {
              code: "job_not_found",
              message: "Job not found."
            }
          }
        };
      }

      const summary = toJobSummary(job);
      return {
        status: 200,
        body: {
          ...summary,
          terminal: TERMINAL_JOB_STATUSES.has(normalizeJobStatus(job.status)),
          active: ACTIVE_JOB_STATUSES.has(normalizeJobStatus(job.status))
        }
      };
    },

    // ─── Job result polling ───────────────────────────────────────────────────

    async pollJobResult(jobId) {
      try {
        const job = await resolveJob(jobId);
        if (!job) {
          return {
            status: 404,
            body: {
              ok: false,
              error: {
                code: "job_not_found",
                message: "Job not found."
              }
            }
          };
        }

        const poll_started_at = nowIso();
        const execution_trace_id =
          String(job.execution_trace_id || "").trim() || createExecutionTraceId();
        if (job.execution_trace_id !== execution_trace_id) {
          updateJob(job, { execution_trace_id });
        }

        const status = normalizeJobStatus(job.status);
        if (status === "succeeded") {
          const responsePayload = {
            job_id: job.job_id,
            status: job.status,
            result: job.result_payload || null
          };

          await performUniversalServerWriteback({
            mode: "poll",
            job_id: job.job_id,
            target_key: job.target_key,
            parent_action_key: job.parent_action_key,
            endpoint_key: job.endpoint_key,
            route_id: job.route_id,
            target_module: job.target_module,
            target_workflow: job.target_workflow,
            source_layer: "http_client_backend",
            entry_type: "poll_read",
            execution_class: "poll",
            attempt_count: job.attempt_count,
            status_source: status,
            responseBody: job.result_payload,
            error_code: job.result_payload?.error?.code,
            error_message_short: job.result_payload?.error?.message,
            http_status: 200,
            brand_name: job.brand_name,
            execution_trace_id,
            started_at: poll_started_at
          });

          return { status: 200, body: responsePayload };
        }

        if (status === "failed" || status === "cancelled") {
          const responsePayload = {
            job_id: job.job_id,
            status: job.status,
            error: job.error_payload || null
          };

          await performUniversalServerWriteback({
            mode: "poll",
            job_id: job.job_id,
            target_key: job.target_key,
            parent_action_key: job.parent_action_key,
            endpoint_key: job.endpoint_key,
            route_id: job.route_id,
            target_module: job.target_module,
            target_workflow: job.target_workflow,
            source_layer: "http_client_backend",
            entry_type: "poll_read",
            execution_class: "poll",
            attempt_count: job.attempt_count,
            status_source: status,
            responseBody: job.error_payload,
            error_code: job.error_payload?.error?.code,
            error_message_short: job.error_payload?.error?.message,
            http_status: 200,
            brand_name: job.brand_name,
            execution_trace_id,
            started_at: poll_started_at
          });

          return { status: 200, body: responsePayload };
        }

        const pendingPayload = {
          job_id: job.job_id,
          status: job.status,
          message: "Job is not complete yet.",
          status_url: `/jobs/${job.job_id}`
        };

        await performUniversalServerWriteback({
          mode: "poll",
          job_id: job.job_id,
          target_key: job.target_key,
          parent_action_key: job.parent_action_key,
          endpoint_key: job.endpoint_key,
          route_id: job.route_id,
          target_module: job.target_module,
          target_workflow: job.target_workflow,
          source_layer: "http_client_backend",
          entry_type: "poll_read",
          execution_class: "poll",
          attempt_count: job.attempt_count,
          status_source: status,
          responseBody: pendingPayload,
          error_code: "",
          error_message_short: "",
          http_status: 202,
          brand_name: job.brand_name,
          execution_trace_id,
          started_at: poll_started_at
        });

        return { status: 202, body: pendingPayload };
      } catch (err) {
        return {
          status: 500,
          body: {
            ok: false,
            error: {
              code: "poll_read_failed",
              message: err?.message || "Poll read failed."
            }
          }
        };
      }
    }
  };
}
