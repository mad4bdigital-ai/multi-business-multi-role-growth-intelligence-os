import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/315_sprint69_capability_vault_record_tool_export.sql", "utf8");
const routes = readFileSync("routes/platformPrivateCapabilityVaultRoutes.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert.match(migration, /platform_capability_vault_repo_ingestion_record/);
assert.match(migration, /\/platform\/capability-vault\/repo-ingestion-record/);
assert.match(migration, /additionalProperties\\?\"?:false|additionalProperties\":false/);
assert.match(migration, /confirm_record_only/);
assert.match(migration, /const\":true/);
assert.match(migration, /maxItems\":5000/);
assert.match(migration, /ptdb_capability_vault_repo_ingestion_record/);
assert.match(migration, /capability_vault_record_only_same_cycle_v1/);
assert.match(migration, /transactional_guarded/);
assert.match(migration, /executes_source_assets', FALSE/);
assert.match(migration, /installs_source_assets', FALSE/);
assert.match(migration, /grants_dispatch_or_apply', FALSE/);
assert.match(migration, /secrets_included', FALSE/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
assert.match(routes, /repo-ingestion-record/);
assert.match(routes, /recordRepoIngestionPlan/);
assert.match(openapi, /operationId: platformCapabilityVaultRepoIngestionRecord/);
assert.match(openapi, /x-openai-isConsequential: true/);

console.log("capability vault record tool export contracts passed");