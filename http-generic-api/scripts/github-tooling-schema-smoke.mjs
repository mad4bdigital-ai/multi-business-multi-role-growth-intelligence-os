#!/usr/bin/env node
import { getPool } from "../db.js";

const REQUIRED_ENDPOINTS = [
  {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_list_pull_requests",
    expectation: "list pull requests returns an array response schema",
    validateSchema(schema) {
      return schema?.responses?.["200"]?.content?.["application/json"]?.schema?.type === "array";
    },
  },
  {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_create_pull_request",
    expectation: "create pull request accepts GitHub 201 Created object response",
    validateSchema(schema) {
      return schema?.responses?.["201"]?.content?.["application/json"]?.schema?.type === "object";
    },
  },
  {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_merge_pull_request",
    expectation: "merge pull request has 200 object response schema",
    validateSchema(schema) {
      return schema?.responses?.["200"]?.content?.["application/json"]?.schema?.type === "object";
    },
  },
  {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_update_pull_request_branch",
    expectation: "update-branch endpoint exists for conflict handling",
    validateSchema(schema) {
      return schema?.method === "put" || schema?.method === "PUT" || schema?.operationId === "updatePullRequestBranch";
    },
  },
  {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_graphql",
    expectation: "GraphQL endpoint requires query body",
    validateSchema(schema) {
      return Boolean(schema?.requestBody?.content?.["application/json"]?.schema?.required?.includes("query"));
    },
  },
  {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_list_repo_actions_secrets",
    expectation: "repository secret-name listing is read-only GET",
    validateSchema(schema, row) {
      return row.method === "GET" && String(row.endpoint_path_or_function || "").includes("/actions/secrets");
    },
  },
  {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_list_environment_actions_secrets",
    expectation: "environment secret-name listing is read-only GET",
    validateSchema(schema, row) {
      return row.method === "GET" && String(row.endpoint_path_or_function || "").includes("/environments/{environment_name}/secrets");
    },
  },
  {
    parent_action_key: "github_git_data",
    endpoint_key: "getGitTree",
    expectation: "Git tree read endpoint is GET",
    validateSchema(schema, row) {
      return row.method === "GET" && String(row.endpoint_path_or_function || "").includes("/git/trees/");
    },
  },
  {
    parent_action_key: "github_actions_status",
    endpoint_key: "listWorkflowRunsForWorkflow",
    expectation: "workflow-specific runs endpoint is GET",
    validateSchema(schema, row) {
      return row.method === "GET" && String(row.endpoint_path_or_function || "").includes("/actions/workflows/{workflow_id}/runs");
    },
  },
];

const REQUIRED_EXPORTS = [
  { tool_name: "github_api_mcp__github_list_pull_requests", note_terms: ["array"] },
  { tool_name: "github_api_mcp__github_create_pull_request", note_terms: ["PR creation"] },
  { tool_name: "github_api_mcp__github_get_pull_request", note_terms: ["mergeability"] },
  { tool_name: "github_api_mcp__github_update_pull_request", note_terms: ["metadata"] },
  { tool_name: "github_api_mcp__github_update_pull_request_branch", note_terms: ["update-branch"] },
  { tool_name: "github_api_mcp__github_merge_pull_request", note_terms: ["expected head sha"] },
  { tool_name: "github_api_mcp__github_graphql", note_terms: ["GraphQL"] },
  { tool_name: "github_actions_status__listWorkflowRunsForWorkflow", note_terms: ["workflow-specific"] },
  { tool_name: "github_api_mcp__github_list_repo_actions_secrets", note_terms: ["read-only", "Secret values are never returned"] },
  { tool_name: "github_api_mcp__github_list_environment_actions_secrets", note_terms: ["read-only", "Secret values are never returned"] },
  { tool_name: "github_git_data__getGitTree", note_terms: ["Git tree read"] },
];

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function assertCheck(checks, name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), details });
}

async function main() {
  const checks = [];
  const pool = getPool();

  const endpointKeys = REQUIRED_ENDPOINTS.map((item) => item.endpoint_key);
  const [endpointRows] = await pool.query(
    `SELECT parent_action_key, endpoint_key, method, endpoint_path_or_function, status,
            execution_readiness, transport_action_key, schema_json
       FROM endpoints
      WHERE endpoint_key IN (?)`,
    [endpointKeys]
  );
  const endpointsByKey = new Map(endpointRows.map((row) => [`${row.parent_action_key}:${row.endpoint_key}`, row]));

  for (const contract of REQUIRED_ENDPOINTS) {
    const key = `${contract.parent_action_key}:${contract.endpoint_key}`;
    const row = endpointsByKey.get(key);
    const schema = parseJson(row?.schema_json);
    assertCheck(checks, `${contract.endpoint_key}: endpoint exists`, Boolean(row), { parent_action_key: contract.parent_action_key });
    assertCheck(checks, `${contract.endpoint_key}: active and ready`, row?.status === "active" && row?.execution_readiness === "ready", { status: row?.status || null, execution_readiness: row?.execution_readiness || null });
    assertCheck(checks, `${contract.endpoint_key}: delegated through http_generic_api`, row?.transport_action_key === "http_generic_api" || Boolean(row?.transport_action_key), { transport_action_key: row?.transport_action_key || null });
    assertCheck(checks, `${contract.endpoint_key}: ${contract.expectation}`, Boolean(row && contract.validateSchema(schema, row)), { method: row?.method || null, path: row?.endpoint_path_or_function || null });
  }

  const exportNames = REQUIRED_EXPORTS.map((item) => item.tool_name);
  const [exportRows] = await pool.query(
    `SELECT tool_name, scope_class, status, notes
       FROM platform_endpoint_tool_exports
      WHERE tool_name IN (?)`,
    [exportNames]
  );
  const exportsByName = new Map(exportRows.map((row) => [row.tool_name, row]));

  for (const contract of REQUIRED_EXPORTS) {
    const row = exportsByName.get(contract.tool_name);
    const notes = String(row?.notes || "");
    assertCheck(checks, `${contract.tool_name}: export exists`, Boolean(row));
    assertCheck(checks, `${contract.tool_name}: admin-only active export`, row?.scope_class === "admin" && row?.status === "active", { scope_class: row?.scope_class || null, status: row?.status || null });
    assertCheck(checks, `${contract.tool_name}: policy notes present`, contract.note_terms.every((term) => notes.includes(term)), { required_terms: contract.note_terms });
  }

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.length - passed;
  console.log(JSON.stringify({
    ok: failed === 0,
    passed,
    failed,
    checks,
    endpoint_contract_count: REQUIRED_ENDPOINTS.length,
    export_contract_count: REQUIRED_EXPORTS.length,
    writes_attempted: false,
    secrets_included: false,
  }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "github_tooling_schema_smoke_failed", message: err.message }, writes_attempted: false, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
