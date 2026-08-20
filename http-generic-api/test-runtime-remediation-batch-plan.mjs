import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const planPath = path.join(root, "http-generic-api", "config", "runtime-remediation-batch-plan.json");
const packagePath = path.join(root, "http-generic-api", "package.json");
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
  const migrationPath = path.join(root, "http-generic-api", "migrations", migration.migration);
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

const envelope = plan.source_schema_migrations.find((entry) => entry.migration === "225_sprint67_capability_resolution_envelope_ledger.sql");
assert.ok(envelope);
assert.equal(envelope.database_role, "governance");
assert.ok(envelope.required_objects.includes("capability_resolution_envelope_ledger"));

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

assert.equal(plan.queue_policy.status, "decision_required");
assert.equal(plan.queue_policy.sql_fallback_path.allowed, true);
assert.ok(plan.execution_order.includes("runtime_deployment_exact_head_readback"));
assert.ok(plan.execution_order.includes("migration_1051_readiness"));
assert.ok(plan.readiness_evidence.required_fields.includes("privilege_readback"));
assert.ok(plan.readiness_evidence.required_fields.includes("queue_policy_state"));


console.log(JSON.stringify({
  ok: true,
  contract: plan.contract,
  status: plan.status,
  migration_count: plan.source_schema_migrations.length,
  inventory_table_count: inventory.tables.length,
  queue_policy: plan.queue_policy.status,
  runtime_mutation_executed: false,
  grant_mutation_executed: false,
  secrets_included: false,
}));
