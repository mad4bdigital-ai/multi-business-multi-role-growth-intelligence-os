import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/1004_sprint69_growth_agent_migration_reconciliation_policy.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

for (const filename of [
  "243_sprint68_growth_intelligence_product_registry.sql",
  "244_sprint68_sequential_plan_orchestrator.sql",
  "245_sprint68_agent_governance_runtime.sql",
  "1004_sprint69_growth_agent_migration_reconciliation_policy.sql",
]) {
  assert.match(migration, new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const ruleKey of [
  "migration_reconcile_243_growth_intelligence_apply",
  "migration_reconcile_244_sequential_orchestrator_apply",
  "migration_reconcile_245_agent_governance_apply",
]) {
  assert.match(migration, new RegExp(ruleKey));
}

assert.match(migration, /governed_migration_runner_authorization_v1/);
assert.match(migration, /governed_migration_reconciliation_v1/);
assert.match(migration, /governed_migration_apply/);
assert.match(migration, /migration_preflight_pass/);
assert.match(migration, /post_apply_schema_readback/);
assert.match(migration, /execution_plan_status_enum_readback/);
assert.match(migration, /exact_file_only/);
assert.match(migration, /no_provider_calls/);
assert.match(migration, /secrets_included/);
assert.match(runner, /1004_sprint69_growth_agent_migration_reconciliation_policy\.sql/);

assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /credential_value|value_ciphertext|private_key|api[_-]?key\s*[:=]/i);

console.log("growth and agent migration reconciliation policy test passed");
