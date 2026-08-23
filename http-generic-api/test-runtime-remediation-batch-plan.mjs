import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const workingDirectory = process.cwd();
const root = fs.existsSync(path.join(workingDirectory, "http-generic-api"))
  ? workingDirectory
  : path.resolve(workingDirectory, "..");
const apiRoot = path.join(root, "http-generic-api");
const planPath = path.join(apiRoot, "config", "runtime-remediation-batch-plan.json");
const packagePath = path.join(apiRoot, "package.json");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const sha256 = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

assert.equal(plan.contract, "mad4b.runtime-remediation-batch.v1");
assert.equal(plan.status, "prepared-only");
assert.equal(plan.authority, "shadow-library-only");
assert.equal(plan.runtime_mutation_allowed, false);
assert.equal(plan.grant_mutation_allowed, false);
assert.equal(plan.migration_apply_allowed, false);
assert.equal(plan.production_activation_allowed, false);
assert.equal(plan.credentials_read_allowed, false);
assert.equal(plan.secrets_included, false);
assert.equal(plan.operator_approval_required, true);
assert.equal(packageJson.scripts["runtime:remediation:plan-check"], undefined);

for (const migration of plan.source_schema_migrations) {
  const migrationPath = path.join(apiRoot, "migrations", migration.migration);
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.equal(sha256(sql), migration.checksum_sha256, `${migration.migration} checksum drift`);
}

const catalog = plan.source_schema_migrations.find((entry) => entry.migration === "20260815_custom_gpt_mcp_catalog_levels.sql");
assert.ok(catalog);
assert.equal(catalog.database_role, "runtime");
assert.deepEqual(catalog.required_objects, [
  "admin_platform_endpoint_tools.mcp_catalog_level",
  "tenant_platform_endpoint_tools.mcp_catalog_level",
]);

assert.equal(plan.source_schema_migrations.length, 1, "only the unapplied MCP catalog migration may be applied");
const verificationOnly = new Map(plan.verification_only_migrations.map((entry) => [entry.migration, entry]));
for (const migration of [
  "225_sprint67_capability_resolution_envelope_ledger.sql",
  "1048_transport_response_chunk_schema_recovery.sql",
]) {
  const entry = verificationOnly.get(migration);
  assert.ok(entry, `${migration} must remain verification-only`);
  assert.equal(entry.apply_allowed, false);
  assert.equal(entry.required_result, "already_applied");
  const sql = fs.readFileSync(path.join(apiRoot, "migrations", migration), "utf8");
  assert.equal(sha256(sql), entry.checksum_sha256, `${migration} verification checksum drift`);
}

const inventory = plan.write_authority_profiles.find((entry) => entry.profile_key === "runtime_inventory_writer");
assert.ok(inventory);
assert.equal(inventory.identity_env_prefix, "RUNTIME_INVENTORY_DB_");
assert.equal(inventory.global_privileges_forbidden, true);
assert.equal(inventory.grant_option_forbidden, true);
assert.deepEqual(inventory.tables.map((entry) => entry.table), [
  "actions",
  "endpoints",
  "dynamic_audit_scheduler_runs",
  "openapi_endpoint_inventory_sync_runs",
]);

const session = plan.write_authority_profiles.find((entry) => entry.profile_key === "session_continuity_writer");
assert.ok(session);
assert.deepEqual(session.tables.map((entry) => entry.table), ["customer_sessions", "gpt_session_turns"]);

const observability = plan.write_authority_profiles.find((entry) => entry.profile_key === "observability_sink_writer");
assert.ok(observability);
assert.deepEqual(observability.tables.map((entry) => entry.table), ["execution_log", "json_assets"]);

for (const profile of plan.write_authority_profiles) {
  assert.equal(profile.same_cycle_readback_required, true);
  assert.equal(profile.global_privileges_forbidden, true);
  assert.equal(profile.grant_option_forbidden, true);
  for (const table of profile.tables) {
    assert.deepEqual(table.allowed_operations, ["SELECT", "INSERT", "UPDATE"]);
  }
}

assert.equal(plan.queue_policy.status, "decision_required");
assert.equal(plan.queue_policy.sql_fallback_path.allowed, true);
assert.ok(plan.execution_order.includes("runtime_deployment_exact_head_readback"));
assert.ok(plan.execution_order.indexOf("runner_integrity_acceptance_readback") < plan.execution_order.indexOf("mcp_catalog_levels_apply_operator_only"));
assert.ok(plan.execution_order.indexOf("migration_225_applied_ledger_dry_run_readback_only") < plan.execution_order.indexOf("mcp_catalog_levels_apply_operator_only"));
assert.ok(plan.execution_order.indexOf("migration_1048_applied_ledger_dry_run_readback_only") < plan.execution_order.indexOf("mcp_catalog_levels_apply_operator_only"));
assert.ok(!plan.execution_order.includes("capability_envelope_ledger_apply_operator_only"));
assert.ok(plan.execution_order.includes("migration_1051_readiness"));
assert.ok(plan.readiness_evidence.required_fields.includes("privilege_readback"));
assert.ok(plan.readiness_evidence.required_fields.includes("queue_policy_state"));


console.log(JSON.stringify({
  ok: true,
  contract: plan.contract,
  status: plan.status,
  migration_count: plan.source_schema_migrations.length,
  verification_only_migration_count: plan.verification_only_migrations.length,
  write_authority_profile_count: plan.write_authority_profiles.length,
  inventory_table_count: inventory.tables.length,
  queue_policy: plan.queue_policy.status,
  runtime_mutation_executed: false,
  grant_mutation_executed: false,
  secrets_included: false,
}));
