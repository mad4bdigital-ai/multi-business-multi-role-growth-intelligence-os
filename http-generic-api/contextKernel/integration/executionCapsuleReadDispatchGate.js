import { assertExecutionCapsuleIntegrity, deepFreeze } from "../domain/index.js";
import { ExecutionCapsuleValidationStatus } from "../application/executionCapsuleService.js";

const TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,190}$/u;
const SECRET_VALUE_PATTERNS = Object.freeze([
  /Bearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|authorization|cookie|session)\s*[:=]/iu,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
]);
const FORBIDDEN_DISPATCH_FIELDS = new Set([
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
const MAX_DISPATCH_INPUT_DEPTH = 8;
const MAX_DISPATCH_INPUT_NODES = 512;
const MAX_DISPATCH_INPUT_ENTRIES = 128;
const MAX_DISPATCH_INPUT_STRING_LENGTH = 16 * 1024;

function cleanToken(value, fieldName) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    throw new TypeError(`${fieldName} must be a bounded token.`);
  }
  return token;
}

function safeTelemetryToken(value, fallback = "unknown") {
  const token = typeof value === "string" ? value.trim() : "";
  return TOKEN_PATTERN.test(token) ? token : fallback;
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

function safeClockMilliseconds(clock) {
  try {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

function durationMilliseconds(clock, startedAt) {
  const finishedAt = safeClockMilliseconds(clock);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, Math.round(finishedAt - startedAt));
}

function unsafeDispatchInput(reasonCode) {
  return new ExecutionCapsuleReadDispatchError(
    "execution_capsule_read_dispatch_input_unsafe",
    [reasonCode],
  );
}

function normalizedDispatchFieldName(value) {
  return String(value).replace(/[_-]/gu, "").toLowerCase();
}

function projectSafeDispatchInputValue(value, depth, state) {
  state.nodes += 1;
  if (state.nodes > MAX_DISPATCH_INPUT_NODES) {
    throw unsafeDispatchInput("execution_capsule_read_dispatch_input_too_large");
  }
  if (depth > MAX_DISPATCH_INPUT_DEPTH) {
    throw unsafeDispatchInput("execution_capsule_read_dispatch_input_too_deep");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw unsafeDispatchInput("execution_capsule_read_dispatch_input_non_finite");
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_DISPATCH_INPUT_STRING_LENGTH) {
      throw unsafeDispatchInput("execution_capsule_read_dispatch_input_string_too_large");
    }
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw unsafeDispatchInput("execution_capsule_read_dispatch_input_secret_like");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw unsafeDispatchInput("execution_capsule_read_dispatch_input_type_unsupported");
  }
  if (state.active.has(value)) {
    throw unsafeDispatchInput("execution_capsule_read_dispatch_input_cycle");
  }
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_DISPATCH_INPUT_ENTRIES) {
        throw unsafeDispatchInput("execution_capsule_read_dispatch_input_array_too_large");
      }
      const unexpectedKeys = Reflect.ownKeys(value).filter((key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key))
      );
      if (unexpectedKeys.length > 0) {
        throw unsafeDispatchInput("execution_capsule_read_dispatch_input_array_shape_invalid");
      }
      return value.map((entry) => projectSafeDispatchInputValue(entry, depth + 1, state));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unsafeDispatchInput("execution_capsule_read_dispatch_input_object_type_unsupported");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_DISPATCH_INPUT_ENTRIES) {
      throw unsafeDispatchInput("execution_capsule_read_dispatch_input_object_too_large");
    }
    const result = Object.create(null);
    for (const key of keys.sort((left, right) => String(left).localeCompare(String(right)))) {
      if (typeof key !== "string") {
        throw unsafeDispatchInput("execution_capsule_read_dispatch_input_symbol_key");
      }
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw unsafeDispatchInput("execution_capsule_read_dispatch_input_prototype_key");
      }
      if (FORBIDDEN_DISPATCH_FIELDS.has(normalizedDispatchFieldName(key))) {
        throw unsafeDispatchInput("execution_capsule_read_dispatch_input_authority_field");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
        throw unsafeDispatchInput("execution_capsule_read_dispatch_input_descriptor_unsupported");
      }
      result[key] = projectSafeDispatchInputValue(descriptor.value, depth + 1, state);
    }
    return result;
  } finally {
    state.active.delete(value);
  }
}

function projectSafeDispatchInput(value) {
  return deepFreeze(projectSafeDispatchInputValue(value, 0, {
    nodes: 0,
    active: new WeakSet(),
  }));
}

function requireReadOperationContract(operationContract) {
  if (!operationContract || typeof operationContract !== "object" || Array.isArray(operationContract)) {
    throw new TypeError("operationContract must be an object.");
  }
  const operationKey = cleanToken(operationContract.operationKey, "operationContract.operationKey");
  if (operationContract.operationKind !== "read") {
    throw new ExecutionCapsuleReadDispatchError(
      "execution_capsule_read_dispatch_requires_read_operation",
      ["execution_capsule_read_dispatch_requires_read_operation"],
    );
  }
  if (operationContract.mutationRequired !== false) {
    throw new ExecutionCapsuleReadDispatchError(
      "execution_capsule_read_dispatch_mutation_classification_required",
      ["execution_capsule_read_dispatch_mutation_classification_required"],
    );
  }
  return Object.freeze({
    operationKey,
    operationKind: "read",
    riskClass: cleanToken(operationContract.riskClass || "read", "operationContract.riskClass"),
    mutationRequired: false,
  });
}

function requireGovernanceDecision(governanceDecision, operationContract, capsule) {
  if (!governanceDecision || typeof governanceDecision !== "object" || Array.isArray(governanceDecision)) {
    throw new ExecutionCapsuleReadDispatchError(
      "execution_capsule_read_dispatch_governance_missing",
      ["execution_capsule_read_dispatch_governance_missing"],
    );
  }
  const decisionOperationKey = cleanToken(
    governanceDecision.operationKey,
    "governanceDecision.operationKey",
  );
  const decisionContextHash = cleanToken(
    governanceDecision.contextHash,
    "governanceDecision.contextHash",
  );
  if (
    governanceDecision.status !== "allowed" ||
    governanceDecision.dispatchAllowed !== true ||
    governanceDecision.mutationAllowed !== false
  ) {
    throw new ExecutionCapsuleReadDispatchError(
      "execution_capsule_read_dispatch_governance_blocked",
      safeReasonCodes(
        governanceDecision.reasonCodes,
        "execution_capsule_read_dispatch_governance_blocked",
      ),
    );
  }
  if (decisionOperationKey !== operationContract.operationKey) {
    throw new ExecutionCapsuleReadDispatchError(
      "execution_capsule_read_dispatch_operation_mismatch",
      ["execution_capsule_read_dispatch_operation_mismatch"],
    );
  }
  if (decisionContextHash !== capsule.contextHash) {
    throw new ExecutionCapsuleReadDispatchError(
      "execution_capsule_read_dispatch_governance_context_mismatch",
      ["execution_capsule_read_dispatch_governance_context_mismatch"],
    );
  }
  return Object.freeze({
    decisionRef: cleanToken(governanceDecision.decisionRef, "governanceDecision.decisionRef"),
    decisionRevision: cleanToken(
      governanceDecision.decisionRevision,
      "governanceDecision.decisionRevision",
    ),
    operationKey: decisionOperationKey,
    contextHash: decisionContextHash,
    status: "allowed",
    dispatchAllowed: true,
    mutationAllowed: false,
  });
}

function requireCurrentEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("currentEvidenceProvider must return an object.");
  }
  if (!value.currentContext || typeof value.currentContext !== "object") {
    throw new TypeError("currentEvidence.currentContext must be an object.");
  }
  if (!Array.isArray(value.currentDependencies)) {
    throw new TypeError("currentEvidence.currentDependencies must be an array.");
  }
  return value;
}

function safeExecutionContext(capsule) {
  return Object.freeze({
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
    // Telemetry cannot alter validation or dispatch behavior.
  }
}

export class ExecutionCapsuleReadDispatchError extends Error {
  constructor(code, reasonCodes = [code]) {
    super(code);
    this.name = "ExecutionCapsuleReadDispatchError";
    this.code = code;
    this.status = 409;
    this.reasonCodes = Object.freeze(safeReasonCodes(reasonCodes, code));
  }
}

function createDisabledGate({ dispatchReadOperation }) {
  return Object.freeze({
    enabled: false,
    mode: "legacy_read_dispatch",
    dispatch({ dispatchInput } = {}) {
      return dispatchReadOperation(dispatchInput);
    },
    rollback() {
      return createDisabledGate({ dispatchReadOperation });
    },
  });
}

export function createExecutionCapsuleReadDispatchGate({
  enabled = false,
  capsuleService = null,
  currentEvidenceProvider = null,
  dispatchReadOperation = null,
  emitTelemetry = null,
  clock = () => Date.now(),
} = {}) {
  if (typeof dispatchReadOperation !== "function") {
    throw new TypeError("dispatchReadOperation must be a function.");
  }
  if (enabled !== true) return createDisabledGate({ dispatchReadOperation });
  if (!capsuleService || typeof capsuleService.validate !== "function") {
    throw new TypeError("capsuleService.validate must be a function when the gate is enabled.");
  }
  if (typeof currentEvidenceProvider !== "function") {
    throw new TypeError("currentEvidenceProvider must be a function when the gate is enabled.");
  }
  if (typeof emitTelemetry !== "function") {
    throw new TypeError("emitTelemetry must be a function when the gate is enabled.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  return Object.freeze({
    enabled: true,
    mode: "execution_capsule_read_dispatch_gate",
    async dispatch({ capsule, operationContract, governanceDecision, dispatchInput } = {}) {
      const startedAt = safeClockMilliseconds(clock);
      let readContract = null;
      let validation = null;
      let governance = null;
      let dispatcherInvoked = false;
      try {
        readContract = requireReadOperationContract(operationContract);
        const canonicalCapsule = assertExecutionCapsuleIntegrity(capsule);
        const safeDispatchInput = projectSafeDispatchInput(dispatchInput);
        const evidence = requireCurrentEvidence(await currentEvidenceProvider({
          capsule: canonicalCapsule,
          operationContract: readContract,
          dispatchInput: safeDispatchInput,
        }));
        validation = capsuleService.validate({
          capsule: canonicalCapsule,
          currentContext: evidence.currentContext,
          currentDependencies: evidence.currentDependencies,
          operationKind: "read",
          dynamicRefreshComplete: false,
          interpretationRequired: evidence.interpretationRequired === true,
          blockedReasonCodes: Array.isArray(evidence.blockedReasonCodes)
            ? evidence.blockedReasonCodes
            : [],
          now: evidence.now ?? clock(),
        });
        if (validation.status !== ExecutionCapsuleValidationStatus.VALID) {
          throw new ExecutionCapsuleReadDispatchError(
            `execution_capsule_read_dispatch_${validation.status}`,
            validation.reasonCodes,
          );
        }
        governance = requireGovernanceDecision(
          governanceDecision,
          readContract,
          canonicalCapsule,
        );
        const dispatchEnvelope = deepFreeze({
          operationContract: readContract,
          governanceDecision: governance,
          executionContext: safeExecutionContext(canonicalCapsule),
          dispatchInput: safeDispatchInput,
        });
        dispatcherInvoked = true;
        const result = await dispatchReadOperation(dispatchEnvelope);
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_read_dispatch",
          mode: "read_only",
          operationKey: readContract.operationKey,
          validationStatus: validation.status,
          governanceStatus: governance.status,
          dispatcherInvoked: true,
          dispatchSucceeded: true,
          mutationAllowed: false,
          capsuleGrantedAuthority: false,
          durationMs: durationMilliseconds(clock, startedAt),
          reasonCodes: [],
          secretsIncluded: false,
        });
        return result;
      } catch (error) {
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_read_dispatch",
          mode: "read_only",
          operationKey: readContract?.operationKey || safeTelemetryToken(operationContract?.operationKey),
          validationStatus: validation?.status || null,
          governanceStatus: governance?.status || null,
          dispatcherInvoked,
          dispatchSucceeded: false,
          mutationAllowed: false,
          capsuleGrantedAuthority: false,
          durationMs: durationMilliseconds(clock, startedAt),
          reasonCodes: safeReasonCodes(
            error?.reasonCodes || [error?.code],
            "execution_capsule_read_dispatch_failed",
          ),
          secretsIncluded: false,
        });
        throw error;
      }
    },
    rollback() {
      return createDisabledGate({ dispatchReadOperation });
    },
  });
}
