import {
  RECOVERY_COMPOSITION_COMPONENT_KEYS,
  RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS,
} from "./recoveryComposition.js";
import { resolveRecoveryControlDbConfig } from "./recoveryControlDb.js";
import { getServerManagedRecoveryBindingStatus } from "./serverManagedRecoveryBindingProvider.js";
import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";

export const PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_CONTRACT =
  "mad4b.production-recovery-authority-preflight.v1";

export const PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS = Object.freeze({
  runtime: "production_runtime_class_explicit_required",
  bindingModule: "server_managed_binding_module_required",
  bindingMode: "production_live_binding_mode_required",
  controlStore: "independent_recovery_control_store_configuration_required",
  authorityGraph: "production_authority_graph_resolution_required",
});

function boundedCode(error, fallback) {
  return String(error?.code || error?.errno || fallback).slice(0, 128) || fallback;
}

export function classifyProductionRecoveryAuthorityPreflight({
  runtime = null,
  binding = null,
  controlStoreConfigured = false,
} = {}) {
  const blockers = [];
  const explicitProductionRuntime = runtime?.ok === true
    && runtime?.environment_key === "production"
    && runtime?.runtime_class === "hostinger_autodeploy"
    && runtime?.runtime_class_explicit === true;

  if (!explicitProductionRuntime) blockers.push(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.runtime);
  if (binding?.module_configured !== true) blockers.push(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.bindingModule);
  if (binding?.requested_mode !== "production_live") blockers.push(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.bindingMode);
  if (controlStoreConfigured !== true) blockers.push(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.controlStore);

  const configurationReady = blockers.length === 0;
  blockers.push(PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_BLOCKERS.authorityGraph);

  return Object.freeze({
    contract: PRODUCTION_RECOVERY_AUTHORITY_PREFLIGHT_CONTRACT,
    status: "blocked",
    ok: false,
    ready: false,
    configuration_ready_for_candidate_resolution: configurationReady,
    activation_eligible: false,
    production_live_enabled: false,
    required_components: [...RECOVERY_COMPOSITION_COMPONENT_KEYS],
    live_authority_components: [...RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS],
    blockers: [...new Set(blockers)],
    runtime: {
      explicit_production_hostinger: explicitProductionRuntime,
      environment_key: runtime?.environment_key || null,
      runtime_class: runtime?.runtime_class || null,
      runtime_class_explicit: runtime?.runtime_class_explicit === true,
      reason: runtime?.reason || null,
    },
    binding: {
      module_configured: binding?.module_configured === true,
      requested_mode: binding?.requested_mode || null,
      effective_mode: binding?.mode || null,
      provider_discovery: false,
    },
    control_store: {
      configured: controlStoreConfigured === true,
      independent_of_target_databases_required: true,
      connection_performed: false,
      mutation_performed: false,
    },
    evaluation: {
      deployment_module_loaded: false,
      adapter_graph_evaluated: false,
      execution_ticket_issued: false,
      approval_issued: false,
      provider_accessed: false,
      database_connection_performed: false,
      database_mutation_performed: false,
      production_mutation_performed: false,
    },
    secrets_included: false,
  });
}

export function inspectProductionRecoveryAuthorityPreflight({
  env = process.env,
  runtimeResolver = resolveRuntimeEnvironmentStrict,
  bindingStatusReader = getServerManagedRecoveryBindingStatus,
  controlDbConfigReader = resolveRecoveryControlDbConfig,
} = {}) {
  let runtime;
  try {
    runtime = runtimeResolver(env);
  } catch (error) {
    runtime = {
      ok: false,
      environment_key: null,
      runtime_class: null,
      runtime_class_explicit: false,
      reason: boundedCode(error, "production_runtime_resolution_failed"),
    };
  }

  let binding;
  try {
    binding = bindingStatusReader({ env });
  } catch (error) {
    binding = {
      module_configured: false,
      requested_mode: null,
      mode: null,
      reason: boundedCode(error, "production_binding_status_failed"),
    };
  }

  let controlStoreConfigured = false;
  let controlStoreReason = null;
  try {
    const config = controlDbConfigReader(env);
    controlStoreConfigured = Boolean(config && typeof config === "object");
  } catch (error) {
    controlStoreReason = boundedCode(error, "recovery_control_store_config_unavailable");
  }

  const result = classifyProductionRecoveryAuthorityPreflight({
    runtime,
    binding,
    controlStoreConfigured,
  });

  return Object.freeze({
    ...result,
    control_store: {
      ...result.control_store,
      reason: controlStoreReason,
    },
  });
}
