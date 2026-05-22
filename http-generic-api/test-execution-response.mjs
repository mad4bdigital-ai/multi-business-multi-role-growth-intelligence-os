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
  {
    requestPayload: { target_key: "brand_1" },
    action: {
      runtime_callable: "FALSE",
      primary_executor: "http_client_backend",
      runtime_capability_class: "http"
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
    schemaOperationInfo: { operation: {} },
    route_id: "route_1",
    target_module: "module_1",
    target_workflow: "workflow_1",
    brand_name: "Example Brand",
    resolvedProviderDomain: "example.test",
    resolvedProviderDomainMode: "static",
    placeholderResolutionSource: "none",
    execution_trace_id: "trace_1",
    sync_execution_started_at: "2026-04-26T00:00:00.000Z",
    resolvedMethodPath: { method: "GET", path: "/resource" },
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
  },
  {
    boolFromSheet,
    policyValue(_policies, _group, _key, fallback) {
      return fallback;
    },
    policyList() {
      return [];
    },
    validateByJsonSchema() {
      return [];
    },
    classifySchemaDrift() {
      return null;
    },
    async performUniversalServerWriteback() {}
  }
);

assert("response returns success", result.status === 200, JSON.stringify(result));
assert("runtime_callable uses effective eligibility", result.body.runtime_callable === true, JSON.stringify(result.body));
assert("registry_runtime_callable preserves raw registry value", result.body.registry_runtime_callable === false, JSON.stringify(result.body));
assert("execution response includes safe graph memory context", result.body.graph_memory_context?.resolved === true && result.body.graph_memory_context?.asset_count === 1, JSON.stringify(result.body));
assert("execution graph memory context does not expose secrets", result.body.graph_memory_context?.secrets_included === false && result.body.graph_memory_context?.selection_policy?.raw_secret_values_included === false, JSON.stringify(result.body));

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
