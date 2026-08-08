import { resolveExecutionRequest } from "./executionResolution.js";
import { prepareExecutionRequest } from "./executionPreparation.js";
import { dispatchPreparedExecution } from "./executionDispatch.js";
import { validateAndShapeExecutionResponse } from "./executionResponse.js";
import { buildPassiveExecutionReport } from "./executionControlResolvers.js";
import { resolveExecutionGraphMemoryContext } from "./executionGraphMemoryContext.js";
import { resolveActionEndpointToolManifest } from "./actionEndpointToolManifestResolver.js";
import {
  GITHUB_ISSUE_COMMENT_READBACK_POLICY_KEY,
  enforceGithubIssueCommentMutationGate,
  isGithubIssueCommentMutationTarget,
} from "./platformEndpointToolFacade.js";
import {
  getExecutionJob,
  pollExecutionJobResult,
  submitGenericExecutionJob,
  submitSiteMigrationJob,
  tickExecutionJob
} from "./executionAsync.js";

function truthyFlag(value) {
  if (value === true) return true;
  return ["true", "1", "yes"].includes(String(value || "").trim().toLowerCase());
}

function isGithubIssueCommentLiveMutation(reqBody = {}) {
  return isGithubIssueCommentMutationTarget(reqBody)
    && !truthyFlag(reqBody.dry_run)
    && !truthyFlag(reqBody.preflight_only);
}

function responseCandidates(response) {
  return [
    response,
    response?.body,
    response?.data,
    response?.result,
    response?.body?.data,
    response?.body?.result,
    response?.data?.data,
    response?.data?.result,
  ].filter((value) => value !== undefined && value !== null);
}

function githubIssueCommentId(response) {
  for (const candidate of responseCandidates(response)) {
    if (Array.isArray(candidate) || typeof candidate !== "object") continue;
    const id = candidate.id ?? candidate.comment_id;
    if (id !== undefined && id !== null && String(id).trim()) return String(id).trim();
  }
  return "";
}

function githubIssueCommentRows(response) {
  for (const candidate of responseCandidates(response)) {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.comments)) return candidate.comments;
    if (Array.isArray(candidate?.items)) return candidate.items;
  }
  return [];
}

function readbackSinceIso(startedAt) {
  const timestamp = new Date(startedAt || Date.now()).getTime();
  return new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) - 5000).toISOString();
}

function buildGithubIssueCommentReadbackPayload(reqBody = {}, startedAt) {
  const payload = {
    ...reqBody,
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_list_issue_comments",
    path_params: { ...(reqBody.path_params || {}) },
    query: {
      since: readbackSinceIso(startedAt),
      per_page: 100,
    },
    readback: { required: false, policy_key: null },
  };
  for (const field of [
    "body",
    "dry_run",
    "preflight_only",
    "mutation_approval",
    "operator_approval",
    "operator_approved",
    "operator_approval_granted",
    "dry_run_preflight_completed",
    "approved_preflight_dry_run_validated",
    "live_execution_approved",
    "execute_live",
  ]) {
    delete payload[field];
  }
  return payload;
}

function githubIssueCommentReadbackError(code, message, details = {}) {
  const error = new Error(message);
  error.status = 502;
  error.code = code;
  error.details = {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_create_issue_comment",
    readback_policy_key: GITHUB_ISSUE_COMMENT_READBACK_POLICY_KEY,
    mutation_executed: true,
    automatic_retry_allowed: false,
    secrets_included: false,
    ...details,
  };
  return error;
}

async function attachGithubIssueCommentReadback({
  facade,
  reqBody,
  liveResponse,
  startedAt,
}) {
  const status = Number(liveResponse?.status || 0);
  if (!Number.isFinite(status) || status < 200 || status >= 300) return liveResponse;

  const commentId = githubIssueCommentId(liveResponse);
  if (!commentId) {
    throw githubIssueCommentReadbackError(
      "github_issue_comment_readback_identity_missing",
      "GitHub issue-comment mutation returned without a readable comment identity; exact same-cycle readback cannot be proven.",
      { provider_write_succeeded_or_unknown: true },
    );
  }

  const readbackResponse = await facade.execute(
    buildGithubIssueCommentReadbackPayload(reqBody, startedAt),
  );
  const readbackStatus = Number(readbackResponse?.status || 0);
  if (!Number.isFinite(readbackStatus) || readbackStatus < 200 || readbackStatus >= 300) {
    throw githubIssueCommentReadbackError(
      "github_issue_comment_readback_failed",
      "GitHub issue-comment mutation completed but same-cycle readback failed.",
      {
        comment_id: commentId,
        readback_http_status: readbackStatus || null,
        cause_code: readbackResponse?.body?.error?.code || null,
      },
    );
  }

  const comments = githubIssueCommentRows(readbackResponse);
  if (!comments.some((comment) => String(comment?.id ?? "").trim() === commentId)) {
    throw githubIssueCommentReadbackError(
      "github_issue_comment_readback_not_observed",
      "GitHub issue-comment mutation completed but the exact created comment was not observed during same-cycle readback.",
      {
        comment_id: commentId,
        observed_comment_count: comments.length,
      },
    );
  }

  return {
    ...liveResponse,
    governance_readback: {
      policy_key: GITHUB_ISSUE_COMMENT_READBACK_POLICY_KEY,
      status: "verified",
      comment_id: commentId,
      observed_comment_count: comments.length,
      automatic_retry_allowed: false,
      secrets_included: false,
    },
  };
}

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
    getGoogleClientsForSpreadsheet,
    fetchChunkedTable,
    headerMap,
    getCell,
    REGISTRY_SPREADSHEET_ID,
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
    executeSingleQueuedJob,
    failAsyncSubmission,
    toJobSummary,
    // job read
    resolveJob,
    normalizeJobStatus,
    TERMINAL_JOB_STATUSES,
    ACTIVE_JOB_STATUSES
  } = deps;

  const facade = {

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
        if (isGithubIssueCommentLiveMutation(reqBody)) {
          enforceGithubIssueCommentMutationGate(reqBody, reqBody);
        }

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
            appendQuery,
            getGoogleClientsForSpreadsheet,
            fetchChunkedTable,
            headerMap,
            getCell,
            REGISTRY_SPREADSHEET_ID,
            resolveActionEndpointToolManifest
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
          requestUrl,
          governedExecutionContext,
          pathResolverLoad
        } = preparation;

        const graphMemoryContext = await resolveExecutionGraphMemoryContext({
          requestPayload,
          action,
          endpoint,
          brand,
          resolvedMethodPath,
          providerDomain: resolvedProviderDomain,
          parentActionKey: parent_action_key,
          endpointKey: endpoint_key
        });

        const dryRunRequested = requestPayload.dry_run === true || String(requestPayload.dry_run || "").trim().toLowerCase() === "true";
        if (dryRunRequested) {
          const report = buildPassiveExecutionReport({
            requestPayload,
            action,
            endpoint,
            brand,
            resolvedMethodPath,
            resolvedProviderDomain,
            resolvedProviderDomainMode,
            placeholderResolutionSource,
            authContract,
            schemaContract,
            schemaSource,
            schemaContractFileId,
            schemaOperationInfo,
            governedExecutionContext,
            pathResolverLoad,
            finalQuery,
            baseUrl,
            requestUrl,
            principal: requestPayload._principal || null,
            graphMemoryContext
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
            entry_type: "sync_execution_dry_run",
            execution_class: "dry_run",
            attempt_count: 1,
            status_source: "succeeded",
            responseBody: report,
            error_code: undefined,
            error_message_short: undefined,
            http_status: 200,
            brand_name,
            execution_trace_id,
            started_at: sync_execution_started_at,
            credential_resolution_status: authContract?.credential_resolution_status ?? "",
            runtime_capability_class: String(action?.runtime_capability_class || ""),
            primary_executor: String(action?.primary_executor || ""),
            endpoint_role: String(endpoint?.endpoint_role || ""),
            transport_action_key: String(endpoint?.transport_action_key || ""),
            schema_contract_validation_status: schemaContract ? "validated" : "not_declared",
            transport_request_contract_status: "validated"
          });

          return { status: 200, body: report };
        }

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
            requestUrl,
            resolvedProviderDomain
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
        if (dispatchResult.shortCircuitResponse) {
          return dispatchResult.shortCircuitResponse;
        }

        const validatedResponse = await validateAndShapeExecutionResponse(
          dispatchResult,
          {
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
            graphMemoryContext
          },
          {
            policyValue,
            policyList,
            validateByJsonSchema,
            classifySchemaDrift,
            boolFromSheet,
            performUniversalServerWriteback
          }
        );

        if (isGithubIssueCommentLiveMutation(reqBody)) {
          return await attachGithubIssueCommentReadback({
            facade,
            reqBody,
            liveResponse: validatedResponse,
            startedAt: sync_execution_started_at,
          });
        }
        return validatedResponse;
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
        normalizeJobStatus,
        updateJob,
        nowIso
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
    },

    async tickJob(jobId) {
      return tickExecutionJob(jobId, {
        resolveJob,
        executeSingleQueuedJob,
        toJobSummary,
        normalizeJobStatus,
      });
    }
  };

  return facade;
}
