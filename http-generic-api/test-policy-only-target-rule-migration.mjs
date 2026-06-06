import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/202_sprint67_policy_only_runtime_policy_target_rules.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert.match(migration, /policy_only_execution_policy_target_/);
assert.match(migration, /policy_only_execution_policy_rule_/);
assert.match(migration, /runtime_policy_target_rule/);
assert.match(migration, /execution_policies remains enforcement source/i);
assert.match(migration, /cutover_enabled',false/);
assert.match(migration, /WHERE c\.classification = 'policy_without_legacy_logic_mirror'/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.match(runner, /202_sprint67_policy_only_runtime_policy_target_rules\.sql/);
assert.match(readiness, /202_sprint67_policy_only_runtime_policy_target_rules\.sql/);

console.log("policy-only target rule migration guard passed");
