import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/1026_sprint69_github_actions_runs_read_dispatch.sql", import.meta.url),
  "utf8"
);

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

for (const required of [
  "ACT-GH-REST-043",
  "github_list_workflow_runs_for_repo",
  "listWorkflowRunsForRepo",
  "/repos/{owner}/{repo}/actions/runs",
  "github_rest_endpoint_dispatch",
  "platform_endpoint_tool_exports",
  "platform_tool_dispatch_bindings",
  "github_actions_runs_read",
  "github_actions_workflow_runs_list",
  "github_actions_runs_list_readback_v1",
  "runtime_endpoint_call",
  "http_generic_api",
  "method_and_path_from_endpoints_only",
  "read_only_endpoint",
  "head_sha",
  "per_page",
  "page",
]) {
  assert.match(migration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(migration, /'method', 'get'/);
assert.match(migration, /'github_rest', 'GET',/);
assert.match(migration, /JSON_QUOTE\('github_list_workflow_runs_for_repo'\)/);
assert.match(migration, /'\$\.properties\.tool_args\.properties\.endpoint_key\.enum'/);
assert.match(migration, /'\$\.properties\.tool_args\.properties\.query\.properties\.head_sha'/);
assert.match(migration, /'\^\[a-fA-F0-9\]\{40\}\$'/);
assert.match(migration, /'mutation_preflight_required',FALSE/);
assert.match(migration, /'requires_runtime_preflight',FALSE/);
assert.match(migration, /'requires_same_cycle_readback',TRUE/);
assert.match(migration, /e\.execution_readiness = 'ready'/);
assert.match(migration, /e\.transport_action_key = 'http_generic_api'/);
assert.match(migration, /ON DUPLICATE KEY UPDATE/g);

assert.doesNotMatch(migration, /"method"\s*:/);
assert.doesNotMatch(migration, /"url"\s*:/);
assert.doesNotMatch(migration, /fetch\s*\(/);
assert.doesNotMatch(migration, /axios\s*\(/);
assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
assert.doesNotMatch(migration, /github_rest_api_unsupported_path/);

console.log("github actions runs read dispatch tests passed");
