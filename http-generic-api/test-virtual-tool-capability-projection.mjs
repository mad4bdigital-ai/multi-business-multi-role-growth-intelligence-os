import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/20260717_virtual_tool_capability_projection.sql", import.meta.url), "utf8");
assert.match(migration, /v_platform_virtual_tool_capabilities_current/);
assert.match(migration, /CAPABILITY_AMBIGUOUS/);
assert.match(migration, /apply_allowed,0/);
assert.doesNotMatch(migration, /\bDROP\s+(TABLE|DATABASE)|\bTRUNCATE\s+TABLE|\bDELETE\s+FROM/i);
console.log("virtual tool capability projection tests passed");
