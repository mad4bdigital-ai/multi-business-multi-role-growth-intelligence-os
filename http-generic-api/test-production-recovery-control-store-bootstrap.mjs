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
  assert.equal(status.next_action, "durable_reinspection_required");
  assert.equal(status.execution_allowed, false);
  assert.equal(status.pre_rebuild_sequence.find((x) => x.key === "server_managed_recovery_binding_ready")?.ready, true);
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
      "server_managed_recovery_binding_ready",
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

console.log("production recovery control-store bootstrap tests passed");
