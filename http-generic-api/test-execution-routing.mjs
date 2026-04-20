/**
 * Execution routing tests for executionRouting.js
 * Run: node test-execution-routing.mjs
 */

import { resolveHttpExecutionContext } from "./executionRouting.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

function createDeps(overrides = {}) {
  const calls = [];
  const action = {
    action_key: "wordpress_api",
    runtime_capability_class: "direct_runtime",
    runtime_callable: "TRUE",
    primary_executor: "http_generic_api"
  };
  const endpoint = {
    endpoint_key: "wordpress_list_posts",
    execution_mode: "http_delegated",
    transport_action_key: "http_generic_api",
    transport_required: "TRUE",
    provider_domain: "https://example.com"
  };
  const brand = {
    brand_name: "Test Brand",
    target_key: "brand_1"
  };

  return {
    calls,
    deps: {
      debugLog() {},
      boolFromSheet(value) {
        return String(value || "").trim().toUpperCase() === "TRUE";
      },
      policyValue(_policies, _group, key, fallback = "") {
        if (key === "Allowed Transport") return "http_generic_api";
        return fallback;
      },
      resolveAction() {
        calls.push("resolveAction");
        return action;
      },
      resolveEndpoint() {
        calls.push("resolveEndpoint");
        return { ...endpoint };
      },
      getEndpointExecutionSnapshot(value) {
        return value;
      },
      resolveBrand() {
        calls.push("resolveBrand");
        return brand;
      },
      requireRuntimeCallableAction() {
        calls.push("requireRuntimeCallableAction");
      },
      requireEndpointExecutionEligibility() {
        calls.push("requireEndpointExecutionEligibility");
        return { ok: true, status: "ready" };
      },
      requireExecutionModeCompatibility() {
        calls.push("requireExecutionModeCompatibility");
      },
      requireNativeFamilyBoundary() {
        calls.push("requireNativeFamilyBoundary");
      },
      requireTransportIfDelegated() {
        calls.push("requireTransportIfDelegated");
      },
      requireNoFallbackDirectExecution() {
        calls.push("requireNoFallbackDirectExecution");
      },
      isDelegatedTransportTarget(value) {
        return String(value.execution_mode || "").trim().toLowerCase() === "http_delegated";
      },
      ensureMethodAndPathMatchEndpoint() {
        calls.push("ensureMethodAndPathMatchEndpoint");
        return { method: "GET", path: "/wp/v2/posts", templatePath: "/wp/v2/posts" };
      },
      ...overrides
    }
  };
}

section("resolveHttpExecutionContext");

{
  const { deps, calls } = createDeps();
  const result = resolveHttpExecutionContext(
    {
      requestPayload: {
        method: "GET",
        path: "/wp/v2/posts",
        path_params: {}
      },
      parent_action_key: "wordpress_api",
      endpoint_key: "wordpress_list_posts",
      actionRows: [{}],
      endpointRows: [{}],
      brandRows: [{}],
      policies: []
    },
    deps
  );

  assert("returns resolved action", result.action.action_key === "wordpress_api", JSON.stringify(result));
  assert("returns resolved endpoint", result.endpoint.endpoint_key === "wordpress_list_posts", JSON.stringify(result));
  assert("returns resolved brand", result.brand.brand_name === "Test Brand", JSON.stringify(result));
  assert("returns resolved method/path", result.resolvedMethodPath.path === "/wp/v2/posts", JSON.stringify(result));
  assert("marks delegated transport target", result.delegatedTransportTarget === true, JSON.stringify(result));
  assert("marks non-native delegated endpoint as not same-service-native", result.sameServiceNativeTarget === false, JSON.stringify(result));
  assert(
    "calls guard chain before returning",
    calls.includes("requireRuntimeCallableAction") &&
      calls.includes("requireEndpointExecutionEligibility") &&
      calls.includes("ensureMethodAndPathMatchEndpoint"),
    calls.join(", ")
  );
}

{
  const { deps } = createDeps({
    resolveEndpoint() {
      return {
        endpoint_key: "wordpress_list_posts",
        execution_mode: "http_delegated",
        transport_action_key: "some_other_transport",
        transport_required: "TRUE",
        provider_domain: "https://example.com"
      };
    }
  });

  let error = null;
  try {
    resolveHttpExecutionContext(
      {
        requestPayload: { method: "GET", path: "/wp/v2/posts" },
        parent_action_key: "wordpress_api",
        endpoint_key: "wordpress_list_posts",
        policies: []
      },
      deps
    );
  } catch (err) {
    error = err;
  }

  assert("rejects unsupported transport bindings", error?.code === "unsupported_transport", JSON.stringify(error));
}

{
  const { deps } = createDeps({
    resolveEndpoint() {
      return {
        endpoint_key: "native_internal_status",
        execution_mode: "native_controller",
        transport_action_key: "some_other_transport",
        transport_required: "TRUE",
        provider_domain: "same_service_native"
      };
    },
    ensureMethodAndPathMatchEndpoint() {
      return { method: "POST", path: "/internal/status", templatePath: "/internal/status" };
    }
  });

  const result = resolveHttpExecutionContext(
    {
      requestPayload: { method: "POST", path: "/internal/status" },
      parent_action_key: "wordpress_api",
      endpoint_key: "native_internal_status",
      policies: []
    },
    deps
  );

  assert("same-service-native target bypasses transport mismatch block", result.sameServiceNativeTarget === true, JSON.stringify(result));
  assert("same-service-native target still resolves method/path", result.resolvedMethodPath.path === "/internal/status", JSON.stringify(result));
}

console.log(`\n${"-".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL EXECUTION ROUTING TESTS PASS");
  process.exit(0);
}

console.error(`${failed} TEST(S) FAILED`);
process.exit(1);
