/**
 * Unit tests for utils.js, normalization.js, wordpress-cpt-preflight.js,
 * mutationGovernance.js, and governedChangeControl.js
 * Run: node test-utils.mjs
 */
import {
  extractJsonAssetPayloadBody,
  normalizeJsonObjectOrEmpty,
  isWordpressCptSchemaPreflightEndpoint,
  buildWordpressCptSchemaPreflightAssetKey,
  buildWordpressCptSchemaPreflightPayload
} from "./utils.js";
import {
  normalizeExecutionPayload,
  normalizeTopLevelRoutingFields,
  validatePayloadIntegrity,
  isHttpGenericTransportEndpointKey,
  isDelegatedHttpExecuteWrapper,
  promoteDelegatedExecutionPayload,
  isHostingerAction,
  isSiteTargetKey,
  isHostingAccountTargetKey
} from "./normalization.js";
import {
  inferWordpressInventoryAssetType,
  buildWordpressJsonAssetContext
} from "./wordpress-cpt-preflight.js";
import {
  classifyGovernedMutationIntent,
  summarizeDuplicateCandidates,
  isExecutionLogUnifiedAppendExempt,
  buildGovernedMutationExemptionContext
} from "./mutationGovernance.js";
import {
  normalizeSemanticValue,
  findSemanticDuplicateRows
} from "./governedChangeControl.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

// ─── extractJsonAssetPayloadBody ────────────────────────────────────────────
section("extractJsonAssetPayloadBody");

assert("returns null when no response_body",
  extractJsonAssetPayloadBody({}) === null);
assert("returns body.data when data key present",
  extractJsonAssetPayloadBody({ response_body: { data: { id: 1 } } })?.id === 1);
assert("returns full body when no data key",
  extractJsonAssetPayloadBody({ response_body: { title: "x" } })?.title === "x");
assert("returns array body as-is",
  Array.isArray(extractJsonAssetPayloadBody({ response_body: [1, 2] })));

// ─── normalizeJsonObjectOrEmpty ─────────────────────────────────────────────
section("normalizeJsonObjectOrEmpty");

assert("returns {} for null",
  Object.keys(normalizeJsonObjectOrEmpty(null)).length === 0);
assert("returns {} for array",
  Object.keys(normalizeJsonObjectOrEmpty([1, 2])).length === 0);
assert("returns {} for string",
  Object.keys(normalizeJsonObjectOrEmpty("str")).length === 0);
assert("passes through plain object",
  normalizeJsonObjectOrEmpty({ a: 1 }).a === 1);

// ─── isWordpressCptSchemaPreflightEndpoint ──────────────────────────────────
section("isWordpressCptSchemaPreflightEndpoint");

assert("true for wordpress_get_cpt_runtime_type",
  isWordpressCptSchemaPreflightEndpoint("wordpress_get_cpt_runtime_type") === true);
assert("true for jetengine_get_post_type_config",
  isWordpressCptSchemaPreflightEndpoint("jetengine_get_post_type_config") === true);
assert("true for wordpress_get_taxonomy_runtime",
  isWordpressCptSchemaPreflightEndpoint("wordpress_get_taxonomy_runtime") === true);
assert("false for wordpress_list_types",
  isWordpressCptSchemaPreflightEndpoint("wordpress_list_types") === false);
assert("false for empty string",
  isWordpressCptSchemaPreflightEndpoint("") === false);

// ─── buildWordpressCptSchemaPreflightAssetKey ────────────────────────────────
section("buildWordpressCptSchemaPreflightAssetKey");

const key1 = buildWordpressCptSchemaPreflightAssetKey({
  brand_name: "My Brand",
  target_key: "site_abc",
  cpt_slug: "post"
});
assert("key contains brand slug", key1.startsWith("my_brand__"));
assert("key contains target_key", key1.includes("__site_abc__"));
assert("key contains cpt_slug", key1.includes("__post__"));
assert("key ends with v1 suffix", key1.endsWith("__wordpress_cpt_schema_preflight_v1"));

const keyFallback = buildWordpressCptSchemaPreflightAssetKey({});
assert("fallback key uses unknown_brand", keyFallback.startsWith("unknown_brand__"));
assert("fallback key uses unknown_cpt", keyFallback.includes("__unknown_cpt__"));

// ─── buildWordpressCptSchemaPreflightPayload ─────────────────────────────────
section("buildWordpressCptSchemaPreflightPayload");

const payload = buildWordpressCptSchemaPreflightPayload({
  brand_name: "Test Brand",
  target_key: "site_x",
  base_url: "https://site.example.com",
  cpt_slug: "article",
  endpoint_key: "wordpress_get_cpt_runtime_type"
});
assert("returns identity block", typeof payload.identity === "object");
assert("identity.site_type is wordpress", payload.identity.site_type === "wordpress");
assert("identity.brand_name set", payload.identity.brand_name === "Test Brand");
assert("source_resolution block present", typeof payload.source_resolution === "object");
assert("wordpress_rest_type_resolved true for matching endpoint",
  payload.source_resolution.wordpress_rest_type_resolved === true);
assert("jetengine_config_resolved false for non-matching endpoint",
  payload.source_resolution.jetengine_config_resolved === false);
assert("field_contract is object", typeof payload.field_contract === "object");
assert("playbook_inference block present", typeof payload.playbook_inference === "object");
assert("playbook_coverage_status defaults to not_applicable",
  payload.playbook_inference.playbook_coverage_status === "not_applicable");

const payloadWithData = buildWordpressCptSchemaPreflightPayload({
  brand_name: "B",
  endpoint_key: "jetengine_get_post_type_config",
  response_body: {
    data: {
      field_contract: { name: "string" },
      wordpress_rest_type_resolved: true
    }
  }
});
assert("merges field_contract from response_body.data",
  payloadWithData.field_contract?.name === "string");
assert("jetengine_config_resolved true for matching endpoint",
  payloadWithData.source_resolution.jetengine_config_resolved === true);

// ─── normalization.js ────────────────────────────────────────────────────────
section("normalization — normalizeExecutionPayload");

const norm1 = normalizeExecutionPayload({ target_key: "site_a", body: { x: 1 }, query: { page: 2 } });
assert("normalizeExecutionPayload returns object", typeof norm1 === "object");
assert("preserves target_key", norm1.target_key === "site_a");
assert("preserves body", norm1.body?.x === 1);
assert("preserves query.page", norm1.query?.page === 2);

const norm2 = normalizeExecutionPayload({ params: { query: { q: "test" } } });
assert("lifts params.query to top-level query", norm2.query?.q === "test");

const normEmpty = normalizeExecutionPayload(null);
assert("handles null payload", typeof normEmpty === "object");

section("normalization — normalizeTopLevelRoutingFields");

const routing = normalizeTopLevelRoutingFields({ target_key: "site_b", endpoint_key: "wp_list_posts", extra: "ignored" });
assert("includes target_key", routing.target_key === "site_b");
assert("includes endpoint_key", routing.endpoint_key === "wp_list_posts");

section("normalization — validatePayloadIntegrity");

const integrity = validatePayloadIntegrity({ target_key: "x" }, { target_key: "x" });
assert("returns object", typeof integrity === "object");

section("normalization — isHttpGenericTransportEndpointKey");

assert("http_post is transport endpoint", isHttpGenericTransportEndpointKey("http_post") === true);
assert("http_get is transport endpoint", isHttpGenericTransportEndpointKey("http_get") === true);
assert("wp_list_posts is not transport endpoint", isHttpGenericTransportEndpointKey("wp_list_posts") === false);
assert("empty string is not transport endpoint", isHttpGenericTransportEndpointKey("") === false);

section("normalization — isDelegatedHttpExecuteWrapper / promoteDelegatedExecutionPayload");

const delegated = {
  parent_action_key: "http_generic_api",
  endpoint_key: "http_post",
  path: "/http-execute",
  body: { endpoint_key: "wp_get_post", target_key: "abc" }
};
assert("isDelegatedHttpExecuteWrapper true for correctly structured payload", isDelegatedHttpExecuteWrapper(delegated) === true);
assert("isDelegatedHttpExecuteWrapper false for direct payload", isDelegatedHttpExecuteWrapper({ endpoint_key: "wp_get_post" }) === false);

const promoted = promoteDelegatedExecutionPayload(delegated);
assert("promotes endpoint_key from body", promoted.endpoint_key === "wp_get_post");
assert("promotes target_key from body", promoted.target_key === "abc");

section("normalization — isHostingerAction / isSiteTargetKey / isHostingAccountTargetKey");

assert("hostinger_api is hostinger action", isHostingerAction("hostinger_api") === true);
assert("wp_list_posts is not hostinger action", isHostingerAction("wp_list_posts") === false);
assert("isSiteTargetKey true for site_ prefix", isSiteTargetKey("site_mybrand") === true);
assert("isSiteTargetKey true for _wp suffix", isSiteTargetKey("mybrand_wp") === true);
assert("isSiteTargetKey false for plain string", isSiteTargetKey("account_123") === false);
assert("isHostingAccountTargetKey true for hostinger_ prefix", isHostingAccountTargetKey("hostinger_main") === true);
assert("isHostingAccountTargetKey true for _account_ substring", isHostingAccountTargetKey("main_account_plan") === true);
assert("isHostingAccountTargetKey false for site_ prefix", isHostingAccountTargetKey("site_abc") === false);

// ─── wordpress-cpt-preflight.js ──────────────────────────────────────────────
section("wordpress-cpt-preflight — inferWordpressInventoryAssetType");

assert("preflight endpoint → wordpress_cpt_schema_preflight",
  inferWordpressInventoryAssetType("wordpress_get_cpt_runtime_type") === "wordpress_cpt_schema_preflight");
assert("wordpress_list_tags → wordpress_taxonomy_inventory",
  inferWordpressInventoryAssetType("wordpress_list_tags") === "wordpress_taxonomy_inventory");
assert("wordpress_list_categories → wordpress_taxonomy_inventory",
  inferWordpressInventoryAssetType("wordpress_list_categories") === "wordpress_taxonomy_inventory");
assert("wordpress_list_types → wordpress_cpt_inventory",
  inferWordpressInventoryAssetType("wordpress_list_types") === "wordpress_cpt_inventory");
assert("unknown endpoint → wordpress_runtime_response",
  inferWordpressInventoryAssetType("some_other_endpoint") === "wordpress_runtime_response");
assert("empty string → wordpress_runtime_response",
  inferWordpressInventoryAssetType("") === "wordpress_runtime_response");

section("wordpress-cpt-preflight — buildWordpressJsonAssetContext (preflight)");

const ctx = buildWordpressJsonAssetContext({
  endpoint_key: "wordpress_get_cpt_runtime_type",
  brand_name: "My Brand",
  target_key: "site_x",
  cpt_slug: "post",
  execution_trace_id: "trace_abc"
});
assert("isWordpressPreflightAsset true", ctx.isWordpressPreflightAsset === true);
assert("inferred_asset_type is preflight", ctx.inferred_asset_type === "wordpress_cpt_schema_preflight");
assert("asset_key contains brand", ctx.asset_key.includes("my_brand"));
assert("mapping_status is captured_governed_preflight", ctx.mapping_status === "captured_governed_preflight");
assert("validation_status is validated", ctx.validation_status === "validated");
assert("transport_status is captured_governed", ctx.transport_status === "captured_governed");

section("wordpress-cpt-preflight — buildWordpressJsonAssetContext (non-preflight)");

const ctxNonPreflight = buildWordpressJsonAssetContext({
  endpoint_key: "wp_list_posts",
  execution_trace_id: "trace_xyz"
});
assert("isWordpressPreflightAsset false", ctxNonPreflight.isWordpressPreflightAsset === false);
assert("inferred_asset_type is wordpress_runtime_response", ctxNonPreflight.inferred_asset_type === "wordpress_runtime_response");
assert("asset_key uses endpoint+trace", ctxNonPreflight.asset_key === "wp_list_posts__trace_xyz");
assert("mapping_status is captured_unreduced", ctxNonPreflight.mapping_status === "captured_unreduced");
assert("validation_status is pending", ctxNonPreflight.validation_status === "pending");

// ─── mutationGovernance — classifyGovernedMutationIntent ────────────────────
section("mutationGovernance — classifyGovernedMutationIntent");

assert("append with no duplicates → append_new",
  classifyGovernedMutationIntent({ mutationType: "append", duplicateCandidates: [] }) === "append_new");
assert("append with duplicates → blocked_duplicate",
  classifyGovernedMutationIntent({ mutationType: "append", duplicateCandidates: [{ rowNumber: 5, score: 2 }] }) === "blocked_duplicate");
assert("update with targetRowNumber → update_existing",
  classifyGovernedMutationIntent({ mutationType: "update", targetRowNumber: 3 }) === "update_existing");
assert("update with renameOnly → rename_existing",
  classifyGovernedMutationIntent({ mutationType: "update", renameOnly: true }) === "rename_existing");
assert("update with mergeCandidate → merge_existing",
  classifyGovernedMutationIntent({ mutationType: "update", mergeCandidate: true }) === "merge_existing");
assert("update with no target → blocked_policy_unconfirmed",
  classifyGovernedMutationIntent({ mutationType: "update" }) === "blocked_policy_unconfirmed");

section("mutationGovernance — summarizeDuplicateCandidates");

const dupes = [
  { rowNumber: 2, score: 3, row: [] },
  { rowNumber: 5, score: 1, row: [] },
  { rowNumber: 7, score: 2, row: [] },
  { rowNumber: 9, score: 4, row: [] },
  { rowNumber: 11, score: 2, row: [] },
  { rowNumber: 13, score: 5, row: [] }
];
const summary = summarizeDuplicateCandidates(dupes);
assert("summary capped at 5 items", summary.length === 5);
assert("summary item has rowNumber", typeof summary[0].rowNumber === "number");
assert("summary item has score", typeof summary[0].score === "number");
assert("summary item has no row data", !("row" in summary[0]));

section("mutationGovernance — isExecutionLogUnifiedAppendExempt");

assert("exempt when sheetName matches and mutationType is append",
  isExecutionLogUnifiedAppendExempt(
    { sheetName: "Execution Log Unified", mutationType: "append" },
    { executionLogUnifiedSheetName: "Execution Log Unified" }
  ) === true);
assert("not exempt when sheetName differs",
  isExecutionLogUnifiedAppendExempt(
    { sheetName: "Other Sheet", mutationType: "append" },
    { executionLogUnifiedSheetName: "Execution Log Unified" }
  ) === false);
assert("not exempt when mutationType is update",
  isExecutionLogUnifiedAppendExempt(
    { sheetName: "Execution Log Unified", mutationType: "update" },
    { executionLogUnifiedSheetName: "Execution Log Unified" }
  ) === false);
assert("defaults mutationType to append when omitted",
  isExecutionLogUnifiedAppendExempt(
    { sheetName: "Execution Log Unified" },
    { executionLogUnifiedSheetName: "Execution Log Unified" }
  ) === true);

section("mutationGovernance — buildGovernedMutationExemptionContext");

const exemptCtx = buildGovernedMutationExemptionContext(
  { sheetName: "Execution Log Unified", mutationType: "append" },
  { executionLogUnifiedSheetName: "Execution Log Unified" }
);
assert("exemptCtx.sink_exemption_applied true", exemptCtx.sink_exemption_applied === true);
assert("exemptCtx.sink_exemption_class is execution_log_unified_append",
  exemptCtx.sink_exemption_class === "execution_log_unified_append");

const nonExemptCtx = buildGovernedMutationExemptionContext(
  { sheetName: "Registry Sheet", mutationType: "append" },
  { executionLogUnifiedSheetName: "Execution Log Unified" }
);
assert("non-exempt ctx has sink_exemption_applied false or absent",
  !nonExemptCtx.sink_exemption_applied);

// ─── governedChangeControl — semantic duplicate detection ────────────────────
section("governedChangeControl — normalizeSemanticValue");

assert("lowercases value", normalizeSemanticValue("Hello World") === "hello world");
assert("trims whitespace", normalizeSemanticValue("  abc  ") === "abc");
assert("collapses internal spaces", normalizeSemanticValue("a  b   c") === "a b c");
assert("handles null", normalizeSemanticValue(null) === "");
assert("handles number", normalizeSemanticValue(42) === "42");

section("governedChangeControl — findSemanticDuplicateRows");

const header = ["job_id", "status", "brand"];
const rows = [
  ["job_001", "succeeded", "brandA"],
  ["job_002", "failed", "brandB"],
  ["job_003", "succeeded", "brandA"]
];

const noDupes = findSemanticDuplicateRows(header, rows, { job_id: "job_999" });
assert("no match returns empty array", noDupes.length === 0);

const exactMatch = findSemanticDuplicateRows(header, rows, { job_id: "job_001" });
assert("exact match returns one result", exactMatch.length === 1);
assert("match has correct rowNumber", exactMatch[0].rowNumber === 2);
assert("match has score >= 1", exactMatch[0].score >= 1);

const multiFieldMatch = findSemanticDuplicateRows(header, rows, { status: "succeeded", brand: "brandA" });
assert("multi-field match returns 2 candidates", multiFieldMatch.length === 2);
assert("highest score is first", multiFieldMatch[0].score >= multiFieldMatch[1].score);

const caseInsensitive = findSemanticDuplicateRows(header, rows, { brand: "BRANDA" });
assert("matching is case-insensitive", caseInsensitive.length >= 1);

const emptyRows = findSemanticDuplicateRows(header, [], { job_id: "job_001" });
assert("empty rows returns empty array", emptyRows.length === 0);

const emptyHeader = findSemanticDuplicateRows([], rows, { job_id: "job_001" });
assert("empty header returns empty array", emptyHeader.length === 0);

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL TESTS PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
