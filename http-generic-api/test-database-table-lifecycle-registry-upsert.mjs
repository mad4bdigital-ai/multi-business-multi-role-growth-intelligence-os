import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertDatabaseTableLifecycleRegistryUpsertAllowed,
  buildDatabaseTableLifecycleRegisterPlan,
  DATABASE_TABLE_LIFECYCLE_REFRESH_CONFIRMATION,
  DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION,
  planDatabaseTableLifecycleRegistryUpsert,
} from "./databaseTableLifecycle.js";

const script = fs.readFileSync(
  new URL("./scripts/database-table-lifecycle-registry-upsert.mjs", import.meta.url),
  "utf8"
);
const ownerEngineMigration = fs.readFileSync(
  new URL("./migrations/201_sprint68_lifecycle_owner_engine_registry_alignment.sql", import.meta.url),
  "utf8"
);
const governedMigrationRunner = fs.readFileSync(
  new URL("./scripts/governed-migration-runner.mjs", import.meta.url),
  "utf8"
);

assert(script.includes("database_table_lifecycle_registry"), "script must target lifecycle registry");
assert(script.includes("ON DUPLICATE KEY UPDATE"), "script must be idempotent");
assert(script.includes("--include-existing"), "script must require an explicit flag before refreshing existing rows");
assert(script.includes("no_drop"), "script response must preserve no-drop signal");
assert(script.includes("no_archive_execution"), "script response must preserve no-archive signal");

for (const destructiveSql of [/^\s*DROP\s+TABLE\b/mi, /^\s*TRUNCATE\s+TABLE\b/mi, /^\s*DELETE\s+FROM\b/mi]) {
  assert(!destructiveSql.test(script), `lifecycle upsert script must not include destructive SQL statement ${destructiveSql}`);
}

const dryRunGate = assertDatabaseTableLifecycleRegistryUpsertAllowed({ apply: false });
assert.equal(dryRunGate.allowed, false);
assert.equal(dryRunGate.mode, "dry_run");
assert.equal(dryRunGate.selection_mode, "missing_only");
assert.equal(dryRunGate.required_confirmation, DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION);

assert.throws(
  () => assertDatabaseTableLifecycleRegistryUpsertAllowed({ apply: true, confirm: "WRONG" }),
  /APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT/,
  "apply must require the exact confirmation token"
);

const applyGate = assertDatabaseTableLifecycleRegistryUpsertAllowed({
  apply: true,
  confirm: DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION,
});
assert.equal(applyGate.allowed, true);
assert.equal(applyGate.mode, "apply");
assert.equal(applyGate.selection_mode, "missing_only");

const refreshDryRunGate = assertDatabaseTableLifecycleRegistryUpsertAllowed({ apply: false, includeExisting: true });
assert.equal(refreshDryRunGate.selection_mode, "include_existing");
assert.equal(refreshDryRunGate.required_confirmation, DATABASE_TABLE_LIFECYCLE_REFRESH_CONFIRMATION);
assert.throws(
  () => assertDatabaseTableLifecycleRegistryUpsertAllowed({
    apply: true,
    includeExisting: true,
    confirm: DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION,
  }),
  new RegExp(DATABASE_TABLE_LIFECYCLE_REFRESH_CONFIRMATION),
  "refreshing existing registry rows must require a distinct confirmation token"
);

const plan = buildDatabaseTableLifecycleRegisterPlan([
  {
    table_name: "platform_audit_event_bus",
    approx_rows: 0,
    size_mb: 0.078,
    column_names: ["event_id", "source_family", "status", "created_at"],
  },
]);
assert.equal(plan.dry_run, true);
assert.equal(plan.will_write, false);
assert.equal(plan.no_drop, true);
assert.equal(plan.no_archive_execution, true);
assert.equal(plan.target_table, "database_table_lifecycle_registry");
assert.equal(plan.upsert_count, 1);

const lifecycleRows = [
  {
    table_name: "already_registered",
    approx_rows: 5,
    size_mb: 0.1,
    column_names: "id,status",
    lifecycle_registered: "1",
  },
  {
    table_name: "new_unregistered_table",
    approx_rows: 0,
    size_mb: 0.1,
    column_names: "id,status",
    lifecycle_registered: "0",
  },
];
const fakePool = {
  async query() {
    return [lifecycleRows];
  },
};
const missingOnlyPlan = await planDatabaseTableLifecycleRegistryUpsert({ limit: 1000 }, { pool: fakePool });
assert.equal(missingOnlyPlan.selection_mode, "missing_only");
assert.equal(missingOnlyPlan.live_table_count, 2);
assert.equal(missingOnlyPlan.existing_registry_count, 1);
assert.equal(missingOnlyPlan.upsert_count, 1);
assert.equal(missingOnlyPlan.upsert_rows[0].table_name, "new_unregistered_table");

const refreshPlan = await planDatabaseTableLifecycleRegistryUpsert(
  { limit: 1000, include_existing: true },
  { pool: fakePool }
);
assert.equal(refreshPlan.selection_mode, "include_existing");
assert.equal(refreshPlan.upsert_count, 2);

const ownershipPlan = buildDatabaseTableLifecycleRegisterPlan([
  { table_name: "policy_logic_bindings", approx_rows: 10, size_mb: 0.1 },
  { table_name: "workspace_resource_grants", approx_rows: 10, size_mb: 0.1 },
  { table_name: "connected_execution_sessions", approx_rows: 10, size_mb: 0.1 },
  { table_name: "database_collation_policy_registry", approx_rows: 10, size_mb: 0.1 },
  { table_name: "platform_private_packages", approx_rows: 10, size_mb: 0.1 },
  { table_name: "repo_ingestion_jobs", approx_rows: 10, size_mb: 0.1 },
  { table_name: "database_lifecycle_report_snapshots", approx_rows: 10, size_mb: 0.1 },
  { table_name: "tenant_ssh_cli_approval_requests", approx_rows: 0, size_mb: 0.1 },
  { table_name: "growth_intelligence_actions", approx_rows: 10, size_mb: 0.1 },
  { table_name: "execution_plan_steps", approx_rows: 10, size_mb: 0.1 },
  { table_name: "execution_plan_events", approx_rows: 10, size_mb: 0.1 },
]);
const expectedOwnerEngineByTable = new Map([
  ["policy_logic_bindings", "platform_contract_governance_engine"],
  ["workspace_resource_grants", "resource_authority_engine"],
  ["connected_execution_sessions", "workflow_runtime_engine"],
  ["database_collation_policy_registry", "schema_cleanup_engine"],
  ["platform_private_packages", "platform_private_capability_vault_engine"],
  ["repo_ingestion_jobs", "developer_platform_lifecycle_engine"],
  ["database_lifecycle_report_snapshots", "database_table_lifecycle_engine"],
  ["tenant_ssh_cli_approval_requests", "workflow_runtime_engine"],
  ["growth_intelligence_actions", "workflow_runtime_engine"],
  ["execution_plan_steps", "workflow_runtime_engine"],
  ["execution_plan_events", "workflow_runtime_engine"],
]);
assert.equal(ownershipPlan.upsert_rows.length, expectedOwnerEngineByTable.size);
for (const row of ownershipPlan.upsert_rows) {
  assert.equal(
    row.owner_engine_key,
    expectedOwnerEngineByTable.get(row.table_name),
    `unexpected lifecycle owner for ${row.table_name}`,
  );
}
assert(ownershipPlan.upsert_rows.every(({ usage_status }) => usage_status !== "runtime_unclassified"));
assert(
  !ownershipPlan.buckets.unlinked.includes("database_lifecycle_report_snapshots"),
  "explicit database lifecycle family ownership must not be reported as unlinked",
);
const tenantSshApprovalLifecycle = ownershipPlan.upsert_rows.find(
  ({ table_name }) => table_name === "tenant_ssh_cli_approval_requests"
);
assert.equal(tenantSshApprovalLifecycle.usage_status, "runtime_canonical");
assert.equal(tenantSshApprovalLifecycle.retention_class, "approval_audit");
assert(
  !ownershipPlan.buckets.archive_candidate.includes("tenant_ssh_cli_approval_requests"),
  "active tenant SSH approval authority must never be classified as an archive candidate",
);
for (const engineKey of [
  "developer_platform_lifecycle_engine",
  "platform_contract_governance_engine",
  "workflow_runtime_engine",
]) {
  assert(
    ownerEngineMigration.includes(`'${engineKey}'`),
    `${engineKey} must be reproducible from the migration ledger`,
  );
}
assert(ownerEngineMigration.includes("ON DUPLICATE KEY UPDATE"), "owner engine alignment migration must be idempotent");
assert(
  governedMigrationRunner.includes('"201_sprint68_lifecycle_owner_engine_registry_alignment.sql"'),
  "owner engine alignment migration must be allowlisted for governed apply",
);

const taxonomyV2Plan = buildDatabaseTableLifecycleRegisterPlan([
  { table_name: "platform_audit_event_bus", approx_rows: 25000, size_mb: 25 },
  { table_name: "activation_runs", approx_rows: 15, size_mb: 0.2 },
  { table_name: "activation_policy_registry", approx_rows: 4, size_mb: 0.1 },
  { table_name: "runtime_verification_steps", approx_rows: 20, size_mb: 0.2 },
  { table_name: "session_insight_candidates", approx_rows: 5, size_mb: 0.1 },
  { table_name: "session_insight_review_events", approx_rows: 8, size_mb: 0.1 },
  { table_name: "platform_resource_authority_bindings", approx_rows: 3, size_mb: 0.1 },
  { table_name: "cms_site_access_grants", approx_rows: 5, size_mb: 0.1 },
  { table_name: "platform_orchestration_state_snapshots", approx_rows: 10, size_mb: 0.1 },
  { table_name: "ticket_lifecycle_events", approx_rows: 12, size_mb: 0.1 },
  { table_name: "external_delivery_provider_adapter_contract_registry", approx_rows: 6, size_mb: 0.1 },
  { table_name: "governed_migration_authorization_registry", approx_rows: 7, size_mb: 0.1 },
  { table_name: "admin_platform_endpoint_tools", approx_rows: 200, size_mb: 1 },
  { table_name: "agent_model_runs", approx_rows: 11, size_mb: 0.1 },
  { table_name: "ai_model_registry", approx_rows: 2, size_mb: 0.1 },
]);
const taxonomyV2ByTable = new Map(taxonomyV2Plan.upsert_rows.map((row) => [row.table_name, row]));
for (const tableName of taxonomyV2ByTable.keys()) {
  assert.notEqual(
    taxonomyV2ByTable.get(tableName).usage_status,
    "runtime_unclassified",
    `${tableName} must not fall through to runtime_unclassified`,
  );
}
assert.equal(taxonomyV2ByTable.get("platform_audit_event_bus").table_family, "dynamic_audit_pipeline");
assert.equal(taxonomyV2ByTable.get("platform_audit_event_bus").usage_status, "runtime_log");
assert.equal(taxonomyV2ByTable.get("activation_runs").table_family, "activation_runtime");
assert.equal(taxonomyV2ByTable.get("activation_runs").usage_status, "runtime_log");
assert.equal(taxonomyV2ByTable.get("activation_policy_registry").usage_status, "runtime_registry");
assert.equal(taxonomyV2ByTable.get("runtime_verification_steps").usage_status, "runtime_log");
assert.equal(taxonomyV2ByTable.get("session_insight_candidates").usage_status, "runtime_canonical");
assert.equal(taxonomyV2ByTable.get("session_insight_review_events").usage_status, "runtime_log");
assert.equal(taxonomyV2ByTable.get("platform_resource_authority_bindings").owner_engine_key, "resource_authority_engine");
assert.equal(taxonomyV2ByTable.get("cms_site_access_grants").table_family, "cms_resource_authority");
assert.equal(taxonomyV2ByTable.get("platform_orchestration_state_snapshots").usage_status, "runtime_log");
assert.equal(taxonomyV2ByTable.get("ticket_lifecycle_events").table_family, "ticket_lifecycle");
assert.equal(taxonomyV2ByTable.get("external_delivery_provider_adapter_contract_registry").table_family, "external_delivery");
assert.equal(taxonomyV2ByTable.get("governed_migration_authorization_registry").table_family, "platform_runtime_governance");
assert.equal(taxonomyV2ByTable.get("admin_platform_endpoint_tools").usage_status, "runtime_registry");
assert.equal(taxonomyV2ByTable.get("agent_model_runs").usage_status, "runtime_log");
assert.equal(taxonomyV2ByTable.get("ai_model_registry").usage_status, "runtime_registry");

for (const tableName of [
  "repair_backup_actions",
  "repair_backup_platform_audit_event_bus",
  "rb_platform_tool_dispatch_bindings",
]) {
  const backupRow = buildDatabaseTableLifecycleRegisterPlan([
    { table_name: tableName, approx_rows: 12, size_mb: 0.1 },
  ]).upsert_rows[0];
  assert.equal(backupRow.usage_status, "backup_snapshot", `${tableName} must preserve backup precedence`);
  assert.equal(backupRow.table_family, "backup_repair_snapshot", `${tableName} must keep backup family`);
  assert.equal(backupRow.write_strategy, "read_only", `${tableName} must remain read only`);
}

console.log("database table lifecycle registry upsert tests passed");
