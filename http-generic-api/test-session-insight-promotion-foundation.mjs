import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/256_sprint68_session_insight_promotion_foundation.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS `session_insight_promotions`"), "migration must create session insight promotion table");
assert.ok(migration.includes("CREATE OR REPLACE VIEW `v_session_insight_promotion_issues`"), "migration must create promotion diagnostics view");
assert.ok(migration.includes("promotion_hash` CHAR(64) NOT NULL"), "promotion identity must use an explicit bounded SHA-256 hash");
assert.ok(migration.includes("UNIQUE KEY `uq_session_insight_promotion_hash` (`promotion_hash`)"), "promotion hash must provide idempotent identity");
assert.ok(migration.includes("promotion_type` VARCHAR(64) NOT NULL"), "promotion types must remain dynamic rather than enum-locked");
assert.ok(!migration.includes("promotion_type` ENUM"), "promotion type must not be schema enum locked");
assert.ok(migration.includes("FOREIGN KEY (`insight_id`) REFERENCES `session_insight_candidates` (`insight_id`)"), "promotion rows must reference session insight candidates");
assert.ok(migration.includes("promotion_allowed` TINYINT(1) NOT NULL DEFAULT 0"), "runtime promotion must be explicitly gated off by default");
assert.ok(migration.includes("promotion_executor_key"), "promotion execution must require a governed executor key before runtime use");
assert.ok(migration.includes("secrets_included` TINYINT(1) NOT NULL DEFAULT 0"), "promotion rows must carry explicit no-secret flag");

for (const issueCode of [
  "promotion_without_candidate",
  "promoted_without_approval",
  "promotion_allowed_without_executor",
  "secret_flag_set_on_promotion",
  "missing_proposal_text",
]) {
  assert.ok(migration.includes(issueCode), `diagnostics must include ${issueCode}`);
}

assert.ok(!migration.includes("INSERT INTO `session_insight_promotions`"), "foundation migration must not auto-create promotion rows");
assert.ok(!migration.includes("UPDATE `session_insight_candidates` SET promotion_status = 'promoted'"), "foundation migration must not promote candidates");
assert.ok(runner.includes("256_sprint68_session_insight_promotion_foundation.sql"), "governed migration runner must register migration 256");
assert.ok(readiness.includes("256_sprint68_session_insight_promotion_foundation.sql"), "release readiness must track migration 256");

console.log("session insight promotion foundation contract passed");
