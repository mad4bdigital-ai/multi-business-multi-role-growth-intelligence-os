import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const apiRoot = path.resolve(import.meta.dirname);
const repoRoot = path.resolve(apiRoot, "..");
const manifestPath = path.join(apiRoot, "config", "staging-database-role-migration-manifest.json");
const generatorPath = path.join(apiRoot, "scripts", "build-staging-schema-bundle.mjs");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const generator = fs.readFileSync(generatorPath, "utf8");
const baselineSchema = fs.readFileSync(path.join(apiRoot, "schema.sql"), "utf8");
const expectedCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();

function runPlan() {
  return spawnSync(process.execPath, [generatorPath, "--expected-commit", expectedCommit, "--plan"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("schema bundle manifest declares exactly three isolated roles", () => {
  assert.equal(manifest.contract, "mad4b.staging.database-role-migration-manifest.v1");
  assert.deepEqual(Object.keys(manifest.roles).sort(), ["governance", "runtime", "runtime_persistence"]);
  assert.deepEqual(manifest.validation.required_bundle_files.sort(), [
    "governance.schema.sql.gz",
    "persistence.schema.sql.gz",
    "runtime.schema.sql.gz",
  ]);
  assert.equal(manifest.source.production_access_forbidden, true);
  assert.equal(manifest.source.provider_access_forbidden, true);
  assert.equal(manifest.safety.schema_only, true);
  assert.equal(manifest.safety.data_copy_forbidden, true);
  assert.equal(manifest.source.baseline_schema, "http-generic-api/schema.sql");
  assert.equal(manifest.source.ordering, "baseline_schema_then_lexicographic_filename");
  assert.equal(manifest.source.baseline_foreign_key_policy, "defer_baseline_fk_create_statements_until_after_migrations");
  assert.equal(manifest.validation.baseline_foreign_key_ordering_required, true);
  assert.deepEqual(manifest.validation.required_endpoints_baseline_columns, ["child_openai_schema_file_id"]);
  assert.deepEqual(manifest.validation.required_validation_repair_baseline_columns, ["validation_type", "repair_action", "repair_status", "priority"]);
  assert.equal(manifest.validation.required_runtime_table_census.length, 18);
  assert.deepEqual(manifest.validation.required_runtime_support_tables, ["connected_systems", "platform_contract_surfaces", "tenant_secrets", "platform_secrets", "secret_references", "credential_bindings", "admin_platform_endpoint_tools", "tenant_platform_endpoint_tools", "customer_sessions", "gpt_session_turns"]);
  assert.equal(manifest.canonical_seed_lifecycle.contract, "mad4b.staging.canonical-seed-manifest.v1");
  assert.deepEqual(manifest.canonical_seed_lifecycle.seed_files, [
    "039_sprint43_data_integrity_and_missing_tables.sql",
    "1043_sprint69_dynamic_container_hvac_activity_seed.sql",
    "20260815_custom_gpt_mcp_catalog_levels.sql",
  ]);
  assert.deepEqual(manifest.canonical_seed_lifecycle.mcp_catalog_required_columns, [
    "admin_platform_endpoint_tools.mcp_catalog_level",
    "tenant_platform_endpoint_tools.mcp_catalog_level",
  ]);
  for (const table of ["business_activity_types", "business_type_profiles", "brand_paths"]) {
    const quote = String.fromCharCode(96);
    assert.match(baselineSchema, new RegExp("CREATE TABLE IF NOT EXISTS " + quote + table + quote, "i"));
  }
  assert.match(baselineSchema, /CREATE TABLE IF NOT EXISTS `workflows`/i);
  assert.match(baselineSchema, /CREATE TABLE IF NOT EXISTS `platform_contract_surfaces`/i);
  assert.match(baselineSchema, /CREATE TABLE IF NOT EXISTS `tenant_secrets`/i);
  assert.match(baselineSchema, /CREATE TABLE IF NOT EXISTS `platform_secrets`/i);
  assert.deepEqual(manifest.validation.required_platform_contract_surfaces_baseline_columns, [
    "surface_id", "surface_name", "surface_type", "file_id", "folder_id", "surface_scope",
    "active_status", "authority_status", "runtime_consumption_status", "current_runtime_adapter",
  ]);
});

test("baseline actions schema covers the full migration column contract", () => {
  const quote = String.fromCharCode(96);
  const requiredColumns = [
    "action_id", "action_title", "action_class", "action_scope", "endpoint_group", "route_target",
    "execution_layer", "logging_target", "inventory_role", "admin_only", "client_allowed", "team_allowed",
    "review_required", "provider_agnostic", "request_envelope_required", "structured_api_supported", "writeback_scope",
    "secret_store_ref", "openai_schema_file_name", "openai_schema_ref", "openai_schema_storage_surface",
    "oauth_config_ref", "oauth_client_id_ref", "oauth_client_secret_ref", "oauth_binding_status",
    "runtime_binding_profile", "schema_json", "import_job_id", "schema_imported_at",
  ];
  for (const column of requiredColumns) {
    assert.equal(baselineSchema.includes(`${quote}${column}${quote}`), true, `actions baseline missing ${column}`);
  }
  const migration022 = fs.readFileSync(path.join(apiRoot, "migrations", "022_sprint27_makecom_integration_fix.sql"), "utf8");
  assert.match(migration022, /UPDATE `actions`/i);
  assert.match(migration022, /action_title/i);
  assert.match(migration022, /WHERE action_id/i);
});

test("baseline endpoints schema covers the pre-use migration column contract", () => {
  const quote = String.fromCharCode(96);
  for (const column of manifest.validation.required_endpoints_baseline_columns) {
    assert.equal(baselineSchema.includes(`${quote}${column}${quote}`), true, `endpoints baseline missing ${column}`);
  }
  const migration023 = fs.readFileSync(path.join(apiRoot, "migrations", "023_sprint28_schema_import.sql"), "utf8");
  assert.match(migration023, /ALTER TABLE `endpoints`/i);
  assert.match(migration023, /AFTER `child_openai_schema_file_id`/i);
});

test("baseline validation_repair schema covers the pre-use migration 040 contract", () => {
  const quote = String.fromCharCode(96);
  for (const column of manifest.validation.required_validation_repair_baseline_columns) {
    assert.equal(baselineSchema.includes(`${quote}${column}${quote}`), true, `validation_repair baseline missing ${column}`);
  }
  const migration039 = fs.readFileSync(path.join(apiRoot, "migrations", "039_sprint43_data_integrity_and_missing_tables.sql"), "utf8");
  const migration040 = fs.readFileSync(path.join(apiRoot, "migrations", "040_sprint44_expand_surfaces_and_repair_schema.sql"), "utf8");
  assert.match(migration039, /CREATE TABLE IF NOT EXISTS `validation_repair`/i);
  assert.match(migration039, /validation_type/i);
  assert.match(migration039, /repair_action/i);
  assert.match(migration039, /repair_status/i);
  assert.match(migration039, /priority/i);
  assert.match(migration040, /AFTER `validation_type`/i);
  assert.match(migration040, /AFTER `repair_status`/i);
  assert.match(migration040, /AFTER `repair_action`/i);
});

test("platform contract surfaces baseline exists before migration 041 and covers the runtime contract", () => {
  const quote = String.fromCharCode(96);
  for (const column of manifest.validation.required_platform_contract_surfaces_baseline_columns) {
    assert.equal(baselineSchema.includes(`${quote}${column}${quote}`), true, `platform_contract_surfaces baseline missing ${column}`);
  }
  const migration041 = fs.readFileSync(path.join(apiRoot, "migrations", "041_sprint44b_knowledge_surface_enforcement.sql"), "utf8");
  assert.match(migration041, /ALTER TABLE `platform_contract_surfaces`/i);
  assert.match(migration041, /ADD COLUMN IF NOT EXISTS `business_type_scope`/i);
  assert.match(migration041, /AFTER `surface_scope`/i);
  assert.match(migration041, /UPDATE `platform_contract_surfaces`/i);
});

test("secret storage baselines exist before migration 058 and cover runtime contracts", () => {
  const quote = String.fromCharCode(96);
  for (const [table, columns] of [
    ["tenant_secrets", manifest.validation.required_tenant_secrets_baseline_columns],
    ["platform_secrets", manifest.validation.required_platform_secrets_baseline_columns],
  ]) {
    assert.match(baselineSchema, new RegExp("CREATE TABLE IF NOT EXISTS " + quote + table + quote, "i"));
    for (const column of columns) assert.equal(baselineSchema.includes(`${quote}${column}${quote}`), true, `${table} baseline missing ${column}`);
  }
  const migration057 = fs.readFileSync(path.join(apiRoot, "migrations", "057_sprint53_credential_binding_bridge.sql"), "utf8");
  const migration058 = fs.readFileSync(path.join(apiRoot, "migrations", "058_sprint53b_non_env_secret_storage.sql"), "utf8");
  assert.match(migration057, /CREATE TABLE IF NOT EXISTS `credential_bindings`/i);
  assert.match(migration058, /ALTER TABLE `tenant_secrets`/i);
  assert.match(migration058, /ALTER TABLE `platform_secrets`/i);
  assert.match(migration058, /INSERT INTO `tenant_secrets`/i);
  assert.match(migration058, /INSERT INTO `platform_secrets`/i);
});

test("local connector migration reconciles legacy table shape before tunnel seed", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const migration017 = fs.readFileSync(path.join(migrationsDir, "017_sprint21_output_sink_router.sql"), "utf8");
  const migration030 = fs.readFileSync(path.join(migrationsDir, "030_sprint33_local_connector_tables.sql"), "utf8");
  const migration032 = fs.readFileSync(path.join(migrationsDir, "032_sprint35_local_connector_seed.sql"), "utf8");
  assert.match(migration017, /CREATE TABLE IF NOT EXISTS `local_connector_user_configs`/i);
  assert.match(migration030, /ALTER TABLE `local_connector_user_configs`/i);
  assert.match(migration030, /ADD COLUMN IF NOT EXISTS `tunnel_url`/i);
  assert.match(migration030, /AFTER `device_id`/i);
  assert.match(migration032, /INSERT IGNORE INTO `local_connector_user_configs`/i);
  assert.match(migration032, /config_id, user_id, tenant_id, device_id, tunnel_url, connector_secret, is_enabled/i);
  assert.ok(["017_sprint21_output_sink_router.sql", "030_sprint33_local_connector_tables.sql", "032_sprint35_local_connector_seed.sql"].every((file, index, files) => index === 0 || files[index - 1] < file));
});

test("role manifest prevents runtime ownership of governance and persistence tables", () => {
  const runtimeExcluded = new Set(manifest.roles.runtime.excluded_tables);
  for (const table of manifest.roles.governance.required_tables) assert.equal(runtimeExcluded.has(table), true, `runtime must exclude governance table ${table}`);
  for (const table of manifest.roles.runtime_persistence.required_tables) assert.equal(runtimeExcluded.has(table), true, `runtime must exclude persistence table ${table}`);
});

test("generator requires exact confirmation and emits schema-only no-provider contract", () => {
  assert.equal(manifest.safety.confirmation, "BUILD_STAGING_SCHEMA_BUNDLE");
  assert.match(generator, /mariadb-dump/);
  assert.match(generator, /--no-data/);
  assert.match(generator, /production_accessed: false/);
  assert.match(generator, /provider_accessed: false/);
  assert.match(generator, /data_exported: false/);
  assert.match(generator, /const stdinFlag = options\.input === undefined \? \[\] : \["-i"\]/);
  assert.ok(generator.includes(String.raw`const baselineSchemaPath = path.join(apiRoot, "schema.sql")`));
  assert.ok(generator.includes(String.raw`applyMigrations(baseline, rows)`));
  assert.ok(generator.includes(String.raw`deferred_foreign_key_sql`));
  assert.ok(generator.includes(String.raw`result.stdout.split(/\r?\n/)`));
  assert.ok(generator.includes(String.raw`line.split("\t")`));
  assert.ok(generator.includes(String.raw`/^\s*GRANT\b/imu`));
  assert.ok(!generator.includes(String.raw`/\\bGRANT\\b/iu`));
  assert.doesNotMatch(generator, /migrate-platform-tables\.mjs/);
  assert.match(generator, /canonicalSeedPlan/);
  assert.match(generator, /required_runtime_table_census/);
  assert.match(generator, /mcp_catalog_required_columns/);
  assert.match(generator, /required_actions_baseline_columns/);
  assert.match(generator, /required_endpoints_baseline_columns/);
  assert.match(generator, /required_validation_repair_baseline_columns/);
  assert.match(generator, /endpoints baseline column contract is incomplete/);
  assert.match(generator, /validation_repair baseline column contract is incomplete/);
  assert.match(generator, /required_platform_contract_surfaces_baseline_columns/);
  assert.match(generator, /platform_contract_surfaces baseline column contract is incomplete/);
  assert.match(generator, /required_tenant_secrets_baseline_columns/);
  assert.match(generator, /required_platform_secrets_baseline_columns/);
  assert.match(generator, /tenant_secrets baseline column contract is incomplete/);
  assert.match(generator, /platform_secrets baseline column contract is incomplete/);
});

test("generator plan-only mode inventories the exact migration chain", () => {
  const result = runPlan();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.plan_only, true);
  assert.equal(plan.expected_commit, expectedCommit.toLowerCase());
  assert.equal(plan.baseline_schema.file, "schema.sql");
  assert.equal(plan.baseline_schema.sha256.length, 64);
  assert.equal(plan.baseline_schema.deferred_foreign_key_statement_count, 1);
  assert.deepEqual(plan.baseline_schema.deferred_foreign_key_tables, ["user_credentials"]);
  assert.deepEqual(plan.baseline_schema.required_actions_baseline_columns.sort(), manifest.validation.required_actions_baseline_columns.slice().sort());
  assert.deepEqual(plan.baseline_schema.required_endpoints_baseline_columns.sort(), manifest.validation.required_endpoints_baseline_columns.slice().sort());
  assert.deepEqual(plan.baseline_schema.required_validation_repair_baseline_columns.sort(), manifest.validation.required_validation_repair_baseline_columns.slice().sort());
  assert.deepEqual(plan.baseline_schema.required_platform_contract_surfaces_baseline_columns.sort(), manifest.validation.required_platform_contract_surfaces_baseline_columns.slice().sort());
  assert.deepEqual(plan.baseline_schema.required_tenant_secrets_baseline_columns.sort(), manifest.validation.required_tenant_secrets_baseline_columns.slice().sort());
  assert.deepEqual(plan.baseline_schema.required_platform_secrets_baseline_columns.sort(), manifest.validation.required_platform_secrets_baseline_columns.slice().sort());
  assert.equal(plan.migration_count, 783);
  assert.equal(plan.confirmation_required, "BUILD_STAGING_SCHEMA_BUNDLE");
  assert.deepEqual(plan.canonical_seed_lifecycle.seed_files.map((entry) => entry.file), [
    "039_sprint43_data_integrity_and_missing_tables.sql",
    "1043_sprint69_dynamic_container_hvac_activity_seed.sql",
    "20260815_custom_gpt_mcp_catalog_levels.sql",
  ]);
  assert.equal(plan.canonical_seed_lifecycle.readback_required, true);
});
