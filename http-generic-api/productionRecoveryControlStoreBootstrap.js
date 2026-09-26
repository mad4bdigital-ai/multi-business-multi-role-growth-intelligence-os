import { createHash } from "node:crypto";
import { readCanonicalDeploymentIdentity } from "./deploymentManifest.js";
import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";
import { getServerManagedRecoveryBindingStatus } from "./serverManagedRecoveryBindingProvider.js";
import {
  getRecoveryControlPool,
  getRecoveryControlStoreReadiness,
} from "./recoveryControlDb.js";
import {
  PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT,
  RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS,
} from "./productionRecoveryControlStore.js";

export const PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONTRACT =
  "mad4b.production-recovery-control-store-bootstrap.v1";
export const PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION =
  "APPLY_PRODUCTION_RECOVERY_CONTROL_STORE_SCHEMA";

const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const BRANCH = "Production";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(stable(value)))
    .digest("hex");
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function bootstrapError(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = {
    contract: PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONTRACT,
    production_runtime_mutation_performed: false,
    provider_mutation_performed: false,
    target_database_mutation_performed: false,
    secrets_included: false,
    ...details,
  };
  return error;
}

function requiredSha(value, field = "expected_sha") {
  const sha = text(value, 40).toLowerCase();
  if (!SHA40.test(sha)) {
    throw bootstrapError(
      "RECOVERY_CONTROL_STORE_BOOTSTRAP_SHA_INVALID",
      `${field} must be an exact 40-character Git commit SHA.`,
      { field },
      400,
    );
  }
  return sha;
}

function configPresence(env = process.env) {
  return Object.freeze({
    recovery_control_db_name: Boolean(text(env.RECOVERY_CONTROL_DB_NAME)),
    recovery_control_db_user: Boolean(text(env.RECOVERY_CONTROL_DB_USER)),
    recovery_control_db_password: Boolean(String(env.RECOVERY_CONTROL_DB_PASSWORD || "")),
    recovery_control_db_host_explicit: Boolean(text(env.RECOVERY_CONTROL_DB_HOST)),
    server_managed_binding_mode_explicit: Boolean(text(env.RECOVERY_SERVER_MANAGED_BINDING_MODE)),
    server_managed_binding_module_explicit: Boolean(text(env.RECOVERY_SERVER_MANAGED_BINDING_MODULE)),
    approval_material_present: Boolean(String(env.RECOVERY_PRODUCTION_APPROVAL_SECRET || "")),
    execution_private_key_present: Boolean(String(env.RECOVERY_PRODUCTION_EXECUTION_PRIVATE_KEY_JWK || "")),
    secrets_included: false,
  });
}

function buildPreRebuildSequence({ readiness, binding }) {
  const controlStoreReady = readiness?.ready === true
    && readiness?.config_complete === true
    && readiness?.connection_ready === true
    && readiness?.schema_ready === true;
  const bindingReady = binding?.mode === "production_live" && binding?.module_configured === true;
  return Object.freeze([
    { key: "recovery_control_store_configured", ready: readiness?.config_complete === true, mutation: false },
    { key: "recovery_control_store_connection_ready", ready: readiness?.connection_ready === true, mutation: false },
    { key: "recovery_control_store_schema_ready", ready: readiness?.schema_ready === true, mutation: "bootstrap_schema_only" },
    { key: "server_managed_recovery_binding_ready", ready: bindingReady, mutation: false },
    { key: "durable_full_inspection", ready: false, pending_after: controlStoreReady && bindingReady ? null : "bootstrap_prerequisites", mutation: false },
    { key: "role_selection_provenance_bound", ready: false, pending_after: "durable_full_inspection", mutation: false },
    { key: "role_bundle_bindings_bound", ready: false, pending_after: "durable_full_inspection", mutation: false },
    { key: "governance_baseline_ready", ready: false, pending_after: "typed_rebuild_approval", mutation: "separate_recovery_execution" },
    { key: "runtime_persistence_baseline_ready", ready: false, pending_after: "typed_rebuild_approval", mutation: "separate_recovery_execution" },
    { key: "canonical_grants_readback_ready", ready: false, pending_after: "baseline_rebuild", mutation: "separate_grant_authority" },
    { key: "governance_authority_ready", ready: false, pending_after: "canonical_grants_readback_ready", mutation: false },
    { key: "ordinary_migration_ready", ready: false, pending_after: "governance_authority_ready", mutation: "separate_migration_authority" },
  ]);
}

function classifyAction({ readiness, binding }) {
  if (readiness?.config_complete !== true) {
    return {
      action: "blocked_control_store_configuration",
      execution_allowed: false,
      blocker: readiness?.error_code || "RECOVERY_CONTROL_DB_CONFIG_MISSING",
    };
  }
  if (readiness?.connection_ready !== true) {
    return {
      action: "blocked_control_store_connection",
      execution_allowed: false,
      blocker: readiness?.error_code || "RECOVERY_CONTROL_STORE_CONNECTION_NOT_READY",
    };
  }
  if (readiness?.schema_ready !== true) {
    return {
      action: "reconcile_control_store_schema",
      execution_allowed: true,
      blocker: null,
    };
  }
  if (binding?.mode !== "production_live" || binding?.module_configured !== true) {
    return {
      action: "runtime_binding_activation_required",
      execution_allowed: false,
      blocker: "external_runtime_configuration_required",
    };
  }
  return {
    action: "durable_reinspection_required",
    execution_allowed: false,
    blocker: null,
  };
}

function defaultIdentityReader(env) {
  return readCanonicalDeploymentIdentity({ env, requireManifest: true });
}

export async function inspectProductionRecoveryControlStoreBootstrap(
  input = {},
  {
    env = process.env,
    identityReader = defaultIdentityReader,
    runtimeResolver = resolveRuntimeEnvironmentStrict,
    bindingStatusReader = getServerManagedRecoveryBindingStatus,
    readinessReader = getRecoveryControlStoreReadiness,
    poolProvider = getRecoveryControlPool,
  } = {},
) {
  const expectedSha = input?.expected_sha ? requiredSha(input.expected_sha) : null;
  const runtime = runtimeResolver(env);
  const identity = identityReader(env);
  const observedSha = text(identity?.commit_sha || identity?.sha, 40).toLowerCase();
  const exactIdentity = Boolean(
    runtime?.ok === true
      && runtime.environment_key === "production"
      && runtime.runtime_class === "hostinger_autodeploy"
      && runtime.runtime_class_explicit === true
      && identity?.ok === true
      && identity?.repository === REPOSITORY
      && identity?.branch === BRANCH
      && SHA40.test(observedSha)
      && (!expectedSha || observedSha === expectedSha),
  );

  if (expectedSha && !exactIdentity) {
    throw bootstrapError(
      "RECOVERY_CONTROL_STORE_BOOTSTRAP_PRODUCTION_IDENTITY_MISMATCH",
      "Recovery Control Store bootstrap requires the exact current Production deployment identity.",
      {
        expected_sha: expectedSha,
        observed_sha: SHA40.test(observedSha) ? observedSha : null,
        repository_match: identity?.repository === REPOSITORY,
        branch_match: identity?.branch === BRANCH,
        runtime_class_match: runtime?.runtime_class === "hostinger_autodeploy",
      },
      412,
    );
  }

  let readiness;
  try {
    readiness = await readinessReader({ env, poolProvider });
  } catch (error) {
    readiness = {
      contract: "mad4b.recovery-control-store-readiness.v1",
      ready: false,
      config_complete: false,
      connection_ready: false,
      schema_ready: false,
      error_code: error?.code || "RECOVERY_CONTROL_STORE_READINESS_FAILED",
      database_connection_performed: false,
      database_mutation_performed: false,
      secrets_included: false,
    };
  }

  const binding = bindingStatusReader({ env });
  const classification = classifyAction({ readiness, binding });

  return Object.freeze({
    ok: exactIdentity,
    contract: PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONTRACT,
    expected_sha: expectedSha,
    observed_sha: SHA40.test(observedSha) ? observedSha : null,
    production_identity_ready: exactIdentity,
    runtime: {
      environment_key: runtime?.environment_key || null,
      runtime_class: runtime?.runtime_class || null,
      runtime_class_explicit: runtime?.runtime_class_explicit === true,
    },
    binding: {
      mode: binding?.mode || "disabled",
      requested_mode: binding?.requested_mode || "disabled",
      module_configured: binding?.module_configured === true,
      module_id_hash: binding?.module_id_hash || null,
      binding_source: binding?.binding_source || "server_managed",
    },
    control_store: {
      contract: PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT,
      config_complete: readiness?.config_complete === true,
      connection_ready: readiness?.connection_ready === true,
      schema_ready: readiness?.schema_ready === true,
      ready: readiness?.ready === true,
      error_code: readiness?.error_code || null,
      missing_tables: Array.isArray(readiness?.missing_tables) ? readiness.missing_tables : [],
      missing_columns: Array.isArray(readiness?.missing_columns) ? readiness.missing_columns : [],
      missing_indexes: Array.isArray(readiness?.missing_indexes) ? readiness.missing_indexes : [],
      independent_of_target_databases: readiness?.independent_of_target_databases === true,
    },
    configuration_presence: configPresence(env),
    pre_rebuild_sequence: buildPreRebuildSequence({ readiness, binding }),
    scope_boundaries: {
      rebuild_execution_in_scope: false,
      grant_mutation_in_scope: false,
      ordinary_migration_in_scope: false,
      hostinger_environment_write_in_scope: false,
      database_or_user_creation_in_scope: false,
      recovery_control_store_schema_reconciliation_in_scope: true,
    },
    next_action: classification.action,
    execution_allowed: classification.execution_allowed,
    blocker: classification.blocker,
    read_only_probe: true,
    database_connection_performed: readiness?.database_connection_performed === true,
    database_mutation_performed: false,
    target_database_mutation_performed: false,
    provider_mutation_performed: false,
    production_runtime_mutation_performed: false,
    secrets_included: false,
  });
}

export async function buildProductionRecoveryControlStoreBootstrapPlan(
  input = {},
  deps = {},
) {
  const expectedSha = requiredSha(input.expected_sha);
  const status = await inspectProductionRecoveryControlStoreBootstrap(
    { expected_sha: expectedSha },
    deps,
  );
  const schemaHashes = RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.map((statement) => digest(statement));
  const base = {
    contract: "mad4b.production-recovery-control-store-bootstrap-plan.v1",
    expected_sha: expectedSha,
    action: status.next_action,
    execution_allowed: status.execution_allowed === true,
    blocker: status.blocker,
    control_store: status.control_store,
    binding: status.binding,
    schema_statement_count: RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.length,
    schema_statement_sha256: schemaHashes,
    required_confirmation: status.next_action === "reconcile_control_store_schema"
      ? PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION
      : null,
    runtime_env_write_allowed: false,
    database_or_user_creation_allowed: false,
    target_database_mutation_allowed: false,
    raw_sql_from_caller_allowed: false,
    provider_mutation_allowed: false,
    production_runtime_restart_allowed: false,
    secrets_included: false,
  };
  return Object.freeze({
    ...base,
    plan_sha256: digest(base),
  });
}

export async function applyProductionRecoveryControlStoreBootstrapPlan(
  input = {},
  {
    env = process.env,
    poolProvider = getRecoveryControlPool,
    readinessReader = getRecoveryControlStoreReadiness,
    planBuilder = buildProductionRecoveryControlStoreBootstrapPlan,
    ...deps
  } = {},
) {
  const expectedSha = requiredSha(input.expected_sha);
  const suppliedPlanHash = text(input.plan_sha256, 64).toLowerCase();
  if (!SHA256.test(suppliedPlanHash)) {
    throw bootstrapError(
      "RECOVERY_CONTROL_STORE_BOOTSTRAP_PLAN_HASH_INVALID",
      "A valid exact bootstrap plan SHA-256 is required.",
      {},
      400,
    );
  }
  if (text(input.confirmation, 128) !== PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION) {
    throw bootstrapError(
      "RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION_REQUIRED",
      "Typed Recovery Control Store schema confirmation is required before any database mutation.",
      { required_confirmation: PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_CONFIRMATION },
      403,
    );
  }

  const plan = await planBuilder(
    { expected_sha: expectedSha },
    { env, poolProvider, readinessReader, ...deps },
  );
  if (plan.plan_sha256 !== suppliedPlanHash) {
    throw bootstrapError(
      "RECOVERY_CONTROL_STORE_BOOTSTRAP_PLAN_STALE",
      "The supplied bootstrap plan no longer matches the current Production state.",
      {
        supplied_plan_sha256: suppliedPlanHash,
        authoritative_plan_sha256: plan.plan_sha256,
      },
      409,
    );
  }
  if (plan.action !== "reconcile_control_store_schema" || plan.execution_allowed !== true) {
    throw bootstrapError(
      "RECOVERY_CONTROL_STORE_BOOTSTRAP_ACTION_NOT_EXECUTABLE",
      "The current bootstrap plan does not authorize Recovery Control Store schema reconciliation.",
      { action: plan.action, blocker: plan.blocker || null },
      409,
    );
  }

  const pool = poolProvider();
  if (!pool || typeof pool.query !== "function") {
    throw bootstrapError(
      "RECOVERY_CONTROL_STORE_BOOTSTRAP_POOL_INVALID",
      "The independent Recovery Control Store pool is unavailable.",
      {},
      503,
    );
  }

  let executed = 0;
  try {
    for (const statement of RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS) {
      await pool.query(statement);
      executed += 1;
    }
  } catch (error) {
    return Object.freeze({
      ok: false,
      contract: "mad4b.production-recovery-control-store-bootstrap-receipt.v1",
      status: "reconciliation_required",
      expected_sha: expectedSha,
      plan_sha256: plan.plan_sha256,
      statement_count: RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.length,
      statements_acknowledged: executed,
      failure_code: error?.code || "RECOVERY_CONTROL_STORE_SCHEMA_APPLY_FAILED",
      same_cycle_readback_performed: false,
      automatic_replay_allowed: false,
      runtime_env_write_performed: false,
      database_or_user_creation_performed: false,
      target_database_mutation_performed: false,
      provider_mutation_performed: false,
      production_runtime_mutation_performed: false,
      database_mutation_performed: executed > 0,
      secrets_included: false,
    });
  }

  const readback = await readinessReader({ env, poolProvider });
  const ready = readback?.ready === true
    && readback?.config_complete === true
    && readback?.connection_ready === true
    && readback?.schema_ready === true;

  return Object.freeze({
    ok: ready,
    contract: "mad4b.production-recovery-control-store-bootstrap-receipt.v1",
    status: ready ? "control_store_schema_ready" : "reconciliation_required",
    expected_sha: expectedSha,
    plan_sha256: plan.plan_sha256,
    statement_count: RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.length,
    statements_acknowledged: executed,
    same_cycle_readback_performed: true,
    readback: {
      config_complete: readback?.config_complete === true,
      connection_ready: readback?.connection_ready === true,
      schema_ready: readback?.schema_ready === true,
      ready: readback?.ready === true,
      error_code: readback?.error_code || null,
    },
    next_action: ready ? "runtime_binding_activation_required" : "reconciliation_required",
    automatic_replay_allowed: false,
    runtime_env_write_performed: false,
    database_or_user_creation_performed: false,
    target_database_mutation_performed: false,
    provider_mutation_performed: false,
    production_runtime_mutation_performed: false,
    database_mutation_performed: executed > 0,
    secrets_included: false,
  });
}

export const _testingProductionRecoveryControlStoreBootstrap = Object.freeze({
  stable,
  digest,
  configPresence,
  classifyAction,
  buildPreRebuildSequence,
  requiredSha,
});
