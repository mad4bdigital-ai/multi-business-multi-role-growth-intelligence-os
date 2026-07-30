import { deepFreeze } from "./model.js";

export const SUPPORT_DELEGATION_MODES = deepFreeze([
  "support_impersonation",
  "support_delegated_agent",
]);

const SUPPORT_DELEGATION_STATUSES = new Set(["active", "revoked"]);
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,190}$/;

function requireString(value, field, maximumLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string.`);
  if (normalized.length > maximumLength) {
    throw new TypeError(`${field} must not exceed ${maximumLength} characters.`);
  }
  return normalized;
}

function optionalString(value, field, maximumLength = 191) {
  if (value === null || value === undefined || value === "") return null;
  return requireString(value, field, maximumLength);
}

function normalizeTimestamp(value, field) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${field} must be a valid timestamp.`);
  return parsed;
}

function normalizeOperations(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("allowedOperations must contain at least one operation.");
  }
  return [...new Set(values.map((value) => requireString(value, "allowedOperations", 191)))].sort();
}

export function createSupportDelegationEvidence({
  delegationRef,
  mode,
  actorPrincipalRef,
  subjectRef,
  tenantRef,
  workspaceRef = null,
  delegatedByPrincipalRef = null,
  reasonCode,
  auditRef,
  allowedOperations,
  validFrom,
  expiresAt,
  status,
  revokedAt = null,
} = {}) {
  const normalizedMode = requireString(mode, "mode", 64).toLowerCase();
  if (!SUPPORT_DELEGATION_MODES.includes(normalizedMode)) {
    throw new TypeError(`Unsupported support delegation mode: ${normalizedMode}`);
  }

  const normalizedStatus = requireString(status, "status", 32).toLowerCase();
  if (!SUPPORT_DELEGATION_STATUSES.has(normalizedStatus)) {
    throw new TypeError(`Unsupported support delegation status: ${normalizedStatus}`);
  }

  const normalizedReasonCode = requireString(reasonCode, "reasonCode").toUpperCase();
  if (!REASON_CODE_PATTERN.test(normalizedReasonCode)) {
    throw new TypeError("reasonCode must be a stable uppercase reason code.");
  }

  const normalizedValidFrom = normalizeTimestamp(validFrom, "validFrom");
  const normalizedExpiresAt = normalizeTimestamp(expiresAt, "expiresAt");
  if (normalizedExpiresAt.getTime() <= normalizedValidFrom.getTime()) {
    throw new TypeError("expiresAt must be later than validFrom.");
  }

  const normalizedRevokedAt = revokedAt === null || revokedAt === undefined
    ? null
    : normalizeTimestamp(revokedAt, "revokedAt");
  if (normalizedStatus === "revoked" && !normalizedRevokedAt) {
    throw new TypeError("revokedAt is required when status is revoked.");
  }
  if (normalizedStatus === "active" && normalizedRevokedAt) {
    throw new TypeError("Active delegation evidence cannot include revokedAt.");
  }

  const normalizedDelegatedBy = optionalString(
    delegatedByPrincipalRef,
    "delegatedByPrincipalRef",
  );
  if (normalizedMode === "support_delegated_agent" && !normalizedDelegatedBy) {
    throw new TypeError(
      "delegatedByPrincipalRef is required for support_delegated_agent mode.",
    );
  }

  return deepFreeze({
    delegationRef: requireString(delegationRef, "delegationRef"),
    mode: normalizedMode,
    actorPrincipalRef: requireString(actorPrincipalRef, "actorPrincipalRef"),
    subjectRef: requireString(subjectRef, "subjectRef"),
    tenantRef: requireString(tenantRef, "tenantRef"),
    workspaceRef: optionalString(workspaceRef, "workspaceRef"),
    delegatedByPrincipalRef: normalizedDelegatedBy,
    reasonCode: normalizedReasonCode,
    auditRef: requireString(auditRef, "auditRef"),
    allowedOperations: normalizeOperations(allowedOperations),
    validFrom: normalizedValidFrom.toISOString(),
    expiresAt: normalizedExpiresAt.toISOString(),
    status: normalizedStatus,
    revokedAt: normalizedRevokedAt?.toISOString() || null,
    auditRequired: true,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    secretsIncluded: false,
  });
}

function tenantIsAuthorized(principal, tenantRef) {
  const authorizedTenantRefs = Array.isArray(principal?.authorizedTenantRefs)
    ? principal.authorizedTenantRefs
    : [];
  return authorizedTenantRefs.includes("*") || authorizedTenantRefs.includes(tenantRef);
}

export function evaluateSupportDelegation({
  principal,
  effectiveSubject,
  evidence,
  operationIntent,
  tenantRef,
  workspaceRef = null,
  now = new Date(),
} = {}) {
  if (!principal || typeof principal !== "object") {
    throw new TypeError("principal must be an object.");
  }
  if (!effectiveSubject || typeof effectiveSubject !== "object") {
    throw new TypeError("effectiveSubject must be an object.");
  }

  const normalizedEvidence = createSupportDelegationEvidence(evidence);
  const normalizedOperation = requireString(operationIntent, "operationIntent");
  const normalizedTenantRef = requireString(tenantRef, "tenantRef");
  const normalizedWorkspaceRef = optionalString(workspaceRef, "workspaceRef");
  const evaluatedAt = normalizeTimestamp(now, "now");
  const reasonCodes = [];

  if (normalizedEvidence.status === "revoked" || normalizedEvidence.revokedAt) {
    reasonCodes.push("SUPPORT_DELEGATION_REVOKED");
  } else if (normalizedEvidence.status !== "active") {
    reasonCodes.push("SUPPORT_DELEGATION_NOT_ACTIVE");
  }
  if (evaluatedAt.getTime() < Date.parse(normalizedEvidence.validFrom)) {
    reasonCodes.push("SUPPORT_DELEGATION_NOT_YET_ACTIVE");
  }
  if (evaluatedAt.getTime() >= Date.parse(normalizedEvidence.expiresAt)) {
    reasonCodes.push("SUPPORT_DELEGATION_EXPIRED");
  }
  if (!normalizedEvidence.allowedOperations.includes(normalizedOperation)) {
    reasonCodes.push("SUPPORT_DELEGATION_OPERATION_NOT_ALLOWED");
  }
  if (principal.principalRef !== normalizedEvidence.actorPrincipalRef) {
    reasonCodes.push("SUPPORT_DELEGATION_ACTOR_MISMATCH");
  }
  if (effectiveSubject.subjectRef !== normalizedEvidence.subjectRef) {
    reasonCodes.push("SUPPORT_DELEGATION_SUBJECT_MISMATCH");
  }
  if (
    normalizedTenantRef !== normalizedEvidence.tenantRef ||
    effectiveSubject.tenantRef !== normalizedEvidence.tenantRef
  ) {
    reasonCodes.push("SUPPORT_DELEGATION_TENANT_MISMATCH");
  }
  if (
    normalizedEvidence.workspaceRef &&
    (normalizedWorkspaceRef !== normalizedEvidence.workspaceRef ||
      effectiveSubject.workspaceRef !== normalizedEvidence.workspaceRef)
  ) {
    reasonCodes.push("SUPPORT_DELEGATION_WORKSPACE_MISMATCH");
  }
  if (!tenantIsAuthorized(principal, normalizedEvidence.tenantRef)) {
    reasonCodes.push("SUPPORT_DELEGATION_TENANT_NOT_AUTHORIZED");
  }

  if (normalizedEvidence.mode === "support_impersonation") {
    if (
      principal.principalType !== "service_principal" ||
      principal.attributes?.actorClass !== "support"
    ) {
      reasonCodes.push("SUPPORT_IMPERSONATION_ACTOR_INVALID");
    }
    if (effectiveSubject.delegatedByPrincipalRef !== principal.principalRef) {
      reasonCodes.push("SUPPORT_IMPERSONATION_CHAIN_MISMATCH");
    }
  }

  if (normalizedEvidence.mode === "support_delegated_agent") {
    if (
      principal.principalType !== "delegated_agent" ||
      principal.attributes?.actorClass !== "agent"
    ) {
      reasonCodes.push("SUPPORT_DELEGATED_AGENT_ACTOR_INVALID");
    }
    if (
      principal.attributes?.delegatedByPrincipalRef !==
        normalizedEvidence.delegatedByPrincipalRef ||
      effectiveSubject.delegatedByPrincipalRef !==
        normalizedEvidence.delegatedByPrincipalRef
    ) {
      reasonCodes.push("SUPPORT_DELEGATED_AGENT_CHAIN_MISMATCH");
    }
  }

  const uniqueReasonCodes = [...new Set(reasonCodes)];
  const allowed = uniqueReasonCodes.length === 0;
  return deepFreeze({
    allowed,
    status: allowed ? "allowed" : "blocked",
    reasonCodes: uniqueReasonCodes,
    delegationRef: normalizedEvidence.delegationRef,
    mode: normalizedEvidence.mode,
    actor: {
      principalType: principal.principalType,
      principalRef: principal.principalRef,
    },
    effectiveSubject: {
      subjectType: effectiveSubject.subjectType,
      subjectRef: effectiveSubject.subjectRef,
      tenantRef: effectiveSubject.tenantRef,
      workspaceRef: effectiveSubject.workspaceRef,
      delegatedByPrincipalRef: effectiveSubject.delegatedByPrincipalRef,
    },
    operationIntent: normalizedOperation,
    tenantRef: normalizedTenantRef,
    workspaceRef: normalizedWorkspaceRef,
    reasonCode: normalizedEvidence.reasonCode,
    auditRef: normalizedEvidence.auditRef,
    evaluatedAt: evaluatedAt.toISOString(),
    auditRequired: true,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    secretsIncluded: false,
  });
}
