const PRINCIPAL_TYPES = new Set([
  "tenant_user",
  "admin",
  "service_principal",
  "delegated_agent",
  "registry_defined",
]);

const RISK_CLASSES = new Set(["read", "low", "medium", "high", "critical"]);
const OPERATION_KINDS = new Set(["read", "mutation"]);

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value, fieldName) {
  if (value == null || value === "") return null;
  return requireNonEmptyString(value, fieldName);
}

function uniqueSortedStrings(values, fieldName) {
  if (!Array.isArray(values)) throw new TypeError(`${fieldName} must be an array.`);
  return [...new Set(values.map((value) => requireNonEmptyString(value, fieldName)))].sort();
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createAuthenticatedPrincipal({
  principalType,
  principalRef,
  authorizedTenantRefs = [],
  attributes = {},
}) {
  const normalizedType = requireNonEmptyString(principalType, "principalType");
  if (!PRINCIPAL_TYPES.has(normalizedType)) {
    throw new TypeError(`Unsupported principalType: ${normalizedType}`);
  }
  return deepFreeze({
    principalType: normalizedType,
    principalRef: requireNonEmptyString(principalRef, "principalRef"),
    authorizedTenantRefs: uniqueSortedStrings(authorizedTenantRefs, "authorizedTenantRefs"),
    attributes: { ...attributes },
  });
}

export function createEffectiveSubject({
  subjectType = "tenant_user",
  subjectRef,
  tenantRef,
  workspaceRef = null,
  delegatedByPrincipalRef = null,
}) {
  return deepFreeze({
    subjectType: requireNonEmptyString(subjectType, "subjectType"),
    subjectRef: requireNonEmptyString(subjectRef, "subjectRef"),
    tenantRef: requireNonEmptyString(tenantRef, "tenantRef"),
    workspaceRef: optionalString(workspaceRef, "workspaceRef"),
    delegatedByPrincipalRef: optionalString(delegatedByPrincipalRef, "delegatedByPrincipalRef"),
  });
}

export function createContextCandidate({
  candidateType,
  stableRef,
  tenantRef,
  workspaceRef = null,
  brandRef = null,
  resourceType = null,
  resourceRef = null,
  connectionRef = null,
  displayLabel = "",
  authoritySummary = "",
  readinessSummary = "",
  metadata = {},
}) {
  return deepFreeze({
    candidateType: requireNonEmptyString(candidateType, "candidateType"),
    stableRef: requireNonEmptyString(stableRef, "stableRef"),
    tenantRef: requireNonEmptyString(tenantRef, "tenantRef"),
    workspaceRef: optionalString(workspaceRef, "workspaceRef"),
    brandRef: optionalString(brandRef, "brandRef"),
    resourceType: optionalString(resourceType, "resourceType"),
    resourceRef: optionalString(resourceRef, "resourceRef"),
    connectionRef: optionalString(connectionRef, "connectionRef"),
    displayLabel: typeof displayLabel === "string" ? displayLabel : "",
    authoritySummary: typeof authoritySummary === "string" ? authoritySummary : "",
    readinessSummary: typeof readinessSummary === "string" ? readinessSummary : "",
    metadata: { ...metadata },
  });
}

export function createContextPin({
  pinRef,
  stableRef,
  contextRevision,
  expiresAt = null,
  verified = false,
}) {
  const normalizedExpiry = expiresAt == null ? null : new Date(expiresAt).toISOString();
  return deepFreeze({
    pinRef: requireNonEmptyString(pinRef, "pinRef"),
    stableRef: requireNonEmptyString(stableRef, "stableRef"),
    contextRevision: requireNonEmptyString(contextRevision, "contextRevision"),
    expiresAt: normalizedExpiry,
    verified: verified === true,
  });
}

export function normalizeDecisionInput({
  riskClass = "read",
  operationKind = "read",
  operationIntent,
}) {
  const normalizedRisk = requireNonEmptyString(riskClass, "riskClass");
  const normalizedKind = requireNonEmptyString(operationKind, "operationKind");
  if (!RISK_CLASSES.has(normalizedRisk)) throw new TypeError(`Unsupported riskClass: ${normalizedRisk}`);
  if (!OPERATION_KINDS.has(normalizedKind)) throw new TypeError(`Unsupported operationKind: ${normalizedKind}`);
  return deepFreeze({
    riskClass: normalizedRisk,
    operationKind: normalizedKind,
    operationIntent: requireNonEmptyString(operationIntent, "operationIntent"),
  });
}

export const DomainEnums = deepFreeze({
  principalTypes: [...PRINCIPAL_TYPES].sort(),
  riskClasses: [...RISK_CLASSES],
  operationKinds: [...OPERATION_KINDS],
});
