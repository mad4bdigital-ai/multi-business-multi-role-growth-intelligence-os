import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/251_sprint68_dynamic_memory_scope_types.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS `memory_scope_type_registry`"), "migration must create a governed dynamic scope registry");
assert.ok(migration.includes("PRIMARY KEY (`scope_type`)"), "scope registry must be keyed by scope_type");
assert.ok(migration.includes("MODIFY COLUMN `subject_type` VARCHAR(64) NOT NULL"), "json_asset_subject_links.subject_type must move away from closed enum");
assert.ok(!migration.includes("MODIFY COLUMN `subject_type` ENUM"), "new subject_type migration must not reintroduce enum locking");
assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS `scope_registry_status`"), "subject links must record registry status for readback diagnostics");
assert.ok(migration.includes("ON DUPLICATE KEY UPDATE"), "scope seed must be safely repeatable");

for (const scopeType of [
  "'platform'",
  "'tenant'",
  "'user'",
  "'brand'",
  "'workflow'",
  "'module'",
  "'conversation'",
  "'execution_trace'",
  "'workspace'",
  "'business_activity_type'",
  "'activity_type'",
  "'role'",
  "'assistance_role'",
  "'policy'",
  "'logic'",
  "'logic_pack'",
  "'engine'",
  "'plugin'",
  "'task_route'",
  "'action'",
  "'endpoint'",
  "'knowledge_profile'",
  "'resource'",
]) {
  assert.ok(migration.includes(scopeType), `dynamic scope registry must seed ${scopeType}`);
}

assert.ok(migration.includes("JSON_OBJECT('legacy_enum_value', true)"), "legacy enum values must be explicitly identified");
assert.ok(migration.includes("JSON_OBJECT('dynamic_scope', true)"), "new extensible scopes must be identified as dynamic");
assert.ok(migration.includes("LEFT JOIN `memory_scope_type_registry`"), "existing subject links must be backfilled against registry status");
assert.ok(migration.includes("scope_registry_status = CASE"), "existing links must be classified as registered or unregistered");
assert.ok(runner.includes("251_sprint68_dynamic_memory_scope_types.sql"), "governed migration runner must register migration 251");
assert.ok(readiness.includes("251_sprint68_dynamic_memory_scope_types.sql"), "release readiness must track migration 251");

console.log("dynamic memory scope type registry contract passed");
