import assert from "node:assert/strict";
import { runProductionActivationReadiness } from "./productionActivationReadiness.js";
import {
  classifyProductionRecoveryAuthorityPreflight,
  inspectProductionRecoveryAuthorityPreflight,
  PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS,
} from "./productionRecoveryAuthorityPreflight.js";

const explicitRuntime = {
  ok: true,
  environment_key: "production",
  runtime_class: "hostinger_autodeploy",
  runtime_class_explicit: true,
  reason: null,
};

{
  const result = classifyProductionRecoveryAuthorityPreflight({
    runtime: { ...explicitRuntime, runtime_class_explicit: false, reason: "runtime_class_ambiguous" },
    binding: { module_configured: false, requested_mode: "disabled", mode: "disabled" },
    controlStoreConfigured: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.activation_eligible, false);
  assert.equal(result.evaluation.production_mutation_performed, false);
  assert(result.blockers.includes(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.runtime));
  assert(result.blockers.includes(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.bindingModule));
  assert(result.blockers.includes(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.bindingMode));
  assert(result.blockers.includes(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.controlStore));
  assert(result.blockers.includes(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.authorityGraph));
}

{
  const result = classifyProductionRecoveryAuthorityPreflight({
    runtime: explicitRuntime,
    binding: { module_configured: true, requested_mode: "production_live", mode: "injected_non_live" },
    controlStoreConfigured: true,
  });
  assert.equal(result.configuration_ready_for_candidate_resolution, true);
  assert.deepEqual(result.blockers, [PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.authorityGraph]);
  assert.equal(result.activation_eligible, false);
  assert.equal(result.production_live_enabled, false);
}

{
  const env = {
    DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy",
    RECOVERY_SERVER_MANAGED_BINDING_MODULE: "/server/production-recovery-authority.js",
    RECOVERY_SERVER_MANAGED_BINDING_MODE: "production_live",
    RECOVERY_CONTROL_DB_PASSWORD: "must-never-appear",
  };
  const result = inspectProductionRecoveryAuthorityPreflight({
    env,
    runtimeResolver: () => explicitRuntime,
    bindingStatusReader: () => ({
      module_configured: true,
      requested_mode: "production_live",
      mode: "injected_non_live",
      module_id_hash: "a".repeat(64),
    }),
    controlDbConfigReader: () => ({
      host: "db.internal",
      user: "recovery",
      password: env.RECOVERY_CONTROL_DB_PASSWORD,
      database: "recovery_control",
    }),
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.configuration_ready_for_candidate_resolution, true);
  assert(!serialized.includes("must-never-appear"));
  assert(!serialized.includes("db.internal"));
  assert(!serialized.includes("recovery_control"));
  assert.equal(result.secrets_included, false);
}

{
  const preflight = {
    contract: "mad4b.production-recovery-authority-preflight.v1",
    status: "blocked",
    ok: false,
    ready: false,
    activation_eligible: false,
    blockers: ["production_authority_graph_resolution_required"],
    secrets_included: false,
  };
  const readOnly = {
    ok: true,
    ready: true,
    read_only_probe: true,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
  };
  const readiness = await runProductionActivationReadiness({
    mcpCatalogReader: async () => ({ ...readOnly, ok: true }),
    governanceDbReader: async () => ({ ...readOnly, ready: true }),
    runtimePersistenceReader: async () => ({ ...readOnly, ok: true }),
    recoveryAuthorityPreflightReader: () => preflight,
    recoveryComposition: null,
    env: { DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy" },
  });
  assert.deepEqual(readiness.production_recovery_authority_preflight, preflight);
  assert.equal(readiness.production_recovery_authority_preflight.activation_eligible, false);
  assert.equal(readiness.production_mutation_performed, false);
}

console.log("Production Recovery authority preflight tests passed");
