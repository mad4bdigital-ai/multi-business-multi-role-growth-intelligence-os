import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const schema = readFileSync(new URL("./schemas/github/github_rest.yaml", import.meta.url), "utf8");
const activeMigrationName = "20260716_github_list_repository_issues_array_contract.sql";
const activeMigration = readFileSync(new URL(`./migrations/${activeMigrationName}`, import.meta.url), "utf8");
const reconciliationMigrationName = "20260717_runtime_contract_root_cause_reconciliation.sql";
const reconciliationMigration = readFileSync(new URL(`./migrations/${reconciliationMigrationName}`, import.meta.url), "utf8");
const verifyRuntime = readFileSync(new URL("./verify-runtime.mjs", import.meta.url), "utf8");
const activationRoutes = readFileSync(new URL("./routes/activationRoutes.js", import.meta.url), "utf8");

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
  assert.ok(activeMigration.includes(marker), `active migration missing ${marker}`);
}

for (const marker of [
  "admin_hostinger",
  "$.properties.connection_id",
  "d43275c7-2e41-4686-9c32-b3fff36efb7d",
  "activation_session_context_read_only",
  "/activation/session-context/read-only",
  "listRepositoryIssues",
  "status = 'archived'",
  "superseded_by_github_list_repository_issues",
  "github_get_git_blob_chunk",
  "degraded_contract_proxy_path_misrouted",
  "$.responses.200.content.\"application/json\".schema",
  "'type', 'array'",
]) {
  assert.ok(reconciliationMigration.includes(marker), `reconciliation migration missing ${marker}`);
}

assert.match(activationRoutes, /\/session-context\/read-only/);
assert.match(verifyRuntime, /function isBotVerificationResponse\(response\)/);
assert.doesNotMatch(verifyRuntime, /return response\?\.status === 403 && \(/);
assert.match(verifyRuntime, /bot_challenge_attempts/);
assert.match(verifyRuntime, /250 \* attempt/);

for (const [migrationName, migration] of [
  [activeMigrationName, activeMigration],
  [reconciliationMigrationName, reconciliationMigration],
]) {
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
    assert.ok(migration.includes(marker), `${migrationName} missing safety marker ${marker}`);
  }

  const preflight = assessMigrationSqlPreflight(migrationName, migration);
  assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
  assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
  assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));
}

console.log("Runtime contract root-cause reconciliation tests passed.");
