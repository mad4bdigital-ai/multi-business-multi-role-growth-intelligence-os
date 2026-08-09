import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/1023_sprint69_github_rest_endpoint_dispatch_foundation.sql", import.meta.url),
  "utf8"
);
const issueCommentParityMigration = readFileSync(
  new URL("./migrations/20260808_github_issue_comment_dispatch_parity.sql", import.meta.url),
  "utf8"
);
const githubSchema = readFileSync(
  new URL("./schemas/github/github_rest.yaml", import.meta.url),
  "utf8"
);

const requiredEndpoints = [
  ["ACT-GH-REST-038", "github_list_issue_labels", "GET", "/repos/{owner}/{repo}/issues/{issue_number}/labels"],
  ["ACT-GH-REST-039", "github_add_issue_labels", "POST", "/repos/{owner}/{repo}/issues/{issue_number}/labels"],
  ["ACT-GH-REST-040", "github_set_issue_labels", "PUT", "/repos/{owner}/{repo}/issues/{issue_number}/labels"],
  ["ACT-GH-REST-041", "github_remove_issue_label", "DELETE", "/repos/{owner}/{repo}/issues/{issue_number}/labels/{name}"],
];

for (const [id, key, method, path] of requiredEndpoints) {
  assert.match(migration, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(migration, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(migration, new RegExp(`'${method}'`));
  assert.ok(migration.includes(path), `${key} must preserve the canonical GitHub REST path`);
}

assert.match(migration, /'github_rest_endpoint_dispatch'/);
assert.match(migration, /'\/system\/tools\/call'/);
assert.match(migration, /JSON_OBJECT\('name','runtime_endpoint_call'\)/);
assert.match(migration, /'parent_action_key','endpoint_key','path_params'/);
assert.match(migration, /'parent_action_key',JSON_OBJECT\('type','string','const','github_api_mcp'\)/);
assert.match(migration, /'method_and_path_from_endpoints_only',TRUE/);
assert.match(migration, /e\.endpoint_id IS NOT NULL/);
assert.match(migration, /e\.execution_readiness = 'ready'/);
assert.match(migration, /e\.transport_action_key = 'http_generic_api'/);
assert.match(migration, /platform_endpoint_tool_exports/);
assert.match(migration, /platform_tool_dispatch_bindings/);
assert.match(migration, /github_pr_state_readback_v1/);
assert.match(migration, /github_issue_labels_exact_readback_v1/);
assert.match(migration, /caller_supplied_authorization_forbidden/);
assert.match(migration, /ON DUPLICATE KEY UPDATE/g);

assert.doesNotMatch(migration, /"method"\s*:/);
assert.doesNotMatch(migration, /"url"\s*:/);
assert.doesNotMatch(migration, /fetch\s*\(/);
assert.doesNotMatch(migration, /axios\s*\(/);
assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `missing migration safety marker ${marker}`);
}

assert.match(migration, /ACT-GH-EP-011/);
assert.match(migration, /github_create_branch_reference/);
assert.match(migration, /'\$\.responses\.201'/);
assert.match(migration, /'description', 'Reference created'/);
assert.match(migration, /'required', JSON_ARRAY\('ref', 'object'\)/);
assert.match(migration, /WHERE endpoint_id = 'ACT-GH-EP-011'/);

assert.match(githubSchema, /operationId: createIssueComment[\s\S]*?responses:\s*\n\s*'201':\s*\n\s*description: Created[\s\S]*?\$ref: '#\/components\/schemas\/Comment'/);

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(issueCommentParityMigration.includes(marker), `missing issue-comment parity safety marker ${marker}`);
}

for (const required of [
  "github_create_issue_comment",
  "/repos/{owner}/{repo}/issues/{issue_number}/comments",
  "github_rest_endpoint_dispatch",
  "runtime_endpoint_call",
  "platform_endpoint_tool_exports",
  "platform_tool_dispatch_bindings",
  "ptdb_github_rest_dispatch_issue_comment_create",
  "github_issue_comments_write",
  "github_issue_comment_create",
  "github_issue_comment_exact_readback_v1",
  "v_github_issue_comment_dispatch_parity",
]) {
  assert.ok(issueCommentParityMigration.includes(required), `missing issue-comment parity contract ${required}`);
}

assert.match(issueCommentParityMigration, /SET @github_issue_comment_endpoint_match_count :=/);
assert.match(issueCommentParityMigration, /SET @github_issue_comment_dispatcher_match_count :=/);
assert.match(issueCommentParityMigration, /@github_issue_comment_endpoint_match_count = 1/);
assert.match(issueCommentParityMigration, /@github_issue_comment_dispatcher_match_count = 1/);
assert.match(issueCommentParityMigration, /UPDATE endpoints/);
assert.match(issueCommentParityMigration, /'\$\.responses\.201'/);
assert.match(issueCommentParityMigration, /'description', 'Created'/);
assert.match(issueCommentParityMigration, /'type', 'object'/);
assert.match(issueCommentParityMigration, /'additionalProperties', TRUE/);
assert.match(issueCommentParityMigration, /endpoint_id IS NOT NULL/);
assert.match(issueCommentParityMigration, /method = 'POST'/);
assert.match(issueCommentParityMigration, /status = 'active'/);
assert.match(issueCommentParityMigration, /execution_readiness = 'ready'/);
assert.match(issueCommentParityMigration, /transport_action_key = 'http_generic_api'/);
assert.match(issueCommentParityMigration, /t\.http_method = 'POST'/);
assert.match(issueCommentParityMigration, /t\.http_path = '\/system\/tools\/call'/);
assert.match(issueCommentParityMigration, /JSON_UNQUOTE\(JSON_EXTRACT\(t\.fixed_body, '\$\.name'\)\) = 'runtime_endpoint_call'/);
assert.match(
  issueCommentParityMigration,
  /UPDATE endpoints[\s\S]*?@github_issue_comment_endpoint_match_count = 1[\s\S]*?@github_issue_comment_dispatcher_match_count = 1;/,
  "endpoint schema mutation must require both exact endpoint and dispatcher cardinality before any partial apply",
);
assert.match(
  issueCommentParityMigration,
  /UPDATE admin_platform_endpoint_tools[\s\S]*?http_path = '\/system\/tools\/call'[\s\S]*?JSON_UNQUOTE\(JSON_EXTRACT\(fixed_body, '\$\.name'\)\) = 'runtime_endpoint_call'/,
  "dispatcher mutation must target the canonical system tool row, not merely a matching tool key",
);
assert.match(issueCommentParityMigration, /JSON_SEARCH\([\s\S]*?'github_create_issue_comment'/);
assert.match(issueCommentParityMigration, /JSON_ARRAY_APPEND\([\s\S]*?'github_create_issue_comment'/);
assert.doesNotMatch(
  issueCommentParityMigration,
  /\$\.properties\.tool_args\.properties\.body\.properties\.body/,
  "issue-comment parity must not impose a shared body minLength that blocks clearing a pull-request body",
);
assert.match(issueCommentParityMigration, /export_key = VALUES\(export_key\)/);
assert.match(issueCommentParityMigration, /parent_action_key = VALUES\(parent_action_key\)/);
assert.match(issueCommentParityMigration, /endpoint_key = VALUES\(endpoint_key\)/);
assert.match(issueCommentParityMigration, /tenant_id = VALUES\(tenant_id\)/);
assert.match(issueCommentParityMigration, /input_schema_json = VALUES\(input_schema_json\)/);
assert.match(issueCommentParityMigration, /binding_id = VALUES\(binding_id\)/);
assert.match(issueCommentParityMigration, /tool_key = VALUES\(tool_key\)/);
assert.match(issueCommentParityMigration, /source_endpoint_id = VALUES\(source_endpoint_id\)/);
assert.match(issueCommentParityMigration, /'preflight_required', TRUE/);
assert.match(issueCommentParityMigration, /'approval_required', TRUE/);
assert.match(issueCommentParityMigration, /'same_cycle_readback_required', TRUE/);
assert.match(issueCommentParityMigration, /'requires_runtime_preflight', TRUE/);
assert.match(issueCommentParityMigration, /'requires_approval', TRUE/);
assert.match(issueCommentParityMigration, /'requires_same_cycle_readback', TRUE/);
assert.match(issueCommentParityMigration, /'caller_supplied_authorization_forbidden', TRUE/);
assert.match(issueCommentParityMigration, /'secrets_included', FALSE/);
assert.match(issueCommentParityMigration, /CREATE OR REPLACE VIEW v_github_issue_comment_dispatch_parity AS/);
assert.match(issueCommentParityMigration, /endpoint_match_count/);
assert.match(issueCommentParityMigration, /response_schema_ready_count/);
assert.match(issueCommentParityMigration, /dispatcher_allowlist_ready_count/);
assert.match(issueCommentParityMigration, /export_schema_parity_count/);
assert.match(issueCommentParityMigration, /binding_match_count/);
assert.match(issueCommentParityMigration, /export_row\.input_schema_json <=> endpoint_row\.schema_json/);
assert.match(
  issueCommentParityMigration,
  /FROM platform_tool_dispatch_bindings binding_row[\s\S]*?JOIN platform_endpoint_tool_exports export_row[\s\S]*?export_row\.source_endpoint_id = binding_row\.source_endpoint_id[\s\S]*?JOIN endpoints endpoint_row[\s\S]*?endpoint_row\.id = export_row\.source_endpoint_id/,
  "binding readiness must prove the binding, export, and endpoint all resolve to the same canonical source row",
);
assert.match(
  issueCommentParityMigration,
  /binding_row\.parent_action_key = 'github_api_mcp'[\s\S]*?binding_row\.endpoint_key = 'github_create_issue_comment'[\s\S]*?binding_row\.export_key = 'github_api_mcp__github_create_issue_comment'/,
  "binding readiness must prove canonical logical identity",
);
assert.match(
  issueCommentParityMigration,
  /export_row\.parent_action_key = 'github_api_mcp'[\s\S]*?export_row\.endpoint_key = 'github_create_issue_comment'[\s\S]*?export_row\.tenant_id IS NULL/,
  "export readiness must prove canonical admin identity",
);
assert.ok(
  (issueCommentParityMigration.match(/execution_readiness = 'ready'/g) || []).length >= 4,
  "endpoint, export, binding and mutation paths must all require ready execution state",
);
assert.ok(
  (issueCommentParityMigration.match(/transport_action_key = 'http_generic_api'/g) || []).length >= 4,
  "endpoint, export, binding and mutation paths must all require canonical transport",
);
assert.match(issueCommentParityMigration, /THEN 'ready'[\s\S]*?ELSE 'blocked'/);

assert.doesNotMatch(issueCommentParityMigration, /INSERT\s+INTO\s+endpoints/i);
assert.doesNotMatch(issueCommentParityMigration, /fetch\s*\(/);
assert.doesNotMatch(issueCommentParityMigration, /axios\s*\(/);
assert.doesNotMatch(issueCommentParityMigration, /\bPREPARE\b/i);
assert.doesNotMatch(issueCommentParityMigration, /\bEXECUTE\b/i);
assert.doesNotMatch(issueCommentParityMigration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);

console.log("github REST endpoint dispatch foundation tests passed");
