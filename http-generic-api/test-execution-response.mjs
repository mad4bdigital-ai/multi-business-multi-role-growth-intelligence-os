import { validateAndShapeExecutionResponse } from "./executionResponse.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed++;
  } else {
    console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function boolFromSheet(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function makeContext({ method = "GET", schemaOperationInfo = { operation: {} } } = {}) {
  return {
    requestPayload: { target_key: "brand_1" },
    action: {
      runtime_callable: "FALSE",
      primary_executor: "http_client_backend",
      runtime_capability_class: "http",
      openai_schema_file_id: "action_schema:github_api_mcp"
    },
    endpoint: {
      execution_mode: "http_delegated",
      transport_required: "TRUE",
      transport_action_key: "http_generic_api"
    },
    parent_action_key: "example_api",
    endpoint_key: "example_endpoint",
    authContract: { mode: "none" },
    schemaContract: { name: "Example Schema" },
    schemaOperationInfo,
    route_id: "route_1",
    target_module: "module_1",
    target_workflow: "workflow_1",
    brand_name: "Example Brand",
    resolvedProviderDomain: "example.test",
    resolvedProviderDomainMode: "static",
    placeholderResolutionSource: "none",
    execution_trace_id: "trace_1",
    sync_execution_started_at: "2026-04-26T00:00:00.000Z",
    resolvedMethodPath: { method, path: "/resource" },
    policies: [],
    graphMemoryContext: {
      requested: true,
      resolved: true,
      source: "platform_graph_memory",
      usage: "execution_context_advisory",
      applied_to_transport: false,
      asset_count: 1,
      assets: [{ asset_key: "example_execution_doctrine", payload_summary: { rule_count: 2 } }],
      selection_policy: { included_payload: "summary_only", raw_secret_values_included: false },
      secrets_included: false
    }
  };
}

function makeDeps({ enforceResponseSchema = false, responseErrors = [], writebacks = [] } = {}) {
  return {
    boolFromSheet,
    policyValue(_policies, group, key, fallback) {
      if (
        enforceResponseSchema &&
        group === "HTTP Response Schema Enforcement" &&
        key === "Response Schema Enforcement Enabled"
      ) return "TRUE";
      return fallback;
    },
    policyList() {
      return [];
    },
    validateByJsonSchema() {
      return responseErrors;
    },
    classifySchemaDrift() {
      return {
        schema_drift_detected: true,
        schema_drift_type: "structure_mismatch",
        schema_drift_scope: "response"
      };
    },
    async performUniversalServerWriteback(entry) {
      writebacks.push(entry);
    }
  };
}

const result = await validateAndShapeExecutionResponse(
  {
    upstream: { ok: true, status: 200 },
    data: { ok: true },
    responseHeaders: {},
    contentType: "application/json",
    effectiveRequestUrl: "https://example.test/resource",
    finalAttemptQuery: {},
    resilienceApplies: false
  },
  makeContext(),
  makeDeps()
);

assert("response returns success", result.status === 200, JSON.stringify(result));
assert("runtime_callable uses effective eligibility", result.body.runtime_callable === true, JSON.stringify(result.body));
assert("registry_runtime_callable preserves raw registry value", result.body.registry_runtime_callable === false, JSON.stringify(result.body));
assert("execution response includes safe graph memory context", result.body.graph_memory_context?.resolved === true && result.body.graph_memory_context?.asset_count === 1, JSON.stringify(result.body));
assert("execution graph memory context does not expose secrets", result.body.graph_memory_context?.secrets_included === false && result.body.graph_memory_context?.selection_policy?.raw_secret_values_included === false, JSON.stringify(result.body));

const missingSchemaMutationWritebacks = [];
const missingSchemaMutation = await validateAndShapeExecutionResponse(
  {
    upstream: { ok: true, status: 201 },
    data: { id: 5220865297, body: "persisted" },
    responseHeaders: {},
    contentType: "application/json",
    effectiveRequestUrl: "https://api.github.com/repos/o/r/issues/4451/comments",
    finalAttemptQuery: {},
    resilienceApplies: false
  },
  makeContext({ method: "POST", schemaOperationInfo: { operation: { responses: {} } } }),
  makeDeps({ enforceResponseSchema: true, writebacks: missingSchemaMutationWritebacks })
);

assert(
  "successful mutation with missing response schema becomes reconciliation-required",
  missingSchemaMutation.status === 409 && missingSchemaMutation.body?.error?.code === "UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED",
  JSON.stringify(missingSchemaMutation)
);
assert(
  "post-mutation schema drift explicitly blocks retry",
  missingSchemaMutation.body?.error?.details?.outcome_classification === "unknown_outcome" &&
    missingSchemaMutation.body?.error?.details?.reconciliation_required === true &&
    missingSchemaMutation.body?.error?.details?.retry_allowed === false &&
    missingSchemaMutation.body?.error?.details?.automatic_retry_performed === false,
  JSON.stringify(missingSchemaMutation.body)
);
assert(
  "post-mutation missing schema preserves upstream success and original drift code",
  missingSchemaMutation.body?.error?.details?.upstream_success_confirmed === true &&
    missingSchemaMutation.body?.error?.details?.upstream_status === 201 &&
    missingSchemaMutation.body?.error?.details?.original_schema_error_code === "response_schema_missing" &&
    missingSchemaMutation.body?.error?.details?.schema_drift_detected === true,
  JSON.stringify(missingSchemaMutation.body)
);
assert(
  "post-mutation audit records unknown outcome instead of failed 422",
  missingSchemaMutationWritebacks.length === 1 &&
    missingSchemaMutationWritebacks[0]?.status_source === "unknown_outcome" &&
    missingSchemaMutationWritebacks[0]?.error_code === "UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED" &&
    missingSchemaMutationWritebacks[0]?.http_status === 201,
  JSON.stringify(missingSchemaMutationWritebacks)
);

const mismatchMutationWritebacks = [];
const mismatchMutation = await validateAndShapeExecutionResponse(
  {
    upstream: { ok: true, status: 201 },
    data: { unexpected: true },
    responseHeaders: {},
    contentType: "application/json",
    effectiveRequestUrl: "https://api.github.com/repos/o/r/issues/4451/comments",
    finalAttemptQuery: {},
    resilienceApplies: false
  },
  makeContext({
    method: "POST",
    schemaOperationInfo: {
      operation: {
        responses: {
          "201": {
            content: {
              "application/json": {
                schema: { type: "object", required: ["id"] }
              }
            }
          }
        }
      }
    }
  }),
  makeDeps({
    enforceResponseSchema: true,
    responseErrors: [{ path: "$.id", message: "is required" }],
    writebacks: mismatchMutationWritebacks
  })
);

assert(
  "successful mutation with response schema mismatch also requires reconciliation",
  mismatchMutation.status === 409 &&
    mismatchMutation.body?.error?.code === "UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED" &&
    mismatchMutation.body?.error?.details?.original_schema_error_code === "response_schema_mismatch" &&
    mismatchMutation.body?.error?.details?.errors?.length === 1 &&
    mismatchMutationWritebacks[0]?.status_source === "unknown_outcome",
  JSON.stringify({ mismatchMutation, mismatchMutationWritebacks })
);

const safeReadWritebacks = [];
const safeReadMissingSchema = await validateAndShapeExecutionResponse(
  {
    upstream: { ok: true, status: 200 },
    data: { ok: true },
    responseHeaders: {},
    contentType: "application/json",
    effectiveRequestUrl: "https://example.test/resource",
    finalAttemptQuery: {},
    resilienceApplies: false
  },
  makeContext({ method: "GET", schemaOperationInfo: { operation: { responses: {} } } }),
  makeDeps({ enforceResponseSchema: true, writebacks: safeReadWritebacks })
);

assert(
  "safe read keeps strict schema-missing validation failure",
  safeReadMissingSchema.status === 422 &&
    safeReadMissingSchema.body?.error?.code === "response_schema_missing" &&
    safeReadWritebacks[0]?.status_source === "failed" &&
    safeReadWritebacks[0]?.http_status === 422,
  JSON.stringify({ safeReadMissingSchema, safeReadWritebacks })
);

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
