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
  assert.equal(manifest.validation.required_runtime_table_census.length, 18);
  assert.deepEqual(manifest.validation.required_runtime_support_tables, ["connected_systems", "admin_platform_endpoint_tools", "tenant_platform_endpoint_tools", "customer_sessions", "gpt_session_turns"]);
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
  assert.equal(plan.migration_count, 783);
  assert.equal(plan.confirmation_required, "BUILD_STAGING_SCHEMA_BUNDLE");
  assert.deepEqual(plan.canonical_seed_lifecycle.seed_files.map((entry) => entry.file), [
    "039_sprint43_data_integrity_and_missing_tables.sql",
    "1043_sprint69_dynamic_container_hvac_activity_seed.sql",
    "20260815_custom_gpt_mcp_catalog_levels.sql",
  ]);
  assert.equal(plan.canonical_seed_lifecycle.readback_required, true);
});
