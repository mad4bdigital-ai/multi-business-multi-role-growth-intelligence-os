import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const schema = readFileSync(new URL("./schemas/github/github_rest.yaml", import.meta.url), "utf8");
const migrationName = "20260716_github_list_repository_issues_array_contract.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");

const listIssuesStart = schema.indexOf("  /repos/{owner}/{repo}/issues:\n");
const nextPath = schema.indexOf("\n  /repos/", listIssuesStart + 1);
assert.ok(listIssuesStart >= 0, "listRepositoryIssues path must exist");
const listIssuesPath = schema.slice(listIssuesStart, nextPath > listIssuesStart ? nextPath : undefined);
const getOperationEnd = listIssuesPath.indexOf("\n    post:");
const listIssuesOperation = listIssuesPath.slice(0, getOperationEnd > 0 ? getOperationEnd : undefined);

assert.match(listIssuesOperation, /operationId: listRepositoryIssues/);
assert.match(listIssuesOperation, /'200':\n\s+description: Success/);
assert.match(listIssuesOperation, /schema:\n\s+type: array\n\s+items:\n\s+\$ref: '#\/components\/schemas\/Issue'/);
assert.doesNotMatch(listIssuesOperation, /schema:\n\s+\$ref: '#\/components\/schemas\/Issue'/);

for (const marker of [
  "UPDATE endpoints",
  "ACT-GH-REST-023",
  "github_api_mcp",
  "github_list_repository_issues",
  "$.responses.200.content.\"application/json\".schema",
  "'type', 'array'",
  "'items', JSON_OBJECT",
  "'additionalProperties', TRUE",
]) {
  assert.ok(migration.includes(marker), `migration missing ${marker}`);
}
assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
assert.doesNotMatch(migration, /private_key|refresh_token|client_secret|access_token|value_ciphertext/i);

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

const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));

console.log("GitHub list-repository-issues array contract tests passed.");
