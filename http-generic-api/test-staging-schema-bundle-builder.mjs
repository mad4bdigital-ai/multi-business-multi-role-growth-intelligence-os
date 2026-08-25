import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { splitStatements } from "./scripts/staging-sql-parser.mjs";
import { compareMigrationFiles, isMigrationFilename } from "./scripts/migration-order.mjs";
import { inspectOrderedMigrationChainEnumSeeds } from "./databaseEnumSeedPolicyGuard.js";
import { inspectOrderedMigrationChainTextWidths } from "./databaseTextWidthPolicyGuard.js";

const apiRoot = path.resolve(import.meta.dirname);
const repoRoot = path.resolve(apiRoot, "..");
const manifestPath = path.join(apiRoot, "config", "staging-database-role-migration-manifest.json");
const migrationPolicyPath = path.join(apiRoot, "config", "staging-migration-contract-policy.json");
const generatorPath = path.join(apiRoot, "scripts", "build-staging-schema-bundle.mjs");
const preuseAuditPath = path.join(apiRoot, "scripts", "audit-staging-migration-preuse.mjs");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const migrationPolicy = JSON.parse(fs.readFileSync(migrationPolicyPath, "utf8"));
const generator = fs.readFileSync(generatorPath, "utf8");
const baselineSchema = fs.readFileSync(path.join(apiRoot, "schema.sql"), "utf8");
const expectedCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();

function runPlan() {
  return spawnSync(process.execPath, [generatorPath, "--expected-commit", expectedCommit, "--plan"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function runPreuseAuditFixture({ baseline, migrations }) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staging-preuse-audit-"));
  const fixtureApiRoot = path.join(fixtureRoot, "http-generic-api");
  const fixtureMigrations = path.join(fixtureApiRoot, "migrations");
  fs.mkdirSync(fixtureMigrations, { recursive: true });
  fs.writeFileSync(path.join(fixtureApiRoot, "schema.sql"), baseline);
  for (const [file, sql] of Object.entries(migrations)) fs.writeFileSync(path.join(fixtureMigrations, file), sql);
  try {
    const result = spawnSync(process.execPath, [preuseAuditPath, fixtureRoot], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("SQL splitter preserves semicolons inside quoted literals and strips comments safely", () => {
  const sql = `-- Values are provisioned separately; this schema contains no secret payloads.\nCREATE TABLE IF NOT EXISTS \`tenant_secrets\` (\`id\` BIGINT UNSIGNED NOT NULL);\nINSERT INTO \`tenant_secrets\` (\`metadata_json\`) VALUES (JSON_OBJECT('note', 'a;b'));\n/* block comment; remains data-safe */\nUPDATE \`tenant_secrets\` SET \`metadata_json\` = '{"value":"x;y"}' WHERE \`id\` = 1;`;
  assert.deepEqual(splitStatements(sql), [
    "CREATE TABLE IF NOT EXISTS `tenant_secrets` (`id` BIGINT UNSIGNED NOT NULL)",
    "INSERT INTO `tenant_secrets` (`metadata_json`) VALUES (JSON_OBJECT('note', 'a;b'))",
    "/* block comment; remains data-safe */\nUPDATE `tenant_secrets` SET `metadata_json` = '{\"value\":\"x;y\"}' WHERE `id` = 1",
  ]);
});

test("migration contract policy enables comprehensive pre-use fail-closed guards", () => {
  assert.equal(migrationPolicy.contract, "mad4b.staging.migration-contract-policy.v1");
  assert.deepEqual(migrationPolicy.preuse_contract, {
    check_create_index_table_and_columns: true,
    check_alter_add_index_table_and_columns: true,
    check_foreign_key_parent_tables: true,
    check_table_source_operations: true,
    check_view_source_columns: true,
    check_insert_column_value_arity: true,
    check_update_target_columns: true,
    check_rename_and_drop_targets: true,
    fail_on_unresolved_gaps: true,
  });
  assert.equal(migrationPolicy.safety.database_connection_allowed, false);
  assert.equal(migrationPolicy.safety.database_mutation_allowed, false);
  assert.equal(migrationPolicy.safety.provider_access_allowed, false);
  assert.equal(migrationPolicy.safety.credential_access_allowed, false);
  assert.equal(migrationPolicy.safety.data_export_allowed, false);
  assert.deepEqual(migrationPolicy.enum_seed_chain_contract, {
    enabled: true,
    engine: "mariadb",
    baseline_file: "http-generic-api/schema.sql",
    ordered_numeric_filename_and_lexicographic_tie_break: true,
    fail_on_unsupported_literal: true,
    inspect_create_alter_enum_domains: true,
    inspect_insert_replace_update_literals: true,
    allow_null_default_and_dynamic_expressions: true,
    static_only: true,
    database_connection_allowed: false,
    sql_mutation_allowed: false,
    provider_access_allowed: false,
    credential_access_allowed: false,
    data_export_allowed: false,
    runtime_mutation_allowed: false,
    secrets_included: false,
    policy_key: "mariadb_enum_seed_ordered_chain_v1",
  });
  assert.equal(migrationPolicy.text_width_chain_contract.enabled, true);
  assert.equal(migrationPolicy.text_width_chain_contract.inspect_insert_select_source_domains, true);
  assert.equal(migrationPolicy.text_width_chain_contract.static_only, true);
  assert.equal(migrationPolicy.text_width_chain_contract.database_connection_allowed, false);
  assert.equal(migrationPolicy.text_width_chain_contract.sql_mutation_allowed, false);
  assert.equal(migrationPolicy.text_width_chain_contract.provider_access_allowed, false);
  assert.equal(migrationPolicy.text_width_chain_contract.credential_access_allowed, false);
  assert.equal(migrationPolicy.text_width_chain_contract.data_export_allowed, false);
  assert.equal(migrationPolicy.text_width_chain_contract.runtime_mutation_allowed, false);
  assert.equal(migrationPolicy.text_width_chain_contract.secrets_included, false);
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
  assert.equal(manifest.source.ordering, "baseline_schema_then_numeric_migration_prefix_then_lexicographic_tiebreaker");
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

test("numeric migration ordering runs dependencies before later indexes", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  assert.ok(orderedMigrations.every(isMigrationFilename), "every migration filename must carry a numeric version prefix");
  assert.ok(
    orderedMigrations.indexOf("310_sprint69_activation_awareness_completeness_control_plane.sql")
      < orderedMigrations.indexOf("1042_sprint69_activation_session_context_indexes.sql"),
    "activation_runs must be created before migration 1042 indexes it",
  );
  assert.ok(
    orderedMigrations.indexOf("018_sprint22_customer_session_registry.sql")
      < orderedMigrations.indexOf("1042_sprint69_activation_session_context_indexes.sql"),
    "customer_sessions must be created before migration 1042 indexes it",
  );
  assert.ok(
    orderedMigrations.indexOf("196_sprint67_mariadb_join_key_collation_alignment.sql")
      < orderedMigrations.indexOf("197_sprint67_workspace_authority_reconciliation_views.sql"),
    "MariaDB join-key alignment must run before migration 197 views",
  );
  assert.ok(
    orderedMigrations.indexOf("20260721_z_mariadb_agent_skill_grant_request_precreation_collation.sql")
      < orderedMigrations.indexOf("20260722_agent_skill_grant_approval_provenance.sql"),
    "agent skill grant request pre-creation must precede the immutable provenance migration",
  );
  assert.ok(
    orderedMigrations.indexOf("20260724_mariadb_repository_authority_system_collation_alignment.sql")
      < orderedMigrations.indexOf("20260725_repository_authority_capability_readiness_repair.sql"),
    "repository authority system-key alignment must run before the 20260725 repair",
  );
  for (const [repair, firstWriter] of [
    ["201_sprint67_z_mariadb_engine_registry_enum_domain_alignment.sql", "201_sprint68_lifecycle_owner_engine_registry_alignment.sql"],
    ["233_sprint67_z_mariadb_policy_mode_enum_domain_alignment.sql", "233_sprint68_general_mode_choice_governance.sql"],
    ["244_sprint67_z_mariadb_lifecycle_registry_enum_domain_alignment.sql", "244_sprint68_sequential_plan_orchestrator.sql"],
    ["20260720_z_mariadb_activation_tile_scope_enum_domain_alignment.sql", "20260721_ci_guard_operational_alert_ingestion_slo.sql"],
    ["958_sprint67_z_mariadb_resource_adapter_kind_enum_domain_alignment.sql", "958_sprint68_github_file_content_gate_and_patch_plan_registry.sql"],
  ]) {
    assert.ok(orderedMigrations.indexOf(repair) !== -1, `${repair} must exist`);
    assert.ok(orderedMigrations.indexOf(repair) < orderedMigrations.indexOf(firstWriter), `${repair} must precede ${firstWriter}`);
  }
});

test("expanded pre-use audit catches index and foreign-key dependency gaps", () => {
  const baseline = "CREATE TABLE IF NOT EXISTS `parent_table` (`id` INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;\nCREATE TABLE IF NOT EXISTS `alter_target` (`id` INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;";
  const report = runPreuseAuditFixture({
    baseline,
    migrations: {
      "001_create_child.sql": "CREATE TABLE IF NOT EXISTS `child_table` (`id` INT NOT NULL, `parent_id` INT NOT NULL, FOREIGN KEY (`parent_id`) REFERENCES `parent_table` (`id`)) ENGINE=InnoDB;",
      "1042_sprint69_activation_session_context_indexes.sql": "CREATE INDEX IF NOT EXISTS `idx_ar_context_reuse_session` ON `activation_runs` (`tenant_id`, `user_id`, `created_at`);",
      "1043_alter_index_missing_column.sql": "ALTER TABLE `alter_target` ADD INDEX `idx_missing` (`missing_column`);",
      "1044_fk_missing_parent.sql": "CREATE TABLE IF NOT EXISTS `orphan_table` (`id` INT NOT NULL, `parent_id` INT NOT NULL, FOREIGN KEY (`parent_id`) REFERENCES `missing_parent` (`id`)) ENGINE=InnoDB;",
    },
  });
  assert.equal(report.counts.missing_table, 2);
  assert.equal(report.counts.missing_column, 1);
  assert.ok(report.gaps.some((gap) => gap.table === "activation_runs" && gap.kind === "missing_table"));
  assert.ok(report.gaps.some((gap) => gap.table === "missing_parent" && gap.kind === "missing_table"));
  assert.ok(report.gaps.some((gap) => gap.table === "alter_target" && gap.column === "missing_column" && gap.kind === "missing_column"));
});

test("expanded pre-use audit accepts same-statement column-and-index additions", () => {
  const report = runPreuseAuditFixture({
    baseline: "CREATE TABLE IF NOT EXISTS `alter_target` (`id` INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;",
    migrations: {
      "001_add_column_and_index.sql": "ALTER TABLE `alter_target` ADD COLUMN `new_column` VARCHAR(32) NULL, ADD INDEX `idx_new_column` (`new_column`);",
    },
  });
  assert.equal(report.unique_true_preuse_gaps, 0);
  assert.equal(report.counts.missing_column ?? 0, 0);
  assert.equal(report.same_statement_false_positives >= 1, true);
});

test("expanded pre-use audit catches qualified view columns before CREATE VIEW", () => {
  const report = runPreuseAuditFixture({
    baseline: "CREATE TABLE IF NOT EXISTS `source_table` (`id` INT NOT NULL PRIMARY KEY, `present_column` VARCHAR(32) NULL) ENGINE=InnoDB;",
    migrations: {
      "001_missing_view_column.sql": "CREATE OR REPLACE VIEW `v_source_contract` AS SELECT s.present_column, s.missing_column FROM `source_table` s;",
    },
  });
  assert.equal(report.counts.missing_column, 1);
  assert.equal(report.view_column_references_checked, 2);
  assert.ok(report.gaps.some((gap) => gap.table === "source_table" && gap.column === "missing_column" && gap.kind === "missing_column"));
});

test("expanded pre-use audit catches multi-table UPDATE target columns before disposable DB apply", () => {
  const report = runPreuseAuditFixture({
    baseline: "CREATE TABLE IF NOT EXISTS `endpoints` (`id` INT NOT NULL PRIMARY KEY, `present_column` VARCHAR(32) NULL) ENGINE=InnoDB;",
    migrations: {
      "001_missing_update_target.sql": "UPDATE `endpoints` legacy JOIN `endpoints` canonical ON canonical.id = legacy.id SET legacy.present_column = canonical.present_column, legacy.missing_column = canonical.id WHERE legacy.id = canonical.id;",
    },
  });
  assert.equal(report.update_target_column_checks, 2);
  assert.equal(report.update_target_column_missing_columns, 1);
  assert.equal(report.counts.missing_column, 1);
  assert.ok(report.gaps.some((gap) => gap.table === "endpoints" && gap.column === "missing_column" && gap.kind === "missing_column"));
});

test("expanded pre-use audit catches INSERT column/value arity before disposable DB apply", () => {
  const report = runPreuseAuditFixture({
    baseline: "CREATE TABLE IF NOT EXISTS `target_table` (`a` INT NULL, `b` INT NULL, `c` INT NULL) ENGINE=InnoDB;",
    migrations: {
      "001_bad_insert_select_arity.sql": "INSERT INTO `target_table` (`a`, `b`, `c`) SELECT 1, 2 WHERE 1 = 1;",
    },
  });
  assert.equal(report.insert_arity_checks, 1);
  assert.equal(report.insert_arity_mismatches, 1);
  assert.equal(report.insert_arity_findings[0].table, "target_table");
  assert.match(report.insert_arity_findings[0].detail, /3 target columns, 2 projected values/iu);
});

test("expanded pre-use audit accepts matching INSERT VALUES and INSERT SELECT arity", () => {
  const report = runPreuseAuditFixture({
    baseline: "CREATE TABLE IF NOT EXISTS `target_table` (`a` INT NULL, `b` INT NULL, `c` INT NULL) ENGINE=InnoDB;",
    migrations: {
      "001_matching_insert_values.sql": "INSERT INTO `target_table` (`a`, `b`, `c`) VALUES (1, 2, 3), (4, 5, 6);",
      "002_matching_insert_select.sql": "INSERT INTO `target_table` (`a`, `b`, `c`) SELECT 7, 8, 9;",
    },
  });
  assert.equal(report.insert_arity_checks, 3);
  assert.equal(report.insert_arity_mismatches, 0);
});

test("WordPress schema overlay prerequisite precedes the historical 284 writer", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  const prerequisite = "283_sprint68_z_wordpress_schema_overlay_contract_alignment.sql";
  const writer = "284_sprint68_wordpress_schema_import_completion_registry.sql";
  assert.ok(orderedMigrations.indexOf(prerequisite) !== -1);
  assert.ok(orderedMigrations.indexOf(writer) !== -1);
  assert.ok(orderedMigrations.indexOf(prerequisite) < orderedMigrations.indexOf(writer));
  const sql = fs.readFileSync(path.join(migrationsDir, prerequisite), "utf8");
  for (const pattern of [
    /ADD COLUMN IF NOT EXISTS `required_variable_contracts` TEXT NULL/i,
    /ADD COLUMN IF NOT EXISTS `schema_overlay_mode` VARCHAR\(100\) NULL/i,
    /ADD COLUMN IF NOT EXISTS `schema_overlay_parent_action_key` VARCHAR\(255\) NULL/i,
    /ADD COLUMN IF NOT EXISTS `provider_agnostic` VARCHAR\(20\) NULL/i,
    /ADD COLUMN IF NOT EXISTS `allowed_actor_roles` TEXT NULL/i,
    /ADD COLUMN IF NOT EXISTS `allowed_governance_levels` TEXT NULL/i,
  ]) assert.match(sql, pattern);
  const ddl = sql.replace(/--[^\n]*(?:\n|$)/g, "");
  assert.doesNotMatch(ddl, /(?:JSON|TOKEN|SECRET|CREDENTIAL|PASSWORD)/i);
});

test("memory scope shape alignments precede historical views and preserve the legacy migrations", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  const memoryAlignment = "251_sprint68_z_mariadb_memory_scope_links_shape_alignment.sql";
  const memoryFoundation = "252_sprint68_memory_scope_links_foundation.sql";
  const brandAlignment = "20260720_z_mariadb_brands_status_view_alignment.sql";
  const brandView = "20260721_repository_authority_capability_bindings_v2.sql";
  assert.ok(orderedMigrations.indexOf(memoryAlignment) < orderedMigrations.indexOf(memoryFoundation));
  assert.ok(orderedMigrations.indexOf(brandAlignment) < orderedMigrations.indexOf(brandView));
  const memorySql = fs.readFileSync(path.join(migrationsDir, memoryAlignment), "utf8");
  assert.match(memorySql, /ADD COLUMN IF NOT EXISTS `resource_type` VARCHAR\(64\)/i);
  assert.match(memorySql, /ADD COLUMN IF NOT EXISTS `lifecycle_status` ENUM/i);
  assert.match(memorySql, /MODIFY COLUMN `resource_scope_hash` CHAR\(64\) NOT NULL/i);
  assert.doesNotMatch(memorySql, /ADD CONSTRAINT `fk_memory_scope_links_scope_type`/i);
  const brandSql = fs.readFileSync(path.join(migrationsDir, brandAlignment), "utf8");
  assert.match(brandSql, /ADD COLUMN IF NOT EXISTS `status` VARCHAR\(32\) NOT NULL DEFAULT 'active'/i);
});

test("binding identifier width is widened before every descriptive binding writer", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
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

test("platform plugin binding status domain is pre-created before migration 314", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  const bridge = "313_sprint69_zzzz_platform_plugin_bindings_binding_status_width_alignment.sql";
  const writer = "314_sprint69_capability_assurance_graph.sql";
  assert.notEqual(orderedMigrations.indexOf(bridge), -1, "binding_status bridge must exist");
  assert.notEqual(orderedMigrations.indexOf(writer), -1, "migration 314 must exist");
  assert.ok(orderedMigrations.indexOf(bridge) < orderedMigrations.indexOf(writer), "binding_status bridge must precede migration 314");
  const bridgeSql = fs.readFileSync(path.join(migrationsDir, bridge), "utf8");
  assert.match(bridgeSql, /CREATE TABLE IF NOT EXISTS `platform_plugin_bindings`/i);
  assert.match(bridgeSql, /`binding_status` VARCHAR\(256\) NOT NULL/i);
  assert.match(bridgeSql, /KEY `idx_ppb_capability_status` \(`capability_key`, `binding_status`\)/i);
  const ddl = bridgeSql.replace(/--[^\n]*(?:\n|$)/g, "");
  assert.doesNotMatch(ddl, /(?:^|;)\s*(?:INSERT|REPLACE|UPDATE|DELETE)\b/im);
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

test("all local connector allowlist writers satisfy the required identifier contract", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const writerFiles = [
    "032_sprint35_local_connector_seed.sql",
    "036_sprint40_connect_page.sql",
    "156_sprint65_remote_runtime_diff_name_status.sql",
    "159_sprint65_db_driven_connector_shell_policy.sql",
  ];
  for (const file of writerFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const writers = splitStatements(sql).filter((statement) => /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?local_connector_shell_allowlists`?/iu.test(statement));
    assert.ok(writers.length > 0, `${file} must contain a local connector allowlist writer`);
    for (const statement of writers) {
      const columns = statement.match(/^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?local_connector_shell_allowlists`?\s*\(([^)]*)\)/iu)?.[1] || "";
      assert.match(columns, /(?:^|,)\s*`?allowlist_id`?\s*(?:,|$)/iu, `${file} local connector allowlist writer must include allowlist_id`);
    }
  }
  const generator = fs.readFileSync(generatorPath, "utf8");
  assert.match(generator, /function validateLocalConnectorAllowlistStatement/iu);
  assert.match(generator, /local_connector_shell_allowlists INSERT must include allowlist_id/iu);
});

test("all local connector file access rule writers satisfy the required identifier contract", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const writerFiles = [
    "032_sprint35_local_connector_seed.sql",
    "162_sprint65_connector_capability_policy_grants.sql",
  ];
  for (const file of writerFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const writers = splitStatements(sql).filter((statement) => /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?local_connector_file_access_rules`?/iu.test(statement));
    assert.ok(writers.length > 0, `${file} must contain a local connector file access rule writer`);
    for (const statement of writers) {
      const columns = statement.match(/^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?local_connector_file_access_rules`?\s*\(([^)]*)\)/iu)?.[1] || "";
      assert.match(columns, /(?:^|,)\s*`?rule_id`?\s*(?:,|$)/iu, `${file} local connector file access rule writer must include rule_id`);
    }
  }
  const generator = fs.readFileSync(generatorPath, "utf8");
  assert.match(generator, /function validateLocalConnectorFileAccessRuleStatement/iu);
  assert.match(generator, /local_connector_file_access_rules INSERT must include rule_id/iu);
  assert.match(generator, /local_connector_file_access_rules SELECT writer must provide a non-null rule_id/iu);
});

test("all secret_references writers honor the canonical tenant/key uniqueness contract", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const writerFiles = [
    "057_sprint53_credential_binding_bridge.sql",
    "1012_sprint69_sql_only_runtime_auth_schema.sql",
    "108_hostinger_ssh_governed_connectors.sql",
    "182_sprint66_platform_hostinger_ssh_db_credentials.sql",
    "20260717_github_repository_main_moved_webhook_ingress.sql",
  ];
  for (const file of writerFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const writers = splitStatements(sql).filter((statement) => /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?secret_references`?/iu.test(statement));
    assert.ok(writers.length > 0, `${file} must contain a secret_references writer`);
    for (const statement of writers) {
      if (/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/iu.test(statement)) continue;
      const guard = statement.match(/\b(?:WHERE|AND|OR)\s+NOT\s+EXISTS\s*\(([\s\S]*)\)\s*$/iu)?.[1] || "";
      assert.ok(guard, `${file} secret_references writer must have an idempotent guard`);
      assert.match(guard, /\bsecret_key\b/iu, `${file} secret_references guard must compare secret_key`);
      assert.doesNotMatch(guard, /\b(?:sr\s*\.\s*)?system_id\b/iu, `${file} secret_references guard must not narrow uq_tenant_key by system_id`);
    }
  }
  const migration012 = fs.readFileSync(path.join(migrationsDir, "012_sprint16_security.sql"), "utf8");
  const migration108 = fs.readFileSync(path.join(migrationsDir, "108_hostinger_ssh_governed_connectors.sql"), "utf8");
  const migration182 = fs.readFileSync(path.join(migrationsDir, "182_sprint66_platform_hostinger_ssh_db_credentials.sql"), "utf8");
  assert.match(migration012, /UNIQUE KEY `uq_tenant_key` \(`tenant_id`, `secret_key`\)/iu);
  assert.match(migration108, /sr\.tenant_id\s*=\s*@platform_tenant_id[\s\S]*?sr\.secret_key\s*=\s*refs\.secret_key/iu);
  assert.match(migration182, /@effective_prod_system_id/iu);
  assert.match(migration182, /WHERE tenant_id = @platform_tenant_id\s+AND secret_key IN/iu);
  assert.match(migration182, /WHERE tenant_id = @platform_tenant_id\s+AND system_key = @prod_system_key/iu);
  const generator = fs.readFileSync(generatorPath, "utf8");
  assert.match(generator, /function validateSecretReferenceIdempotencyStatement/iu);
  assert.match(generator, /secret_references NOT EXISTS guard must not narrow canonical uq_tenant_key uniqueness by system_id/iu);
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

test("migration 1030 widens catalog tags before append-only governance updates", () => {
  const migration1030 = fs.readFileSync(path.join(apiRoot, "migrations", "1030_sprint69_default_blocker_recovery_governance_seed.sql"), "utf8");
  const tables = ["admin_platform_endpoint_tools", "tenant_platform_endpoint_tools", "local_gateway_tools"];
  const firstUpdate = migration1030.indexOf("UPDATE admin_platform_endpoint_tools");
  assert.ok(firstUpdate > 0, "migration 1030 must retain the admin catalog update");
  const quote = String.fromCharCode(96);
  for (const table of tables) {
    const alter = new RegExp(`ALTER TABLE ${quote}${table}${quote}\\s+MODIFY COLUMN ${quote}tags${quote} TEXT NULL`, "i");
    assert.match(migration1030, alter, `${table}.tags must be widened before strict-mode updates`);
    assert.ok(migration1030.search(alter) < firstUpdate, `${table}.tags widening must precede catalog updates`);
  }
  assert.doesNotMatch(migration1030, /\b(?:LEFT|SUBSTRING|TRUNCATE)\s*\(/i, "migration 1030 must not truncate governance tags");
});

test("cross-environment migration governance keeps discovery, roles, and execution authority isolated", () => {
  const policy = JSON.parse(fs.readFileSync(path.join(apiRoot, "config", "staging-migration-contract-policy.json"), "utf8"));
  const staging = policy.environment_profiles.staging_local_windows_docker;
  const production = policy.environment_profiles.production_hostinger_autodeploy;
  assert.equal(staging.source_branch, "main");
  assert.equal(staging.hostinger_access_allowed, false);
  assert.equal(staging.production_access_allowed, false);
  assert.equal(production.source_branch, "Production");
  assert.equal(production.local_docker_access_allowed, false);
  assert.equal(production.exact_source_sha_required, true);
  assert.equal(production.typed_approval_required, true);
  assert.equal(policy.execution_authority.discovery_grants_execution, false);
  assert.equal(policy.execution_authority.production_auto_apply_allowed, false);
  assert.equal(policy.migration_history.silent_ledger_reconciliation_allowed, false);
  assert.equal(policy.database_role_topology.governance.owns_migration_ledger, true);
  assert.equal(policy.database_role_topology.runtime_persistence.owns_tables.includes("governed_tool_response_chunks"), true);
});

test("migration 196 widens every catalog tags column before later long writers", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const migration195 = fs.readFileSync(path.join(migrationsDir, "195_sprint66_connected_execution_read_only_tool_execution.sql"), "utf8");
  const migration196 = fs.readFileSync(path.join(migrationsDir, "196_sprint66_admin_tool_registry_tags_text.sql"), "utf8");
  const migration202 = fs.readFileSync(path.join(migrationsDir, "202_sprint66_tenant_ssh_cli_allowlisted_execute_tool.sql"), "utf8");
  const migration195Alter = /ALTER TABLE\s+admin_platform_endpoint_tools[\s\S]*?MODIFY COLUMN\s+tags\s+TEXT\s+NULL/i;
  assert.match(migration195, migration195Alter, "migration 195 must widen admin tags before its long update");
  const tables = ["admin_platform_endpoint_tools", "tenant_platform_endpoint_tools", "local_gateway_tools"];
  for (const table of tables) {
    const alter = new RegExp(`ALTER TABLE\\s+${table}\\s+MODIFY COLUMN\\s+tags\\s+TEXT\\s+NULL`, "i");
    assert.match(migration196, alter, `${table}.tags must be widened by the shared compatibility migration`);
  }
  assert.ok(migration196.indexOf("ALTER TABLE tenant_platform_endpoint_tools") < migration196.indexOf("UPDATE admin_platform_endpoint_tools"));
  assert.match(migration202, /INSERT INTO tenant_platform_endpoint_tools[\s\S]*tags[\s\S]*tenant,infrastructure,ssh,cli,execute/i);
});

test("migration 1037 uses only the canonical brand_core column contract", () => {
  const migration1037 = fs.readFileSync(path.join(apiRoot, "migrations", "1037_sprint69_dona_brand_core_readiness_data_repair.sql"), "utf8");
  const sql = migration1037.slice(migration1037.indexOf("UPDATE `brand_core`"));
  assert.match(sql, /WHERE `brand_key` = 'donatours_wp'/i);
  assert.match(sql, /AND `id` BETWEEN 76 AND 86/i);
  for (const column of ["brand_key", "id", "doc_id", "file_id", "active_status", "updated_at"]) {
    assert.match(baselineSchema, new RegExp("CREATE TABLE IF NOT EXISTS `brand_core`[\\s\\S]*`" + column + "`", "i"), `brand_core baseline must declare ${column}`);
  }
  assert.doesNotMatch(sql, /`brand_name`|`google_drive_link`/i, "migration 1037 must not query columns absent from brand_core");
});

test("migration 1037 record-only retirement normalizes mixed migration-file collations", () => {
  const migration1037 = fs.readFileSync(path.join(apiRoot, "migrations", "1037_sprint69_record_only_authorization_retirement.sql"), "utf8");
  for (const alias of ["l", "applied"]) {
    assert.match(
      migration1037,
      new RegExp(`\\b${alias}\\.migration_file\\s*=\\s*a\\.migration_file\\s+COLLATE\\s+utf8mb4_unicode_ci\\b`, "i"),
      `${alias}.migration_file must retain its index while the authorization-side comparison uses the ledger collation`,
    );
  }
  assert.doesNotMatch(migration1037, /\\b(?:l|applied)\\.migration_file\\s+COLLATE\\b/i, "indexed ledger migration_file must not be wrapped in COLLATE");
});

test("migration 1038 widens dispatch binding ids before workflow-control inserts", () => {
  const migration1038 = fs.readFileSync(path.join(apiRoot, "migrations", "1038_sprint69_github_actions_workflow_control_dispatch.sql"), "utf8");
  const alter = /ALTER TABLE\s+platform_tool_dispatch_bindings\s+MODIFY COLUMN\s+binding_id\s+VARCHAR\(128\)\s+NOT NULL/i;
  const firstBindingInsert = migration1038.search(/INSERT INTO\s+platform_tool_dispatch_bindings/i);
  assert.notEqual(firstBindingInsert, -1, "migration 1038 must retain the workflow-control binding writer");
  assert.notEqual(alter.exec(migration1038), null, "dispatch binding compatibility width must be declared");
  assert.ok(migration1038.search(alter) < firstBindingInsert, "binding_id widening must precede workflow-control binding inserts");
});

test("migration 1039 uses legal runtime and authority binding status enums", () => {
  const migration1039 = fs.readFileSync(path.join(apiRoot, "migrations", "1039_sprint69_disable_temporary_hostinger_deploy_gates.sql"), "utf8");
  const runtimeConfigMigration = fs.readFileSync(path.join(apiRoot, "migrations", "038_sprint42_platform_runtime_config.sql"), "utf8");
  const authorityBindingMigration = fs.readFileSync(path.join(apiRoot, "migrations", "950_sprint68_platform_resource_authority_bindings.sql"), "utf8");
  assert.match(runtimeConfigMigration, /`status`\s+ENUM\('active','disabled'\)/i);
  assert.match(authorityBindingMigration, /status\s+ENUM\('active','suspended','revoked','expired'\)/i);
  assert.match(migration1039, /UPDATE\s+platform_runtime_config[\s\S]*?status\s*=\s*'disabled'/i);
  assert.match(migration1039, /UPDATE\s+platform_resource_authority_bindings[\s\S]*?status\s*=\s*'revoked'/i);
  assert.doesNotMatch(migration1039, /status\s*=\s*'inactive'/i, "migration 1039 must not write an unsupported inactive status");
  assert.match(migration1039, /WHERE\s+binding_id\s*=\s*'a8ec8ed2-5ba7-4b33-98ac-f6f51076ce38'/i);
  assert.match(migration1039, /resource_uri\s*=\s*'hostinger:\/\/auth\.mad4b\.com\/production'/i);
});

test("catalog path parameter metadata is valid JSON before disposable replay", () => {
  const migration125 = fs.readFileSync(path.join(apiRoot, "migrations", "125_sprint64_platform_plugin_contributions.sql"), "utf8");
  assert.match(
    migration125,
    /'platform_plugin_contribution_get'[\s\S]*?\/platform\/plugins\/contributions\/\{contribution_id\}'[\s\S]*?JSON_ARRAY\('contribution_id'\)/iu,
    "migration 125 must encode the contribution_id path parameter as a JSON array",
  );
  assert.doesNotMatch(
    migration125,
    /\/platform\/plugins\/contributions\/\{contribution_id\}'[\s\S]*?\n\s*'contribution_id'\s*,/iu,
    "migration 125 must not write a bare scalar path parameter",
  );
  assert.match(generator, /function validatePathParamKeysStatement/iu);
  assert.match(generator, /path_param_keys must be NULL, JSON_ARRAY/iu);
  assert.match(generator, /path_param_keys JSON value must be an array of strings/iu);
  assert.match(generator, /function validateLocalConnectorAllowlistStatement/iu);
  assert.match(generator, /local_connector_shell_allowlists INSERT must include allowlist_id/iu);
});

test("text-width bridge migrations precede their immutable historical writers", () => {
  const orderedNames = fs.readdirSync(path.join(apiRoot, "migrations")).filter((name) => name.endsWith(".sql")).sort(compareMigrationFiles);
  const bridge313 = fs.readFileSync(path.join(apiRoot, "migrations", "313_sprint69_z_platform_plugin_capabilities_operation_class_text_alignment.sql"), "utf8");
  const bridge313RuntimeStatus = fs.readFileSync(path.join(apiRoot, "migrations", "313_sprint69_zz_platform_plugin_capabilities_runtime_status_width_alignment.sql"), "utf8");
  const bridge20260720 = fs.readFileSync(path.join(apiRoot, "migrations", "20260720_sprint69_z_workspace_app_links_linked_by_width_alignment.sql"), "utf8");
  const bridge20260809 = fs.readFileSync(path.join(apiRoot, "migrations", "20260809_sprint69_z_platform_plugin_capability_exports_http_path_text_alignment.sql"), "utf8");
  const bridge097 = fs.readFileSync(path.join(apiRoot, "migrations", "097_sprint62h_zz_local_connector_device_routes_endpoint_width_alignment.sql"), "utf8");
  const bridge149 = fs.readFileSync(path.join(apiRoot, "migrations", "149_sprint65_zz_remote_runtime_targets_host_label_width_alignment.sql"), "utf8");
  const bridge264 = fs.readFileSync(path.join(apiRoot, "migrations", "264_sprint68_zz_external_provider_policy_key_width_alignment.sql"), "utf8");
  const bridge310 = fs.readFileSync(path.join(apiRoot, "migrations", "310_sprint69_zz_platform_endpoint_tool_exports_width_alignment.sql"), "utf8");
  const bridge311Dispatch = fs.readFileSync(path.join(apiRoot, "migrations", "311_sprint69_zz_platform_tool_dispatch_binding_width_alignment.sql"), "utf8");
  const bridge313CapabilityGraph = fs.readFileSync(path.join(apiRoot, "migrations", "313_sprint69_zzz_capability_assurance_key_width_alignment.sql"), "utf8");
  const bridge1039BindingId = fs.readFileSync(path.join(apiRoot, "migrations", "1039_sprint69_zz_platform_tool_dispatch_binding_id_width_alignment.sql"), "utf8");
  const bridge20260701Readback = fs.readFileSync(path.join(apiRoot, "migrations", "20260701_0z_platform_capability_readback_key_width_alignment.sql"), "utf8");
  assert.ok(orderedNames.indexOf("313_sprint69_z_platform_plugin_capabilities_operation_class_text_alignment.sql") < orderedNames.indexOf("314_sprint69_capability_assurance_graph.sql"));
  assert.ok(orderedNames.indexOf("313_sprint69_zz_platform_plugin_capabilities_runtime_status_width_alignment.sql") < orderedNames.indexOf("314_sprint69_capability_assurance_graph.sql"));
  assert.ok(orderedNames.indexOf("20260720_sprint69_z_workspace_app_links_linked_by_width_alignment.sql") < orderedNames.indexOf("20260721_repository_authority_capability_bindings_v2.sql"));
  assert.ok(orderedNames.indexOf("20260809_sprint69_z_platform_plugin_capability_exports_http_path_text_alignment.sql") < orderedNames.indexOf("20260810_platform_runtime_registry_drift_reconciliation.sql"));
  for (const [bridge, writer] of [
    ["097_sprint62h_zz_local_connector_device_routes_endpoint_width_alignment.sql", "098_sprint62i_local_connector_device_routes.sql"],
    ["149_sprint65_zz_remote_runtime_targets_host_label_width_alignment.sql", "150_sprint65_remote_ssh_runtime_foundation.sql"],
    ["264_sprint68_zz_external_provider_policy_key_width_alignment.sql", "265_sprint68_ticket_external_provider_adapter_contracts.sql"],
    ["310_sprint69_zz_platform_endpoint_tool_exports_width_alignment.sql", "311_sprint69_platform_tool_dispatch_binding_integrity.sql"],
    ["311_sprint69_zz_platform_tool_dispatch_binding_width_alignment.sql", "1026_sprint69_github_actions_runs_read_dispatch.sql"],
    ["313_sprint69_zzz_capability_assurance_key_width_alignment.sql", "314_sprint69_capability_assurance_graph.sql"],
    ["1039_sprint69_zz_platform_tool_dispatch_binding_id_width_alignment.sql", "1040_sprint69_capability_enablement_operational_dashboard.sql"],
    ["20260701_0z_platform_capability_readback_key_width_alignment.sql", "20260717_virtual_tool_capability_projection.sql"],
  ]) {
    assert.ok(orderedNames.indexOf(bridge) < orderedNames.indexOf(writer), `${bridge} must precede ${writer}`);
  }
  assert.ok(bridge313.includes("CREATE TABLE IF NOT EXISTS `platform_plugin_capabilities`"));
  assert.ok(bridge313.includes("`operation_class` TEXT NOT NULL"));
  assert.match(bridge313RuntimeStatus, /ALTER TABLE `platform_plugin_capabilities`[\s\S]*MODIFY COLUMN `runtime_status` VARCHAR\(256\) NOT NULL/i);
  assert.ok(bridge20260720.includes("ALTER TABLE `workspace_app_links`"));
  assert.ok(bridge20260720.includes("MODIFY COLUMN `linked_by` VARCHAR(128) NULL"));
  assert.ok(bridge20260809.includes("ALTER TABLE `platform_plugin_capability_exports`"));
  assert.ok(bridge20260809.includes("MODIFY COLUMN `http_path` TEXT NULL"));
  assert.match(bridge097, /`endpoint_url` TEXT NOT NULL/i);
  assert.match(bridge149, /`host_label` VARCHAR\(255\) NOT NULL/i);
  assert.match(bridge264, /`policy_key` VARCHAR\(255\) NOT NULL/i);
  assert.match(bridge310, /`export_key` VARCHAR\(271\) NOT NULL/i);
  assert.match(bridge311Dispatch, /`export_key` VARCHAR\(271\) NULL/i);
  assert.match(bridge313CapabilityGraph, /`capability_key` VARCHAR\(255\) NOT NULL/i);
  assert.match(bridge313CapabilityGraph, /`certification_status` VARCHAR\(256\) NOT NULL/i);
  assert.match(bridge1039BindingId, /`binding_id` VARCHAR\(293\) NOT NULL/i);
  assert.match(bridge20260701Readback, /`capability_key` VARCHAR\(255\) NOT NULL/i);
  for (const bridge of [bridge313, bridge313RuntimeStatus, bridge20260720, bridge20260809, bridge097, bridge149, bridge264, bridge310, bridge311Dispatch, bridge313CapabilityGraph, bridge1039BindingId, bridge20260701Readback]) {
    assert.doesNotMatch(bridge, /^\\s*(?:INSERT|UPDATE|DELETE|REPLACE)\\b/imu);
    assert.match(bridge, /secrets_included=false/iu);
  }
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
  assert.equal(plan.migration_count, 811);
  assert.equal(plan.statement_count, 3098);
  assert.equal(plan.confirmation_required, "BUILD_STAGING_SCHEMA_BUNDLE");
  assert.equal(plan.ordered_collation_chain.contract, "mad4b.mariadb-collation-ordered-chain.v1");
  assert.equal(plan.ordered_collation_chain.ok, true);
  assert.equal(plan.ordered_collation_chain.ready, true);
  assert.equal(plan.ordered_collation_chain.finding_count, 0);
  assert.equal(plan.ordered_collation_chain.files_checked, 812);
  assert.equal(plan.ordered_collation_chain.migration_files_checked, 811);
  assert.equal(plan.ordered_collation_chain.statements_checked, 3125);
  assert.equal(plan.ordered_collation_chain.database_connection_performed, false);
  assert.equal(plan.ordered_collation_chain.sql_mutation_performed, false);
  assert.equal(plan.ordered_collation_chain.provider_mutation_performed, false);
  assert.equal(plan.ordered_collation_chain.secrets_included, false);
  assert.equal(plan.ordered_enum_seed_chain.contract, "mad4b.mariadb-enum-seed-ordered-chain.v1");
  assert.equal(plan.ordered_enum_seed_chain.ok, true);
  assert.equal(plan.ordered_enum_seed_chain.ready, true);
  assert.equal(plan.ordered_enum_seed_chain.finding_count, 0);
  assert.equal(plan.ordered_enum_seed_chain.files_checked, 812);
  assert.equal(plan.ordered_enum_seed_chain.migration_files_checked, 811);
  assert.equal(plan.ordered_enum_seed_chain.statements_checked, 3125);
  assert.equal(plan.ordered_enum_seed_chain.enum_columns, 836);
  assert.equal(plan.ordered_enum_seed_chain.definitions_applied, 887);
  assert.equal(plan.ordered_enum_seed_chain.database_connection_performed, false);
  assert.equal(plan.ordered_enum_seed_chain.sql_mutation_performed, false);
  assert.equal(plan.ordered_enum_seed_chain.provider_mutation_performed, false);
  assert.equal(plan.ordered_enum_seed_chain.credential_access_performed, false);
  assert.equal(plan.ordered_enum_seed_chain.data_export_performed, false);
  assert.equal(plan.ordered_enum_seed_chain.runtime_mutation_performed, false);
  assert.equal(plan.ordered_enum_seed_chain.secrets_included, false);
  assert.equal(plan.ordered_text_width_chain.contract, "mad4b.mariadb-text-width-ordered-chain.v1");
  assert.equal(plan.ordered_text_width_chain.ok, true);
  assert.equal(plan.ordered_text_width_chain.ready, true);
  assert.equal(plan.ordered_text_width_chain.finding_count, 0);
  assert.equal(plan.ordered_text_width_chain.files_checked, 812);
  assert.equal(plan.ordered_text_width_chain.migration_files_checked, 811);
  assert.equal(plan.ordered_text_width_chain.statements_checked, 3125);
  assert.equal(plan.ordered_text_width_chain.bounded_text_columns, 5200);
  assert.equal(plan.ordered_text_width_chain.definitions_applied, 6032);
  assert.equal(plan.ordered_text_width_chain.insert_select_source_domain_checks, 933);
  assert.equal(plan.ordered_text_width_chain.insert_select_source_domain_overflows, 0);
  assert.equal(plan.ordered_text_width_chain.database_connection_performed, false);
  assert.equal(plan.ordered_text_width_chain.sql_mutation_performed, false);
  assert.equal(plan.ordered_text_width_chain.provider_mutation_performed, false);
  assert.equal(plan.ordered_text_width_chain.credential_access_performed, false);
  assert.equal(plan.ordered_text_width_chain.data_export_performed, false);
  assert.equal(plan.ordered_text_width_chain.runtime_mutation_performed, false);
  assert.equal(plan.ordered_text_width_chain.secrets_included, false);
  assert.deepEqual(plan.canonical_seed_lifecycle.seed_files.map((entry) => entry.file), [
    "039_sprint43_data_integrity_and_missing_tables.sql",
    "1043_sprint69_dynamic_container_hvac_activity_seed.sql",
    "20260815_custom_gpt_mcp_catalog_levels.sql",
  ]);
  assert.equal(plan.canonical_seed_lifecycle.readback_required, true);
  assert.equal(plan.ordered_preuse_audit.missing_table_gaps, 0);
  assert.equal(plan.ordered_preuse_audit.missing_column_gaps, 0);
  assert.equal(plan.ordered_preuse_audit.unique_true_preuse_gaps, 0);
  assert.ok(plan.ordered_preuse_audit.view_column_references_checked > 0);
  assert.ok(plan.ordered_preuse_audit.insert_arity_checks > 0);
  assert.equal(plan.ordered_preuse_audit.insert_arity_mismatches, 0);
  assert.ok(plan.ordered_preuse_audit.update_target_column_checks > 0);
  assert.equal(plan.ordered_preuse_audit.update_target_column_missing_columns, 0);
  assert.equal(plan.canonical_table_bootstrap.unresolved_missing_table_gaps, 0);
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
  assert.equal(bootstrap.unresolved_missing_table_gaps, 0);
  assert.ok(bootstrap.resolved_missing_table_gaps >= 18);
  assert.ok(bootstrap.table_count >= 19);
  assert.ok(bootstrap.view_count >= 0);
  assert.equal(plan.ordered_preuse_audit.missing_column_gaps, 0);
  assert.equal(plan.ordered_preuse_audit.missing_table_gaps, 0);
  assert.equal(plan.ordered_preuse_audit.unique_true_preuse_gaps, 0);
  assert.ok(plan.ordered_preuse_audit.insert_arity_checks > 0);
  assert.equal(plan.ordered_preuse_audit.insert_arity_mismatches, 0);
  assert.ok(plan.ordered_preuse_audit.same_statement_false_positives >= 500);
  assert.match(generator, /canonical table bootstrap leaves/iu);
  const authorizationRegistry = bootstrap.entries.find((entry) => entry.table === "capability_apply_authorization_policy_registry");
  assert.equal(authorizationRegistry.file, "307_sprint69_hostinger_deploy_restart_option_support.sql");
  assert.equal(authorizationRegistry.source_file, "902_sprint68_dynamic_capability_apply_authorization_policy.sql");
  assert.equal(authorizationRegistry.sha256.length, 64);
  assert.equal(
    bootstrap.entries.some((entry) => entry.table === "runtime_dispatch_certification_registry"),
    false,
    "runtime dispatch certification is no longer a pre-use gap under numeric ordering",
  );
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

test("generator preflight emits batch baseline and collation-chain contract evidence", () => {
  assert.match(generator, /function baselineColumnContracts/);
  assert.match(generator, /baseline_column_contract_sources/);
  assert.match(generator, /function createTableLikeSource/);
  assert.match(generator, /function baselineColumnExists/);
  assert.match(generator, /baseline_column_contracts: baseline\.baseline_column_contracts/);
  assert.match(generator, /function orderedCollationAudit/);
  assert.match(generator, /ordered_collation_chain: collationAuditMetadata/);
  assert.match(generator, /ordered_collation_chain_checked: true/);
  assert.match(generator, /function orderedEnumSeedAudit/);
  assert.match(generator, /ordered_enum_seed_chain: orderedEnumSeedMetadata/);
  assert.match(generator, /ordered_enum_seed_chain_checked: true/);
});

test("MariaDB collation repairs are narrow and precede first risky JOIN use", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const joinAlignment = fs.readFileSync(path.join(migrationsDir, "196_sprint67_mariadb_join_key_collation_alignment.sql"), "utf8");
  const joinAlignmentSql = joinAlignment.replace(/^\s*--[^\r\n]*(?:\r?\n|$)/gmu, "");
  assert.match(joinAlignmentSql, /MODIFY\s+user_id[\s\S]*utf8mb4_uca1400_ai_ci/iu);
  assert.match(joinAlignmentSql, /MODIFY\s+tenant_id[\s\S]*utf8mb4_uca1400_ai_ci/iu);
  assert.doesNotMatch(joinAlignmentSql, /(?:credential|secret|payload|metadata_json)/iu);
  const activationAlignment = fs.readFileSync(path.join(migrationsDir, "270_sprint68_z_mariadb_activation_join_key_collation_alignment.sql"), "utf8");
  const activationAlignmentSql = activationAlignment.replace(/^\s*--[^\r\n]*(?:\r?\n|$)/gmu, "");
  assert.match(activationAlignmentSql, /ALTER TABLE `app_integrations`[\s\S]*MODIFY `app_key`[\s\S]*utf8mb4_unicode_ci/iu);
  assert.match(activationAlignmentSql, /ALTER TABLE `user_app_connections`[\s\S]*MODIFY `connection_id`[\s\S]*utf8mb4_unicode_ci[\s\S]*MODIFY `app_key`[\s\S]*utf8mb4_unicode_ci/iu);
  assert.match(activationAlignmentSql, /ALTER TABLE `app_action_grants`[\s\S]*MODIFY `connection_id`[\s\S]*utf8mb4_unicode_ci[\s\S]*MODIFY `app_key`[\s\S]*utf8mb4_unicode_ci/iu);
  assert.match(activationAlignmentSql, /ALTER TABLE `tenant_integration_policies`[\s\S]*MODIFY `app_key`[\s\S]*utf8mb4_unicode_ci/iu);
  assert.match(activationAlignmentSql, /ALTER TABLE `workflows`[\s\S]*MODIFY `workflow_key`[\s\S]*utf8mb4_unicode_ci/iu);
  assert.match(activationAlignmentSql, /ALTER TABLE `workflow_runtime_bindings`[\s\S]*MODIFY `workflow_key`[\s\S]*utf8mb4_unicode_ci/iu);
  assert.doesNotMatch(activationAlignmentSql, /(?:credential|encrypted|token|secret|payload|metadata_json)/iu);
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  assert.ok(
    orderedMigrations.indexOf("270_sprint68_z_mariadb_activation_join_key_collation_alignment.sql")
      < orderedMigrations.indexOf("271_sprint68_activation_expanded_authorized_surfaces.sql"),
    "activation collation alignment must precede the first expanded authorized-surface view",
  );
  const provenance = fs.readFileSync(path.join(migrationsDir, "20260722_agent_skill_grant_approval_provenance.sql"), "utf8");
  assert.match(provenance, /ENGINE=InnoDB\s+DEFAULT CHARSET=utf8mb4\s+COLLATE=utf8mb4_unicode_ci/iu);
  assert.doesNotMatch(provenance, /approval_hold_id\s+VARCHAR\(36\)\s+CHARACTER SET utf8mb4 COLLATE/iu);
  const precreation = fs.readFileSync(path.join(migrationsDir, "20260721_z_mariadb_agent_skill_grant_request_precreation_collation.sql"), "utf8");
  assert.match(precreation, /ENGINE=InnoDB\s+DEFAULT CHARSET=utf8mb4\s+COLLATE=utf8mb4_uca1400_ai_ci/iu);
  assert.match(precreation, /approval_hold_id\s+VARCHAR\(36\)\s+CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/iu);
  const repositoryAlignment = fs.readFileSync(path.join(migrationsDir, "20260724_mariadb_repository_authority_system_collation_alignment.sql"), "utf8");
  const repositoryAlignmentSql = repositoryAlignment.replace(/^\s*--[^\r\n]*(?:\r?\n|$)/gmu, "");
  assert.match(repositoryAlignmentSql, /MODIFY\s+system_id[\s\S]*utf8mb4_uca1400_ai_ci/iu);
  assert.doesNotMatch(repositoryAlignmentSql, /(?:credential_ref|metadata_json|provider)/iu);
});

test("platform note and execution-policy text domains widen before every descriptive writer", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  const alignmentFile = "204_sprint67_zz_mariadb_platform_runtime_config_note_text_width_alignment.sql";
  const alignmentIndex = orderedMigrations.indexOf(alignmentFile);
  assert.notEqual(alignmentIndex, -1, "platform note/scope width alignment migration must exist");
  for (const writer of [
    "241_sprint67_google_ads_budget_preflight_ledger.sql",
    "243_sprint67_preflight_execution_gate_helper.sql",
    "906_sprint68_ticket_external_delivery_completion_certification.sql",
    "1040_sprint69_normalize_temporary_hostinger_gate_statuses.sql",
    "1041_sprint69_hard_disable_temporary_hostinger_executor_gate.sql",
  ]) {
    assert.ok(orderedMigrations.indexOf(writer) > alignmentIndex, `${writer} must run after platform text-width alignment`);
  }
  const alignment = fs.readFileSync(path.join(migrationsDir, alignmentFile), "utf8");
  assert.match(alignment, /ALTER TABLE platform_runtime_config[\s\S]*MODIFY COLUMN note TEXT NULL/iu);
  assert.match(alignment, /ALTER TABLE execution_policies[\s\S]*MODIFY COLUMN execution_scope TEXT NULL[\s\S]*MODIFY COLUMN affects_layer TEXT NULL/iu);
});

test("migration 1041 widens the runtime-config audit note before writing it", () => {
  const migration = fs.readFileSync(
    path.join(apiRoot, "migrations", "1041_sprint69_hard_disable_temporary_hostinger_executor_gate.sql"),
    "utf8",
  );
  const widenIndex = migration.indexOf("ALTER TABLE platform_runtime_config");
  const updateStatement = ["UPDATE", "platform_runtime_config"].join(" ");
  assert.notEqual(widenIndex, -1, "migration 1041 must widen the existing note column");
  assert.ok(
    widenIndex < migration.indexOf(updateStatement),
    "note widening must precede the audit writer",
  );
  assert.match(migration, /ALTER TABLE platform_runtime_config[\s\S]*MODIFY COLUMN note TEXT NULL/iu);
  const noteLiteral = migration.match(/^\s+note = '([^']*)',$/mu)?.[1] || "";
  assert.ok(noteLiteral.length > 255, "the 1041 audit note must exercise the widened contract");
});
