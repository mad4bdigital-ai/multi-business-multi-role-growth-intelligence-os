import { stableOperationHash } from "./operationRegistryContracts.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;

export class OperationCapabilityAuthorityContextError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationCapabilityAuthorityContextError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationCapabilityAuthorityContextError(code, message, status, details);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("operation_capability_authority_invalid_object", `${field} must be an object.`, 400, { field });
  }
  return value;
}

function text(value, field, { max = 191, pattern = null, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_capability_authority_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    fail("operation_capability_authority_invalid_hash", `${field} must be SHA-256.`, 400, { field });
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    fail("operation_capability_authority_invalid_integer", `${field} must be positive.`, 400, { field });
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function capabilityRequired(requestedMode, effectClass) {
  return String(requestedMode || "").toLowerCase() === "apply"
    || /(?:mutation|write|apply)/i.test(String(effectClass || ""));
}

export function buildOperationCapabilityAuthorityContext({
  contract_resolution: contractResolution,
  authority_preflight: authorityPreflight,
  revision_pin: revisionPin,
} = {}) {
  const contractReport = object(contractResolution, "contract_resolution");
  if (contractReport.ok !== true || !contractReport.contract) {
    fail("operation_capability_contract_not_ready", "The runtime contract resolution is not ready.", 409);
  }
  const contract = object(contractReport.contract, "contract_resolution.contract");
  const definition = object(contract.definition, "contract_resolution.contract.definition");
  const operationKey = text(contract.operation_key || definition.operation_key, "operation_key", { pattern: KEY_PATTERN }).toLowerCase();
  const operationVersion = positiveInteger(contract.version || definition.version, "operation_version");
  const contractRevisionHash = hash(contract.revision_hash, "contract_revision_hash");

  const preflight = object(authorityPreflight, "authority_preflight");
  if (preflight.ok !== true || preflight.preflight_status !== "ready_for_governed_authority_handoff") {
    fail("operation_capability_preflight_not_ready", "The governed authority preflight is not ready.", 409, {
      observed_status: preflight.preflight_status || null,
    });
  }
  const shadow = object(preflight.capability_shadow, "authority_preflight.capability_shadow");
  const capabilityManifest = object(shadow.manifest, "authority_preflight.capability_shadow.manifest");
  const capabilityKey = text(shadow.capability_key, "capability_key", { pattern: KEY_PATTERN }).toLowerCase();
  const requestedMode = text(shadow.requested_mode, "requested_mode", { max: 32 }).toLowerCase();
  const effectClass = text(capabilityManifest.effect_class || "read_only", "effect_class", { max: 64 }).toLowerCase();
  const requiresCapability = capabilityRequired(requestedMode, effectClass);

  if (!requiresCapability) {
    return deepFreeze({
      context_version: "operation-capability-authority-context-v1",
      operation_key: operationKey,
      operation_version: operationVersion,
      run_id: null,
      requires_capability: false,
      authority_source: "sql_contract_and_governed_preflight",
      contract_revision_hash: contractRevisionHash,
      manifest_hash: null,
      source_revision_hash: null,
      binding_sha256: null,
      capability_sha256: null,
      profile: null,
      legacy_fallback_used: contractReport.fallback_used === true,
      runtime_dispatch_authorized: false,
      secrets_included: false,
    });
  }

  if (contractReport.resolution_source !== "sql_operation_registry") {
    fail("operation_capability_legacy_fallback_cannot_authorize_mutation", "Legacy code fallback cannot grant mutation authority.", 409, {
      resolution_source: contractReport.resolution_source || null,
    });
  }

  const pin = object(revisionPin?.record || revisionPin, "revision_pin");
  if (pin.operation_key !== operationKey || Number(pin.operation_version) !== operationVersion) {
    fail("operation_capability_run_pin_identity_mismatch", "Run revision pin and operation identity differ.", 409);
  }
  const revisions = Array.isArray(pin.revisions) ? pin.revisions : [];
  const contractItems = revisions.filter((item) => item?.revision_type === "contract");
  if (contractItems.length !== 1 || contractItems[0].revision_hash !== contractRevisionHash) {
    fail("operation_capability_run_pin_contract_mismatch", "Run revision pin does not contain the selected contract revision.", 409);
  }
  const bindingItems = revisions.filter((item) => item?.revision_type === "binding" && item?.snapshot?.capability_key === capabilityKey);
  if (bindingItems.length !== 1) {
    fail("operation_capability_run_pin_binding_ambiguous", "Run revision pin must contain exactly one matching capability binding.", 409, {
      matching_binding_count: bindingItems.length,
    });
  }
  const binding = bindingItems[0];
  const snapshot = object(binding.snapshot, "revision_pin.binding.snapshot");
  const appKey = text(snapshot.app_key || "platform_orchestration", "app_key", { pattern: KEY_PATTERN }).toLowerCase();
  const operationIntent = text(snapshot.operation_intent, "operation_intent", { pattern: KEY_PATTERN }).toLowerCase();
  const runtimeSurface = text(snapshot.runtime_surface, "runtime_surface", { pattern: KEY_PATTERN }).toLowerCase();
  const requestedSourceTier = text(snapshot.requested_source_tier || "managed", "requested_source_tier", { max: 96 }).toLowerCase();
  const bindingSha256 = hash(binding.revision_hash, "binding_revision_hash");
  const manifestHash = hash(pin.manifest_hash, "manifest_hash");
  const sourceRevisionHash = hash(pin.source_revision_hash, "source_revision_hash");
  const runId = text(pin.run_id, "run_id", { max: 64 });

  const capabilitySha256 = stableOperationHash({
    schema_version: "operation-capability-authority-context-v1",
    operation_key: operationKey,
    operation_version: operationVersion,
    run_id: runId,
    contract_revision_hash: contractRevisionHash,
    manifest_hash: manifestHash,
    source_revision_hash: sourceRevisionHash,
    binding_sha256: bindingSha256,
    capability_key: capabilityKey,
    operation_intent: operationIntent,
    runtime_surface: runtimeSurface,
    requested_mode: requestedMode,
    effect_class: effectClass,
  });

  return deepFreeze({
    context_version: "operation-capability-authority-context-v1",
    operation_key: operationKey,
    operation_version: operationVersion,
    run_id: runId,
    requires_capability: true,
    authority_source: "sql_contract_governed_preflight_and_run_pin",
    contract_revision_hash: contractRevisionHash,
    manifest_hash: manifestHash,
    source_revision_hash: sourceRevisionHash,
    binding_sha256: bindingSha256,
    capability_sha256: capabilitySha256,
    requested_mode: requestedMode,
    effect_class: effectClass,
    profile: {
      app_key: appKey,
      capability_key: capabilityKey,
      operation_intent: operationIntent,
      runtime_surface: runtimeSurface,
      requested_source_tier: requestedSourceTier,
    },
    legacy_fallback_used: false,
    runtime_dispatch_authorized: false,
    secrets_included: false,
  });
}
