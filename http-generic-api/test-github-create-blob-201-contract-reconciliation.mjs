import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("./schemas/github/github_rest.yaml", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/20260628_github_create_blob_201_contract_reconciliation.sql", import.meta.url), "utf8");

const createBlobStart = schema.indexOf("  /repos/{owner}/{repo}/git/blobs:\n");
const nextPath = schema.indexOf("\n  /repos/", createBlobStart + 1);
assert.ok(createBlobStart >= 0, "createBlob path must exist");
const createBlobOperation = schema.slice(createBlobStart, nextPath > createBlobStart ? nextPath : undefined);

assert.match(createBlobOperation, /operationId: createBlob/);
assert.match(createBlobOperation, /'201':\n\s+description: Blob created/);
assert.match(createBlobOperation, /required:\n\s+- sha\n\s+- url/);
assert.match(createBlobOperation, /pattern: '\^\[0-9a-fA-F\]\{40\}\$'/);
assert.match(createBlobOperation, /format: uri/);

assert.match(migration, /WHERE endpoint_id = 'ACT-GH-REST-029'/);
assert.match(migration, /parent_action_key = 'github_api_mcp'/);
assert.match(migration, /endpoint_key = 'github_create_blob'/);
assert.match(migration, /'\$\.responses\.201'/);
assert.match(migration, /'description', 'Blob created'/);
assert.match(migration, /'required', JSON_ARRAY\('sha', 'url'\)/);
assert.match(migration, /'pattern', '\^\[0-9a-fA-F\]\{40\}\$'/);
assert.match(migration, /'format', 'uri'/);
assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `missing safety marker ${marker}`);
}

console.log("GitHub create-blob 201 contract reconciliation tests passed.");
