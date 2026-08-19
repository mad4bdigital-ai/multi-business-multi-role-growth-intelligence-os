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

function runPlan() {
  return spawnSync(process.execPath, [generatorPath, "--expected-commit", "1a6c94a9ce9ab9bf011ddf5d38b8a12cb99569b4", "--plan"], {
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
  assert.doesNotMatch(generator, /migrate-platform-tables\.mjs/);
});

test("generator plan-only mode inventories the exact migration chain", () => {
  const result = runPlan();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.plan_only, true);
  assert.equal(plan.expected_commit, "1a6c94a9ce9ab9bf011ddf5d38b8a12cb99569b4");
  assert.equal(plan.migration_count, 783);
  assert.equal(plan.confirmation_required, "BUILD_STAGING_SCHEMA_BUNDLE");
});
