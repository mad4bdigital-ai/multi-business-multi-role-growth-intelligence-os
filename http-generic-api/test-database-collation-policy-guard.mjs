import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DATABASE_COLLATION_POLICY,
  assessDatabaseCollationPolicyMigrationContract,
  databaseCollationPolicyReadbackQuery,
  inspectDatabaseCollationPolicy,
} from "./databaseCollationPolicyGuard.js";

const migrationName = "198_sprint67_database_collation_policy_guard.sql";
const migrationSql = await readFile(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");

assert.equal(DATABASE_COLLATION_POLICY.target_character_set, "utf8mb4");
assert.equal(DATABASE_COLLATION_POLICY.target_collation, "utf8mb4_unicode_ci");
assert.equal(DATABASE_COLLATION_POLICY.blocking, true);

const valid = assessDatabaseCollationPolicyMigrationContract({ migrationName, sql: migrationSql });
assert.equal(valid.status, "pass");
assert.deepEqual(valid.missing_fragments, []);
assert.equal(valid.secret_field_mentioned, false);

const wrongFile = assessDatabaseCollationPolicyMigrationContract({
  migrationName: "209_unreviewed.sql",
  sql: migrationSql,
});
assert.equal(wrongFile.status, "not_applicable");

const tampered = assessDatabaseCollationPolicyMigrationContract({
  migrationName,
  sql: migrationSql.replaceAll("utf8mb4_unicode_ci", "utf8mb4_general_ci"),
});
assert.equal(tampered.status, "fail");
assert.ok(tampered.missing_fragments.includes("utf8mb4_unicode_ci"));

const secretMention = assessDatabaseCollationPolicyMigrationContract({
  migrationName,
  sql: `${migrationSql}\n-- encrypted_credentials must never be altered`,
});
assert.equal(secretMention.status, "fail");
assert.equal(secretMention.secret_field_mentioned, true);

const queryContract = databaseCollationPolicyReadbackQuery();
assert.match(queryContract.sql, /v_database_collation_policy_status/);
assert.deepEqual(queryContract.params, [DATABASE_COLLATION_POLICY.policy_key]);

const ready = await inspectDatabaseCollationPolicy({
  async query(sql, params) {
    assert.match(sql, /v_database_collation_policy_status/);
    assert.deepEqual(params, [DATABASE_COLLATION_POLICY.policy_key]);
    return [[{
      policy_key: DATABASE_COLLATION_POLICY.policy_key,
      target_character_set: "utf8mb4",
      target_collation: "utf8mb4_unicode_ci",
      policy_status: "active",
      blocking: 1,
      actionable_violation_count: 0,
      observed_at: "2026-08-13T00:00:00.000Z",
    }]];
  },
});
assert.equal(ready.ready, true);
assert.equal(ready.readback_performed, true);

const blocked = await inspectDatabaseCollationPolicy({
  async query() {
    return [[{
      policy_key: DATABASE_COLLATION_POLICY.policy_key,
      target_character_set: "utf8mb4",
      target_collation: "utf8mb4_unicode_ci",
      policy_status: "active",
      blocking: 1,
      actionable_violation_count: 2,
    }]];
  },
});
assert.equal(blocked.ready, false);
assert.equal(blocked.status, "blocked");
assert.equal(blocked.actionable_violation_count, 2);

await assert.rejects(
  inspectDatabaseCollationPolicy(),
  (error) => error?.code === "DATABASE_COLLATION_POLICY_READBACK_UNAVAILABLE" && error?.status === 503,
);

console.log("database collation policy guard tests passed");
