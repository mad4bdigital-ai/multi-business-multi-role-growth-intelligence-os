import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/260_sprint68_platform_development_constitution_policies.sql", import.meta.url), "utf8");

assert.match(migration, /Platform Development Constitution execution policies/);
assert.match(migration, /UPDATE `execution_policies` ep\nJOIN/);
assert.match(migration, /WHERE ep\.`policy_group` IS NOT NULL/);
assert.match(migration, /AND ep\.`policy_key` IS NOT NULL/);
assert.match(migration, /secrets_included/);
assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);

console.log("Platform constitution policy update guard passed");
