import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/194_sprint66_admin_tool_registry_updated_at_column.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const readiness = readFileSync("releaseReadiness.js", "utf8");
const docs = readFileSync("../docs/admin-tool-registry-updated-at-column-2026-06-05.md", "utf8");

assert(migration.includes("ALTER TABLE admin_platform_endpoint_tools"), "migration must target admin tool registry");
assert(migration.includes("ADD COLUMN IF NOT EXISTS updated_at"), "migration must be idempotent");
assert(migration.includes("ON UPDATE CURRENT_TIMESTAMP"), "updated_at should refresh on registry row updates");
assert(!/DROP\s+/i.test(migration));
assert(!/DELETE\s+/i.test(migration));
assert(!/TRUNCATE\s+/i.test(migration));
assert(!/UPDATE\s+admin_platform_endpoint_tools/i.test(migration), "column migration should not mutate registry rows");

assert(runner.includes("194_sprint66_admin_tool_registry_updated_at_column.sql"), "runner must allow migration 194");
assert(readiness.includes("194_sprint66_admin_tool_registry_updated_at_column.sql"), "readiness must expect migration 194");
assert(docs.includes("operational freshness"), "docs must explain practical value");
assert(docs.includes("No destructive SQL"), "docs must cover safety");

console.log("admin tool registry updated_at migration contract tests passed");
