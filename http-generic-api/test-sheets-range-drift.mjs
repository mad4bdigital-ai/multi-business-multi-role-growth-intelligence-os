/**
 * Closure test: getSheetValues range integrity guards
 * Verifies all 3 guard layers added during the drift-fix sprint:
 *   1. assertExplicitRange (googleSheets.js — SDK layer)
 *   2. validateEndpointRowConsistency exactPath (registryExecutionEligibility.js — registry layer)
 *   3. resolveExecutionRequest pre/post guards (executionResolution.js — request layer)
 *
 * Run: node test-sheets-range-drift.mjs
 */

import { fetchRange } from "./googleSheets.js";
import { validateEndpointRowConsistency } from "./registryExecutionEligibility.js";
import { resolveExecutionRequest } from "./executionResolution.js";

const ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID = "1RV185rQo58pGppg27r81eD9hPE8pXPyBY1pfHANip4o";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

// ── 1. assertExplicitRange — SDK layer ──────────────────────────────────────
section("assertExplicitRange (via fetchRange) — SDK layer");

for (const [label, range] of [
  ["empty string", ""],
  ["null", null],
  ["whitespace only", "   "]
]) {
  let errCode;
  try {
    await fetchRange(null, range);
  } catch (e) {
    errCode = e.code;
  }
  assert(
    `${label} range throws missing_required_range_param`,
    errCode === "missing_required_range_param",
    `got: ${errCode}`
  );
}

// ── 2. validateEndpointRowConsistency exactPath — registry layer ─────────────
section("validateEndpointRowConsistency — getSheetValues exactPath guard");

{
  const correct = {
    endpoint_key: "getSheetValues",
    parent_action_key: "google_sheets_api",
    endpoint_operation: "getSheetValues",
    openai_action_name: "getSheetValues",
    route_target: "google_sheets_api",
    provider_domain: "https://sheets.googleapis.com",
    method: "GET",
    endpoint_path_or_function: "/v4/spreadsheets/{spreadsheetId}/values/{range}"
  };
  const r = validateEndpointRowConsistency(correct, { endpoint_key: "getSheetValues", parent_action_key: "google_sheets_api" });
  assert("correct registry row passes", r.valid === true, JSON.stringify(r.mismatches));
}

{
  const bakedRange = {
    endpoint_key: "getSheetValues",
    parent_action_key: "google_sheets_api",
    endpoint_operation: "getSheetValues",
    openai_action_name: "getSheetValues",
    route_target: "google_sheets_api",
    provider_domain: "https://sheets.googleapis.com",
    method: "GET",
    endpoint_path_or_function: "/v4/spreadsheets/abc/values/Execution%20Policy%20Registry%21A1852%3AH1901"
  };
  const r = validateEndpointRowConsistency(bakedRange, { endpoint_key: "getSheetValues", parent_action_key: "google_sheets_api" });
  assert(
    "row with baked-in range fails exactPath guard",
    r.valid === false && r.mismatches.some(m => m.field === "endpoint_path_or_function"),
    JSON.stringify(r.mismatches)
  );
}

{
  const docsDrift = {
    endpoint_key: "getSheetValues",
    parent_action_key: "google_sheets_api",
    endpoint_operation: "getSheetValues",
    openai_action_name: "getSheetValues",
    route_target: "google_sheets_api",
    provider_domain: "https://docs.googleapis.com",
    method: "GET",
    endpoint_path_or_function: "/v1/documents/{documentId}"
  };
  const r = validateEndpointRowConsistency(docsDrift, { endpoint_key: "getSheetValues", parent_action_key: "google_sheets_api" });
  assert(
    "row pointing to Docs domain fails provider_domain guard",
    r.valid === false && r.mismatches.some(m => m.field === "provider_domain"),
    JSON.stringify(r.mismatches)
  );
}

// ── 3. resolveExecutionRequest guards — request layer ────────────────────────

function makeMinimalDeps(overrides = {}) {
  const registry = { drive: {}, brandRows: [], hostingAccounts: [], actionRows: [], endpointRows: [], policies: {} };
  return {
    requireEnv: () => {},
    createExecutionTraceId: () => "trace_closure_test",
    debugLog: () => {},
    promoteDelegatedExecutionPayload: p => p,
    normalizeExecutionPayload: p => p,
    validateAssetHomePayloadRules: () => ({ ok: true }),
    normalizeAssetType: t => t,
    classifyAssetHome: () => "external",
    assertHostingerTargetTier: () => {},
    validatePayloadIntegrity: () => ({ ok: true }),
    normalizeTopLevelRoutingFields: p => p,
    isDelegatedHttpExecuteWrapper: () => false,
    validateTopLevelRoutingFields: () => ({ ok: true }),
    getRegistry: async () => registry,
    reloadRegistry: async () => registry,
    getRequiredHttpExecutionPolicyKeys: () => [],
    requirePolicySet: () => ({ ok: true }),
    policyValue: (_p, _g, _k, fallback = "") => fallback,
    resolveHttpExecutionContext: () => ({ resolvedMethodPath: { path: "" } }),
    boolFromSheet: v => String(v || "").trim().toUpperCase() === "TRUE",
    resolveAction: () => ({}),
    resolveEndpoint: () => ({}),
    getEndpointExecutionSnapshot: () => ({}),
    resolveBrand: () => ({}),
    requireRuntimeCallableAction: () => {},
    requireEndpointExecutionEligibility: () => ({
      endpointRole: "primary",
      executionMode: "http_delegated",
      transportRequired: true,
      delegatedTransportTarget: false
    }),
    requireExecutionModeCompatibility: () => {},
    requireNativeFamilyBoundary: () => {},
    requireTransportIfDelegated: () => {},
    requireNoFallbackDirectExecution: () => {},
    isDelegatedTransportTarget: () => false,
    ensureMethodAndPathMatchEndpoint: () => ({ path: "" }),
    sanitizeCallerHeaders: h => (h || {}),
    ...overrides
  };
}

section("resolveExecutionRequest — pre-resolution guard (missing_required_range_param)");

for (const [label, payload] of [
  ["no path_params no query",     { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET" }],
  ["empty path_params no query",  { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET", path_params: {} }],
  ["empty range in path_params",  { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET", path_params: { spreadsheetId: "abc", range: "" } }],
  ["whitespace range in path_params", { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET", path_params: { spreadsheetId: "abc", range: "   " } }],
  ["empty range in query",        { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET", query: { range: "" } }],
  ["whitespace range in query",   { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET", query: { range: "   " } }]
]) {
  const result = await resolveExecutionRequest(payload, makeMinimalDeps());
  assert(
    `${label} → missing_required_range_param`,
    result.ok === false && result.response?.body?.error?.code === "missing_required_range_param",
    JSON.stringify(result.response?.body?.error)
  );
}

// Mock the endpoint resolver path expansion used by ensureMethodAndPathMatchEndpoint.
const sentinelAwareMock = (input) => ({
  resolvedMethodPath: {
    path: `/v4/spreadsheets/${encodeURIComponent(String(input?.requestPayload?.path_params?.spreadsheetId || ""))}/values/${encodeURIComponent(String(input?.requestPayload?.path_params?.range || ""))}`
  }
});

section("resolveExecutionRequest — query.range accepted and preferred over path_params.range");

{
  const range = "Activation Bootstrap Config!A2:J2";
  const result = await resolveExecutionRequest(
    {
      parent_action_key: "google_sheets_api",
      endpoint_key: "getSheetValues",
      method: "GET",
      path_params: { spreadsheetId: ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID },
      query: { range }
    },
    makeMinimalDeps({ resolveHttpExecutionContext: sentinelAwareMock })
  );
  assert("query.range accepted — ok", result.ok === true, JSON.stringify(result.response?.body?.error));
  assert("query.range removed from outbound query", result.query?.range === undefined, `got: ${result.query?.range}`);
  assert("query.range propagated to path_params", result.pathParams?.range === range, `got: ${result.pathParams?.range}`);
  assert("range encoded once in outbound path", String(result.resolvedMethodPath?.path || "").endsWith(`/values/${encodeURIComponent(range)}`), `got: ${result.resolvedMethodPath?.path}`);
}

{
  const range = "Activation Bootstrap Config!A2:J2";
  const wrongRange = "Wrong Sheet!Z99:Z99";
  const result = await resolveExecutionRequest(
    {
      parent_action_key: "google_sheets_api",
      endpoint_key: "getSheetValues",
      method: "GET",
      path_params: { spreadsheetId: ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID, range: wrongRange },
      query: { range }
    },
    makeMinimalDeps({ resolveHttpExecutionContext: sentinelAwareMock })
  );
  assert("query.range preferred over path_params.range — ok", result.ok === true, JSON.stringify(result.response?.body?.error));
  assert("query.range preferred over path_params.range", result.pathParams?.range === range, `got: ${result.pathParams?.range}`);
  assert("wrong path_params.range removed from outbound path", !String(result.resolvedMethodPath?.path || "").includes(encodeURIComponent(wrongRange)), `got: ${result.resolvedMethodPath?.path}`);
}

section("resolveExecutionRequest — pre-encoded range decoded before path encoding (no double-encoding)");

{
  const rawRange = "Activation Bootstrap Config!A2:J2";
  const preEncoded = encodeURIComponent(rawRange);
  const result = await resolveExecutionRequest(
    {
      parent_action_key: "google_sheets_api",
      endpoint_key: "getSheetValues",
      method: "GET",
      path_params: { spreadsheetId: ACTIVATION_BOOTSTRAP_SPREADSHEET_ID },
      query: { range: preEncoded }
    },
    makeMinimalDeps({ resolveHttpExecutionContext: sentinelAwareMock })
  );
  assert("pre-encoded query.range decoded once — no %2520 double-encoding", result.ok === true, JSON.stringify(result.response?.body?.error));
  assert("decoded range in path_params", result.pathParams?.range === rawRange, `got: ${result.pathParams?.range}`);
  assert("outbound path has no double encoding", String(result.resolvedMethodPath?.path || "").endsWith(`/values/${encodeURIComponent(rawRange)}`), `got: ${result.resolvedMethodPath?.path}`);
}

section("resolveExecutionRequest - activation bootstrap placeholder auto-resolution & custom ID allowance");

{
  // Test 1: Placeholder auto-resolution
  const placeholderResult = await resolveExecutionRequest(
    {
      parent_action_key: "google_sheets_api",
      endpoint_key: "getSheetValues",
      method: "GET",
      path_params: {
        spreadsheetId: "<activation_bootstrap_spreadsheet_id>"
      },
      query: { range: "Activation Bootstrap Config!A2:J2" }
    },
    makeMinimalDeps({ resolveHttpExecutionContext: sentinelAwareMock })
  );

  assert(
    "placeholder spreadsheet ID is auto-resolved to configured ID",
    placeholderResult.ok === true && placeholderResult.pathParams.spreadsheetId === ACTIVATION_BOOTSTRAP_SPREADSHEET_ID,
    `got: ${placeholderResult.pathParams?.spreadsheetId}`
  );

  // Test 2: Custom ID allowance (no hardcode)
  const customId = "1hX7a6RQzaJ1FP0z8xN9Krds4VluqilkSRAxYXHKR4sE";
  const customResult = await resolveExecutionRequest(
    {
      parent_action_key: "google_sheets_api",
      endpoint_key: "getSheetValues",
      method: "GET",
      path_params: {
        spreadsheetId: customId
      },
      query: { range: "Activation Bootstrap Config!A2:J2" }
    },
    makeMinimalDeps({ resolveHttpExecutionContext: sentinelAwareMock })
  );

  assert(
    "custom spreadsheet ID is allowed without rejection (no hardcode)",
    customResult.ok === true && customResult.pathParams.spreadsheetId === customId,
    `got: ${customResult.pathParams?.spreadsheetId} (ok=${customResult.ok})`
  );
}

section("resolveExecutionRequest — path range routing");

// Range is routed through the URL path so Google Sheets API receives
// .../values/<encoded-range>, never .../values?range=<range>.

const REGRESSION_RANGES = [
  "Review Stage Registry!A1:C3",
  "Actor Role Capability Registry!A1:C3",
  "Registry Surfaces Catalog!A32:P32",
  "Execution Policy Registry!A190:H196"
];

for (const range of REGRESSION_RANGES) {
  const result = await resolveExecutionRequest(
    { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET", path_params: { spreadsheetId: "abc", range } },
    makeMinimalDeps({ resolveHttpExecutionContext: sentinelAwareMock })
  );
  assert(
    `"${range}" — ok`,
    result.ok === true,
    result.ok === false ? JSON.stringify(result.response?.body?.error) : ""
  );
  assert(
    `"${range}" — range removed from outbound query`,
    result.query?.range === undefined,
    `got: ${result.query?.range}`
  );
  assert(
    `"${range}" — encoded range remains in outbound path`,
    String(result.resolvedMethodPath?.path || "").endsWith(`/values/${encodeURIComponent(range)}`),
    `got path: ${result.resolvedMethodPath?.path}`
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL TESTS PASS");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
