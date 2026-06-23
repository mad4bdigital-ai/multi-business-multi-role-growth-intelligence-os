import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "./migrations/1024_sprint69_github_create_reference_201_contract_reconciliation.sql",
    import.meta.url
  ),
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

assert.match(migration, /UPDATE endpoints/);
assert.match(migration, /JSON_SET\(/);
assert.match(migration, /'\$\.responses\.201'/);
assert.match(migration, /'description', 'Reference created'/);
assert.match(migration, /'required', JSON_ARRAY\('ref', 'object'\)/);
assert.match(migration, /WHERE endpoint_id = 'ACT-GH-EP-011'/);
assert.match(migration, /parent_action_key = 'github_api_mcp'/);
assert.match(migration, /endpoint_key = 'github_create_branch_reference'/);

assert.equal((migration.match(/\bUPDATE endpoints\b/g) || []).length, 1);
assert.doesNotMatch(migration, /\bINSERT\s+INTO\b/i);
assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
assert.doesNotMatch(migration, /\bDROP\b/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /\bALTER\b/i);
assert.doesNotMatch(migration, /admin_platform_endpoint_tools/);
assert.doesNotMatch(migration, /platform_endpoint_tool_exports/);
assert.doesNotMatch(migration, /platform_tool_dispatch_bindings/);
assert.doesNotMatch(migration, /fetch\s*\(/);
assert.doesNotMatch(migration, /axios\s*\(/);

console.log("GitHub create-reference 201 contract reconciliation tests passed");
