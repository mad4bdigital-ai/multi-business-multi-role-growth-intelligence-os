import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/1025_sprint69_github_ref_dispatch_catalog_persistence.sql", import.meta.url),
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

for (const endpointKey of ["github_get_git_ref_head", "github_get_reference"]) {
  assert.match(migration, new RegExp(endpointKey));
  assert.match(migration, new RegExp(`JSON_QUOTE\\('${endpointKey}'\\)`));
  assert.match(migration, new RegExp(`'${endpointKey}'`));
}

assert.match(migration, /'github_rest_endpoint_dispatch'/);
assert.match(migration, /admin_platform_endpoint_tools/);
assert.match(migration, /platform_endpoint_tool_exports/);
assert.match(migration, /platform_tool_dispatch_bindings/);
assert.match(migration, /JSON_ARRAY_APPEND/);
assert.match(migration, /'\$\.properties\.tool_args\.properties\.endpoint_key\.enum'/);
assert.match(migration, /'\$\.properties\.tool_args\.properties\.path_params\.properties\.branch'/);
assert.match(migration, /'\$\.properties\.tool_args\.properties\.path_params\.properties\.ref'/);
assert.match(migration, /'\^\[A-Za-z0-9\._\/-\]\+\$'/);
assert.match(migration, /'github_api_mcp__'/);
assert.match(migration, /'github_git_ref_read'/);
assert.match(migration, /'github_git_ref_readback_v1'/);
assert.match(migration, /'github_git_ref_head_read'/);
assert.match(migration, /'github_git_reference_read'/);
assert.match(migration, /'runtime_endpoint_call'/);
assert.match(migration, /'http_generic_api'/);
assert.match(migration, /'method_and_path_from_endpoints_only',TRUE/);
assert.match(migration, /'read_only_endpoint',TRUE/);
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

console.log("github ref dispatch catalog persistence tests passed");
