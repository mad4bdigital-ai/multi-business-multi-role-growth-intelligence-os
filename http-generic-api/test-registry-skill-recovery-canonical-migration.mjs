import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/20260705_registry_skill_recovery_and_execution_log_certification.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

for (const token of [
  "platform_registry_database_recovery",
  "github_repository_recovery_adapter",
  "github_approve_workflow_run",
  "github_api_mcp__github_approve_workflow_run",
  "ptdb_github_rest_dispatch_workflow_run_approve",
  "github_rest_endpoint_dispatch",
  "execution_log_skill_grant_resolution_certified_v1",
  "agent_skill_grants",
  "runtime_dispatch_certification_registry",
  "tenant grant priority",
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

assert.match(runner, /20260705_registry_skill_recovery_and_execution_log_certification\.sql/);
assert.match(migration, /ON DUPLICATE KEY UPDATE/);
assert.match(migration, /JSON_SEARCH\(input_schema, 'one', 'github_approve_workflow_run'\)/);
assert.match(migration, /JSON_ARRAY_APPEND\(input_schema, '\$\.properties\.tool_args\.properties\.endpoint_key\.enum'/);
assert.match(migration, /WHERE a\.name IN \('admin_gpt_assistant','governed_ops_agent'\)/);
assert.doesNotMatch(migration, /\bDROP\s+TABLE\b|\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\b/i);
assert.doesNotMatch(migration, /encrypted_credentials|value_ciphertext|secret_value|token_value|private_key|api_key_value/i);

console.log("registry skill recovery canonical migration test passed");
