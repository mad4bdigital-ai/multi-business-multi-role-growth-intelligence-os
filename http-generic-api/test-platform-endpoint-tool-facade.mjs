import assert from "node:assert/strict";
import {
  buildPlatformEndpointToolDescriptors,
  selectPlatformEndpointToolBinding,
} from "./platformEndpointToolFacade.js";
import { listSystemToolCatalog } from "./systemToolCatalogV2.js";

function normalizeInputSchema(value) {
  if (!value) return { type: "object", properties: {}, required: [] };
  if (typeof value === "object") return value;
  return JSON.parse(value);
}

const githubRows = [
  {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_list_issue_comments",
    scope_class: "both",
    method: "GET",
    input_schema_json: JSON.stringify({
      type: "object",
      properties: {
        path_params: { type: "object", additionalProperties: true },
        query: { type: "object", additionalProperties: true },
      },
      required: [],
    }),
  },
  {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_add_issue_labels",
    scope_class: "both",
    method: "POST",
    input_schema_json: JSON.stringify({
      type: "object",
      properties: {
        path_params: { type: "object", additionalProperties: true },
        body: { type: "object", additionalProperties: true },
      },
      required: [],
    }),
  },
  {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_get_git_ref_head",
    scope_class: "both",
    method: "GET",
    input_schema_json: JSON.stringify({
      type: "object",
      properties: {
        path_params: { type: "object", additionalProperties: true },
      },
      required: [],
    }),
  },
];

{
  const descriptors = buildPlatformEndpointToolDescriptors(githubRows, { normalizeInputSchema });
  const reversed = buildPlatformEndpointToolDescriptors([...githubRows].reverse(), { normalizeInputSchema });

  assert.equal(descriptors.length, 1, "one public tool name must produce one descriptor");
  assert.deepEqual(descriptors, reversed, "descriptor projection must be stable regardless of row order");

  const [descriptor] = descriptors;
  assert.equal(descriptor.name, "github_rest_endpoint_dispatch");
  assert.equal(descriptor.x_platform_endpoint.binding_count, 3);
  assert.deepEqual(descriptor.inputSchema.properties.endpoint_key.enum, [
    "github_add_issue_labels",
    "github_get_git_ref_head",
    "github_list_issue_comments",
  ]);
  assert.deepEqual(descriptor.inputSchema.required, ["endpoint_key"]);
  assert.equal(descriptor.x_platform_endpoint.selection_field, "endpoint_key");

  const catalog = listSystemToolCatalog(descriptors, { limit: 10 });
  assert.equal(catalog.items.length, 1, "coalesced descriptors must not trigger catalog collision");
  assert.equal(catalog.items[0].name, "github_rest_endpoint_dispatch");
}

{
  assert.throws(
    () => selectPlatformEndpointToolBinding(githubRows, {}, "github_rest_endpoint_dispatch"),
    (error) => error.code === "platform_endpoint_tool_endpoint_key_required"
      && error.status === 400
      && error.details.tool_name === "github_rest_endpoint_dispatch"
      && error.details.allowed_endpoint_keys.join(",") === [
        "github_add_issue_labels",
        "github_get_git_ref_head",
        "github_list_issue_comments",
      ].join(",")
      && error.details.secrets_included === false,
    "multi-binding tools must require endpoint_key",
  );

  assert.throws(
    () => selectPlatformEndpointToolBinding(
      githubRows,
      { endpoint_key: "github_unknown_endpoint" },
      "github_rest_endpoint_dispatch",
    ),
    (error) => error.code === "platform_endpoint_tool_endpoint_key_unknown"
      && error.status === 400
      && error.details.endpoint_key === "github_unknown_endpoint",
    "unknown endpoint_key values must fail closed",
  );

  const selected = selectPlatformEndpointToolBinding(
    githubRows,
    { endpoint_key: "github_get_git_ref_head" },
    "github_rest_endpoint_dispatch",
  );
  assert.equal(selected.endpoint_key, "github_get_git_ref_head");
  assert.equal(selected.parent_action_key, "github_api_mcp");
  assert.equal(selected.method, "GET");
}

{
  const singleRows = [{
    tool_name: "single_endpoint_tool",
    parent_action_key: "example_api",
    endpoint_key: "example_get",
    scope_class: "tenant",
    method: "GET",
    input_schema_json: JSON.stringify({
      type: "object",
      properties: { query: { type: "object", additionalProperties: true } },
      required: [],
    }),
  }];

  const [descriptor] = buildPlatformEndpointToolDescriptors(singleRows, { normalizeInputSchema });
  assert.equal(descriptor.x_platform_endpoint.binding_count, 1);
  assert.equal(descriptor.inputSchema.properties.endpoint_key, undefined);
  assert.deepEqual(descriptor.inputSchema.required, []);
  assert.equal(
    selectPlatformEndpointToolBinding(singleRows, {}, "single_endpoint_tool").endpoint_key,
    "example_get",
    "single-binding tools must remain callable without endpoint_key",
  );
}

{
  const duplicateRows = [
    {
      ...githubRows[0],
      endpoint_key: "github_get_git_ref_head",
      parent_action_key: "github_api_mcp",
    },
    {
      ...githubRows[0],
      endpoint_key: "github_get_git_ref_head",
      parent_action_key: "github_api_mcp_duplicate",
    },
  ];

  assert.throws(
    () => selectPlatformEndpointToolBinding(
      duplicateRows,
      { endpoint_key: "github_get_git_ref_head" },
      "github_rest_endpoint_dispatch",
    ),
    (error) => error.code === "platform_endpoint_tool_binding_ambiguous"
      && error.status === 409
      && error.details.endpoint_key === "github_get_git_ref_head"
      && error.details.candidate_count === 2,
    "a selected endpoint_key that still resolves to multiple rows must fail closed",
  );
}

console.log("platform endpoint tool facade tests passed");
