import assert from "node:assert/strict";
import { aggregatePlatformEndpointToolRows } from "./platformEndpointToolAggregation.js";
import { listSystemToolCatalog } from "./systemToolCatalogV2.js";

const normalizeInputSchema = (value) => typeof value === "string" ? JSON.parse(value) : value;

const groupedRows = [
  {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_add_issue_labels",
    scope_class: "admin",
    method: "POST",
    input_schema_json: JSON.stringify({
      type: "object",
      required: ["repository_full_name", "issue_number", "labels"],
      properties: {
        repository_full_name: { type: "string" },
        issue_number: { type: "integer" },
        labels: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    }),
  },
  {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_update_pull_request",
    scope_class: "admin",
    method: "PATCH",
    input_schema_json: JSON.stringify({
      type: "object",
      required: ["repository_full_name", "pr_number"],
      properties: {
        repository_full_name: { type: "string" },
        pr_number: { type: "integer" },
        title: { type: "string" },
      },
      additionalProperties: false,
    }),
  },
];

const grouped = aggregatePlatformEndpointToolRows(groupedRows, {
  isAdmin: true,
  normalizeInputSchema,
});
const catalog = listSystemToolCatalog(grouped, { limit: 10 });
const groupedDescriptor = catalog.items[0];

assert.equal(groupedDescriptor.name, "github_rest_endpoint_dispatch");
assert.deepEqual(groupedDescriptor.inputSchema.required, ["endpoint_key"]);
assert.deepEqual(groupedDescriptor.inputSchema.properties.endpoint_key.enum, [
  "github_add_issue_labels",
  "github_update_pull_request",
]);
const normalizedBindings = groupedDescriptor.inputSchema["x-platform-endpoint"]?.bindings;
assert.equal(normalizedBindings?.length, 2, "catalog normalization must retain endpoint binding metadata");
assert.deepEqual(normalizedBindings[0].inputSchema.required, [
  "repository_full_name",
  "issue_number",
  "labels",
]);
assert.deepEqual(normalizedBindings[1].inputSchema.required, [
  "repository_full_name",
  "pr_number",
]);

const singleSchema = {
  type: "object",
  required: ["tenant_id", "ticket_id"],
  properties: {
    tenant_id: { type: "string" },
    ticket_id: { type: "string" },
  },
  additionalProperties: false,
};
const single = aggregatePlatformEndpointToolRows([
  {
    tool_name: "tenant_ticket_lookup",
    parent_action_key: "tenant_support",
    endpoint_key: "tenant_ticket_lookup_v1",
    scope_class: "admin",
    method: "GET",
    input_schema_json: JSON.stringify(singleSchema),
  },
], {
  isAdmin: true,
  normalizeInputSchema,
});
const singleCatalog = listSystemToolCatalog(single, { limit: 10 });
assert.deepEqual(
  singleCatalog.items[0].inputSchema,
  singleSchema,
  "single-binding tools must retain their endpoint-specific discovery schema",
);
assert.equal(singleCatalog.items[0].inputSchema.properties.endpoint_key, undefined);
assert.equal(singleCatalog.items[0].inputSchema.required.includes("endpoint_key"), false);

console.log("platform endpoint tool discovery contract tests passed");
