import {
  createRecoveryComposition,
  RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS,
  SERVER_MANAGED_RECOVERY_COMPOSITION_CONTEXT,
  SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
} from "./recoveryComposition.js";

export const PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT = "mad4b.production-recovery-composition-factory.v1";
export const PRODUCTION_RECOVERY_COMPOSITION_MODES = Object.freeze([
  "disabled",
  "injected_non_live",
  "production_live",
]);

const SERVER_MANAGED_CONTEXT = Object.freeze({
  ...SERVER_MANAGED_RECOVERY_COMPOSITION_CONTEXT,
  contract: PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
  requested_by_caller: false,
});

function factoryError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function buildLiveAuthorityReadiness(composition, serverManagedBindingResolved) {
  const componentStatus = composition.component_status || {};
  const configuredComponents = RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS.filter((key) => componentStatus[key]?.configured === true);
  const missingComponents = RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS.filter((key) => componentStatus[key]?.configured !== true);
  return Object.freeze({
    contract: "mad4b.recovery-live-authority-readiness.v1",
    required_components: [...RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS],
    configured_components: configuredComponents,
    missing_components: missingComponents,
    all_required_components_configured: missingComponents.length === 0,
    server_managed_binding_resolved: serverManagedBindingResolved,
    activation_eligible: false,
    live_activation: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
}

function failClosedComposition(source, reason) {
  const composition = createRecoveryComposition({ source });
  return Object.freeze({
    ...composition,
    productionRecoveryCompositionFactory: Object.freeze({
      contract: PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
      recoveryCompositionContract: SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
      mode: "disabled",
      registered: true,
      activation_requested: false,
      live_activation: false,
      adapter_factory_wired: true,
      server_managed_binding_resolved: false,
      authority_readiness: buildLiveAuthorityReadiness(composition, false),
      provider_accessed: false,
      database_connection_performed: false,
      database_mutation_performed: false,
      denial_reason: reason,
      secrets_included: false,
    }),
  });
}

function validateServerManagedEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw factoryError(
      "RECOVERY_SERVER_MANAGED_BINDING_INVALID",
      "The server-managed composition provider must return a binding envelope.",
    );
  }
  if (envelope.binding_source !== SERVER_MANAGED_CONTEXT.binding_source) {
    throw factoryError(
      "RECOVERY_SERVER_MANAGED_BINDING_SOURCE_INVALID",
      "Recovery composition accepts bindings only from the server-managed composition root.",
      { binding_source: envelope.binding_source ?? null },
    );
  }
  if (envelope.secrets_included !== false) {
    throw factoryError(
      "RECOVERY_SERVER_MANAGED_BINDING_SECRETS_FORBIDDEN",
      "Recovery composition binding envelopes must not contain secrets.",
    );
  }
  if (!envelope.adapters || typeof envelope.adapters !== "object" || Array.isArray(envelope.adapters)) {
    throw factoryError(
      "RECOVERY_SERVER_MANAGED_BINDING_ADAPTERS_MISSING",
      "The server-managed composition provider did not supply an adapter bundle.",
    );
  }
  return envelope;
}

export function createProductionRecoveryComposition({
  mode = "disabled",
  serverManagedBindingProvider = null,
  source = "server_composition_root",
} = {}) {
  if (!PRODUCTION_RECOVERY_COMPOSITION_MODES.includes(mode)) {
    throw factoryError(
      "RECOVERY_COMPOSITION_FACTORY_MODE_INVALID",
      "Production Recovery composition factory mode is not registered.",
      { mode },
    );
  }

  if (mode === "disabled") {
    return failClosedComposition(source, "production_live_activation_not_requested");
  }

  if (mode === "production_live") {
    throw factoryError(
      "RECOVERY_PRODUCTION_LIVE_DISABLED",
      "production_live remains disabled until a separately certified live authority release enables it; this factory performs no live provider wiring or activation.",
      {
        factory_contract: PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
        live_activation: false,
        provider_accessed: false,
        database_mutation_performed: false,
      },
    );
  }

  if (typeof serverManagedBindingProvider !== "function") {
    return failClosedComposition(source, "server_managed_binding_provider_not_configured");
  }

  const envelope = validateServerManagedEnvelope(
    serverManagedBindingProvider(Object.freeze({
      ...SERVER_MANAGED_CONTEXT,
      requested_mode: mode,
    })),
  );
  const composition = createRecoveryComposition({
    mode: "injected_non_live",
    adapters: envelope.adapters,
    source,
  });
  return Object.freeze({
    ...composition,
    productionRecoveryCompositionFactory: Object.freeze({
      ...composition.productionRecoveryCompositionFactory,
      contract: PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
      recoveryCompositionContract: SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
      mode: "injected_non_live",
      registered: true,
      activation_requested: false,
      live_activation: false,
      adapter_factory_wired: true,
      server_managed_binding_resolved: true,
      authority_readiness: buildLiveAuthorityReadiness(composition, true),
      provider_accessed: false,
      database_connection_performed: false,
      database_mutation_performed: false,
      denial_reason: null,
      secrets_included: false,
    }),
  });
}

export const _testingProductionRecoveryCompositionFactory = Object.freeze({
  SERVER_MANAGED_CONTEXT,
  validateServerManagedEnvelope,
  failClosedComposition,
});
