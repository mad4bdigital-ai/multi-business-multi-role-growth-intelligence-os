import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("./migrations/20260629_sql_cache_admin_tool_export.sql", import.meta.url),
  "utf8"
);
const runner = await readFile(
  new URL("./scripts/governed-migration-runner.mjs", import.meta.url),
  "utf8"
);
const openapi = await readFile(
  new URL("./openapi/sql-cache-policy.yaml", import.meta.url),
  "utf8"
);

assert.match(migration, /'sql_cache_runtime_policy_get'/);
assert.match(migration, /'GET',\s*'\/admin\/cache\/sql-policy'/);
assert.match(migration, /read_only,diagnostics,no_secrets/);
assert.match(migration, /'sql_cache_runtime_policy_update'/);
assert.match(migration, /'PATCH',\s*'\/admin\/cache\/sql-policy'/);
assert.match(migration, /state_changing,dry_run_default,revision_guard,readback,no_secrets/);
assert.match(migration, /ON DUPLICATE KEY UPDATE/);
assert.match(runner, /20260629_sql_cache_admin_tool_export\.sql/);
assert.match(openapi, /x-registry-tool-key:\s*sql_cache_runtime_policy_get/);
assert.match(openapi, /x-registry-tool-key:\s*sql_cache_runtime_policy_update/);
assert.doesNotMatch(migration, /auto_promote\s*=\s*1/i);

console.log("SQL cache Admin tool export contract tests passed.");
