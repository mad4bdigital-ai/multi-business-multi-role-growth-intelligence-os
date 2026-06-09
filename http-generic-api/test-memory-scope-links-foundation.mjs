import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/252_sprint68_memory_scope_links_foundation.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("./sessionSummaryService.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS `memory_scope_links`"), "migration must create generic memory scope links table");
assert.ok(migration.includes("FOREIGN KEY (`scope_type`) REFERENCES `memory_scope_type_registry`"), "memory scope links must be governed by dynamic scope registry");
assert.ok(migration.includes("resource_scope_hash"), "resource/scope/linkage identity must use a bounded hash for utf8mb4-safe indexing");
assert.ok(migration.includes("UNIQUE KEY `uq_memory_scope_resource_scope` (`resource_scope_hash`)"), "resource/scope/linkage writes must be idempotent without an oversized composite key");
assert.ok(migration.includes("brand_key`"), "scope links must support brand dimensions");
assert.ok(migration.includes("activity_type_key`"), "scope links must support activity dimensions");
assert.ok(migration.includes("role_key`"), "scope links must support role dimensions");
assert.ok(migration.includes("workflow_key`"), "scope links must support workflow dimensions");
assert.ok(migration.includes("logic_key`"), "scope links must support logic dimensions");
assert.ok(migration.includes("engine_key`"), "scope links must support engine dimensions");
assert.ok(migration.includes("secrets_included` TINYINT(1) NOT NULL DEFAULT 0"), "scope links must carry explicit no-secret flag");
assert.ok(migration.includes("CREATE OR REPLACE VIEW `v_memory_scope_link_registry_issues`"), "migration must add readback diagnostics view");
assert.ok(migration.includes("unregistered_scope_type"), "diagnostics must detect unregistered scope types");
assert.ok(migration.includes("secret_flag_set_on_memory_link"), "diagnostics must detect secret-flagged links");

assert.ok(service.includes("memoryScopeLinkId"), "session summary service must produce stable dynamic memory scope link IDs");
assert.ok(service.includes("memory_scope_links"), "session summary service must write generic memory scope links");
assert.ok(service.includes("session_summary_scope_attachment"), "session summary scope links must use a stable linkage type");
assert.ok(service.includes("scope_type: \"conversation\""), "session summaries must link to conversation scope");
assert.ok(service.includes("scope_type: \"tenant\""), "session summaries must link to tenant scope");
assert.ok(service.includes("scope_type: \"user\""), "session summaries must link to user scope");
assert.ok(service.includes("scope_type: \"workspace\""), "session summaries must link to workspace scope when available");
assert.ok(service.includes("scope_type: \"brand\""), "session summaries must link to brand scope when available");
assert.ok(service.includes("secrets_included: false"), "service metadata must preserve no-secret contract");
assert.ok(runner.includes("252_sprint68_memory_scope_links_foundation.sql"), "governed migration runner must register migration 252");
assert.ok(readiness.includes("252_sprint68_memory_scope_links_foundation.sql"), "release readiness must track migration 252");

console.log("memory scope links foundation contract passed");
