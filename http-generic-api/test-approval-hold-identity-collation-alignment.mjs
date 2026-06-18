import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migrationPath = new URL(
  "./migrations/1013_sprint69_approval_hold_identity_collation_alignment.sql",
  import.meta.url
);
const sql = await readFile(migrationPath, "utf8");

for (const marker of [
  "no_provider_call",
  "no_credential_payload_read",
  "no_raw_secrets",
  "no_external_send",
  "no_external_write",
  "secrets_included=false",
]) {
  assert(sql.includes(marker), `missing safety marker: ${marker}`);
}

assert(sql.includes("migration_1013_expired_orphan_hold="));
assert(sql.includes("request_status = 'pending_approval'"));
assert(sql.includes("DATE_ADD(r.created_at, INTERVAL r.ttl_hours HOUR) < UTC_TIMESTAMP()"));
assert(sql.includes("SIGNAL SQLSTATE ''45000''"));
assert(sql.includes("Active Approval Hold identity orphans remain"));
assert(sql.includes("CREATE TEMPORARY TABLE tmp_approval_hold_identity_orphans"));
assert(sql.includes("DROP TEMPORARY TABLE tmp_approval_hold_identity_orphans"));

const expectedAlterations = [
  "ALTER TABLE local_gateway_tool_call_log",
  "ALTER TABLE repository_advisory_comment_plans",
  "ALTER TABLE ticket_workflow_links",
  "ALTER TABLE approval_holds",
];
for (const statement of expectedAlterations) {
  assert(sql.includes(statement), `missing alteration: ${statement}`);
}

const applySql = sql.split("-- Align only the four mismatched varchar(36) identity columns.")[1] || "";
assert(applySql, "missing apply-section marker");
assert.equal((applySql.match(/MODIFY approval_hold_id VARCHAR\(36\)/g) || []).length, 3);
assert.equal((applySql.match(/MODIFY hold_id VARCHAR\(36\)/g) || []).length, 1);
assert.equal((applySql.match(/FROM information_schema\.columns/g) || []).length, 4);
assert.equal((applySql.match(/PREPARE align_/g) || []).length, 4);
assert.equal((applySql.match(/EXECUTE align_/g) || []).length, 4);
assert.equal((applySql.match(/DEALLOCATE PREPARE align_/g) || []).length, 4);
const preflight = assessMigrationSqlPreflight(
  "1013_sprint69_approval_hold_identity_collation_alignment.sql",
  sql
);
assert.equal(preflight.status, "pass");
assert.equal(preflight.risk_count, 0);
assert(!sql.includes("VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"));
assert(!sql.includes("VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"));
assert(sql.includes("CREATE OR REPLACE VIEW v_approval_hold_identity_collation_readiness"));
assert(sql.includes("expected_column_count = 10"));
assert(sql.includes("collation_mismatch_count"));
assert(sql.includes("orphan_reference_count"));
assert(sql.includes("approval_hold_identity_collation_v1"));
assert(sql.includes("runtime_compatibility_join_retained_until_verified"));
assert(!/DROP\s+TABLE/i.test(sql));
assert(!/DELETE\s+FROM/i.test(sql));

console.log("approval hold identity collation migration test passed");
