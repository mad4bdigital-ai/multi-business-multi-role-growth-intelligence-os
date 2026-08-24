import assert from "node:assert/strict";
import test from "node:test";
import { buildHostBreakglassPlan, publicHostBreakglassCatalog, __hostBreakglassTest } from "./hostBreakglassCatalog.js";
const SHA = "a".repeat(40);
const MIGRATION = "20260815_custom_gpt_mcp_catalog_levels.sql";
test("catalog is repository-owned and database independent", () => {
  const catalog = publicHostBreakglassCatalog();
  assert.equal(catalog.database_independent, true);
  assert.equal(catalog.destructive_nonempty_rebuild.supported, false);
  assert.equal(catalog.operations.some((item) => item.key === "database.rebuild_empty"), true);
});
test("empty database rebuild is exact-sha and repository-contract bound", () => {
  const plan = buildHostBreakglassPlan({ operation_key: "database.rebuild_empty", action: "dry_run", expected_sha: SHA, migration: MIGRATION });
  assert.equal(plan.requires_zero_table_database, true);
  assert.equal(plan.dispatch_ref, "main");
  assert.equal(plan.target_branch, "Production");
  assert.equal(plan.destructive_nonempty_rebuild_allowed, false);
});
test("runtime_env mutation and uncataloged migration fail closed", () => {
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.repair", action: "apply_migration", expected_sha: SHA, target_source: "runtime_env", migration: MIGRATION }), /Target source is not allowed/u);
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.repair", action: "dry_run", expected_sha: SHA, migration: "arbitrary.sql" }), /not present/u);
});
test("Staging Windows Docker and Production Hostinger authorities cannot cross", () => {
  const staging = buildHostBreakglassPlan({ environment_key: "staging_local_windows_docker", operation_key: "database.inspect", action: "plan", expected_sha: SHA });
  const production = buildHostBreakglassPlan({ environment_key: "production_hostinger_autodeploy", operation_key: "database.inspect", action: "plan", expected_sha: SHA });
  assert.equal(staging.execution_transport, "local_cli");
  assert.equal(staging.host, "local_windows");
  assert.equal(staging.dispatch_ref, null);
  assert.equal(production.execution_transport, "github_workflow");
  assert.equal(production.host, "hostinger_cloud_business");
  assert.equal(production.dispatch_ref, "main");
});
test.after(() => __hostBreakglassTest.RUNS.clear());
