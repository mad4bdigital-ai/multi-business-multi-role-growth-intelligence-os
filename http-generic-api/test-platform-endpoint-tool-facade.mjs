import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GITHUB_ISSUE_COMMENT_READBACK_POLICY_KEY,
  buildPlatformEndpointToolDescriptors,
  isGithubIssueCommentMutationTarget,
  selectPlatformEndpointToolBinding,
} from "./platformEndpointToolFacade.js";

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
  assert.equal(
    new Set(descriptors.map(({ name }) => name)).size,
    descriptors.length,
    "facade projection must emit unique public descriptor names before Catalog V2",
  );

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
  assert.equal(descriptor.requires_admin, false, "tenant-visible shared bindings remain non-admin descriptors");
}

{
  const adminOnlyBinding = {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_delete_repository_environment",
    scope_class: "admin",
    method: "DELETE",
    input_schema_json: JSON.stringify({
      type: "object",
      properties: { path_params: { type: "object", additionalProperties: true } },
      required: [],
    }),
  };

  const [adminDescriptor] = buildPlatformEndpointToolDescriptors(
    [...githubRows, adminOnlyBinding],
    { normalizeInputSchema },
  );
  assert.deepEqual(adminDescriptor.inputSchema.properties.endpoint_key.enum, [
    "github_add_issue_labels",
    "github_delete_repository_environment",
    "github_get_git_ref_head",
    "github_list_issue_comments",
  ], "admin projection includes both shared and admin-only active bindings");

  const [tenantDescriptor] = buildPlatformEndpointToolDescriptors(githubRows, { normalizeInputSchema });
  assert.equal(
    tenantDescriptor.inputSchema.properties.endpoint_key.enum.includes("github_delete_repository_environment"),
    false,
    "tenant projection cannot expose an admin-only endpoint key",
  );

  const [adminOnlyDescriptor] = buildPlatformEndpointToolDescriptors([
    adminOnlyBinding,
    { ...adminOnlyBinding, endpoint_key: "github_delete_repository_secret" },
  ], { normalizeInputSchema });
  assert.equal(adminOnlyDescriptor.requires_admin, true, "all-admin binding groups remain admin-only");
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
  const [githubRowTemplate] = githubRows;
  const duplicateRows = [
    {
      ...githubRowTemplate,
      endpoint_key: "github_get_git_ref_head",
      parent_action_key: "github_api_mcp",
    },
    {
      ...githubRowTemplate,
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

{
  const mismatchedNames = [
    ...githubRows,
    {
      tool_name: "another_public_tool",
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_other_endpoint",
      scope_class: "both",
      method: "GET",
      input_schema_json: "{}",
    },
  ];
  assert.throws(
    () => selectPlatformEndpointToolBinding(
      mismatchedNames,
      { endpoint_key: "github_get_git_ref_head" },
      "github_rest_endpoint_dispatch",
    ),
    (error) => error.code === "platform_endpoint_tool_name_ambiguous"
      && error.status === 409
      && error.details.candidate_tool_names.length === 2,
    "candidate rows spanning more than one public name must fail closed",
  );
}

{
  const issueCommentRow = {
    tool_name: "github_rest_endpoint_dispatch",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_create_issue_comment",
    scope_class: "admin",
    method: "POST",
    input_schema_json: JSON.stringify({
      type: "object",
      properties: {
        path_params: { type: "object", additionalProperties: true },
        body: { type: "object", additionalProperties: true },
        readback: { type: "object", additionalProperties: true },
      },
      required: [],
    }),
  };
  const rows = [...githubRows, issueCommentRow];
  const selectComment = (args = {}) => selectPlatformEndpointToolBinding(
    rows,
    { endpoint_key: "github_create_issue_comment", ...args },
    "github_rest_endpoint_dispatch",
  );

  const [descriptor] = buildPlatformEndpointToolDescriptors(rows, { normalizeInputSchema });
  assert.equal(descriptor.inputSchema.allOf.length, 1, "create-comment projection must publish one endpoint-specific governance condition");
  assert.equal(
    descriptor.inputSchema.allOf[0].if.properties.endpoint_key.const,
    "github_create_issue_comment",
    "the conditional schema must apply only to create-comment",
  );
  assert.equal(
    descriptor.inputSchema.allOf[0].then.properties.readback.properties.policy_key.const,
    GITHUB_ISSUE_COMMENT_READBACK_POLICY_KEY,
    "the projected schema must publish the exact executable readback policy",
  );
  assert.deepEqual(
    descriptor.inputSchema.allOf[0].then.properties.readback.properties.governance.required,
    ["mutation_approval", "approved_preflight_dry_run_validated", "live_execution_approved"],
    "the projected schema must make the normalized governance envelope discoverable",
  );

  assert.throws(
    () => selectComment(),
    (error) => error.code === "github_issue_comment_mutation_approval_required"
      && error.status === 403
      && error.details.provider_call_allowed === false
      && error.details.governance_evidence_location === "readback.governance"
      && error.details.secrets_included === false,
    "issue-comment mutation must fail closed before provider dispatch without explicit approval",
  );

  assert.throws(
    () => selectComment({ mutation_approval: { approved: true } }),
    (error) => error.code === "github_issue_comment_mutation_approval_required"
      && error.details.governance_evidence_location === "readback.governance",
    "top-level approval must not be accepted by the dispatcher because the normalizer does not preserve it",
  );

  assert.throws(
    () => selectComment({
      readback: {
        governance: { mutation_approval: { approved: true } },
      },
    }),
    (error) => error.code === "github_issue_comment_mutation_preflight_required"
      && error.details.provider_call_allowed === false,
    "issue-comment mutation must require completed dry-run/preflight evidence inside the preserved governance envelope",
  );

  assert.throws(
    () => selectComment({
      readback: {
        governance: {
          mutation_approval: { approved: true },
          approved_preflight_dry_run_validated: true,
        },
      },
    }),
    (error) => error.code === "github_issue_comment_mutation_live_approval_required"
      && error.details.provider_call_allowed === false,
    "issue-comment mutation must require live approval inside the preserved governance envelope",
  );

  assert.throws(
    () => selectComment({
      readback: {
        required: true,
        policy_key: "bogus",
        governance: {
          mutation_approval: { approved: true },
          approved_preflight_dry_run_validated: true,
          live_execution_approved: true,
        },
      },
    }),
    (error) => error.code === "github_issue_comment_mutation_readback_required"
      && error.details.required_readback_policy_key === GITHUB_ISSUE_COMMENT_READBACK_POLICY_KEY
      && error.details.provider_call_allowed === false,
    "arbitrary readback policy values must not satisfy the exact comment readback gate",
  );

  assert.throws(
    () => selectComment({
      dry_run: true,
      preflight_only: true,
      readback: { governance: { mutation_approval: { approved: true } } },
    }),
    (error) => error.code === "github_issue_comment_mutation_preflight_requires_preview"
      && error.status === 409
      && error.details.preview_tool === "runtime_endpoint_preview"
      && error.details.provider_call_allowed === false,
    "issue-comment dry-run requests through the public dispatcher must use the no-provider-call runtime preview surface",
  );

  const selected = selectComment({
    readback: {
      required: true,
      policy_key: GITHUB_ISSUE_COMMENT_READBACK_POLICY_KEY,
      governance: {
        mutation_approval: { approved: true },
        approved_preflight_dry_run_validated: true,
        live_execution_approved: true,
      },
    },
  });
  assert.equal(selected.endpoint_key, "github_create_issue_comment");
  assert.equal(selected.method, "POST");

  assert.throws(
    () => isGithubIssueCommentMutationTarget({
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_create_issue_comment",
      preflight_only: true,
    }),
    (error) => error.code === "github_issue_comment_mutation_preflight_requires_preview"
      && error.status === 409
      && error.details.provider_call_allowed === false,
    "direct runtime preflight_only must fail closed before executionFacade can reach provider dispatch",
  );
  assert.equal(
    isGithubIssueCommentMutationTarget({
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_create_issue_comment",
      dry_run: true,
      preflight_only: true,
    }),
    true,
    "runtime_endpoint_preview remains classifiable because it sets dry_run and cannot perform the provider mutation",
  );

  const readOnlySelected = selectPlatformEndpointToolBinding(
    rows,
    { endpoint_key: "github_list_issue_comments" },
    "github_rest_endpoint_dispatch",
  );
  assert.equal(readOnlySelected.endpoint_key, "github_list_issue_comments");
}

{
  const executionFacadeSource = readFileSync(
    new URL("./executionFacade.js", import.meta.url),
    "utf8",
  );
  assert.match(
    executionFacadeSource,
    /if \(isGithubIssueCommentLiveMutation\(reqBody\)\) \{\s*enforceGithubIssueCommentMutationGate\(reqBody, reqBody\);/,
    "actual runtime execution facade must enforce the create-comment gate before resolution/provider dispatch",
  );
  assert.match(
    executionFacadeSource,
    /endpoint_key: "github_list_issue_comments"/,
    "same-cycle readback must execute the canonical read-only issue-comments endpoint",
  );
  assert.match(
    executionFacadeSource,
    /facade\.execute\(\s*buildGithubIssueCommentReadbackPayload/,
    "same-cycle readback must be an executable runtime call rather than metadata only",
  );
  assert.match(
    executionFacadeSource,
    /comments\.some\(\(comment\) => String\(comment\?\.id \?\? ""\)\.trim\(\) === commentId\)/,
    "readback must verify the exact provider-returned comment identity",
  );
  assert.match(
    executionFacadeSource,
    /github_issue_comment_readback_not_observed/,
    "missing exact comment observation must fail closed after the mutation",
  );
  assert.match(
    executionFacadeSource,
    /governance_readback:[\s\S]*policy_key: GITHUB_ISSUE_COMMENT_READBACK_POLICY_KEY[\s\S]*status: "verified"/,
    "successful live mutation must return bounded verified readback evidence",
  );

  const systemLayerRoutesSource = readFileSync(
    new URL("./routes/systemLayerRoutes.js", import.meta.url),
    "utf8",
  );
  assert.match(
    systemLayerRoutesSource,
    /readback: args\.readback \|\| \{ required: false, mode: "none" \}/,
    "platform endpoint normalizer must preserve the readback envelope used for create-comment governance evidence",
  );
}

console.log("platform endpoint tool facade tests passed");
