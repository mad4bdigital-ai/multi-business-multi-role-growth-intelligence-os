import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migrationName = "20260810_github_issue_comment_exact_response_parity.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
const previousMigration = readFileSync(
  new URL("./migrations/20260808_github_issue_comment_dispatch_parity.sql", import.meta.url),
  "utf8",
);
const githubSchema = readFileSync(
  new URL("./schemas/github/github_rest.yaml", import.meta.url),
  "utf8",
);
const executionResponse = readFileSync(
  new URL("./executionResponse.js", import.meta.url),
  "utf8",
);

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "no_runtime_dispatch=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `missing migration safety marker ${marker}`);
}

// Canonical GitHub contract remains 201 Created for createIssueComment.
assert.match(
  githubSchema,
  /operationId: createIssueComment[\s\S]*?responses:\s*\n\s*'201':\s*\n\s*description: Created[\s\S]*?\$ref: '#\/components\/schemas\/Comment'/,
);

// The merged predecessor added 201 but did not remove a pre-existing 200 key.
assert.match(previousMigration, /JSON_SET\([\s\S]*?'\$\.responses\.201'/);
assert.doesNotMatch(previousMigration, /JSON_REMOVE\([\s\S]*?'\$\.responses\.200'/);

// The follow-up must reconcile exact status semantics without changing the
// historical predecessor migration checksum.
assert.match(migration, /JSON_REMOVE\([\s\S]*?'\$\.responses\.200'/);
assert.match(migration, /JSON_SET\([\s\S]*?'\$\.responses\.201'/);
assert.match(migration, /'description', 'Created'/);
assert.match(migration, /'type', 'object'/);
assert.match(migration, /'additionalProperties', TRUE/);
assert.match(migration, /SET @github_issue_comment_endpoint_match_count :=/);
assert.match(migration, /@github_issue_comment_endpoint_match_count = 1/);
assert.match(migration, /parent_action_key = 'github_api_mcp'/);
assert.match(migration, /endpoint_key = 'github_create_issue_comment'/);
assert.match(migration, /method = 'POST'/);
assert.ok(migration.includes("/repos/{owner}/{repo}/issues/{issue_number}/comments"));
assert.match(migration, /execution_readiness = 'ready'/);
assert.match(migration, /transport_action_key = 'http_generic_api'/);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+endpoints/i);

// Export alignment follows the exact endpoint row, but export presence is not
// used as a prerequisite for runtime schema coverage.
assert.match(migration, /UPDATE platform_endpoint_tool_exports export_row/);
assert.match(migration, /JOIN endpoints endpoint_row\s+ON endpoint_row\.id = export_row\.source_endpoint_id/);
assert.match(migration, /SET export_row\.input_schema_json = endpoint_row\.schema_json/);
assert.match(migration, /NOT \(export_row\.input_schema_json <=> endpoint_row\.schema_json\)/);

assert.match(migration, /CREATE OR REPLACE VIEW v_github_issue_comment_exact_response_parity AS/);
assert.match(migration, /legacy_response_200_count/);
assert.match(migration, /export_legacy_response_200_count/);
assert.match(migration, /legacy_response_200_count = 0/);
assert.match(migration, /export_legacy_response_200_count = 0/);
assert.match(migration, /response_201_count = 1/);
assert.match(migration, /THEN 'ready'[\s\S]*?ELSE 'blocked'/);

// General coverage begins from runtime-callable endpoints, not exports, so a
// non-exported endpoint remains visible instead of disappearing from parity
// inventory as it did under v_platform_endpoint_export_schema_parity.
assert.match(migration, /CREATE OR REPLACE VIEW v_runtime_endpoint_schema_coverage AS/);
assert.match(
  migration,
  /FROM endpoints e\s+LEFT JOIN platform_endpoint_tool_exports export_row[\s\S]*?WHERE e\.status = 'active'[\s\S]*?e\.execution_readiness = 'ready'[\s\S]*?e\.transport_action_key = 'http_generic_api'/,
);
assert.match(migration, /WHEN COUNT\(export_row\.id\) = 0 THEN 'covered_runtime_not_exported'/);
assert.match(migration, /WHEN e\.schema_json IS NULL THEN 'schema_contract_missing'/);
assert.match(migration, /JSON_EXTRACT\(e\.schema_json, '\$\.responses'\) IS NULL/);

// Preserve the post-side-effect defense already merged: this patch must not
// regress successful upstream mutation + local schema drift into a retry-safe
// failure classification.
assert.match(executionResponse, /UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED/);
assert.match(executionResponse, /retry_allowed:\s*false/);
assert.match(executionResponse, /reconciliation_required:\s*true/);
assert.match(executionResponse, /upstream_success_confirmed:\s*true/);

// Dynamic SQL is forbidden as executable SQL. Match statement boundaries so
// explanatory prose in SQL comments cannot create a false-positive regression.
assert.doesNotMatch(migration, /(?:^|;)\s*PREPARE\b/mi);
assert.doesNotMatch(migration, /(?:^|;)\s*EXECUTE\b/mi);
assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
assert.doesNotMatch(migration, /fetch\s*\(/);
assert.doesNotMatch(migration, /axios\s*\(/);
assert.doesNotMatch(migration, /private_key|refresh_token|client_secret|access_token|value_ciphertext/i);

const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));

console.log("github issue comment exact response parity tests passed");
