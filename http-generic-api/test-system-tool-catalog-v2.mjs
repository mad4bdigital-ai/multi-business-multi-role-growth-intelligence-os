import assert from "node:assert/strict";
import {
  auditSystemToolDescriptorRuntimeParity,
  getSystemToolCatalogObservability,
  getSystemToolDescriptorByName,
  listSystemToolCatalog,
  resetSystemToolCatalogObservabilityForTests,
  resolveSystemCapabilityIntent,
  SystemToolCatalogError,
} from "./systemToolCatalogV2.js";
import {
  aggregatePlatformEndpointToolRows,
  resolvePlatformEndpointToolBinding,
} from "./platformEndpointToolAggregation.js";

resetSystemToolCatalogObservabilityForTests();

const tools = Array.from({ length: 250 }, (_, index) => ({
  name: `tool_${String(index).padStart(3, "0")}`,
  description: index % 2 === 0 ? "Inspect analytics reports" : "Manage workflow previews",
  source_key: `source_${index % 5}`,
  capability_key: `capability.${index}`,
  tags: index % 2 === 0 ? ["analytics", "read"] : ["workflow", "preview"],
  inputSchema: { type: "object", properties: { fixture: { type: "string" } } },
}));

const expectedOrder = [...tools]
  .sort((a, b) => `${a.source_key}\u0000${a.name}`.localeCompare(`${b.source_key}\u0000${b.name}`))
  .map((tool) => tool.name);

const first = listSystemToolCatalog(tools, { limit: 37 });
const reversed = listSystemToolCatalog([...tools].reverse(), { limit: 37 });
assert.equal(first.catalog_version, reversed.catalog_version, "catalog version must not depend on input order");
assert.deepEqual(first.items.map((item) => item.name), reversed.items.map((item) => item.name));

const traversed = [];
let cursor = null;
do {
  const page = listSystemToolCatalog(tools, cursor ? { limit: 37, cursor } : { limit: 37 });
  traversed.push(...page.items.map((item) => item.name));
  cursor = page.page.next_cursor;
} while (cursor);
assert.equal(traversed.length, 250);
assert.equal(new Set(traversed).size, 250, "cursor traversal must not duplicate tools");
assert.deepEqual(traversed, expectedOrder, "catalog order must be source_key then stable name");

const direct = getSystemToolDescriptorByName(tools, "tool_225");
assert.equal(direct.tool.name, "tool_225");
assert.equal(direct.tool.capability_key, "capability.225");

const identicalDuplicate = listSystemToolCatalog([tools[0], { ...tools[0] }], { limit: 10 });
assert.equal(identicalDuplicate.items.length, 1, "byte-equivalent normalized duplicates may be coalesced");

const conflictingDescriptors = [
  { name: "shared_tool", source_key: "source_a", capability_key: "capability.a" },
  { name: "shared_tool", source_key: "source_b", capability_key: "capability.b" },
];
for (const input of [conflictingDescriptors, [...conflictingDescriptors].reverse()]) {
  assert.throws(
    () => listSystemToolCatalog(input, { limit: 10 }),
    (error) => error instanceof SystemToolCatalogError
      && error.code === "SYSTEM_TOOL_DESCRIPTOR_NAME_COLLISION"
      && error.status === 500
      && error.details.tool_name === "shared_tool"
      && error.details.source_keys.join(",") === "source_a,source_b",
    "divergent descriptors sharing one public name must fail closed independently of input order",
  );
}

const platformEndpointRows = [
  {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_update_pull_request",
    scope_class: "admin",
    method: "PATCH",
    input_schema_json: JSON.stringify({ type: "object", properties: { pull_number: { type: "integer" } } }),
  },
  {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_list_issue_labels",
    scope_class: "admin",
    method: "GET",
    input_schema_json: JSON.stringify({ type: "object", properties: { issue_number: { type: "integer" } } }),
  },
  {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_add_issue_labels",
    scope_class: "admin",
    method: "POST",
    input_schema_json: JSON.stringify({ type: "object", properties: { labels: { type: "array" } } }),
  },
];
const groupedPlatformTools = aggregatePlatformEndpointToolRows(platformEndpointRows, {
  isAdmin: true,
  normalizeInputSchema: (value) => JSON.parse(value),
});
assert.equal(groupedPlatformTools.length, 1, "same-name platform exports must become one public descriptor");
assert.equal(groupedPlatformTools[0].name, "github_rest_endpoint_dispatch");
assert.deepEqual(groupedPlatformTools[0].inputSchema.required, ["endpoint_key"]);
assert.deepEqual(groupedPlatformTools[0].inputSchema.properties.endpoint_key.enum, [
  "github_add_issue_labels",
  "github_list_issue_labels",
  "github_update_pull_request",
]);
assert.equal(groupedPlatformTools[0].x_platform_endpoint.endpoint_count, 3);
assert.equal(groupedPlatformTools[0].x_platform_endpoint.bindings.length, 3);
assert.doesNotThrow(
  () => listSystemToolCatalog(groupedPlatformTools, { limit: 10 }),
  "grouped platform exports must not reach catalog normalization as divergent duplicate names",
);

const selectedPlatformBinding = resolvePlatformEndpointToolBinding(platformEndpointRows, {
  toolName: "github_rest_endpoint_dispatch",
  args: { endpoint_key: "github_add_issue_labels", parent_action_key: "github_api_mcp" },
});
assert.equal(selectedPlatformBinding.endpoint_key, "github_add_issue_labels");
assert.throws(
  () => resolvePlatformEndpointToolBinding(platformEndpointRows, {
    toolName: "github_rest_endpoint_dispatch",
    args: {},
  }),
  (error) => error.code === "platform_endpoint_tool_endpoint_key_required"
    && error.status === 400
    && error.details.allowed_endpoint_keys.length === 3,
);
assert.throws(
  () => resolvePlatformEndpointToolBinding(platformEndpointRows, {
    toolName: "github_rest_endpoint_dispatch",
    args: { endpoint_key: "github_unknown_endpoint" },
  }),
  (error) => error.code === "platform_endpoint_tool_endpoint_key_not_allowed" && error.status === 400,
);
assert.throws(
  () => resolvePlatformEndpointToolBinding(platformEndpointRows, {
    toolName: "github_rest_endpoint_dispatch",
    args: { endpoint_key: "github_add_issue_labels", parent_action_key: "another_parent" },
  }),
  (error) => error.code === "platform_endpoint_tool_parent_action_mismatch" && error.status === 400,
);

const legacy = listSystemToolCatalog(tools.slice(0, 80), {}, { legacyCompleteDefault: true });
assert.equal(legacy.items.length, 80);
assert.equal(legacy.compatibility.deprecated, true);
assert.equal(legacy.compatibility.replacement, "cursor-pagination-or-direct-lookup");

const filtered = listSystemToolCatalog(tools, { tag: "analytics", limit: 200 });
assert.equal(filtered.page.total_count, 125);
assert(filtered.items.every((tool) => tool.tags.includes("analytics")));

const staleCursor = first.page.next_cursor;
assert.throws(
  () => listSystemToolCatalog([...tools, { name: "tool_999" }], { limit: 37, cursor: staleCursor }),
  (error) => error instanceof SystemToolCatalogError
    && error.code === "SYSTEM_TOOL_CATALOG_SNAPSHOT_MISMATCH"
    && error.status === 409,
);

const tenantVisible = tools.filter((tool) => Number(tool.name.slice(-3)) < 20);
assert.throws(
  () => getSystemToolDescriptorByName(tenantVisible, "tool_225"),
  (error) => error.code === "SYSTEM_TOOL_NOT_FOUND" && error.status === 404,
  "direct lookup must not bypass principal visibility",
);

const exactResolution = resolveSystemCapabilityIntent(tools, { tool_name: "tool_225" });
assert.equal(exactResolution.status, "resolved");
assert.equal(exactResolution.selected_tool.name, "tool_225");
assert.equal(exactResolution.execution_allowed, false);

const capabilityResolution = resolveSystemCapabilityIntent(tools, { capability_key: "capability.17" });
assert.equal(capabilityResolution.status, "resolved");
assert.equal(capabilityResolution.selected_tool.name, "tool_017");

const ambiguity = resolveSystemCapabilityIntent([
  { name: "workflow_preview_alpha", description: "Preview shared workflow", tags: ["workflow", "preview"] },
  { name: "workflow_preview_beta", description: "Preview shared workflow", tags: ["workflow", "preview"] },
], { intent: "workflow preview" });
assert.equal(ambiguity.status, "clarification_required");
assert.equal(ambiguity.selected_tool, null);

const arabicResolution = resolveSystemCapabilityIntent([
  {
    name: "travel_report",
    description: "عرض تقارير السفر",
    aliases: ["تقارير السفر"],
    tags: ["السفر", "تقارير"],
  },
], { intent: "تقارير السفر" });
assert.equal(arabicResolution.status, "resolved", "non-Latin intent must not be erased during normalization");
assert.equal(arabicResolution.selected_tool.name, "travel_report");

const handlerMap = new Map(tools.map((tool) => [tool.name, () => null]));
assert.equal(auditSystemToolDescriptorRuntimeParity(tools, handlerMap).ok, true);
handlerMap.delete("tool_249");
const parity = auditSystemToolDescriptorRuntimeParity(tools, handlerMap);
assert.equal(parity.ok, false);
assert.deepEqual(parity.missing_handlers, ["tool_249"]);

const metrics = getSystemToolCatalogObservability().counters;
assert(metrics.catalog_list_requests >= 13);
assert(metrics.catalog_direct_lookup_requests >= 2);
assert.equal(metrics.catalog_lookup_not_found, 1);
assert.equal(metrics.legacy_full_catalog_requests, 1);
assert.equal(metrics.snapshot_mismatch, 1);
assert.equal(metrics.descriptor_runtime_mismatch, 1);
assert.equal(metrics.descriptor_name_collision, 2);
assert(metrics.capability_resolution_requests >= 4);

console.log("system tool catalog v2 tests passed");
