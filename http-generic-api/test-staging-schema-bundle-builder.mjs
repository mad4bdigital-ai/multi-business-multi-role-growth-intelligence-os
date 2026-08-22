import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { splitStatements } from "./scripts/staging-sql-parser.mjs";

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

test("SQL splitter preserves semicolons inside quoted literals and strips comments safely", () => {
  const sql = `-- Values are provisioned separately; this schema contains no secret payloads.\nCREATE TABLE IF NOT EXISTS \`tenant_secrets\` (\`id\` BIGINT UNSIGNED NOT NULL);\nINSERT INTO \`tenant_secrets\` (\`metadata_json\`) VALUES (JSON_OBJECT('note', 'a;b'));\n/* block comment; remains data-safe */\nUPDATE \`tenant_secrets\` SET \`metadata_json\` = '{"value":"x;y"}' WHERE \`id\` = 1;`;
  assert.deepEqual(splitStatements(sql), [
    "CREATE TABLE IF NOT EXISTS `tenant_secrets` (`id` BIGINT UNSIGNED NOT NULL)",
    "INSERT INTO `tenant_secrets` (`metadata_json`) VALUES (JSON_OBJECT('note', 'a;b'))",
    "/* block comment; remains data-safe */\nUPDATE `tenant_secrets` SET `metadata_json` = '{\"value\":\"x;y\"}' WHERE `id` = 1",
  ]);
});

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
  assert.deepEqual(manifest.validation.required_endpoints_baseline_columns, [
    "endpoint_title", "provider_family", "child_openai_schema_file_id", "execution_layer", "dependencies",
    "logging_target", "category_group", "category_detail", "last_reviewed_at", "legacy_status",
    "client_interface_agnostic", "request_envelope_required", "structured_api_supported",
    "conversational_trigger_supported", "schema_json", "runtime_binding_profile", "admin_only",
    "client_allowed", "team_allowed", "writeback_scope",
  ]);
  assert.deepEqual(manifest.validation.required_validation_repair_baseline_columns, ["validation_type", "repair_action", "repair_status", "priority"]);
  assert.equal(manifest.validation.required_runtime_table_census.length, 18);
  assert.deepEqual(manifest.validation.required_runtime_support_tables, ["connected_systems", "platform_contract_surfaces", "platform_endpoint_tool_exports", "tenant_secrets", "platform_secrets", "secret_references", "credential_bindings", "admin_platform_endpoint_tools", "tenant_platform_endpoint_tools", "customer_sessions", "gpt_session_turns"]);
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
  assert.match(baselineSchema, /CREATE TABLE IF NOT EXISTS `platform_endpoint_tool_exports`/i);
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
  const migration068 = fs.readFileSync(path.join(apiRoot, "migrations", "068_sprint58_cloudflare_readonly_runtime.sql"), "utf8");
  for (const column of ["endpoint_title", "provider_family", "execution_layer", "category_group", "category_detail", "last_reviewed_at", "legacy_status", "client_interface_agnostic", "request_envelope_required", "structured_api_supported", "conversational_trigger_supported", "writeback_scope", "schema_json"]) {
    assert.match(migration068, new RegExp(column), `migration 068 must exercise endpoints.${column}`);
  }
  const migration1023 = fs.readFileSync(path.join(apiRoot, "migrations", "1023_sprint69_github_rest_endpoint_dispatch_foundation.sql"), "utf8");
  for (const column of ["dependencies", "logging_target", "runtime_binding_profile", "admin_only", "client_allowed", "team_allowed"]) {
    assert.match(migration1023, new RegExp(column), `migration 1023 must exercise endpoints.${column}`);
  }
});

test("GitHub endpoint runtime binding profiles are valid JSON literals", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const writerFiles = [
    "1023_sprint69_github_rest_endpoint_dispatch_foundation.sql",
    "1026_sprint69_github_actions_runs_read_dispatch.sql",
    "1038_sprint69_github_actions_workflow_control_dispatch.sql",
    "20260718_github_list_issue_comments_endpoint.sql",
  ];
  for (const file of writerFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    assert.match(sql, /JSON_QUOTE\('delegated_http_runtime_binding'\)/, `${file} must write a valid JSON string profile`);
    const withoutValidWrapper = sql.replaceAll("JSON_QUOTE('delegated_http_runtime_binding')", "");
    assert.equal(
      withoutValidWrapper.includes("'delegated_http_runtime_binding'"),
      false,
      `${file} must not insert a bare non-JSON runtime_binding_profile literal`,
    );
  }
});

test("MariaDB migrations do not use unsupported CAST AS JSON syntax", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql"));
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    assert.doesNotMatch(
      sql,
      /CAST\s*\([^;]*?\s+AS\s+JSON\s*\)/i,
      `${file} must not use CAST(... AS JSON), which is unsupported by MariaDB 11.4`,
    );
  }
});

test("binding identifier width is widened before every descriptive binding writer", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const compatibilityFile = "067_sprint69_binding_id_width_compatibility.sql";
  const compatibilityIndex = orderedMigrations.indexOf(compatibilityFile);
  assert.notEqual(compatibilityIndex, -1, "binding_id compatibility migration must exist");

  const overlongWriterFiles = [
    "1024_sprint69_openapi_endpoint_inventory_sync.sql",
    "20260630_dynamic_capability_governance_persistence.sql",
    "20260714_tenant_connection_shadow_contract_bootstrap.sql",
    "20260715_platform_capability_shadow_certification_issue.sql",
    "20260720_github_file_patch_shadow_certification_issue.sql",
    "239_sprint67_google_ads_budget_preflight_binding.sql",
    "265_sprint68_platform_orchestration_capability_binding.sql",
    "904_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql",
    "997_sprint68_openrouter_provider_smoke_capability_binding.sql",
  ];
  for (const file of overlongWriterFiles) {
    assert.ok(orderedMigrations.indexOf(file) > compatibilityIndex, `${file} must run after binding_id compatibility migration`);
  }

  const compatibilitySql = fs.readFileSync(path.join(migrationsDir, compatibilityFile), "utf8");
  assert.match(compatibilitySql, /ALTER TABLE `app_integration_action_bindings`[\s\S]*MODIFY COLUMN `binding_id` VARCHAR\(128\) NOT NULL/i);
  assert.match(compatibilitySql, /ALTER TABLE `credential_bindings`[\s\S]*MODIFY COLUMN `binding_id` VARCHAR\(128\) NOT NULL/i);
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

test("platform endpoint export baseline exists before migration 062 and covers runtime contract", () => {
  const columns = manifest.validation.required_platform_endpoint_tool_exports_baseline_columns;
  const quote = String.fromCharCode(96);
  assert.match(baselineSchema, /CREATE TABLE IF NOT EXISTS `platform_endpoint_tool_exports`/i);
  for (const column of columns) assert.equal(baselineSchema.includes(`${quote}${column}${quote}`), true, `platform_endpoint_tool_exports baseline missing ${column}`);
  const migration062 = fs.readFileSync(path.join(apiRoot, "migrations", "062_sprint56b_connector_registry_diagnostic_views.sql"), "utf8");
  assert.match(migration062, /FROM `platform_endpoint_tool_exports`/i);
  assert.match(migration062, /WHERE status = 'active'/i);
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
  assert.ok(generator.includes(String.raw`applyMigrations(baseline, rows, tableBootstrap)`));
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
  assert.match(generator, /required_platform_endpoint_tool_exports_baseline_columns/);
  assert.match(generator, /platform_endpoint_tool_exports baseline column contract is incomplete/);
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
  assert.deepEqual(plan.baseline_schema.required_platform_endpoint_tool_exports_baseline_columns.sort(), manifest.validation.required_platform_endpoint_tool_exports_baseline_columns.slice().sort());
  assert.deepEqual(plan.baseline_schema.required_tenant_secrets_baseline_columns.sort(), manifest.validation.required_tenant_secrets_baseline_columns.slice().sort());
  assert.deepEqual(plan.baseline_schema.required_platform_secrets_baseline_columns.sort(), manifest.validation.required_platform_secrets_baseline_columns.slice().sort());
  assert.equal(plan.migration_count, 784);
  assert.equal(plan.confirmation_required, "BUILD_STAGING_SCHEMA_BUNDLE");
  assert.deepEqual(plan.canonical_seed_lifecycle.seed_files.map((entry) => entry.file), [
    "039_sprint43_data_integrity_and_missing_tables.sql",
    "1043_sprint69_dynamic_container_hvac_activity_seed.sql",
    "20260815_custom_gpt_mcp_catalog_levels.sql",
  ]);
  assert.equal(plan.canonical_seed_lifecycle.readback_required, true);
});

test("canonical table bootstrap resolves ordered migration pre-use inside disposable staging only", () => {
  const result = runPlan();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  const bootstrap = plan.canonical_table_bootstrap;
  assert.equal(bootstrap.contract, "mad4b.staging.canonical-table-preuse-bootstrap.v1");
  assert.equal(bootstrap.disposable_database_only, true);
  assert.equal(bootstrap.production_access_forbidden, true);
  assert.equal(bootstrap.provider_access_forbidden, true);
  assert.equal(bootstrap.secrets_included, false);
  assert.ok(bootstrap.table_count >= 70);
  assert.ok(bootstrap.view_count >= 6);
  assert.equal(plan.ordered_preuse_audit.missing_column_gaps, 0);
  assert.equal(plan.ordered_preuse_audit.missing_table_gaps, 0);
  assert.match(generator, /canonical table bootstrap leaves/iu);
  const authorizationRegistry = bootstrap.entries.find((entry) => entry.table === "capability_apply_authorization_policy_registry");
  assert.equal(authorizationRegistry.file, "1004_sprint68_hostinger_ssh_executor_db_gate.sql");
  assert.equal(authorizationRegistry.source_file, "902_sprint68_dynamic_capability_apply_authorization_policy.sql");
  assert.equal(authorizationRegistry.sha256.length, 64);
  const dispatch = bootstrap.entries.find((entry) => entry.table === "runtime_dispatch_certification_registry");
  assert.equal(dispatch.file, "1004_sprint68_hostinger_ssh_executor_db_gate.sql");
  assert.match(dispatch.source_file, /^178_/);
  assert.equal(bootstrap.entries.some((entry) => entry.table.startsWith("tmp_")), false);
  assert.equal(bootstrap.entries.some((entry) => Object.hasOwn(entry, "statement")), false);
});

test("skill package catalog and migration authorization use their canonical source-table contracts", () => {
  const migrationDir = path.join(apiRoot, "migrations");
  const skillCatalog = fs.readFileSync(path.join(migrationDir, "273_sprint68_activation_catalog_authorized_surfaces.sql"), "utf8");
  const installer = fs.readFileSync(path.join(apiRoot, "skillInstaller.mjs"), "utf8");
  assert.match(skillCatalog, /CREATE TABLE IF NOT EXISTS `skill_packages`/iu);
  assert.ok(skillCatalog.indexOf("CREATE TABLE IF NOT EXISTS `skill_packages`") < skillCatalog.indexOf("CREATE OR REPLACE VIEW `v_activation_skill_package_catalog`"));
  for (const column of ["package_id", "package_key", "display_name", "source_url", "source_type", "version", "manifest_json", "logic_key", "install_status", "enabled", "installed_at", "updated_at"]) {
    assert.match(skillCatalog, new RegExp("`" + column + "`", "u"));
  }
  assert.match(installer, /INSERT INTO \\`skill_packages\\`/u);

  const grant = fs.readFileSync(path.join(migrationDir, "20260704_platform_resource_authority_grant_tool.sql"), "utf8");
  assert.match(grant, /\(migration_file, authorization_status, risk_tier, notes\)/u);
  assert.doesNotMatch(grant, /\b(?:migration_key|migration_path|risk_class|authorized_for_review)\b/u);
});


test("batch baseline contracts cover every ordered pre-use column repair", () => {
  const contracts = manifest.validation.baseline_column_contract_sources;
  assert.ok(contracts && typeof contracts === "object");
  const expectedTables = [
    "admin_platform_endpoint_tools",
    "tenant_platform_endpoint_tools",
    "brand_core",
    "tickets",
    "workflows",
    "task_routes",
    "logic_definitions",
    "memory_scope_type_registry",
    "endpoints",
    "platform_outbox_event_types",
    "tenant_resolution_cases",
  ];
  assert.deepEqual(Object.values(contracts).map((entry) => entry.table), expectedTables);
  for (const [contractKey, source] of Object.entries(contracts)) {
    const columns = manifest.validation[contractKey];
    assert.ok(Array.isArray(columns) && columns.length > 0, `${contractKey} must declare columns`);
    const sourceSql = fs.readFileSync(path.resolve(repoRoot, source.source_file), "utf8");
    assert.match(sourceSql, /CREATE\s+TABLE/i, `${contractKey} canonical table definition missing`);
    assert.ok(sourceSql.includes(source.table), `${contractKey} table name missing`);
    if (source.inherits_from) {
      assert.match(sourceSql, /LIKE/i);
      assert.ok(sourceSql.includes(source.inherits_from));
    }
  }
  assert.deepEqual(manifest.validation.required_admin_platform_endpoint_tools_baseline_columns, ["updated_at", "input_schema_json", "secrets_included"]);
  assert.deepEqual(manifest.validation.required_tenant_platform_endpoint_tools_baseline_columns, ["updated_at", "input_schema_json", "secrets_included"]);
  assert.deepEqual(manifest.validation.required_brand_core_baseline_columns, ["active_status"]);
  assert.deepEqual(manifest.validation.required_logic_definitions_baseline_columns, ["source_url", "package_version", "skill_manifest"]);
  assert.deepEqual(manifest.validation.required_endpoints_schema_overlay_baseline_columns, ["schema_overlay_status", "schema_overlay_notes"]);
  assert.deepEqual(manifest.validation.required_platform_outbox_event_types_baseline_columns, ["aggregate_type", "active"]);
  assert.deepEqual(manifest.validation.required_tenant_resolution_cases_baseline_columns, ["ticket_id"]);
});

test("batch baseline contracts include full lifecycle, governance, and memory columns", () => {
  assert.deepEqual(manifest.validation.required_tickets_baseline_columns, [
    "occurrence_count", "is_test", "environment", "visibility_class", "target_capability",
    "related_ticket_id", "parent_ticket_id", "supersedes_ticket_id", "first_response_due_at",
    "triage_due_at", "first_response_at", "triaged_at", "last_seen_at",
  ]);
  assert.deepEqual(manifest.validation.required_task_routes_baseline_columns, [
    "required_variable_profile", "variable_contract_group", "supported_ingress_channels",
    "requires_conversational_inference", "supports_structured_api_calls", "supported_model_providers",
    "allowed_actor_roles", "allowed_governance_levels", "client_allowed", "team_allowed", "admin_only",
    "brand_scope_enforced", "supported_languages", "translation_step_required", "locale_sensitive",
  ]);
  assert.deepEqual(manifest.validation.required_workflows_baseline_columns, [
    "required_variable_profile", "input_contract_profile", "supported_ingress_channels",
    "supports_structured_api_calls", "supported_model_providers", "model_adapter_required",
    "allowed_actor_roles", "allowed_governance_levels", "client_allowed", "team_allowed", "admin_only",
    "brand_scope_enforced", "supported_languages", "translation_step_required", "locale_sensitive",
  ]);
  assert.deepEqual(manifest.validation.required_memory_scope_type_registry_baseline_columns, [
    "display_name", "description", "scope_layer", "identity_table", "identity_key_column", "parent_scope_type",
    "supports_tenant_id", "supports_user_id", "supports_workspace_key", "supports_brand_key",
    "supports_activity_type_key", "supports_role_key", "default_visibility_scope", "approval_required", "metadata_json",
  ]);
});

test("generator preflight emits batch baseline contract evidence", () => {
  assert.match(generator, /function baselineColumnContracts/);
  assert.match(generator, /baseline_column_contract_sources/);
  assert.match(generator, /function createTableLikeSource/);
  assert.match(generator, /function baselineColumnExists/);
  assert.match(generator, /baseline_column_contracts: baseline\.baseline_column_contracts/);
});
