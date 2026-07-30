import { deepFreeze } from "./model.js";

export const ENDPOINT_CERTIFICATION_LIMITS = deepFreeze({
  maxAliases: 20,
  maxEndpoints: 20,
  maxCertifications: 20,
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const ALIAS_STATUSES = new Set(["active", "inactive", "revoked", "expired"]);
const ENDPOINT_STATUSES = new Set(["active", "ready", "enabled", "inactive", "disabled", "revoked", "expired"]);
const ENDPOINT_READINESS = new Set(["ready", "active", "enabled", "pending", "blocked", "disabled"]);
const CERTIFICATION_STATUSES = new Set([
  "ci_certified",
  "read_only_certified",
  "diagnostic_certified",
  "runtime_certified",
  "active",
  "ready",
  "baseline_registered",
  "suspended",
  "revoked",
  "expired",
  "disabled",
]);
const CURRENT_CERTIFICATION_STATUSES = new Set([
  "ci_certified",
  "read_only_certified",
  "diagnostic_certified",
  "runtime_certified",
  "active",
  "ready",
]);

function requireString(value, field, maximumLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string.`);
  if (normalized.length > maximumLength) {
    throw new TypeError(`${field} must not exceed ${maximumLength} characters.`);
  }
  return normalized;
}

function requireIdentifier(value, field) {
  const normalized = requireString(value, field);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be a stable identifier.`);
  }
  return normalized;
}

function optionalIdentifier(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return requireIdentifier(value, field);
}

function normalizeTimestamp(value, field, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new TypeError(`${field} must be a valid timestamp.`);
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${field} must be a valid timestamp.`);
  return parsed;
}

function normalizeBoolean(value) {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function normalizeBinding(input) {
  return {
    principalType: requireIdentifier(input.principalType, "principalType"),
    principalRef: requireIdentifier(input.principalRef, "principalRef"),
    subjectType: requireIdentifier(input.subjectType, "subjectType"),
    subjectRef: requireIdentifier(input.subjectRef, "subjectRef"),
    tenantRef: requireIdentifier(input.tenantRef, "tenantRef"),
    workspaceRef: optionalIdentifier(input.workspaceRef, "workspaceRef"),
    capabilityKey: requireIdentifier(input.capabilityKey, "capabilityKey"),
    providerBindingRef: requireIdentifier(input.providerBindingRef, "providerBindingRef"),
    providerFamily: requireIdentifier(input.providerFamily, "providerFamily"),
    connectionRef: optionalIdentifier(input.connectionRef, "connectionRef"),
    parentActionKey: requireIdentifier(input.parentActionKey, "parentActionKey"),
    configuredEndpointKey: requireIdentifier(input.configuredEndpointKey, "configuredEndpointKey"),
    environmentKey: requireIdentifier(input.environmentKey, "environmentKey"),
    riskClass: requireIdentifier(input.riskClass, "riskClass"),
  };
}

function bindingsMatch(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function blocked(reasonCodes, details = {}) {
  return deepFreeze({
    status: "blocked",
    reasonCodes: [...new Set(reasonCodes)].sort(),
    ...details,
    endpointResolved: false,
    certificationResolved: false,
    dispatchCertified: false,
    authorityGranted: false,
    executionAuthorized: false,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  });
}

function recordIsActive(record, now) {
  if (!["active", "ready", "enabled"].includes(record.status)) return false;
  if (record.revokedAt) return false;
  if (record.validFrom && now.getTime() < record.validFrom.getTime()) return false;
  if (record.validUntil && now.getTime() >= record.validUntil.getTime()) return false;
  return true;
}

function normalizeAlias(record, binding) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { errorCode: "ENDPOINT_ALIAS_MALFORMED" };
  }
  try {
    const status = String(record.status || "").trim().toLowerCase();
    if (!ALIAS_STATUSES.has(status)) return { errorCode: "ENDPOINT_ALIAS_STATUS_UNSUPPORTED" };
    const value = {
      aliasRef: requireIdentifier(record.aliasRef, "alias.aliasRef"),
      parentActionKey: requireIdentifier(record.parentActionKey, "alias.parentActionKey"),
      aliasEndpointKey: requireIdentifier(record.aliasEndpointKey, "alias.aliasEndpointKey"),
      canonicalEndpointKey: requireIdentifier(record.canonicalEndpointKey, "alias.canonicalEndpointKey"),
      status,
      validFrom: normalizeTimestamp(record.validFrom, "alias.validFrom"),
      validUntil: normalizeTimestamp(record.validUntil || record.expiresAt, "alias.validUntil"),
      revokedAt: normalizeTimestamp(record.revokedAt, "alias.revokedAt"),
    };
    if (
      value.parentActionKey !== binding.parentActionKey ||
      value.aliasEndpointKey !== binding.configuredEndpointKey
    ) {
      return { errorCode: "ENDPOINT_ALIAS_BINDING_MISMATCH" };
    }
    return { value };
  } catch {
    return { errorCode: "ENDPOINT_ALIAS_MALFORMED" };
  }
}

function normalizeEndpoint(record, binding, canonicalEndpointKey) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { errorCode: "CANONICAL_ENDPOINT_MALFORMED" };
  }
  try {
    const status = String(record.status || "").trim().toLowerCase();
    const executionReadiness = String(record.executionReadiness || "").trim().toLowerCase();
    if (!ENDPOINT_STATUSES.has(status)) return { errorCode: "CANONICAL_ENDPOINT_STATUS_UNSUPPORTED" };
    if (!ENDPOINT_READINESS.has(executionReadiness)) {
      return { errorCode: "CANONICAL_ENDPOINT_READINESS_UNSUPPORTED" };
    }
    const value = {
      endpointRef: requireIdentifier(record.endpointRef, "endpoint.endpointRef"),
      parentActionKey: requireIdentifier(record.parentActionKey, "endpoint.parentActionKey"),
      endpointKey: requireIdentifier(record.endpointKey, "endpoint.endpointKey"),
      providerFamily: requireIdentifier(record.providerFamily, "endpoint.providerFamily"),
      environmentKey: requireIdentifier(record.environmentKey, "endpoint.environmentKey"),
      status,
      executionReadiness,
      schemaPresent: normalizeBoolean(record.schemaPresent),
      method: optionalIdentifier(record.method, "endpoint.method"),
      revisionRef: optionalIdentifier(record.revisionRef, "endpoint.revisionRef"),
      validFrom: normalizeTimestamp(record.validFrom, "endpoint.validFrom"),
      validUntil: normalizeTimestamp(record.validUntil || record.expiresAt, "endpoint.validUntil"),
      revokedAt: normalizeTimestamp(record.revokedAt, "endpoint.revokedAt"),
    };
    if (
      value.parentActionKey !== binding.parentActionKey ||
      value.endpointKey !== canonicalEndpointKey ||
      value.providerFamily !== binding.providerFamily ||
      value.environmentKey !== binding.environmentKey
    ) {
      return { errorCode: "CANONICAL_ENDPOINT_BINDING_MISMATCH" };
    }
    return { value };
  } catch {
    return { errorCode: "CANONICAL_ENDPOINT_MALFORMED" };
  }
}

function normalizeCertification(record, binding, endpoint) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { errorCode: "RUNTIME_CERTIFICATION_MALFORMED" };
  }
  try {
    const certificationStatus = String(record.certificationStatus || "").trim().toLowerCase();
    if (!CERTIFICATION_STATUSES.has(certificationStatus)) {
      return { errorCode: "RUNTIME_CERTIFICATION_STATUS_UNSUPPORTED" };
    }
    const value = {
      certificationRef: requireIdentifier(record.certificationRef, "certification.certificationRef"),
      endpointRef: requireIdentifier(record.endpointRef, "certification.endpointRef"),
      canonicalEndpointKey: requireIdentifier(
        record.canonicalEndpointKey,
        "certification.canonicalEndpointKey",
      ),
      parentActionKey: requireIdentifier(record.parentActionKey, "certification.parentActionKey"),
      providerBindingRef: requireIdentifier(
        record.providerBindingRef,
        "certification.providerBindingRef",
      ),
      providerFamily: requireIdentifier(record.providerFamily, "certification.providerFamily"),
      connectionRef: optionalIdentifier(record.connectionRef, "certification.connectionRef"),
      environmentKey: requireIdentifier(record.environmentKey, "certification.environmentKey"),
      riskClass: requireIdentifier(record.riskClass, "certification.riskClass"),
      certificationStatus,
      dispatchAllowed: normalizeBoolean(record.dispatchAllowed),
      applyAllowed: normalizeBoolean(record.applyAllowed),
      requiresResourceAuthority: normalizeBoolean(record.requiresResourceAuthority),
      requiresDryRun: normalizeBoolean(record.requiresDryRun),
      requiresAuditEvidence: normalizeBoolean(record.requiresAuditEvidence),
      requiresReadback: normalizeBoolean(record.requiresReadback),
      evidenceRef: optionalIdentifier(record.evidenceRef, "certification.evidenceRef"),
      certifiedAt: normalizeTimestamp(record.certifiedAt, "certification.certifiedAt", {
        required: true,
      }),
      expiresAt: normalizeTimestamp(record.expiresAt, "certification.expiresAt", {
        required: true,
      }),
      revokedAt: normalizeTimestamp(record.revokedAt, "certification.revokedAt"),
    };
    if (
      value.endpointRef !== endpoint.endpointRef ||
      value.canonicalEndpointKey !== endpoint.endpointKey ||
      value.parentActionKey !== binding.parentActionKey ||
      value.providerBindingRef !== binding.providerBindingRef ||
      value.providerFamily !== binding.providerFamily ||
      value.connectionRef !== binding.connectionRef ||
      value.environmentKey !== binding.environmentKey ||
      value.riskClass !== binding.riskClass
    ) {
      return { errorCode: "RUNTIME_CERTIFICATION_BINDING_MISMATCH" };
    }
    return { value };
  } catch {
    return { errorCode: "RUNTIME_CERTIFICATION_MALFORMED" };
  }
}

function normalizeList(records, maximumCount, normalizer, malformedCode, ambiguousCode) {
  if (!Array.isArray(records)) return { errorCode: malformedCode };
  if (records.length > maximumCount) return { errorCode: `${malformedCode}_LIMIT_EXCEEDED` };
  const values = [];
  const references = new Set();
  for (const record of records) {
    const result = normalizer(record);
    if (result.errorCode) return result;
    const reference =
      result.value.aliasRef || result.value.certificationRef || result.value.endpointRef;
    if (references.has(reference)) return { errorCode: ambiguousCode };
    references.add(reference);
    values.push(result.value);
  }
  return { value: values };
}

export function evaluateEndpointCertification({
  snapshot,
  principalType,
  principalRef,
  subjectType,
  subjectRef,
  tenantRef,
  workspaceRef = null,
  capabilityKey,
  providerBindingRef,
  providerFamily,
  connectionRef = null,
  parentActionKey,
  configuredEndpointKey,
  environmentKey,
  riskClass,
  now = new Date(),
} = {}) {
  const binding = normalizeBinding({
    principalType,
    principalRef,
    subjectType,
    subjectRef,
    tenantRef,
    workspaceRef,
    capabilityKey,
    providerBindingRef,
    providerFamily,
    connectionRef,
    parentActionKey,
    configuredEndpointKey,
    environmentKey,
    riskClass,
  });
  const evaluatedNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(evaluatedNow.getTime())) throw new TypeError("now must be a valid Date.");

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return blocked(["ENDPOINT_CERTIFICATION_SNAPSHOT_MALFORMED"]);
  }

  let snapshotBinding;
  let capturedAt;
  let expiresAt;
  let sourceEvidence;
  try {
    snapshotBinding = normalizeBinding(snapshot);
    capturedAt = normalizeTimestamp(snapshot.evaluatedAt, "snapshot.evaluatedAt", {
      required: true,
    });
    expiresAt = normalizeTimestamp(snapshot.expiresAt, "snapshot.expiresAt", {
      required: true,
    });
    sourceEvidence = {
      sourceRef: optionalIdentifier(snapshot.sourceRef, "snapshot.sourceRef"),
      versionRef: optionalIdentifier(snapshot.versionRef, "snapshot.versionRef"),
      evaluatedAt: capturedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  } catch {
    return blocked(["ENDPOINT_CERTIFICATION_SNAPSHOT_MALFORMED"]);
  }

  if (!bindingsMatch(binding, snapshotBinding)) {
    return blocked(["ENDPOINT_CERTIFICATION_SNAPSHOT_BINDING_MISMATCH"], { sourceEvidence });
  }
  if (capturedAt.getTime() > evaluatedNow.getTime()) {
    return blocked(["ENDPOINT_CERTIFICATION_SNAPSHOT_FROM_FUTURE"], { sourceEvidence });
  }
  if (expiresAt.getTime() <= evaluatedNow.getTime()) {
    return blocked(["ENDPOINT_CERTIFICATION_SNAPSHOT_STALE"], { sourceEvidence });
  }

  const aliasResult = normalizeList(
    snapshot.aliases,
    ENDPOINT_CERTIFICATION_LIMITS.maxAliases,
    (record) => normalizeAlias(record, binding),
    "ENDPOINT_ALIAS_MALFORMED",
    "ENDPOINT_ALIAS_REFERENCE_AMBIGUOUS",
  );
  if (aliasResult.errorCode) return blocked([aliasResult.errorCode], { sourceEvidence });
  const activeAliases = aliasResult.value.filter((record) => recordIsActive(record, evaluatedNow));
  if (activeAliases.length > 1) {
    return blocked(["ENDPOINT_ALIAS_AMBIGUOUS"], { sourceEvidence });
  }
  const canonicalEndpointKey =
    activeAliases[0]?.canonicalEndpointKey || binding.configuredEndpointKey;

  const endpointResult = normalizeList(
    snapshot.endpoints,
    ENDPOINT_CERTIFICATION_LIMITS.maxEndpoints,
    (record) => normalizeEndpoint(record, binding, canonicalEndpointKey),
    "CANONICAL_ENDPOINT_MALFORMED",
    "CANONICAL_ENDPOINT_REFERENCE_AMBIGUOUS",
  );
  if (endpointResult.errorCode) return blocked([endpointResult.errorCode], { sourceEvidence });
  const activeEndpoints = endpointResult.value.filter((record) => recordIsActive(record, evaluatedNow));
  if (activeEndpoints.length === 0) {
    return blocked(["CANONICAL_ENDPOINT_UNAVAILABLE"], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }
  if (activeEndpoints.length > 1) {
    return blocked(["CANONICAL_ENDPOINT_AMBIGUOUS"], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }
  const endpoint = activeEndpoints[0];
  if (!["ready", "active", "enabled"].includes(endpoint.executionReadiness)) {
    return blocked(["CANONICAL_ENDPOINT_NOT_READY"], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }
  if (!endpoint.schemaPresent) {
    return blocked(["CANONICAL_ENDPOINT_SCHEMA_MISSING"], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }

  const certificationResult = normalizeList(
    snapshot.certifications,
    ENDPOINT_CERTIFICATION_LIMITS.maxCertifications,
    (record) => normalizeCertification(record, binding, endpoint),
    "RUNTIME_CERTIFICATION_MALFORMED",
    "RUNTIME_CERTIFICATION_REFERENCE_AMBIGUOUS",
  );
  if (certificationResult.errorCode) {
    return blocked([certificationResult.errorCode], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }
  if (certificationResult.value.length === 0) {
    return blocked(["RUNTIME_CERTIFICATION_MISSING"], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }

  const currentCertifications = certificationResult.value.filter((record) =>
    CURRENT_CERTIFICATION_STATUSES.has(record.certificationStatus) &&
    !record.revokedAt &&
    record.certifiedAt.getTime() <= evaluatedNow.getTime() &&
    record.expiresAt.getTime() > evaluatedNow.getTime()
  );
  if (currentCertifications.length === 0) {
    const anyFuture = certificationResult.value.some(
      (record) => record.certifiedAt.getTime() > evaluatedNow.getTime(),
    );
    const anyExpired = certificationResult.value.some(
      (record) => record.expiresAt.getTime() <= evaluatedNow.getTime(),
    );
    return blocked([
      anyFuture
        ? "RUNTIME_CERTIFICATION_FROM_FUTURE"
        : anyExpired
          ? "RUNTIME_CERTIFICATION_STALE"
          : "RUNTIME_CERTIFICATION_NOT_CURRENT",
    ], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }
  if (currentCertifications.length > 1) {
    return blocked(["RUNTIME_CERTIFICATION_AMBIGUOUS"], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }
  const certification = currentCertifications[0];
  if (!certification.dispatchAllowed) {
    return blocked(["RUNTIME_CERTIFICATION_DISPATCH_NOT_ALLOWED"], {
      sourceEvidence,
      canonicalEndpointKey,
    });
  }

  return deepFreeze({
    status: "resolved",
    reasonCodes: ["ENDPOINT_CERTIFICATION_RESOLVED"],
    sourceEvidence,
    canonicalEndpointKey,
    aliasEvidence: activeAliases.length
      ? {
          aliasRef: activeAliases[0].aliasRef,
          aliasEndpointKey: activeAliases[0].aliasEndpointKey,
          canonicalEndpointKey: activeAliases[0].canonicalEndpointKey,
        }
      : null,
    endpoint: {
      endpointRef: endpoint.endpointRef,
      endpointKey: endpoint.endpointKey,
      parentActionKey: endpoint.parentActionKey,
      providerFamily: endpoint.providerFamily,
      environmentKey: endpoint.environmentKey,
      method: endpoint.method,
      revisionRef: endpoint.revisionRef,
      schemaPresent: endpoint.schemaPresent,
    },
    certification: {
      certificationRef: certification.certificationRef,
      certificationStatus: certification.certificationStatus,
      evidenceRef: certification.evidenceRef,
      certifiedAt: certification.certifiedAt.toISOString(),
      expiresAt: certification.expiresAt.toISOString(),
      sourceApplyAllowed: certification.applyAllowed,
      requiresResourceAuthority: certification.requiresResourceAuthority,
      requiresDryRun: certification.requiresDryRun,
      requiresAuditEvidence: certification.requiresAuditEvidence,
      requiresReadback: certification.requiresReadback,
    },
    endpointResolved: true,
    certificationResolved: true,
    dispatchCertified: true,
    authorityGranted: false,
    executionAuthorized: false,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  });
}

export const _testingEndpointCertificationPolicy = deepFreeze({
  bindingsMatch,
  normalizeAlias,
  normalizeBinding,
  normalizeCertification,
  normalizeEndpoint,
  normalizeList,
  recordIsActive,
});
