import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertDatabaseTableLifecycleRegistryUpsertAllowed,
  buildDatabaseTableLifecycleRegisterPlan,
  DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION,
} from "./databaseTableLifecycle.js";

const script = fs.readFileSync(
  new URL("./scripts/database-table-lifecycle-registry-upsert.mjs", import.meta.url),
  "utf8"
);

assert(script.includes("database_table_lifecycle_registry"), "script must target lifecycle registry");
assert(script.includes("ON DUPLICATE KEY UPDATE"), "script must be idempotent");
assert(script.includes("no_drop"), "script response must preserve no-drop signal");
assert(script.includes("no_archive_execution"), "script response must preserve no-archive signal");

for (const destructiveSql of [/^\s*DROP\s+TABLE\b/mi, /^\s*TRUNCATE\s+TABLE\b/mi, /^\s*DELETE\s+FROM\b/mi]) {
  assert(!destructiveSql.test(script), `lifecycle upsert script must not include destructive SQL statement ${destructiveSql}`);
}

const dryRunGate = assertDatabaseTableLifecycleRegistryUpsertAllowed({ apply: false });
assert.equal(dryRunGate.allowed, false);
assert.equal(dryRunGate.mode, "dry_run");
assert.equal(dryRunGate.required_confirmation, DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION);

assert.throws(
  () => assertDatabaseTableLifecycleRegistryUpsertAllowed({ apply: true, confirm: "WRONG" }),
  /APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT/,
  "apply must require the exact confirmation token"
);

const applyGate = assertDatabaseTableLifecycleRegistryUpsertAllowed({
  apply: true,
  confirm: DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION,
});
assert.equal(applyGate.allowed, true);
assert.equal(applyGate.mode, "apply");

const plan = buildDatabaseTableLifecycleRegisterPlan([
  {
    table_name: "platform_audit_event_bus",
    approx_rows: 0,
    size_mb: 0.078,
    column_names: ["event_id", "source_family", "status", "created_at"],
  },
]);
assert.equal(plan.dry_run, true);
assert.equal(plan.will_write, false);
assert.equal(plan.no_drop, true);
assert.equal(plan.no_archive_execution, true);
assert.equal(plan.target_table, "database_table_lifecycle_registry");
assert.equal(plan.upsert_count, 1);

console.log("database table lifecycle registry upsert tests passed");
