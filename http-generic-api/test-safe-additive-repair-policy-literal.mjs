import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/196_sprint67_safe_additive_repair_policy.sql", import.meta.url), "utf8");

assert.match(migration, /safe_additive_repair_preferred_over_omission/);
assert.match(migration, /idempotent registry guard table creation/);
assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS registry guard table/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

console.log("safe additive repair policy literal guard passed");
