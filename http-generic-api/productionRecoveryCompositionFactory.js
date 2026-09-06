import {
  createRecoveryComposition,
  RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS,
  SERVER_MANAGED_RECOVERY_COMPOSITION_CONTEXT,
  SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
} from "./recoveryComposition.js";

export const PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT = "mad4b.production-recovery-composition-factory.v2";
export const PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT = "mad4b.production-recovery-live-authorization.v1";
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

const REQUIRED_LIVE_AUTHORIZATION_FLAGS = Object.freeze([
  "exact_sha_bound",
  "single_use_approval",
  "same_cycle_readback_required",
  "server_side_approval_token_resolution",
  "bootstrap_evidence_independent",
]);

function factoryError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function independentBootstrapEvidenceStore(recoveryStore) {
  return Boolean(
    recoveryStore
    && recoveryStore.recovery_store_contract === "mad4b.recovery-durable-store.v1"
    && recoveryStore.independent_of_target_databases === true
    && recoveryStore.target_database_binding === "forbidden"
    && typeof recoveryStore.appendEvidenceEvent === "function"
    && typeof recoveryStore.putRun === "function"
    && typeof recoveryStore.getRunByIdempotency === "function",
  );
}

function independentReadbackAuthority(readbackVerifier) {
  return Boolean(
    readbackVerifier
    && typeof readbackVerifier.verify === "function"
    && readbackVerifier.independent_authority === true
    && readbackVerifier.role_aware === true
    && readbackVerifier.mutation_authority !== true,
  );
}

function serverSideApprovalResolver(approvalIssuer) {
  return Boolean(approvalIssuer && typeof approvalIssuer.resolveApprovedToken === "function");
}

function validateLiveAuthorization(envelope, composition) {
  const authorization = envelope?.live_authorization;
  const problems = [];
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) {
    problems.push("live_authorization_missing");
  } else {
    if (authorization.contract !== PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT) problems.push("live_authorization_contract_invalid");
    if (authorization.authorized !== true) problems.push("production_mutation_not_authorized");
    if (authorization.environment !== "production") problems.push("environment_not_production");
    if (authorization.runtime_class !== "hostinger_autodeploy") problems.push("runtime_class_not_hostinger_autodeploy");
    if (authorization.admin_surface !== "auth.mad4b.com") problems.push("admin_surface_not_canonical");
    if (authorization.secrets_included !== false) problems.push("authorization_secrets_forbidden");
    for (const flag of REQUIRED_LIVE_AUTHORIZATION_FLAGS) {
      if (authorization[flag] !== true) problems.push(`${flag}_required`);
    }
  }

  const capabilities = envelope?.capabilities || {};
  if (capabilities.adapter_present !== true) problems.push("adapter_present_required");
  if (capabilities.durability_capable !== true) problems.push("durability_capable_required");
  if (capabilities.attestation_capable !== true) problems.push("attestation_capable_required");
  if (composition?.configured !== true) problems.push("composition_incomplete");
  if (!independentBootstrapEvidenceStore(composition?.components?.recoveryStore)) problems.push("bootstrap_evidence_store_not_independent");
  if (!independentReadbackAuthority(composition?.components?.readbackVerifier)) problems.push("independent_role_aware_readback_required");
  if (!serverSideApprovalResolver(composition?.components?.approvalIssuer)) problems.push("server_side_approval_token_resolver_required");

  return Object.freeze({
    ok: problems.length === 0,
    contract: PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT,
    problems: Object.freeze(problems),
    exact_sha_bound: authorization?.exact_sha_bound === true,
    single_use_approval: authorization?.single_use_approval === true,
    same_cycle_readback_required: authorization?.same_cycle_readback_required === true,
    server_side_approval_token_resolution: authorization?.server_side_approval_token_resolution === true,
    bootstrap_evidence_independent: authorization?.bootstrap_evidence_independent === true && independentBootstrapEvidenceStore(composition?.components?.recoveryStore),
    secrets_included: false,
  });
}

function buildLiveAuthorityReadiness(composition, serverManagedBindingResolved, bindingCapabilities = {}, liveAuthorization = null) {
  const componentStatus = composition.component_status || {};
  const configuredComponents = RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS.filter((key) => componentStatus[key]?.configured === true);
  const missingComponents = RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS.filter((key) => componentStatus[key]?.configured !== true);
  const authorizationOk = liveAuthorization?.ok === true;
  const liveReady = missingComponents.length === 0
    && serverManagedBindingResolved
    && bindingCapabilities.adapter_present === true
    && bindingCapabilities.durability_capable === true
    && bindingCapabilities.attestation_capable === true
    && authorizationOk;
  return Object.freeze({
    contract: "mad4b.recovery-live-authority-readiness.v2",
    required_components: [...RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS],
    configured_components: configuredComponents,
    missing_components: missingComponents,
    all_required_components_configured: missingComponents.length === 0,
    server_managed_binding_resolved: serverManagedBindingResolved,
    adapter_present: bindingCapabilities.adapter_present === true,
    durability_capable: bindingCapabilities.durability_capable === true,
    attestation_capable: bindingCapabilities.attestation_capable === true,
    bootstrap_evidence_independent: liveAuthorization?.bootstrap_evidence_independent === true,
    exact_sha_bound: liveAuthorization?.exact_sha_bound === true,
    single_use_approval: liveAuthorization?.single_use_approval === true,
    same_cycle_readback_required: liveAuthorization?.same_cycle_readback_required === true,
    server_side_approval_token_resolution: liveAuthorization?.server_side_approval_token_resolution === true,
    live_ready: liveReady,
    activation_eligible: liveReady,
    live_activation: liveReady,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
}

function failClosedComposition(source, reason, { candidate = null, envelope = null, liveAuthorization = null } = {}) {
  const composition = createRecoveryComposition({ source });
  return Object.freeze({
    ...composition,
    productionRecoveryCompositionFactory: Object.freeze({
      contract: PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
      recoveryCompositionContract: SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
      mode: envelope?.requested_mode === "production_live" ? "production_live" : "disabled",
      registered: true,
      activation_requested: envelope?.requested_mode === "production_live",
      live_activation: false,
      adapter_factory_wired: true,
      server_managed_binding_resolved: Boolean(candidate),
      authority_readiness: buildLiveAuthorityReadiness(candidate || composition, Boolean(candidate), envelope?.capabilities || {}, liveAuthorization),
      ...(candidate ? { activation_candidate: candidateMetadata(candidate, envelope) } : {}),
      ...(liveAuthorization ? { live_authorization: liveAuthorization } : {}),
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
      "The server-managed binding resolver did not supply an adapter bundle.",
    );
  }
  return envelope;
}

function candidateMetadata(composition, envelope) {
  return Object.freeze({
    requested_mode: envelope?.requested_mode || "injected_non_live",
    graph_contract: composition.contract,
    configured: composition.configured === true,
    component_status: composition.component_status,
    mutation_authority_exposed: false,
    live_activation: false,
    binding_module_id_hash: envelope?.module_id_hash || null,
    secrets_included: false,
  });
}

function activateCertifiedProductionComposition(candidate, envelope, liveAuthorization) {
  const authorityReadiness = buildLiveAuthorityReadiness(candidate, true, envelope.capabilities, liveAuthorization);
  if (!authorityReadiness.activation_eligible) {
    return failClosedComposition("server_composition_root", "production_live_authority_not_ready", { candidate, envelope, liveAuthorization });
  }
  return Object.freeze({
    ...candidate,
    mode: "production_live",
    live_activation: true,
    mutation_authority_available: true,
    authority_inventory: Object.freeze({
      ...candidate.authority_inventory,
      live_activation: true,
      production_live_authorization_contract: PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT,
      bootstrap_evidence_independent: true,
      server_side_approval_token_resolution: true,
    }),
    productionRecoveryCompositionFactory: Object.freeze({
      contract: PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
      recoveryCompositionContract: SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
      mode: "production_live",
      registered: true,
      activation_requested: true,
      live_activation: true,
      adapter_factory_wired: true,
      server_managed_binding_resolved: true,
      authority_readiness: authorityReadiness,
      live_authorization: liveAuthorization,
      activation_candidate: candidateMetadata(candidate, envelope),
      provider_accessed: false,
      database_connection_performed: false,
      database_mutation_performed: false,
      denial_reason: null,
      secrets_included: false,
    }),
  });
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

  // Direct production_live construction remains forbidden. Production can activate
  // only through the deployment-owned provider path used by the server composition
  // root, where caller/GPT credentials and provider controls are unavailable.
  if (mode === "production_live") {
    throw factoryError(
      "RECOVERY_PRODUCTION_LIVE_DIRECT_CONSTRUCTION_FORBIDDEN",
      "production_live cannot be constructed directly; only the server-managed deployment provider may present a certified Production live authorization envelope.",
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
  const candidate = createRecoveryComposition({
    mode: "injected_non_live",
    adapters: envelope.adapters,
    source,
  });
  const productionCandidateRequested = envelope.requested_mode === "production_live";

  if (productionCandidateRequested) {
    const liveAuthorization = validateLiveAuthorization(envelope, candidate);
    if (!liveAuthorization.ok) {
      return failClosedComposition(source, "production_live_authorization_incomplete", { candidate, envelope, liveAuthorization });
    }
    return activateCertifiedProductionComposition(candidate, envelope, liveAuthorization);
  }

  return Object.freeze({
    ...candidate,
    productionRecoveryCompositionFactory: Object.freeze({
      ...candidate.productionRecoveryCompositionFactory,
      contract: PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
      recoveryCompositionContract: SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
      mode: "injected_non_live",
      registered: true,
      activation_requested: false,
      live_activation: false,
      adapter_factory_wired: true,
      server_managed_binding_resolved: true,
      authority_readiness: buildLiveAuthorityReadiness(candidate, true, envelope.capabilities),
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
  REQUIRED_LIVE_AUTHORIZATION_FLAGS,
  validateServerManagedEnvelope,
  validateLiveAuthorization,
  independentBootstrapEvidenceStore,
  independentReadbackAuthority,
  serverSideApprovalResolver,
  failClosedComposition,
  candidateMetadata,
  activateCertifiedProductionComposition,
});
