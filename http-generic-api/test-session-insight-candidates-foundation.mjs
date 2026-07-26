import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/253_sprint68_session_insight_candidates_foundation.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS `session_insight_candidates`"), "migration must create session insight candidate table");
assert.ok(migration.includes("CREATE OR REPLACE VIEW `v_session_insight_candidate_issues`"), "migration must create candidate diagnostics view");
assert.ok(migration.includes("candidate_hash` CHAR(64) NOT NULL"), "candidate identity must use an explicit bounded SHA-256 hash");
assert.ok(migration.includes("UNIQUE KEY `uq_session_insight_candidate_hash` (`candidate_hash`)"), "candidate hash must provide idempotent identity");
assert.ok(migration.includes("insight_type` VARCHAR(64) NOT NULL"), "insight types must remain dynamic rather than enum-locked");
assert.ok(!migration.includes("insight_type` ENUM"), "insight types must not be locked behind a schema enum");
assert.ok(migration.includes("source_session_id"), "candidate must preserve session source pointer");
assert.ok(migration.includes("source_summary_id"), "candidate must preserve summary source pointer");
assert.ok(migration.includes("tenant_id"), "candidate must support tenant dimension");
assert.ok(migration.includes("user_id"), "candidate must support user dimension");
assert.ok(migration.includes("workspace_key"), "candidate must support workspace dimension");
assert.ok(migration.includes("suggested_scopes_json"), "candidate must allow future scope suggestions without adding columns per scope");
assert.ok(migration.includes("approval_status"), "candidate must track approval state before promotion");
assert.ok(migration.includes("promotion_status"), "candidate must track promotion state separately from approval");
assert.ok(migration.includes("secrets_included` TINYINT(1) NOT NULL DEFAULT 0"), "candidate rows must carry explicit no-secret flag");

for (const issueCode of [
  "missing_source_reference",
  "missing_title_or_statement",
  "invalid_confidence",
  "promoted_without_approval",
  "secret_flag_set_on_insight_candidate",
]) {
  assert.ok(migration.includes(issueCode), `diagnostics must include ${issueCode}`);
}

assert.ok(!migration.includes("INSERT INTO `session_insight_candidates`"), "foundation migration must not auto-create insight candidates");
assert.ok(runner.includes("253_sprint68_session_insight_candidates_foundation.sql"), "governed migration runner must register migration 253");
assert.ok(readiness.includes("253_sprint68_session_insight_candidates_foundation.sql"), "release readiness must track migration 253");

console.log("session insight candidates foundation contract passed");
