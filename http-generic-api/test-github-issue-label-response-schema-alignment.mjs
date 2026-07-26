import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/1024_sprint69_github_issue_label_response_schema_alignment.sql", import.meta.url),
  "utf8"
);

for (const endpointId of [
  "ACT-GH-REST-039",
  "ACT-GH-REST-040",
  "ACT-GH-REST-041",
]) {
  assert.ok(migration.includes(endpointId), `missing endpoint guard ${endpointId}`);
}

for (const endpointKey of [
  "github_add_issue_labels",
  "github_set_issue_labels",
  "github_remove_issue_label",
]) {
  assert.ok(migration.includes(endpointKey), `missing endpoint key ${endpointKey}`);
}

assert.match(migration, /'\$\.responses\.200\.content'/);
assert.match(migration, /'application\/json'/);
assert.match(migration, /'type', 'array'/);
assert.match(migration, /'items', JSON_OBJECT\(/);
assert.match(migration, /'additionalProperties', TRUE/);
assert.match(migration, /'required', JSON_ARRAY\('id', 'name', 'color', 'default'\)/);
assert.match(migration, /'description', JSON_OBJECT\(/);
assert.match(migration, /'anyOf', JSON_ARRAY\(/);
assert.match(migration, /UPDATE platform_endpoint_tool_exports export_row/);
assert.match(migration, /export_row\.input_schema_json = endpoint_row\.schema_json/);
assert.match(migration, /export_row\.tool_name = 'github_rest_endpoint_dispatch'/);
assert.match(migration, /export_row\.status = 'active'/);
assert.match(migration, /endpoint_row\.id = export_row\.source_endpoint_id/);

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

assert.doesNotMatch(migration, /fetch\s*\(/);
assert.doesNotMatch(migration, /axios\s*\(/);
assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
assert.equal((migration.match(/^UPDATE\s+/gmi) || []).length, 2);

console.log("GitHub issue label response schema alignment tests passed");
