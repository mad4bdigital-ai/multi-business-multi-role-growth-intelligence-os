import {
  RECOVERY_COMPOSITION_COMPONENT_KEYS,
  validateRecoveryCompositionAdapters,
} from "./recoveryComposition.js";

export const SERVER_MANAGED_RECOVERY_AUTHORITY_BINDING_CONTRACT = "mad4b.recovery-server-managed-authority-binding.v1";
export const SERVER_MANAGED_CONCRETE_BINDING_ORIGIN = "server_managed_concrete";

const FORBIDDEN_ORIGIN_RE = /(mock|dummy|fake|in[_-]?memory|test[_-]?double|fixture)/iu;

function bindingError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeCapabilities(capabilities = {}) {
  const normalized = {
    adapter_present: capabilities.adapter_present === true,
    durability_capable: capabilities.durability_capable === true,
    attestation_capable: capabilities.attestation_capable === true,
    live_ready: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  };
  return Object.freeze(normalized);
}

function assertConcreteOrigin(origin) {
  const normalized = String(origin ?? "").trim();
  if (normalized !== SERVER_MANAGED_CONCRETE_BINDING_ORIGIN || FORBIDDEN_ORIGIN_RE.test(normalized)) {
    throw bindingError(
      "RECOVERY_SERVER_MANAGED_CONCRETE_ORIGIN_INVALID",
      "Recovery production composition accepts only explicitly server-managed concrete authority bindings.",
      { adapter_origin: normalized || null },
    );
  }
  return normalized;
}

function assertCapabilities(capabilities) {
  if (!capabilities.adapter_present || !capabilities.durability_capable || !capabilities.attestation_capable) {
    throw bindingError(
      "RECOVERY_SERVER_MANAGED_BINDING_CAPABILITY_INCOMPLETE",
      "A server-managed Recovery binding must explicitly attest adapter presence, durability capability, and deployment-attestation capability.",
      { capabilities },
    );
  }
}

export function createServerManagedRecoveryAuthorityBinding({
  adapters = null,
  adapterOrigin = SERVER_MANAGED_CONCRETE_BINDING_ORIGIN,
  capabilities = {},
  authorityHandles = null,
} = {}) {
  assertConcreteOrigin(adapterOrigin);
  if (!object(adapters)) {
    throw bindingError(
      "RECOVERY_SERVER_MANAGED_AUTHORITY_ADAPTERS_REQUIRED",
      "A server-managed Recovery authority binding requires an explicit adapter object.",
    );
  }
  validateRecoveryCompositionAdapters(adapters);
  const normalizedCapabilities = normalizeCapabilities({
    ...capabilities,
    adapter_present: capabilities.adapter_present ?? true,
  });
  assertCapabilities(normalizedCapabilities);
  if (authorityHandles !== null && !object(authorityHandles)) {
    throw bindingError(
      "RECOVERY_SERVER_MANAGED_AUTHORITY_HANDLES_INVALID",
      "Server-managed authority handles must be opaque objects when supplied.",
    );
  }
  const adapterPresence = Object.fromEntries(RECOVERY_COMPOSITION_COMPONENT_KEYS.map((key) => [key, true]));
  return Object.freeze({
    contract: SERVER_MANAGED_RECOVERY_AUTHORITY_BINDING_CONTRACT,
    adapter_origin: adapterOrigin,
    adapters: Object.freeze({ ...adapters }),
    authority_handles_present: authorityHandles !== null,
    adapter_presence: Object.freeze(adapterPresence),
    capabilities: normalizedCapabilities,
    live_activation: false,
    secrets_included: false,
  });
}

export function createServerManagedRecoveryBindingEnvelope({
  binding = null,
  readiness = null,
  source = "server_managed_deployment_module",
} = {}) {
  if (!binding || binding.contract !== SERVER_MANAGED_RECOVERY_AUTHORITY_BINDING_CONTRACT) {
    throw bindingError(
      "RECOVERY_SERVER_MANAGED_BINDING_CONTRACT_INVALID",
      "The server-managed Recovery envelope requires the canonical authority-binding contract.",
    );
  }
  const capabilities = normalizeCapabilities({
    ...binding.capabilities,
    ...(readiness || {}),
    live_ready: false,
  });
  assertCapabilities(capabilities);
  return Object.freeze({
    binding_source: "server_managed",
    binding_origin: binding.adapter_origin,
    binding_contract: SERVER_MANAGED_RECOVERY_AUTHORITY_BINDING_CONTRACT,
    source,
    adapters: binding.adapters,
    adapter_presence: binding.adapter_presence,
    capabilities,
    live_activation: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
}

export function evaluateServerManagedRecoveryBindingReadiness({ binding = null } = {}) {
  const capabilities = normalizeCapabilities(binding?.capabilities || {});
  return Object.freeze({
    contract: "mad4b.recovery-server-managed-authority-readiness.v1",
    adapter_present: capabilities.adapter_present,
    durability_capable: capabilities.durability_capable,
    attestation_capable: capabilities.attestation_capable,
    live_ready: false,
    activation_eligible: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
}

export const _testingServerManagedRecoveryAuthorityBinding = Object.freeze({
  FORBIDDEN_ORIGIN_RE,
  normalizeCapabilities,
  assertConcreteOrigin,
  assertCapabilities,
});
