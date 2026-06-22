import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/1023_sprint69_github_rest_endpoint_dispatch_foundation.sql", import.meta.url),
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

console.log("github REST endpoint dispatch foundation tests passed");
