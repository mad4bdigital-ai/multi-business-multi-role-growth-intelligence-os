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
import { inspectOrderedMigrationChainGeneratedColumns, stripSqlComments } from "./databaseGeneratedColumnPolicyGuard.js";
import { inspectOrderedMigrationChainIndexKeyWidths } from "./databaseIndexKeyWidthPolicyGuard.js";
import { inspectOrderedMigrationChainRequiredInsertColumns } from "./databaseRequiredInsertColumnPolicyGuard.js";

const apiRoot = path.resolve(import.meta.dirname);
const repoRoot = path.resolve(apiRoot, "..");
const manifestPath = path.join(apiRoot, "config", "staging-database-role-migration-manifest.json");
const migrationPolicyPath = path.join(apiRoot, "config", "staging-migration-contract-policy.json");
const indexKeyWidthPolicyPath = path.join(apiRoot, "config", "database-index-key-width-policy.json");
const generatorPath = path.join(apiRoot, "scripts", "build-staging-schema-bundle.mjs");
const preuseAuditPath = path.join(apiRoot, "scripts", "audit-staging-migration-preuse.mjs");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const migrationPolicy = JSON.parse(fs.readFileSync(migrationPolicyPath, "utf8"));
const indexKeyWidthPolicy = JSON.parse(fs.readFileSync(indexKeyWidthPolicyPath, "utf8"));
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

test("schema dump uses the authenticated disposable MariaDB connection", () => {
  assert.match(generator, /function dbConnectionArgs\(extra = \[\]\) \{ return \[\"--protocol=socket\", \"-uroot\", `-p\$\{rootPassword\}`/);
  assert.match(generator, /\[containerName, \"mariadb-dump\", \.\.\.dbConnectionArgs\(\[\"--no-data\"/);
  assert.doesNotMatch(generator, /\[containerName, \"mariadb-dump\", \"--no-data\", \"--skip-triggers\"/);
});

test("schema dump mutation guard classifies top-level mutations without rejecting schema clauses", () => {
  assert.match(generator, /function stripLeadingSqlComments\(value\)/);
  assert.match(generator, /function findDataMutationStatements\(sql\)/);
  assert.match(generator, /const mutationStatements = findDataMutationStatements\(result\.stdout\)/);
  assert.doesNotMatch(generator, /if \(\/\b\(\?:INSERT\|REPLACE\|UPDATE\|DELETE\|LOAD\s\+DATA\)\b\/iu\.test\(result\.stdout\)\)/);

  const schemaOnlyDump = [
    "/* mariadb-dump header; semicolon-safe */",
    "CREATE TABLE `events` (`updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);",
    "/*!40101 SET @saved_cs_client = @@character_set_client */;",
  ].join("\n");
  const mutationDump = `${schemaOnlyDump}\nINSERT INTO \`events\` (\`id\`) VALUES (1);`;
  const classify = (sql) => splitStatements(sql)
    .map((source, index) => ({ index: index + 1, source: source.trim() }))
    .filter(({ source }) => {
      const upper = source.toUpperCase();
      return ["INSERT ", "REPLACE ", "UPDATE ", "DELETE ", "LOAD DATA "].some((prefix) => upper.startsWith(prefix));
    });

  assert.deepEqual(classify(schemaOnlyDump), []);
  assert.equal(classify(mutationDump).length, 1);
  assert.match(classify(mutationDump)[0].source, /^INSERT INTO/iu);
});

test("SQL splitter preserves semicolons inside quoted literals and strips comments safely", () => {
  const sql = `-- Values are provisioned separately; this schema contains no secret payloads.\nCREATE TABLE IF NOT EXISTS \`tenant_secrets\` (\`id\` BIGINT UNSIGNED NOT NULL);\nINSERT INTO \`tenant_secrets\` (\`metadata_json\`) VALUES (JSON_OBJECT('note', 'a;b'));\n/* block comment; remains data-safe */\nUPDATE \`tenant_secrets\` SET \`metadata_json\` = '{"value":"x;y"}' WHERE \`id\` = 1;`;
  assert.deepEqual(splitStatements(sql), [
    "CREATE TABLE IF NOT EXISTS `tenant_secrets` (`id` BIGINT UNSIGNED NOT NULL)",
    "INSERT INTO `tenant_secrets` (`metadata_json`) VALUES (JSON_OBJECT('note', 'a;b'))",
    "/* block comment; remains data-safe */\nUPDATE `tenant_secrets` SET `metadata_json` = '{\"value\":\"x;y\"}' WHERE `id` = 1",
  ]);
});

test("migration ordering uses deterministic bytewise tie-breaks for same-prefix parent and child files", () => {
  const parent = "20260611_activation_dynamic_tabs.sql";
  const child = "20260611_activation_dynamic_tabs_autodiscovery.sql";
  assert.equal(compareMigrationFiles(parent, child), -1);
  assert.equal(compareMigrationFiles(child, parent), 1);
  assert.deepEqual([child, parent].sort(compareMigrationFiles), [parent, child]);
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
  assert.deepEqual(migrationPolicy.foreign_key_compatibility_chain_contract, {
    enabled: true,
    engine: "mariadb",
    baseline_file: "http-generic-api/schema.sql",
    ordered_numeric_filename_and_lexicographic_tie_break: true,
    fail_on_type_mismatch: true,
    inspect_create_alter_foreign_keys: true,
    inspect_parent_unique_indexes: true,
    inspect_column_type_length_sign_charset_collation: true,
    allow_declared_additive_precreate_bridges: true,
    allow_declared_additive_baseline_alter_bridges: true,
    static_only: true,
    database_connection_allowed: false,
    sql_mutation_allowed: false,
    provider_access_allowed: false,
    credential_access_allowed: false,
    data_export_allowed: false,
    runtime_mutation_allowed: false,
    secrets_included: false,
    policy_key: "mariadb_foreign_key_compatibility_ordered_chain_v1",
    bridges: migrationPolicy.foreign_key_compatibility_chain_contract.bridges,
  });
  assert.deepEqual(migrationPolicy.foreign_key_compatibility_chain_contract.bridges.map((rule) => `${rule.table}:${rule.bridge_mode}:${rule.bridge_file}`).sort(), [
    "auth_email_outbox_delivery_attempts:idempotent_canonical_precreate:20260722_zzzzzz_mariadb_foreign_key_compatibility_auth_email_outbox_delivery_attempts.sql",
    "tenant_brand_links:idempotent_canonical_precreate:20260720_zzzzzz_mariadb_foreign_key_compatibility_tenant_brand_links.sql",
    "tenant_gpt_sso_sessions:idempotent_canonical_precreate:20260812_zzzzzz_mariadb_foreign_key_compatibility_tenant_gpt_sso_sessions.sql",
    "user_credentials:baseline_alter_column_shape:000_zzzzzz_mariadb_foreign_key_compatibility_user_credentials.sql",
    "user_credentials:baseline_alter_column_shape:003_zzzzzz_mariadb_foreign_key_compatibility_user_credentials_restore.sql",
  ]);
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
  assert.deepEqual(migrationPolicy.generated_column_chain_contract, {
    enabled: true,
    engine: "mariadb",
    baseline_file: "http-generic-api/schema.sql",
    ordered_numeric_filename_and_lexicographic_tie_break: true,
    fail_on_generated_column_write: true,
    inspect_create_alter_generated_columns: true,
    inspect_insert_replace_update_writers: true,
    include_canonical_table_bootstrap: true,
    static_only: true,
    database_connection_allowed: false,
    sql_mutation_allowed: false,
    provider_access_allowed: false,
    credential_access_allowed: false,
    data_export_allowed: false,
    runtime_mutation_allowed: false,
    secrets_included: false,
    generated_expression_compatibility: {
      enabled: true,
      static_only: true,
      fail_on_unsupported_functions: true,
      allow_declared_bridges: true,
      forbidden_function_names: ["lower", "lcase", "sha2"],
      max_allowed_bridges: 8,
      required_default_contract: {
        enabled: true,
        static_only: true,
        exact_literal_required: true,
        sentinel_overwritten_by_before_trigger: true,
        not_null_requires_default_migration: true,
      },
      bridges: migrationPolicy.generated_column_chain_contract.generated_expression_compatibility.bridges,
    },
    policy_key: "mariadb_generated_column_ordered_chain_v1",
  });
});

test("index-key-width contract is static-only and blocks utf8mb4 composite overflow", () => {
  assert.deepEqual(migrationPolicy.index_key_width_chain_contract, indexKeyWidthPolicy.index_key_width_chain_contract);
  assert.equal(indexKeyWidthPolicy.index_key_width_chain_contract.max_key_bytes, 3072);
  assert.equal(indexKeyWidthPolicy.index_key_width_chain_contract.static_only, true);
  const files = ["http-generic-api/migrations/fixture.sql"];
  const readFailing = (file) => new Map([
    ["http-generic-api/schema.sql", ""],
    ["http-generic-api/migrations/fixture.sql", "CREATE TABLE wide_key (a VARCHAR(700), b VARCHAR(128), c INT, UNIQUE KEY uq_wide (a,b,c)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"],
  ]).get(file);
  const failing = inspectOrderedMigrationChainIndexKeyWidths({ files, baselineFile: "http-generic-api/schema.sql", policy: indexKeyWidthPolicy, readFile: readFailing });
  assert.equal(failing.ok, false);
  assert.equal(failing.ready, false);
  assert.equal(failing.findings[0].code, "index_key_bytes_exceed_limit");
  assert.equal(failing.findings[0].estimated_key_bytes, 3316);
  const readPassing = (file) => new Map([
    ["http-generic-api/schema.sql", ""],
    ["http-generic-api/migrations/fixture.sql", "CREATE TABLE safe_key (scope_key VARCHAR(700), scope_key_hash BINARY(32), UNIQUE KEY uq_scope_hash (scope_key_hash)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"],
  ]).get(file);
  const passing = inspectOrderedMigrationChainIndexKeyWidths({ files, baselineFile: "http-generic-api/schema.sql", policy: indexKeyWidthPolicy, readFile: readPassing });
  assert.equal(passing.ok, true);
  assert.equal(passing.ready, true);
  assert.equal(passing.findings.length, 0);
});

test("required INSERT-column guard blocks omitted required columns and accepts an ordered DDL bridge", () => {
  const baseContract = migrationPolicy.required_insert_column_chain_contract;
  const fixtureBridge = "20260719_zzzz_mariadb_required_insert_column_platform_outbox_compatibility.sql";
  const fixtureWriter = "20260720_dynamic_growth_control_plane_foundation.sql";
  const fixturePolicy = {
    required_insert_column_chain_contract: {
      ...baseContract,
      required_tables: [{
        table: "platform_outbox_event_types",
        columns: ["producer_key"],
        default_bridge: {
          bridge_file: fixtureBridge,
          table: "platform_outbox_event_types",
          column: "producer_key",
          default_literal: "growth_control_plane",
          writer_files: [fixtureWriter],
        },
      }],
    },
  };
  const failingFiles = ["http-generic-api/migrations/20260711_outbox.sql", `http-generic-api/migrations/${fixtureWriter}`];
  const failingRead = (file) => new Map([
    ["http-generic-api/schema.sql", ""],
    [failingFiles[0], "CREATE TABLE platform_outbox_event_types (event_type VARCHAR(191) NOT NULL, producer_key VARCHAR(120) NOT NULL) ENGINE=InnoDB;"],
    [failingFiles[1], "INSERT INTO platform_outbox_event_types (event_type) VALUES ('x');"],
  ]).get(file);
  const failing = inspectOrderedMigrationChainRequiredInsertColumns({ files: failingFiles, baselineFile: "http-generic-api/schema.sql", engine: "mariadb", policy: fixturePolicy, readFile: failingRead });
  assert.equal(failing.ok, false);
  assert.equal(failing.findings[0].code, "required_insert_column_omitted");
  const passingFiles = ["http-generic-api/migrations/20260711_outbox.sql", `http-generic-api/migrations/${fixtureBridge}`, `http-generic-api/migrations/${fixtureWriter}`];
  const passingRead = (file) => new Map([
    ["http-generic-api/schema.sql", ""],
    [passingFiles[0], "CREATE TABLE platform_outbox_event_types (event_type VARCHAR(191) NOT NULL, producer_key VARCHAR(120) NOT NULL) ENGINE=InnoDB;"],
    [passingFiles[1], "ALTER TABLE platform_outbox_event_types MODIFY COLUMN producer_key VARCHAR(120) NOT NULL DEFAULT 'growth_control_plane';"],
    [passingFiles[2], "INSERT INTO platform_outbox_event_types (event_type) VALUES ('x');"],
  ]).get(file);
  const passing = inspectOrderedMigrationChainRequiredInsertColumns({ files: passingFiles, baselineFile: "http-generic-api/schema.sql", engine: "mariadb", policy: fixturePolicy, readFile: passingRead });
  assert.equal(passing.ok, true);
  assert.equal(passing.ready, true);
  assert.equal(passing.findings.length, 0);
  assert.equal(passing.allowed_bridge_omissions, 1);
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
  assert.equal(manifest.validation.required_runtime_table_census.length, 26);
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
  for (const file of overlongWriterFiles) assert.ok(orderedMigrations.indexOf(file) > compatibilityIndex, `${file} must run after binding_id compatibility migration`);
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

test("repo certification type enum alignment precedes migration 199 writer", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  const bridge = "198_sprint67_zzzz_repo_certification_runs_certification_type_enum_alignment.sql";
  const writer = "199_sprint67_skillpack_draft_catalog_and_advisory_routes.sql";
  assert.notEqual(orderedMigrations.indexOf(bridge), -1, "repo certification type enum bridge must exist");
  assert.notEqual(orderedMigrations.indexOf(writer), -1, "migration 199 writer must exist");
  assert.ok(orderedMigrations.indexOf(bridge) < orderedMigrations.indexOf(writer), "repo certification type enum bridge must precede migration 199 writer");
  const bridgeSql = fs.readFileSync(path.join(migrationsDir, bridge), "utf8");
  assert.match(bridgeSql, /ALTER TABLE repo_certification_runs/i);
  assert.match(bridgeSql, /MODIFY COLUMN certification_type ENUM\([\s\S]*path_scope/i);
  assert.match(bridgeSql, /CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/i);
  const ddl = bridgeSql.replace(/--[^\n]*(?:\n|$)/g, "");
  assert.doesNotMatch(ddl, /(?:^|;)\s*(?:INSERT|REPLACE|UPDATE|DELETE)\b/im);
});

test("workspace grant source enum alignment precedes migration 316 writer", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  const bridge = "316_sprint69_aaaa_workspace_resource_grants_source_enum_alignment.sql";
  const writer = "316_sprint69_safe_branch_cleanup_support.sql";
  assert.notEqual(orderedMigrations.indexOf(bridge), -1, "workspace grant source enum bridge must exist");
  assert.notEqual(orderedMigrations.indexOf(writer), -1, "migration 316 writer must exist");
  assert.ok(orderedMigrations.indexOf(bridge) < orderedMigrations.indexOf(writer), "workspace grant source enum bridge must precede migration 316 writer");
  const bridgeSql = fs.readFileSync(path.join(migrationsDir, bridge), "utf8");
  assert.match(bridgeSql, /ALTER TABLE workspace_resource_grants/i);
  assert.match(bridgeSql, /MODIFY COLUMN source ENUM\([\s\S]*workspace_registry_membership_backfill/i);
  assert.match(bridgeSql, /CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci/i);
  const ddl = bridgeSql.replace(/--[^\n]*(?:\n|$)/g, "");
  assert.doesNotMatch(ddl, /(?:^|;)\s*(?:INSERT|REPLACE|UPDATE|DELETE)\b/im);
});

test("generated current-contract key bridge surrounds every explicit historical writer", () => {
  const migrationsDir = path.join(apiRoot, "migrations");
  const orderedMigrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(compareMigrationFiles);
  const preWriterBridge = "1050_sprint69_zzzz_platform_capability_readback_generated_column_writer_compatibility.sql";
  const writer = "1051_github_repository_policy_live_apply_authority.sql";
  const postWriterBridge = "20260814_zzzz_platform_capability_readback_restore_generated_column.sql";
  const nextWriter = "20260815_custom_gpt_mcp_catalog_levels.sql";
  for (const file of [preWriterBridge, writer, postWriterBridge, nextWriter]) assert.notEqual(orderedMigrations.indexOf(file), -1, `${file} must exist`);
  assert.ok(orderedMigrations.indexOf(preWriterBridge) < orderedMigrations.indexOf(writer));
  assert.ok(orderedMigrations.indexOf(writer) < orderedMigrations.indexOf(postWriterBridge));
  assert.ok(orderedMigrations.indexOf(postWriterBridge) < orderedMigrations.indexOf(nextWriter));
  const generatedAudit = inspectOrderedMigrationChainGeneratedColumns({
    files: orderedMigrations.map((file) => `http-generic-api/migrations/${file}`),
    baselineFile: "http-generic-api/schema.sql",
    policy: migrationPolicy,
    bootstrapEntries: [],
    readFile: (file) => fs.readFileSync(path.join(repoRoot, file), "utf8"),
  });
  assert.equal(generatedAudit.ok, true, JSON.stringify(generatedAudit));
  assert.equal(generatedAudit.findings.length, 0);
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
  assert.match(generator, /canonicalSeedPlan/);
  assert.match(generator, /required_runtime_table_census/);
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
  assert.equal(plan.migration_count, 834);
  assert.equal(plan.statement_count, 3135);
  assert.equal(plan.confirmation_required, "BUILD_STAGING_SCHEMA_BUNDLE");
  for (const chain of [
    plan.ordered_collation_chain,
    plan.ordered_enum_seed_chain,
    plan.ordered_text_width_chain,
    plan.ordered_index_key_width_chain,
    plan.ordered_required_insert_column_chain,
    plan.ordered_generated_column_chain,
    plan.ordered_foreign_key_compatibility_chain,
  ]) {
    assert.equal(chain.ok, true);
    assert.equal(chain.ready, true);
    assert.equal(chain.finding_count, 0);
    assert.equal(chain.files_checked, 835);
    assert.equal(chain.migration_files_checked, 834);
    assert.equal(chain.statements_checked, 3162);
    assert.equal(chain.database_connection_performed, false);
    assert.equal(chain.sql_mutation_performed, false);
    assert.equal(chain.provider_mutation_performed, false);
  }
  assert.equal(plan.ordered_enum_seed_chain.enum_columns, 836);
  assert.equal(plan.ordered_enum_seed_chain.definitions_applied, 903);
  assert.equal(plan.ordered_text_width_chain.bounded_text_columns, 5202);
  assert.equal(plan.ordered_text_width_chain.definitions_applied, 6044);
  assert.equal(plan.ordered_text_width_chain.insert_select_source_domain_checks, 933);
  assert.equal(plan.ordered_text_width_chain.insert_select_source_domain_overflows, 0);
  assert.equal(plan.ordered_index_key_width_chain.tables_projected, 582);
  assert.equal(plan.ordered_index_key_width_chain.indexes_checked, 2850);
  assert.equal(plan.ordered_index_key_width_chain.index_columns_checked, 4837);
  assert.equal(plan.ordered_index_key_width_chain.max_key_bytes, 3072);
  assert.equal(plan.ordered_required_insert_column_chain.tables_projected, 585);
  assert.equal(plan.ordered_required_insert_column_chain.writer_checks, 11);
  assert.equal(plan.ordered_required_insert_column_chain.required_columns_checked, 11);
  assert.equal(plan.ordered_required_insert_column_chain.omitted_required_columns, 1);
  assert.equal(plan.ordered_required_insert_column_chain.allowed_bridge_omissions, 1);
  assert.equal(plan.ordered_generated_column_chain.generated_columns, 8);
  assert.equal(plan.ordered_generated_column_chain.definitions_applied, 8);
  assert.equal(plan.ordered_generated_column_chain.writer_checks, 3162);
  assert.equal(plan.ordered_generated_column_chain.generated_expression_checks, 20);
  assert.equal(plan.ordered_generated_column_chain.compatibility_bridge_candidates, 5);
  assert.equal(plan.ordered_generated_column_chain.unsupported_generated_expressions, 0);
  assert.equal(plan.ordered_generated_column_chain.allowed_compatibility_bridges, 5);
  assert.equal(plan.ordered_generated_column_chain.ordinary_column_trigger_bridges, 5);
  assert.equal(plan.ordered_foreign_key_compatibility_chain.tables_projected, 583);
  assert.equal(plan.ordered_foreign_key_compatibility_chain.foreign_keys_checked, 138);
  assert.equal(plan.ordered_foreign_key_compatibility_chain.type_comparisons, 140);
  assert.equal(plan.ordered_foreign_key_compatibility_chain.type_mismatches, 0);
  assert.equal(plan.ordered_foreign_key_compatibility_chain.unresolved_type_mismatches, 0);
  assert.equal(plan.ordered_foreign_key_compatibility_chain.missing_parent_tables, 0);
  assert.equal(plan.ordered_foreign_key_compatibility_chain.missing_parent_columns, 0);
  assert.equal(plan.ordered_foreign_key_compatibility_chain.missing_parent_indexes, 0);
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
  assert.ok(bootstrap.resolved_missing_table_gaps >= 11);
  assert.ok(bootstrap.table_count >= 12);
  assert.equal(plan.ordered_preuse_audit.missing_column_gaps, 0);
  assert.equal(plan.ordered_preuse_audit.missing_table_gaps, 0);
  assert.equal(plan.ordered_preuse_audit.unique_true_preuse_gaps, 0);
});
