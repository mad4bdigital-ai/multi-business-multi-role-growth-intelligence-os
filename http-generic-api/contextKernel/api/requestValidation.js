import {
  assertAllowedKeys,
  ContextApiValidationError,
  freezeApiValue,
  optionalIsoDateTime,
  optionalString,
  requireEnum,
  requireInteger,
  requirePlainObject,
  requireString,
} from "./apiSupport.js";

const RISK_CLASSES = Object.freeze(["read", "low", "medium", "high", "critical"]);
const PIN_SCOPES = Object.freeze(["request", "workflow", "conversation"]);
const EXPLICIT_CONTEXT_KEYS = Object.freeze([
  "tenantRef",
  "workspaceRef",
  "brandRef",
  "resourceType",
  "resourceRef",
  "connectionRef",
]);

function validateExplicitContext(value) {
  if (value == null) return null;
  const input = assertAllowedKeys(value, EXPLICIT_CONTEXT_KEYS, "explicitContext");
  const result = {};
  for (const key of EXPLICIT_CONTEXT_KEYS) {
    const normalized = optionalString(input[key], `explicitContext.${key}`);
    if (normalized) result[key] = normalized;
  }
  if (Object.keys(result).length === 0) {
    throw new ContextApiValidationError("explicitContext must contain at least one stable reference.", [
      { field: "explicitContext", issue: "at least one stable reference is required" },
    ]);
  }
  return freezeApiValue(result);
}

export function validateContextResolutionRequest(value) {
  const input = assertAllowedKeys(
    requirePlainObject(value, "body"),
    ["operationIntent", "explicitContext", "pinRef", "riskClass"],
    "body",
  );
  return freezeApiValue({
    operationIntent: requireString(input.operationIntent, "operationIntent"),
    explicitContext: validateExplicitContext(input.explicitContext),
    pinRef: optionalString(input.pinRef, "pinRef"),
    riskClass: input.riskClass == null ? "read" : requireEnum(input.riskClass, "riskClass", RISK_CLASSES),
  });
}

export function validateContextPinRequest(value) {
  const input = assertAllowedKeys(
    requirePlainObject(value, "body"),
    ["resolutionId", "scope", "contextRevision", "expiresAt"],
    "body",
  );
  return freezeApiValue({
    resolutionId: requireString(input.resolutionId, "resolutionId"),
    scope: requireEnum(input.scope, "scope", PIN_SCOPES),
    contextRevision: requireString(input.contextRevision, "contextRevision", { maxLength: 128 }),
    expiresAt: optionalIsoDateTime(input.expiresAt, "expiresAt"),
  });
}

export function validateExecutionContextRequest(value) {
  const input = assertAllowedKeys(
    requirePlainObject(value, "body"),
    ["resolutionId", "operationIntent", "expectedContextRevision", "expectedResourceRevision"],
    "body",
  );
  return freezeApiValue({
    resolutionId: requireString(input.resolutionId, "resolutionId"),
    operationIntent: requireString(input.operationIntent, "operationIntent"),
    expectedContextRevision: optionalString(input.expectedContextRevision, "expectedContextRevision", { maxLength: 128 }),
    expectedResourceRevision: optionalString(input.expectedResourceRevision, "expectedResourceRevision", { maxLength: 128 }),
  });
}

export function validateIdentifier(value, fieldName) {
  return requireString(value, fieldName, { maxLength: 191 });
}

export function validateIdempotencyKey(value) {
  if (value == null || value === "") return null;
  return requireString(value, "Idempotency-Key", { minLength: 8, maxLength: 191 });
}

export function validateCandidatePageQuery(value = {}) {
  const input = assertAllowedKeys(requirePlainObject(value, "query"), ["candidateLimit", "candidateCursor"], "query");
  return freezeApiValue({
    limit: input.candidateLimit == null || input.candidateLimit === ""
      ? 25
      : requireInteger(input.candidateLimit, "candidateLimit", { min: 1, max: 100 }),
    cursor: optionalString(input.candidateCursor, "candidateCursor", { maxLength: 2048 }),
  });
}

export const ContextKernelApiEnums = Object.freeze({
  riskClasses: RISK_CLASSES,
  pinScopes: PIN_SCOPES,
});
