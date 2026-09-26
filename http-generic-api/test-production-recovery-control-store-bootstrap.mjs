// frontend-surface-operation: get /admin/recovery-bootstrap/status
// frontend-surface-operation: post /admin/recovery-bootstrap/plan
// frontend-surface-operation: post /admin/recovery-bootstrap/apply

import assert from "node:assert/strict";
import {
  PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION,
  _testingProductionRecoveryControlStoreBootstrap,
  applyProductionRecoveryControlStoreBootstrapPlan,
  buildProductionRecoveryControlStoreBootstrapPlan,
  inspectProductionRecoveryControlStoreBootstrap,
} from "./productionRecoveryControlStoreBootstrap.js";
import { RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS } from "./productionRecoveryControlStore.js";

const SHA = "a".repeat(40);

function identityReader() {
  return {
    ok: true,
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Production",
    sha: SHA,
    commit_sha: SHA,
    manifest_bound: true,
    secrets_included: false,
  };
}

function runtimeResolver() {
  return {
    ok: true,
    environment_key: "production",
    runtime_class: "hostinger_autodeploy",
    runtime_class_explicit: true,
  };
}

function bindingStatusReader({ env } = {}) {
  const live = env?.RECOVERY_SERVER_MANAGED_BINDING_MODE === "production_live";
  const moduleConfigured = Boolean(env?.RECOVERY_SERVER_MANAGED_BINDING_MODULE);
  return {
    mode: live ? "production_live" : "disabled",
    requested_mode: live ? "production_live" : "disabled",
    module_configured: moduleConfigured,
    module_id_hash: moduleConfigured ? "b".repeat(64) : null,
    binding_source: "server_managed",
    secrets_included: false,
  };
}

const configuredEnv = {
  DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy",
  RECOVERY_CONTROL_DB_HOST: "db.internal.invalid",
  RECOVERY_CONTROL_DB_NAME: "recovery_control",
  RECOVERY_CONTROL_DB_USER: "recovery_control_user",
  RECOVERY_CONTROL_DB_PASSWORD: "test-only-password",
};

{
  const status = await inspectProductionRecoveryControlStoreBootstrap(
    { expected_sha: SHA },
    {
      env: {},
      identityReader,
      runtimeResolver,
      bindingStatusReader,
      readinessReader: async () => ({
        ready: false,
        config_complete: false,
        connection_ready: false,
        schema_ready: false,
        error_code: "RECOVERY_CONTROL_DB_CONFIG_MISSING",
        database_connection_performed: false,
        database_mutation_performed: false,
        secrets_included: false,
      }),
    },
  );
  assert.equal(status.next_action, "blocked_control_store_configuration");
  assert.equal(status.execution_allowed, false);
  assert.equal(status.scope_boundaries.rebuild_execution_in_scope, false);
  assert.equal(status.scope_boundaries.grant_mutation_in_scope, false);
  assert.equal(status.scope_boundaries.ordinary_migration_in_scope, false);
  assert.equal(status.scope_boundaries.hostinger_environment_write_in_scope, false);
  assert.equal(status.database_mutation_performed, false);
  assert.equal(status.provider_mutation_performed, false);
  assert.equal(status.production_runtime_mutation_performed, false);
}

{
  const deps = {
    env: configuredEnv,
    identityReader,
    runtimeResolver,
    bindingStatusReader,
    readinessReader: async () => ({
      ready: false,
      config_complete: true,
      connection_ready: true,
      schema_ready: false,
      error_code: "RECOVERY_CONTROL_STORE_SCHEMA_NOT_READY",
      missing_tables: ["recovery_control_records"],
      missing_columns: [],
      missing_indexes: [],
      independent_of_target_databases: true,
      database_connection_performed: true,
      database_mutation_performed: false,
      secrets_included: false,
    }),
  };
  const first = await buildProductionRecoveryControlStoreBootstrapPlan({ expected_sha: SHA }, deps);
  const second = await buildProductionRecoveryControlStoreBootstrapPlan({ expected_sha: SHA }, deps);
  assert.equal(first.action, "reconcile_control_store_schema");
  assert.equal(first.execution_allowed, true);
  assert.equal(first.required_confirmation, PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION);
  assert.equal(first.plan_sha256, second.plan_sha256);
  assert.equal(first.schema_statement_count, RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.length);
  assert.equal(first.runtime_env_write_allowed, false);
  assert.equal(first.database_or_user_creation_allowed, false);
  assert.equal(first.target_database_mutation_allowed, false);
  assert.equal(first.raw_sql_from_caller_allowed, false);
}

{
  const plan = await buildProductionRecoveryControlStoreBootstrapPlan(
    { expected_sha: SHA },
    {
      env: configuredEnv,
      identityReader,
      runtimeResolver,
      bindingStatusReader,
      readinessReader: async () => ({
        ready: false,
        config_complete: true,
        connection_ready: true,
        schema_ready: false,
        error_code: "RECOVERY_CONTROL_STORE_SCHEMA_NOT_READY",
        missing_tables: [],
        missing_columns: ["recovery_control_records.payload_sha256"],
        missing_indexes: [],
        independent_of_target_databases: true,
        database_connection_performed: true,
        database_mutation_performed: false,
        secrets_included: false,
      }),
    },
  );
  assert.equal(plan.action, "blocked_control_store_schema_drift");
  assert.equal(plan.execution_allowed, false);
  assert.equal(plan.blocker, "RECOVERY_CONTROL_STORE_PARTIAL_SCHEMA_REQUIRES_SEPARATE_MIGRATION");
  assert.equal(plan.required_confirmation, null);
}

{
  const env = {
    ...configuredEnv,
    RECOVERY_SERVER_MANAGED_BINDING_MODE: "production_live",
    RECOVERY_SERVER_MANAGED_BINDING_MODULE: "./productionRecoveryBaselineAuthorityBinding.js",
  };
  const status = await inspectProductionRecoveryControlStoreBootstrap(
    { expected_sha: SHA },
    {
      env,
      identityReader,
      runtimeResolver,
      bindingStatusReader,
      readinessReader: async () => ({
        ready: true,
        config_complete: true,
        connection_ready: true,
        schema_ready: true,
        error_code: null,
        independent_of_target_databases: true,
        database_connection_performed: true,
        database_mutation_performed: false,
        secrets_included: false,
      }),
    },
  );
  assert.equal(status.binding.readiness_verified, false);
  assert.equal(status.next_action, "durable_reinspection_required");
  assert.equal(status.execution_allowed, false);
  assert.equal(status.pre_rebuild_sequence.find((x) => x.key === "server_managed_recovery_binding_configured")?.ready, true);
  assert.equal(status.pre_rebuild_sequence.find((x) => x.key === "durable_full_inspection")?.ready, false);
  assert.equal(status.pre_rebuild_sequence.find((x) => x.key === "role_selection_provenance_bound")?.pending_after, "durable_full_inspection");
  assert.equal(status.pre_rebuild_sequence.find((x) => x.key === "role_bundle_bindings_bound")?.pending_after, "durable_full_inspection");
}

{
  const deps = {
    env: configuredEnv,
    identityReader,
    runtimeResolver,
    bindingStatusReader,
    readinessReader: async () => ({
      ready: false,
      config_complete: true,
      connection_ready: true,
      schema_ready: false,
      error_code: "RECOVERY_CONTROL_STORE_SCHEMA_NOT_READY",
      missing_tables: ["recovery_control_locks"],
      independent_of_target_databases: true,
      database_connection_performed: true,
      database_mutation_performed: false,
      secrets_included: false,
    }),
  };
  const plan = await buildProductionRecoveryControlStoreBootstrapPlan({ expected_sha: SHA }, deps);
  await assert.rejects(
    () => applyProductionRecoveryControlStoreBootstrapPlan({
      expected_sha: SHA,
      plan_sha256: "f".repeat(64),
      confirmation: PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION,
    }, deps),
    (error) => error?.code === "RECOVERY_CONTROL_STORE_BOOTSTRAP_PLAN_STALE",
  );
  assert.match(plan.plan_sha256, /^[0-9a-f]{64}$/u);
}

{
  let readinessCalls = 0;
  const executed = [];
  const fakePool = {
    async query(statement) {
      executed.push(statement);
      return [{ affectedRows: 0 }, []];
    },
  };
  const deps = {
    env: configuredEnv,
    identityReader,
    runtimeResolver,
    bindingStatusReader,
    poolProvider: () => fakePool,
    readinessReader: async () => {
      readinessCalls += 1;
      if (readinessCalls <= 2) {
        return {
          ready: false,
          config_complete: true,
          connection_ready: true,
          schema_ready: false,
          error_code: "RECOVERY_CONTROL_STORE_SCHEMA_NOT_READY",
          missing_tables: ["recovery_control_locks"],
          independent_of_target_databases: true,
          database_connection_performed: true,
          database_mutation_performed: false,
          secrets_included: false,
        };
      }
      return {
        ready: true,
        config_complete: true,
        connection_ready: true,
        schema_ready: true,
        error_code: null,
        independent_of_target_databases: true,
        database_connection_performed: true,
        database_mutation_performed: false,
        secrets_included: false,
      };
    },
  };
  const plan = await buildProductionRecoveryControlStoreBootstrapPlan({ expected_sha: SHA }, deps);
  const receipt = await applyProductionRecoveryControlStoreBootstrapPlan({
    expected_sha: SHA,
    plan_sha256: plan.plan_sha256,
    confirmation: PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION,
  }, deps);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.status, "control_store_schema_ready");
  assert.equal(receipt.same_cycle_readback_performed, true);
  assert.equal(receipt.next_action, "runtime_binding_activation_required");
  assert.equal(receipt.target_database_mutation_performed, false);
  assert.equal(receipt.provider_mutation_performed, false);
  assert.equal(receipt.production_runtime_mutation_performed, false);
  assert.equal(executed.length, RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.length);
  assert.deepEqual(executed, [...RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS]);
}

{
  const steps = _testingProductionRecoveryControlStoreBootstrap.buildPreRebuildSequence({
    readiness: { ready: true, config_complete: true, connection_ready: true, schema_ready: true },
    binding: { mode: "production_live", module_configured: true },
  });
  assert.deepEqual(
    steps.map((step) => step.key),
    [
      "recovery_control_store_configured",
      "recovery_control_store_connection_ready",
      "recovery_control_store_schema_ready",
      "server_managed_recovery_binding_configured",
      "durable_full_inspection",
      "role_selection_provenance_bound",
      "role_bundle_bindings_bound",
      "governance_baseline_ready",
      "runtime_persistence_baseline_ready",
      "canonical_grants_readback_ready",
      "governance_authority_ready",
      "ordinary_migration_ready",
    ],
  );
}



// Exercise the real metadata reader and classifier together, not a mocked ready flag.
const { getRecoveryControlStoreReadiness, RECOVERY_CONTROL_STORE_SCHEMA_INVENTORY, _testingRecoveryControlDb } =
  await import("./recoveryControlDb.js");
const inventory = RECOVERY_CONTROL_STORE_SCHEMA_INVENTORY;
assert.equal(Object.keys(inventory).length, 11);
const metadata = {
  tables: Object.keys(inventory).map((TABLE_NAME) => ({ TABLE_NAME, TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_COLLATION: "utf8mb4_unicode_ci" })),
  columns: Object.entries(inventory).flatMap(([TABLE_NAME, table]) => Object.entries(table.columns).map(([COLUMN_NAME, column]) => ({
    TABLE_NAME, COLUMN_NAME, COLUMN_TYPE: column.type, IS_NULLABLE: column.nullable ? "YES" : "NO",
    COLUMN_DEFAULT: column.default, EXTRA: column.on_update ? "on update current_timestamp(6)" : "",
    COLLATION_NAME: /^(?:varchar|char|longtext)/u.test(column.type) ? "utf8mb4_unicode_ci" : null,
  }))),
  indexes: Object.entries(inventory).flatMap(([TABLE_NAME, table]) => table.indexes.map((index, i) => ({
    TABLE_NAME, INDEX_NAME: index.primary ? "PRIMARY" : `fixture_${i}`, columns: index.columns,
    NON_UNIQUE: index.unique ? 0 : 1, INDEX_TYPE: "BTREE",
  }))),
};
function metadataPool(data, { onRelease = () => {}, readError = null } = {}) {
  return { async getConnection() { return {
    async ping() {}, release: onRelease,
    async query(sql, params) {
      assert.equal(params[0], configuredEnv.RECOVERY_CONTROL_DB_NAME);
      assert.equal(params.length, 12, "all eleven tables must be queried");
      if (readError) throw readError;
      if (sql.includes("information_schema.COLUMNS")) return [data.columns];
      if (sql.includes("information_schema.STATISTICS")) return [data.indexes];
      if (sql.includes("information_schema.TABLES")) return [data.tables];
      assert.fail("readiness must only issue fixed metadata SELECTs");
    },
  }; } };
}
async function schemaStatus(data, options) {
  return getRecoveryControlStoreReadiness({ env: configuredEnv, poolProvider: () => metadataPool(data, options) });
}
function classify(readiness) {
  return _testingProductionRecoveryControlStoreBootstrap.classifyAction({ readiness, binding: {} });
}
const emptyMetadata = { tables: [], columns: [], indexes: [] };
const emptyReadiness = await schemaStatus(emptyMetadata);
assert.equal(emptyReadiness.missing_tables.length, 11);
assert.deepEqual(emptyReadiness.missing_indexes, []);
assert.equal(classify(emptyReadiness).action, "reconcile_control_store_schema");
const completeReadiness = await schemaStatus(metadata);
assert.equal(completeReadiness.ready, true);
assert.equal(completeReadiness.mutation_grade_schema_ready, true);
assert.equal(completeReadiness.schema_scope, "mutation_grade");

const inspectionTables = new Set(["recovery_control_records", "recovery_control_run_idempotency", "recovery_control_idempotency_receipts", "recovery_control_evidence_events"]);
const inspectionOnly = Object.fromEntries(Object.entries(metadata).map(([key, rows]) => [key, rows.filter((row) => inspectionTables.has(row.TABLE_NAME))]));
assert.equal((await schemaStatus(inspectionOnly)).mutation_grade_schema_ready, false);
assert.equal((await schemaStatus(inspectionOnly)).missing_tables.length, 7);

for (const table of Object.keys(inventory)) {
  const missing = Object.fromEntries(Object.entries(metadata).map(([key, rows]) => [key, rows.filter((row) => row.TABLE_NAME !== table)]));
  const status = await schemaStatus(missing);
  assert.equal(status.ready, false, table);
  assert.deepEqual(status.missing_tables, [table]);
  assert.equal(classify(status).action, "reconcile_control_store_schema");
}
for (const row of metadata.columns) {
  const data = { ...metadata, columns: metadata.columns.filter((candidate) => candidate !== row) };
  const status = await schemaStatus(data);
  assert.equal(status.ready, false, `${row.TABLE_NAME}.${row.COLUMN_NAME}`);
  assert.equal(classify(status).action, "blocked_control_store_schema_drift");
}
for (const row of metadata.indexes) {
  const data = { ...metadata, indexes: metadata.indexes.filter((candidate) => candidate !== row) };
  const status = await schemaStatus(data);
  assert.equal(status.ready, false, `${row.TABLE_NAME}.${row.INDEX_NAME}`);
  assert.equal(classify(status).action, "blocked_control_store_schema_drift");
}
for (const patch of [
  { COLUMN_TYPE: "bigint" }, { COLUMN_DEFAULT: "1" }, { IS_NULLABLE: "YES" }, { EXTRA: "STORED GENERATED" },
]) {
  const data = structuredClone(metadata);
  Object.assign(data.columns.find((row) => row.COLUMN_NAME === "fence_counter"), patch);
  assert.equal(classify(await schemaStatus(data)).action, "blocked_control_store_schema_drift");
}
for (const patch of [{ ENGINE: "MyISAM" }, { TABLE_TYPE: "VIEW" }, { TABLE_COLLATION: "utf8mb4_bin" }]) {
  const data = structuredClone(metadata);
  Object.assign(data.tables.find((row) => row.TABLE_NAME === "recovery_control_locks"), patch);
  assert.equal(classify(await schemaStatus(data)).action, "blocked_control_store_schema_drift");
}
{
  const data = structuredClone(metadata);
  const index = data.indexes.find((row) => row.TABLE_NAME === "recovery_control_locks" && row.columns === "lease_id");
  index.NON_UNIQUE = 1;
  assert.equal((await schemaStatus(data)).ready, false, "non-unique lease IDs must fail closed");
  index.NON_UNIQUE = 0;
  index.columns = "lease_id:prefix:10";
  assert.equal((await schemaStatus(data)).ready, false, "prefix indexes are not full identity indexes");
}
assert.throws(() => _testingRecoveryControlDb.buildSchemaInventory(["CREATE TABLE arbitrary (id INT)"]), /Unsupported/u);
{
  let releases = 0;
  const status = await schemaStatus(metadata, { readError: Object.assign(new Error("transport"), { code: "ECONNRESET" }), onRelease: () => { releases += 1; } });
  assert.equal(status.ready, false);
  assert.equal(classify(status).execution_allowed, false);
  assert.equal(releases, 1);
}

function bootstrapHarness({ onPool = () => {}, onQuery = async () => {}, onReadback = () => completeReadiness } = {}) {
  let readCount = 0;
  const state = { identity: identityReader(), queries: [] };
  const deps = {
    env: configuredEnv, identityReader: () => state.identity, runtimeResolver, bindingStatusReader,
    readinessReader: async () => ++readCount <= 2 ? emptyReadiness : onReadback(),
    poolProvider: () => {
      onPool(state);
      return { async query(sql) { state.queries.push(sql); await onQuery(state); return [[], []]; } };
    },
  };
  return { state, deps };
}
async function applyHarness(harness) {
  const plan = await buildProductionRecoveryControlStoreBootstrapPlan({ expected_sha: SHA }, harness.deps);
  return applyProductionRecoveryControlStoreBootstrapPlan({ expected_sha: SHA, plan_sha256: plan.plan_sha256,
    confirmation: PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION }, harness.deps);
}
for (const drift of [
  { commit_sha: "b".repeat(40) }, { branch: "main" }, { repository: "other/repo" },
  { manifest: { deployed_at: "2026-09-26T10:00:00Z" } }, { runtime_generation: "new-generation" },
]) {
  const harness = bootstrapHarness({ onPool: (state) => { state.identity = { ...state.identity, ...drift }; } });
  await assert.rejects(() => applyHarness(harness), (error) => error.status === 412);
  assert.equal(harness.state.queries.length, 0, "post-plan deployment drift must reject before any DDL");
}
{
  const harness = bootstrapHarness({ onQuery: async (state) => { state.identity = { ...state.identity, commit_sha: "b".repeat(40) }; } });
  const receipt = await applyHarness(harness);
  assert.equal(receipt.status, "reconciliation_required");
  assert.equal(receipt.statements_acknowledged, 1);
  assert.equal(harness.state.queries.length, 1, "mid-cycle drift must stop remaining DDL");
  assert.equal(receipt.automatic_replay_allowed, false);
}
for (const failAt of [1, 3]) {
  const harness = bootstrapHarness({ onQuery: async (state) => {
    if (state.queries.length === failAt) throw Object.assign(new Error("lost acknowledgement"), { code: "ECONNRESET" });
  } });
  const receipt = await applyHarness(harness);
  assert.equal(receipt.status, "reconciliation_required");
  assert.equal(receipt.statements_attempted, failAt);
  assert.equal(receipt.statements_acknowledged, failAt - 1);
  assert.equal(receipt.unknown_outcome, true);
  assert.equal(receipt.database_mutation_performed, failAt === 1 ? null : true);
  assert.equal(receipt.automatic_replay_allowed, false);
  assert.equal(harness.state.queries.length, failAt);
}
for (const onReadback of [
  () => { throw new Error("readback unavailable"); },
  () => ({ ...completeReadiness, ready: false, schema_ready: false }),
]) {
  const receipt = await applyHarness(bootstrapHarness({ onReadback }));
  assert.equal(receipt.status, "reconciliation_required");
  assert.equal(receipt.automatic_replay_allowed, false);
  assert.equal(receipt.statements_acknowledged, 11);
}
console.log("production recovery control-store bootstrap tests passed (full schema, empty store, drift, identity and ambiguity)");
