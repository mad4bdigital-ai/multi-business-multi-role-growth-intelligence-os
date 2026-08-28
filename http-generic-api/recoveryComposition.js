import { recoveryReadinessRouteDependencies } from "./recoveryReadinessEvidence.js";
const COMPOSITION_MODES = new Set(["fail_closed", "injected_non_live", "production_live"]);

export const RECOVERY_COMPOSITION_CONTRACT = "mad4b.recovery-composition.v1";
export const RECOVERY_COMPOSITION_MODES = Object.freeze([...COMPOSITION_MODES]);
export const SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT = "mad4b.recovery-server-managed-composition-factory.v1";
export const SERVER_MANAGED_RECOVERY_COMPOSITION_CONTEXT = Object.freeze({
  contract: SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
  binding_source: "server_managed",
  caller_credentials_accepted: false,
  gpt_credentials_accepted: false,
  local_connector_accepted: false,
  provider_discovery: false,
  database_discovery: false,
  secrets_included: false,
});

const COMPONENT_KEYS = Object.freeze([
  "deploymentIdentityProvider",
  "recoveryStore",
  "approvalIssuer",
  "approvalVerifier",
  "approvalStore",
  "recoveryLock",
  "mutationExecutor",
  "hostLocalMutationExecutor",
  "readbackVerifier",
  "executionTicketSigner",
  "executionTicketVerifier",
  "partialReceiptStore",
  "proofResolver",
  "migrationLedger",
]);
export const RECOVERY_COMPOSITION_COMPONENT_KEYS = COMPONENT_KEYS;
export const RECOVERY_LIVE_AUTHORITY_COMPONENT_KEYS = Object.freeze([
  "recoveryStore",
  "executionTicketSigner",
  "approvalVerifier",
  "recoveryLock",
  "readbackVerifier",
  "hostLocalMutationExecutor",
  "deploymentIdentityProvider",
]);

const STORE_METHODS = Object.freeze([
  "putRun",
  "getRun",
  "putPlan",
  "getPlan",
  "putFinding",
  "getFinding",
  "getRunByIdempotency",
  "appendEvidenceEvent",
  "putIdempotencyReceipt",
  "putApproval",
  "getApprovalByPlanStep",
  "claimExecution",
  "reserveApproval",
  "getExecutionTicket",
  "putExecutionTicket",
  "reserveExecutionTicket",
  "releaseExecutionTicket",
  "finalizeExecutionTicket",
  "releaseExecutionClaim",
  "releaseApprovalReservation",
]);

const REQUIRED_ADAPTERS = Object.freeze({
  deploymentIdentityProvider: { kind: "object", methods: ["readAttestation"] },
    recoveryStore: { kind: "object", methods: STORE_METHODS },
  approvalIssuer: { kind: "object", methods: ["createChallenge"] },
  approvalVerifier: { kind: "object", methods: ["verify"] },
  approvalStore: { kind: "object", methods: ["putChallenge", "getChallenge"] },
  recoveryLock: { kind: "object", methods: ["acquire", "heartbeat", "assertFence", "release"] },
  mutationExecutor: { kind: "object", methods: ["execute"] },
  hostLocalMutationExecutor: { kind: "function" },
  readbackVerifier: { kind: "object", methods: ["verify"] },
  executionTicketSigner: { kind: "object", methods: ["sign"] },
  executionTicketVerifier: { kind: "object", methods: ["verify"] },
  partialReceiptStore: { kind: "object", methods: ["putImmutablePartialRebuildReceipt"] },
  proofResolver: { kind: "function" },
  migrationLedger: { kind: "object", methods: ["finalize"] },
});

function compositionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function componentConfigured(value, spec) {
  if (spec.kind === "function") return typeof value === "function";
  return isObject(value) && spec.methods.every((method) => typeof value[method] === "function");
}

function componentShape(value, spec) {
  if (spec.kind === "function") return { configured: typeof value === "function", missing_methods: [] };
  const missingMethods = !isObject(value)
    ? [...spec.methods]
    : spec.methods.filter((method) => typeof value[method] !== "function");
  return { configured: missingMethods.length === 0, missing_methods: missingMethods };
}

function componentStatus(components) {
  return Object.fromEntries(COMPONENT_KEYS.map((key) => [key, {
    configured: componentConfigured(components[key], REQUIRED_ADAPTERS[key]),
    ...(componentShape(components[key], REQUIRED_ADAPTERS[key]).missing_methods.length
      ? { missing_methods: componentShape(components[key], REQUIRED_ADAPTERS[key]).missing_methods }
      : {}),
  }]));
}

function immutableComponents(adapters = {}) {
  return Object.freeze(Object.fromEntries(COMPONENT_KEYS.map((key) => [key, adapters[key] ?? null])));
}

function buildFailClosedComposition(source) {
  const components = immutableComponents();
  const kernelDependencies = Object.freeze({ ...components });
  const authorityInventory = Object.freeze({
    contract: "mad4b.recovery-authority-inventory.v1",
    required_components: [...COMPONENT_KEYS],
    configured_components: [],
    all_required_components_configured: false,
    live_activation: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
  const hostBreakglassBroker = Object.freeze({
    // Intentionally omit hostLocalExecutor so the repository's read-only inspection
    // implementation may remain available; mutation authority is explicitly null.
    hostLocalMutationExecutor: null,
  });
  const runtimeBootstrapDependencies = Object.freeze({
    deploymentIdentityProvider: null,
    partialReceiptStore: null,
    executionTicketVerifier: null,
  });
  return Object.freeze({
    contract: RECOVERY_COMPOSITION_CONTRACT,
    mode: "fail_closed",
    source,
    configured: false,
    live_activation: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    mutation_authority_available: false,
    components,
    component_status: componentStatus(components),
    authority_inventory: authorityInventory,
    kernelDependencies,
    hostBreakglassBroker,
    runtimeBootstrapDependencies,
    secrets_included: false,
  });
}

export function validateRecoveryCompositionAdapters(adapters = {}) {
  if (!isObject(adapters)) {
    throw compositionError("RECOVERY_COMPOSITION_ADAPTERS_INVALID", "Recovery composition adapters must be an explicit object.");
  }
  const missing = [];
  for (const [key, spec] of Object.entries(REQUIRED_ADAPTERS)) {
    const status = componentShape(adapters[key], spec);
    if (!status.configured) {
      missing.push({ component: key, missing_methods: status.missing_methods });
    }
  }
  const storeVerifier = adapters.recoveryStore?.executionTicketVerifier;
  if (storeVerifier !== adapters.executionTicketVerifier) {
    missing.push({ component: "recoveryStore.executionTicketVerifier", missing_methods: ["must reference the injected executionTicketVerifier"] });
  }
  if (missing.length) {
    throw compositionError(
      "RECOVERY_COMPOSITION_INCOMPLETE",
      "Recovery composition requires every authority adapter and cannot activate a partial provider graph.",
      { missing_components: missing },
    );
  }
  return {
    ok: true,
    contract: RECOVERY_COMPOSITION_CONTRACT,
    required_components: Object.keys(REQUIRED_ADAPTERS),
    secrets_included: false,
  };
}

export function createRecoveryComposition({ mode = "fail_closed", adapters = null, source = "server_composition_root" } = {}) {
  if (!COMPOSITION_MODES.has(mode)) {
    throw compositionError("RECOVERY_COMPOSITION_MODE_INVALID", "Recovery composition mode is not registered.", { mode });
  }
  if (mode === "fail_closed") return buildFailClosedComposition(source);
  if (mode === "production_live") {
    throw compositionError("RECOVERY_PRODUCTION_LIVE_DISABLED", "production_live is registered as a contract boundary but remains disabled until independently certified live authorities are deployed; no live mutation wiring is present in this repository patch.", { live_activation: false, database_mutation_performed: false, provider_accessed: false });
  }
  validateRecoveryCompositionAdapters(adapters);
  const components = immutableComponents(adapters);
  const kernelDependencies = Object.freeze({ ...components });
  const hostBreakglassBroker = Object.freeze({
    proofResolver: components.proofResolver,
    hostLocalMutationExecutor: components.hostLocalMutationExecutor,
    ...(typeof adapters.hostLocalInspectionExecutor === "function"
      ? { hostLocalExecutor: adapters.hostLocalInspectionExecutor }
      : {}),
  });
  const runtimeBootstrapDependencies = Object.freeze({
    deploymentIdentityProvider: components.deploymentIdentityProvider,
    partialReceiptStore: components.partialReceiptStore,
    executionTicketVerifier: components.executionTicketVerifier,
  });
  const authorityInventory = Object.freeze({
    contract: "mad4b.recovery-authority-inventory.v1",
    required_components: [...COMPONENT_KEYS],
    configured_components: [...COMPONENT_KEYS],
    all_required_components_configured: true,
    live_activation: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
  return Object.freeze({
    contract: RECOVERY_COMPOSITION_CONTRACT,
    mode: "injected_non_live",
    source,
    configured: true,
    live_activation: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    mutation_authority_available: true,
    components,
    component_status: componentStatus(components),
    authority_inventory: authorityInventory,
    kernelDependencies,
    hostBreakglassBroker,
    runtimeBootstrapDependencies,
    secrets_included: false,
  });
}

export function getRecoveryCompositionRouteDependencies(composition = buildFailClosedComposition("route_dependency_default"), readinessAuthority = null) {
  if (!composition || composition.contract !== RECOVERY_COMPOSITION_CONTRACT) {
    throw compositionError("RECOVERY_COMPOSITION_INVALID", "Routes require the canonical Recovery composition contract.");
  }
  return Object.freeze({
    recoveryComposition: composition,
    ...composition.kernelDependencies,
    broker: composition.hostBreakglassBroker,
    hostBreakglassMutationExecutor: composition.hostBreakglassBroker.hostLocalMutationExecutor || null,
    runtimeBootstrapDependencies: composition.runtimeBootstrapDependencies,
    ...recoveryReadinessRouteDependencies(readinessAuthority),
  });
}

export const _testingRecoveryComposition = Object.freeze({
  COMPONENT_KEYS,
  REQUIRED_ADAPTERS,
  STORE_METHODS,
  componentStatus,
});
