import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("./migrations/316_sprint69_database_lifecycle_registry_upsert_admin_tool.sql", import.meta.url),
  "utf8"
);
const adminRoutes = fs.readFileSync(
  new URL("./routes/adminCliRoutes.js", import.meta.url),
  "utf8"
);
const upsertScript = fs.readFileSync(
  new URL("./scripts/database-table-lifecycle-registry-upsert.mjs", import.meta.url),
  "utf8"
);
const governedRunner = fs.readFileSync(
  new URL("./scripts/governed-migration-runner.mjs", import.meta.url),
  "utf8"
);
const lifecycleModule = fs.readFileSync(
  new URL("./databaseTableLifecycle.js", import.meta.url),
  "utf8"
);

const toolKey = "database_table_lifecycle_registry_upsert";
const migrationFile = "316_sprint69_database_lifecycle_registry_upsert_admin_tool.sql";

assert(migration.includes(`'${toolKey}'`), "migration must register the lifecycle registry upsert tool");
assert(migration.includes("'/admin/control'"), "tool must dispatch through governed admin control");
assert(migration.includes("'additionalProperties',false"), "tool input schema must reject unknown fields");
assert(migration.includes("'maxItems',6"), "tool must bound shell arguments");
assert(migration.includes("governed_migration_authorization_registry"), "migration must persist its authorization row");
assert(migration.includes("'allow_apply',") || migration.includes("allow_apply"), "migration authorization must declare apply policy");
assert(migration.includes("bootstrap_authorization_required_for_first_apply"), "migration must document first-apply bootstrap authorization");
for (const marker of [
  "no_provider_call true",
  "no_credential_payload_read true",
  "no_raw_secrets true",
  "no_external_send true",
  "no_external_write true",
  "secrets_included=false",
]) {
  assert(migration.includes(marker), `migration must include explicit safety marker: ${marker}`);
}
assert(!/^\s*(DROP\b|TRUNCATE\b|DELETE\s+FROM\b|ALTER\s+TABLE\b[^;]*\bDROP\b)/im.test(migration), "migration must not contain destructive SQL");

assert(adminRoutes.includes(`${toolKey}: {`), "admin shell alias must be registered");
assert(adminRoutes.includes('args: ["http-generic-api/scripts/database-table-lifecycle-registry-upsert.mjs"]'), "alias must point to the governed lifecycle upsert script");
assert(adminRoutes.includes("max_extra_args: 6"), "alias must bound extra arguments");

assert(lifecycleModule.includes('APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT'), "missing-only apply must require the exact confirmation token");
assert(lifecycleModule.includes('APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_REFRESH_EXISTING'), "existing-row refresh must require a separate confirmation token");
assert(upsertScript.includes("includeExisting: false"), "missing-only must remain the default selection mode");
assert(upsertScript.includes("remaining_missing_count"), "apply must expose missing-row readback count");
assert(upsertScript.includes("readback.selected_table_count === 0"), "apply must verify zero remaining missing rows");
assert(upsertScript.includes("DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT_READBACK_FAILED"), "failed readback must use a stable error code");
assert(governedRunner.includes(`"${migrationFile}"`), "governed migration runner must allowlist migration 316");

console.log(JSON.stringify({
  ok: true,
  test: "database_lifecycle_registry_admin_tool",
  tool_key: toolKey,
  migration_file: migrationFile,
  dry_run_default: true,
  separate_refresh_confirmation: true,
  same_cycle_readback: true,
  destructive_sql: false,
  secrets_included: false,
}, null, 2));
