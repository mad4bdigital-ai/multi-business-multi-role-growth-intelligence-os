import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/196_sprint66_admin_tool_registry_tags_text.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const readiness = readFileSync("releaseReadiness.js", "utf8");
const docs = readFileSync("../docs/admin-tool-registry-tags-text-2026-06-05.md", "utf8");

assert(migration.includes("ALTER TABLE admin_platform_endpoint_tools"), "migration must target admin tool registry");
assert(migration.includes("MODIFY COLUMN tags TEXT NULL"), "migration must widen tags to TEXT");
assert(migration.includes("connected_execution_resume_action_enqueue_dry_run"), "migration must repair the truncated connected execution tool row");
assert(migration.includes("no_local_device_call"), "migration must restore the local-device guard tag");
assert(migration.includes("no_apply"), "migration must restore the apply guard tag");
assert(migration.includes("no_secrets"), "migration must restore the no-secrets guard tag");
assert(migration.includes("updated_at = CURRENT_TIMESTAMP"), "migration must update registry freshness timestamp");
assert(!/DROP\s+/i.test(migration));
assert(!/DELETE\s+/i.test(migration));
assert(!/TRUNCATE\s+/i.test(migration));

assert(runner.includes("196_sprint66_admin_tool_registry_tags_text.sql"), "runner must allow migration 196");
assert(readiness.includes("196_sprint66_admin_tool_registry_tags_text.sql"), "readiness must expect migration 196");
assert(readiness.includes("MODIFY\\s+COLUMN\\s+`?tags`?\\s+TEXT"), "readiness preflight must allow only the narrow tags widening rule");
assert(docs.includes("VARCHAR(255)"), "docs must describe the source truncation limit");
assert(docs.includes("TEXT"), "docs must describe the widened target type");
assert(docs.includes("No secrets"), "docs must cover safety/no secrets");

console.log("admin tool registry tags text migration contract tests passed");
