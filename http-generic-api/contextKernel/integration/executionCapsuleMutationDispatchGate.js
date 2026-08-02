import { assertExecutionCapsuleIntegrity, deepFreeze } from "../domain/index.js";
import { ExecutionCapsuleValidationStatus } from "../application/executionCapsuleService.js";

const TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,190}$/u;
const SHA_PATTERN = /^(?:[0-9a-f]{7,64}|sha256-[0-9a-f]{32,128})$/u;
const REQUIRED_STATUSES = Object.freeze({
  approval: "approved",
  capability_envelope: "active",
  effective_authority: "active",
  resource_version: "current",
  provider_version: "current",
  connection_status: "active",
  expected_sha: "matched",
});
const REQUIRED_DYNAMIC_EVIDENCE_KEYS = Object.freeze(
  Object.keys(REQUIRED_STATUSES).sort(),
);
const FORBIDDEN_INPUT_FIELDS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "credential",
  "credentials",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "clientsecret",
  "privatekey",
  "session",
  "sessionid",
]);
const SECRET_VALUE_PATTERNS = Object.freeze([
  /Bearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|authorization|cookie|session)\s*[:=]/iu,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
]);

function cleanToken(value, fieldName) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    throw new TypeError(`${fieldName} must be a bounded token.`);
  }
  return token;
}

function safeReasonCodes(value, fallback) {
  const source = Array.isArray(value) ? value : [];
  const bounded = [...new Set(source
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter((entry) => TOKEN_PATTERN.test(entry)))]
    .sort()
    .slice(0, 16);
  return bounded.length > 0 ? bounded : [fallback];
}

function failure(code, reasonCodes = [code]) {
  return new ExecutionCapsuleMutationDispatchError(code, reasonCodes);
}

function normalizedFieldName(value) {
  return String(value).replace(/[_-]/gu, "").toLowerCase();
}

function projectSafeValue(value, depth, state) {
  state.nodes += 1;
  if (state.nodes > 512) {
    throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_too_large"]);
  }
  if (depth > 8) {
    throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_too_deep"]);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_non_finite"]);
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 16 * 1024) {
      throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_string_too_large"]);
    }
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_secret_like"]);
    }
    return value;
  }
  if (!value || typeof value !== "object") {
    throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_type_unsupported"]);
  }
  if (state.active.has(value)) {
    throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_cycle"]);
  }
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 128) {
        throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_array_too_large"]);
      }
      const unexpectedKeys = Reflect.ownKeys(value).filter((key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key))
      );
      if (unexpectedKeys.length > 0) {
        throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_array_shape_invalid"]);
      }
      return value.map((entry) => projectSafeValue(entry, depth + 1, state));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_object_type_unsupported"]);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > 128) {
      throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_object_too_large"]);
    }
    const result = Object.create(null);
    for (const key of keys.sort((left, right) => String(left).localeCompare(String(right)))) {
      if (typeof key !== "string") {
        throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_symbol_key"]);
      }
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_prototype_key"]);
      }
      if (FORBIDDEN_INPUT_FIELDS.has(normalizedFieldName(key))) {
        throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_authority_field"]);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
        throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_descriptor_unsupported"]);
      }
      result[key] = projectSafeValue(descriptor.value, depth + 1, state);
    }
    return result;
  } finally {
    state.active.delete(value);
  }
}

function projectSafeDispatchInput(value) {
  return deepFreeze(projectSafeValue(value, 0, {
    nodes: 0,
    active: new WeakSet(),
  }));
}

function resourceReferenceField(resourceType) {
  const value = String(resourceType || "");
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) return null;
  return `${value.replace(/_([a-z0-9])/gu, (_match, character) => character.toUpperCase())}Ref`;
}

function assertDispatchInputBinding(dispatchInput, capsule, dynamicEvidence) {
  if (!dispatchInput || typeof dispatchInput !== "object" || Array.isArray(dispatchInput)) {
    throw failure("execution_capsule_mutation_dispatch_input_unsafe", ["input_object_required"]);
  }
  for (const field of [
    "tenantRef",
    "workspaceRef",
    "brandRef",
    "resourceType",
    "resourceRef",
    "connectionRef",
  ]) {
    if (
      Object.hasOwn(dispatchInput, field) &&
      (dispatchInput[field] ?? null) !== (capsule[field] ?? null)
    ) {
      throw failure(
        "execution_capsule_mutation_dispatch_context_re_resolution_required",
        [`execution_capsule_mutation_dispatch_input_${field}_mismatch`],
      );
    }
  }
  const resourceAlias = resourceReferenceField(capsule.resourceType);
  if (
    resourceAlias &&
    resourceAlias !== "resourceRef" &&
    Object.hasOwn(dispatchInput, resourceAlias) &&
    (dispatchInput[resourceAlias] ?? null) !== (capsule.resourceRef ?? null)
  ) {
    throw failure(
      "execution_capsule_mutation_dispatch_context_re_resolution_required",
      [`execution_capsule_mutation_dispatch_input_${resourceAlias}_mismatch`],
    );
  }
  const expectedShaEvidence = dynamicEvidence.find(
    (entry) => entry.evidenceKey === "expected_sha",
  );
  const inputExpectedSha = String(dispatchInput.expectedSha || "").trim().toLowerCase();
  if (
    !expectedShaEvidence ||
    !Object.hasOwn(dispatchInput, "expectedSha") ||
    !SHA_PATTERN.test(inputExpectedSha) ||
    inputExpectedSha !== expectedShaEvidence.expectedSha
  ) {
    throw failure("execution_capsule_mutation_dispatch_expected_sha_mismatch");
  }
}

function requireMutationOperationContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("operationContract must be an object.");
  }
  if (value.operationKind !== "mutation" || value.mutationRequired !== true) {
    throw failure("execution_capsule_mutation_dispatch_requires_mutation_operation");
  }
  if (value.reversible !== true) {
    throw failure("execution_capsule_mutation_dispatch_requires_reversible_operation");
  }
  const requiredDynamicEvidence = [...new Set((Array.isArray(value.requiredDynamicEvidence)
    ? value.requiredDynamicEvidence
    : []).map((entry, index) => {
      const key = cleanToken(entry, `operationContract.requiredDynamicEvidence[${index}]`);
      if (!Object.hasOwn(REQUIRED_STATUSES, key)) {
        throw new TypeError(`Unsupported dynamic evidence key: ${key}`);
      }
      return key;
    }))].sort();
  const missingDynamicEvidence = REQUIRED_DYNAMIC_EVIDENCE_KEYS.filter(
    (key) => !requiredDynamicEvidence.includes(key),
  );
  if (missingDynamicEvidence.length > 0) {
    throw failure(
      "execution_capsule_mutation_dispatch_dynamic_evidence_contract_incomplete",
      missingDynamicEvidence.map(
        (key) => `execution_capsule_mutation_dispatch_${key}_required`,
      ),
    );
  }
  return deepFreeze({
    operationKey: cleanToken(value.operationKey, "operationContract.operationKey"),
    operationKind: "mutation",
    riskClass: cleanToken(value.riskClass || "mutation", "operationContract.riskClass"),
    mutationRequired: true,
    reversible: true,
    rollbackOperationKey: cleanToken(
      value.rollbackOperationKey,
      "operationContract.rollbackOperationKey",
    ),
    requiredDynamicEvidence,
  });
}

function requireGovernanceDecision(value, operationContract, capsule) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure("execution_capsule_mutation_dispatch_governance_missing");
  }
  if (
    value.status !== "allowed" ||
    value.dispatchAllowed !== true ||
    value.mutationAllowed !== true
  ) {
    throw failure(
      "execution_capsule_mutation_dispatch_governance_blocked",
      safeReasonCodes(value.reasonCodes, "execution_capsule_mutation_dispatch_governance_blocked"),
    );
  }
  const operationKey = cleanToken(value.operationKey, "governanceDecision.operationKey");
  const contextHash = cleanToken(value.contextHash, "governanceDecision.contextHash");
  if (operationKey !== operationContract.operationKey) {
    throw failure("execution_capsule_mutation_dispatch_operation_mismatch");
  }
  if (contextHash !== capsule.contextHash) {
    throw failure("execution_capsule_mutation_dispatch_governance_context_mismatch");
  }
  return deepFreeze({
    decisionRef: cleanToken(value.decisionRef, "governanceDecision.decisionRef"),
    decisionRevision: cleanToken(
      value.decisionRevision,
      "governanceDecision.decisionRevision",
    ),
    operationKey,
    contextHash,
    status: "allowed",
    dispatchAllowed: true,
    mutationAllowed: true,
  });
}

function requireCurrentEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("dynamicEvidenceProvider must return an object.");
  }
  if (!value.currentContext || typeof value.currentContext !== "object") {
    throw new TypeError("dynamicEvidence.currentContext must be an object.");
  }
  if (!Array.isArray(value.currentDependencies)) {
    throw new TypeError("dynamicEvidence.currentDependencies must be an array.");
  }
  if (!value.items || typeof value.items !== "object" || Array.isArray(value.items)) {
    throw new TypeError("dynamicEvidence.items must be an object.");
  }
  return value;
}

function assertNoContextSubstitution(item, capsule, key) {
  for (const field of [
    "tenantRef",
    "workspaceRef",
    "brandRef",
    "resourceRef",
    "connectionRef",
  ]) {
    if (Object.hasOwn(item, field) && (item[field] ?? null) !== (capsule[field] ?? null)) {
      throw failure(
        "execution_capsule_mutation_dispatch_context_re_resolution_required",
        [`execution_capsule_mutation_dispatch_${key}_${field}_mismatch`],
      );
    }
  }
}

function projectDynamicEvidence(items, operationContract, capsule) {
  return deepFreeze(operationContract.requiredDynamicEvidence.map((key) => {
    const item = items[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw failure(
        "execution_capsule_mutation_dispatch_dynamic_evidence_missing",
        [`execution_capsule_mutation_dispatch_${key}_missing`],
      );
    }
    const status = cleanToken(item.status, `dynamicEvidence.items.${key}.status`);
    if (status !== REQUIRED_STATUSES[key]) {
      throw failure(
        "execution_capsule_mutation_dispatch_dynamic_evidence_blocked",
        safeReasonCodes(
          item.reasonCodes,
          `execution_capsule_mutation_dispatch_${key}_${status}`,
        ),
      );
    }
    if (
      cleanToken(item.operationKey, `dynamicEvidence.items.${key}.operationKey`) !==
      operationContract.operationKey
    ) {
      throw failure(
        "execution_capsule_mutation_dispatch_dynamic_evidence_operation_mismatch",
        [`execution_capsule_mutation_dispatch_${key}_operation_mismatch`],
      );
    }
    if (
      cleanToken(item.contextHash, `dynamicEvidence.items.${key}.contextHash`) !==
      capsule.contextHash
    ) {
      throw failure(
        "execution_capsule_mutation_dispatch_context_re_resolution_required",
        [`execution_capsule_mutation_dispatch_${key}_context_mismatch`],
      );
    }
    assertNoContextSubstitution(item, capsule, key);
    const projection = {
      evidenceKey: key,
      status,
      revision: cleanToken(item.revision, `dynamicEvidence.items.${key}.revision`),
      evidenceRef: item.evidenceRef == null
        ? null
        : cleanToken(item.evidenceRef, `dynamicEvidence.items.${key}.evidenceRef`),
    };
    if (key === "expected_sha") {
      const expectedSha = String(item.expectedSha || "").trim().toLowerCase();
      const actualSha = String(item.actualSha || "").trim().toLowerCase();
      if (
        !SHA_PATTERN.test(expectedSha) ||
        !SHA_PATTERN.test(actualSha) ||
        expectedSha !== actualSha
      ) {
        throw failure("execution_capsule_mutation_dispatch_expected_sha_mismatch");
      }
      projection.expectedSha = expectedSha;
    }
    return projection;
  }));
}

function safeExecutionContext(capsule) {
  return deepFreeze({
    capsuleRef: capsule.capsuleRef,
    contextHash: capsule.contextHash,
    contextRevision: capsule.contextRevision,
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
    brandRef: capsule.brandRef ?? null,
    resourceType: capsule.resourceType,
    resourceRef: capsule.resourceRef,
    connectionRef: capsule.connectionRef,
  });
}

async function emitSafely(emitTelemetry, event) {
  try {
    await emitTelemetry(deepFreeze(event));
  } catch {
    // Telemetry cannot alter mutation validation or dispatch behavior.
  }
}

export class ExecutionCapsuleMutationDispatchError extends Error {
  constructor(code, reasonCodes = [code]) {
    super(code);
    this.name = "ExecutionCapsuleMutationDispatchError";
    this.code = code;
    this.status = 409;
    this.reasonCodes = Object.freeze(safeReasonCodes(reasonCodes, code));
  }
}

function createDisabledGate({ dispatchMutationOperation }) {
  return Object.freeze({
    enabled: false,
    mode: "legacy_mutation_dispatch",
    dispatch({ dispatchInput } = {}) {
      return dispatchMutationOperation(dispatchInput);
    },
    rollback() {
      return createDisabledGate({ dispatchMutationOperation });
    },
  });
}

export function createExecutionCapsuleMutationDispatchGate({
  enabled = false,
  capsuleService = null,
  dynamicEvidenceProvider = null,
  dispatchMutationOperation = null,
  emitTelemetry = null,
  clock = () => Date.now(),
} = {}) {
  if (typeof dispatchMutationOperation !== "function") {
    throw new TypeError("dispatchMutationOperation must be a function.");
  }
  if (enabled !== true) return createDisabledGate({ dispatchMutationOperation });
  if (!capsuleService || typeof capsuleService.validate !== "function") {
    throw new TypeError("capsuleService.validate must be a function when enabled.");
  }
  if (typeof dynamicEvidenceProvider !== "function") {
    throw new TypeError("dynamicEvidenceProvider must be a function when enabled.");
  }
  if (typeof emitTelemetry !== "function") {
    throw new TypeError("emitTelemetry must be a function when enabled.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  return Object.freeze({
    enabled: true,
    mode: "execution_capsule_mutation_dispatch_gate",
    async dispatch({ capsule, operationContract, governanceDecision, dispatchInput } = {}) {
      let mutationContract = null;
      let validation = null;
      let governance = null;
      let dispatcherInvoked = false;
      try {
        mutationContract = requireMutationOperationContract(operationContract);
        const canonicalCapsule = assertExecutionCapsuleIntegrity(capsule);
        const safeDispatchInput = projectSafeDispatchInput(dispatchInput);
        const evidence = requireCurrentEvidence(await dynamicEvidenceProvider({
          capsule: canonicalCapsule,
          operationContract: mutationContract,
          dispatchInput: safeDispatchInput,
        }));
        const dynamicEvidence = projectDynamicEvidence(
          evidence.items,
          mutationContract,
          canonicalCapsule,
        );
        assertDispatchInputBinding(
          safeDispatchInput,
          canonicalCapsule,
          dynamicEvidence,
        );
        validation = capsuleService.validate({
          capsule: canonicalCapsule,
          currentContext: evidence.currentContext,
          currentDependencies: evidence.currentDependencies,
          operationKind: "mutation",
          dynamicRefreshComplete: true,
          interpretationRequired: evidence.interpretationRequired === true,
          blockedReasonCodes: Array.isArray(evidence.blockedReasonCodes)
            ? evidence.blockedReasonCodes
            : [],
          now: evidence.now ?? clock(),
        });
        if (validation.status !== ExecutionCapsuleValidationStatus.VALID) {
          throw failure(
            validation.requiresContextReresolution
              ? "execution_capsule_mutation_dispatch_context_re_resolution_required"
              : `execution_capsule_mutation_dispatch_${validation.status}`,
            validation.reasonCodes,
          );
        }
        governance = requireGovernanceDecision(
          governanceDecision,
          mutationContract,
          canonicalCapsule,
        );
        const dispatchEnvelope = deepFreeze({
          operationContract: mutationContract,
          governanceDecision: governance,
          executionContext: safeExecutionContext(canonicalCapsule),
          dynamicEvidence,
          rollbackContract: {
            required: true,
            operationKey: mutationContract.rollbackOperationKey,
          },
          dispatchInput: safeDispatchInput,
        });
        dispatcherInvoked = true;
        const result = await dispatchMutationOperation(dispatchEnvelope);
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_mutation_dispatch",
          mode: "reversible_mutation_pilot",
          operationKey: mutationContract.operationKey,
          validationStatus: validation.status,
          governanceStatus: governance.status,
          dynamicEvidenceCount: dynamicEvidence.length,
          dispatcherInvoked: true,
          dispatchSucceeded: true,
          mutationAllowed: true,
          reversible: true,
          capsuleGrantedAuthority: false,
          reasonCodes: [],
          secretsIncluded: false,
        });
        return result;
      } catch (error) {
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_mutation_dispatch",
          mode: "reversible_mutation_pilot",
          operationKey: mutationContract?.operationKey || "unknown",
          validationStatus: validation?.status || null,
          governanceStatus: governance?.status || null,
          dynamicEvidenceCount: 0,
          dispatcherInvoked,
          dispatchSucceeded: false,
          mutationAllowed: false,
          reversible: true,
          capsuleGrantedAuthority: false,
          reasonCodes: safeReasonCodes(
            error?.reasonCodes || [error?.code],
            "execution_capsule_mutation_dispatch_failed",
          ),
          secretsIncluded: false,
        });
        throw error;
      }
    },
    rollback() {
      return createDisabledGate({ dispatchMutationOperation });
    },
  });
}
