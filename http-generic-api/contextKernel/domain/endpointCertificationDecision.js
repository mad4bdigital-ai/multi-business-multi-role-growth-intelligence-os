import { deepFreeze } from "./model.js";

export const ENDPOINT_CERTIFICATION_LIMITS = deepFreeze({
  maxAliases: 50,
  maxEndpoints: 50,
  maxCertifications: 50,
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const ENDPOINT_STATUSES = new Set(["active", "ready", "enabled", "inactive", "disabled", "revoked"]);
const ENDPOINT_READINESS = new Set(["ready", "active", "enabled", "blocked", "unavailable", "unknown"]);
const ALIAS_STATUSES = new Set(["active", "inactive", "disabled", "revoked", "expired"]);
const CERTIFICATION_STATUSES = new Set(["certified", "active", "revoked", "suspended", "expired", "inactive"]);

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

function optionalString(value, field, maximumLength = 500) {
  if (value === null || value === undefined || value === "") return null;
  return requireString(value, field, maximumLength);
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
    appKey: requireIdentifier(input.appKey, "appKey"),
    parentActionKey: requireIdentifier(input.parentActionKey, "parentActionKey"),
    configuredEndpointKey: requireIdentifier(input.configuredEndpointKey, "configuredEndpointKey"),
  };
}

function bindingsMatch(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function blocked(reasonCodes, details = {}) {
  return deepFreeze({
    status: "blocked",
    decision: "deny",
    reasonCodes: [...new Set(reasonCodes)].sort(),
    ...details,
    endpointResolved: false,
    certificationSatisfied: false,
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

function recordIsCurrent(record, now) {
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
    const recordBinding = normalizeBinding(record);
    if (!bindingsMatch(binding, recordBinding)) {
      return { errorCode: "ENDPOINT_ALIAS_BINDING_MISMATCH" };
    }
    return {
      value: {
        aliasRef: requireIdentifier(record.aliasRef, "alias.aliasRef"),
        aliasEndpointKey: requireIdentifier(record.aliasEndpointKey, "alias.aliasEndpointKey"),
        canonicalEndpointKey: requireIdentifier(record.canonicalEndpointKey, "alias.canonicalEndpointKey"),
        status,
        revisionRef: optionalIdentifier(record.revisionRef, "alias.revisionRef"),
        validFrom: normalizeTimestamp(record.validFrom, "alias.validFrom"),
        validUntil: normalizeTimestamp(record.validUntil || record.expiresAt, "alias.validUntil"),
      },
    };
  } catch {
    return { errorCode: "ENDPOINT_ALIAS_MALFORMED" };
  }
}

function normalizeEndpoint(record, binding) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { errorCode: "ENDPOINT_EVIDENCE_MALFORMED" };
  }
  try {
    const status = String(record.status || "").trim().toLowerCase();
    const executionReadiness = String(record.executionReadiness || "").trim().toLowerCase();
    if (!ENDPOINT_STATUSES.has(status)) return { errorCode: "ENDPOINT_STATUS_UNSUPPORTED" };
    if (!ENDPOINT_READINESS.has(executionReadiness)) {
      return { errorCode: "ENDPOINT_READINESS_UNSUPPORTED" };
    }
    const recordBinding = normalizeBinding(record);
    if (!bindingsMatch(binding, recordBinding)) {
      return { errorCode: "ENDPOINT_EVIDENCE_BINDING_MISMATCH" };
    }
    return {
      value: {
        endpointRef: requireIdentifier(record.endpointRef, "endpoint.endpointRef"),
        endpointKey: requireIdentifier(record.endpointKey, "endpoint.endpointKey"),
        status,
        executionReadiness,
        schemaPresent: record.schemaPresent === true,
        method: optionalIdentifier(record.method, "endpoint.method"),
        endpointPathOrFunction: optionalString(
          record.endpointPathOrFunction,
          "endpoint.endpointPathOrFunction",
          500,
        ),
        moduleBinding: optionalIdentifier(record.moduleBinding, "endpoint.moduleBinding"),
        connectorFamily: optionalIdentifier(record.connectorFamily, "endpoint.connectorFamily"),
        revisionRef: optionalIdentifier(record.revisionRef, "endpoint.revisionRef"),
        validFrom: normalizeTimestamp(record.validFrom, "endpoint.validFrom"),
        validUntil: normalizeTimestamp(record.validUntil || record.expiresAt, "endpoint.validUntil"),
      },
    };
  } catch {
    return { errorCode: "ENDPOINT_EVIDENCE_MALFORMED" };
  }
}

function normalizeCertification(record, binding) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { errorCode: "CERTIFICATION_EVIDENCE_MALFORMED" };
  }
  try {
    const status = String(record.status || record.certificationStatus || "").trim().toLowerCase();
    if (!CERTIFICATION_STATUSES.has(status)) {
      return { errorCode: "CERTIFICATION_STATUS_UNSUPPORTED" };
    }
    const recordBinding = normalizeBinding(record);
    if (!bindingsMatch(binding, recordBinding)) {
      return { errorCode: "CERTIFICATION_EVIDENCE_BINDING_MISMATCH" };
    }
    return {
      value: {
        certificationRef: requireIdentifier(record.certificationRef, "certification.certificationRef"),
        endpointKey: requireIdentifier(record.endpointKey, "certification.endpointKey"),
        status,
        dispatchAllowed: record.dispatchAllowed === true,
        applyAllowed: record.applyAllowed === true,
        revisionRef: optionalIdentifier(record.revisionRef, "certification.revisionRef"),
        certifiedAt: normalizeTimestamp(record.certifiedAt, "certification.certifiedAt"),
        validFrom: normalizeTimestamp(record.validFrom, "certification.validFrom"),
        validUntil: normalizeTimestamp(record.validUntil || record.expiresAt, "certification.validUntil"),
        revokedAt: normalizeTimestamp(record.revokedAt, "certification.revokedAt"),
      },
    };
  } catch {
    return { errorCode: "CERTIFICATION_EVIDENCE_MALFORMED" };
  }
}

function normalizeList(records, normalizeRecord, binding, maximumCount, limitCode, ambiguousCode, refKey) {
  if (!Array.isArray(records)) return { errorCode: `${limitCode.replace("_LIMIT_EXCEEDED", "")}_MALFORMED` };
  if (records.length > maximumCount) return { errorCode: limitCode };
  const normalized = [];
  const references = new Set();
  for (const record of records) {
    const result = normalizeRecord(record, binding);
    if (result.errorCode) return result;
    const reference = result.value[refKey];
    if (references.has(reference)) return { errorCode: ambiguousCode };
    references.add(reference);
    normalized.push(result.value);
  }
  return { value: normalized };
}

function summarizeAlias(alias) {
  return alias ? {
    aliasRef: alias.aliasRef,
    aliasEndpointKey: alias.aliasEndpointKey,
    canonicalEndpointKey: alias.canonicalEndpointKey,
    revisionRef: alias.revisionRef,
  } : null;
}

function summarizeEndpoint(endpoint) {
  return {
    endpointRef: endpoint.endpointRef,
    endpointKey: endpoint.endpointKey,
    method: endpoint.method,
    endpointPathOrFunction: endpoint.endpointPathOrFunction,
    moduleBinding: endpoint.moduleBinding,
    connectorFamily: endpoint.connectorFamily,
    revisionRef: endpoint.revisionRef,
  };
}

function summarizeCertification(certification) {
  return {
    certificationRef: certification.certificationRef,
    endpointKey: certification.endpointKey,
    status: certification.status,
    dispatchAllowed: certification.dispatchAllowed,
    applyAllowed: certification.applyAllowed,
    revisionRef: certification.revisionRef,
    certifiedAt: certification.certifiedAt?.toISOString() || null,
    validUntil: certification.validUntil?.toISOString() || null,
  };
}

export function evaluateEndpointCertificationDecision({
  snapshot,
  principalType,
  principalRef,
  subjectType,
  subjectRef,
  tenantRef,
  workspaceRef = null,
  capabilityKey,
  providerBindingRef,
  appKey,
  parentActionKey,
  configuredEndpointKey,
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
    appKey,
    parentActionKey,
    configuredEndpointKey,
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
    capturedAt = normalizeTimestamp(snapshot.evaluatedAt, "snapshot.evaluatedAt", { required: true });
    expiresAt = normalizeTimestamp(snapshot.expiresAt, "snapshot.expiresAt", { required: true });
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

  const aliasesResult = normalizeList(
    snapshot.aliases,
    normalizeAlias,
    binding,
    ENDPOINT_CERTIFICATION_LIMITS.maxAliases,
    "ENDPOINT_ALIAS_LIMIT_EXCEEDED",
    "ENDPOINT_ALIAS_REFERENCE_AMBIGUOUS",
    "aliasRef",
  );
  if (aliasesResult.errorCode) return blocked([aliasesResult.errorCode], { sourceEvidence });

  const relevantAliases = aliasesResult.value.filter(
    (alias) => alias.aliasEndpointKey === binding.configuredEndpointKey && recordIsCurrent(alias, evaluatedNow),
  );
  const blockingAliases = relevantAliases.filter((alias) => ["revoked", "disabled", "inactive", "expired"].includes(alias.status));
  if (blockingAliases.length > 0) {
    return blocked(["ENDPOINT_ALIAS_NOT_ACTIVE"], {
      sourceEvidence,
      aliasEvidence: blockingAliases.map(summarizeAlias),
    });
  }
  const activeAliases = relevantAliases.filter((alias) => alias.status === "active");
  if (activeAliases.length > 1) {
    return blocked(["ENDPOINT_ALIAS_AMBIGUOUS"], {
      sourceEvidence,
      aliasEvidence: activeAliases.map(summarizeAlias),
    });
  }
  const selectedAlias = activeAliases[0] || null;
  const canonicalEndpointKey = selectedAlias?.canonicalEndpointKey || binding.configuredEndpointKey;

  const endpointsResult = normalizeList(
    snapshot.endpoints,
    normalizeEndpoint,
    binding,
    ENDPOINT_CERTIFICATION_LIMITS.maxEndpoints,
    "ENDPOINT_EVIDENCE_LIMIT_EXCEEDED",
    "ENDPOINT_REFERENCE_AMBIGUOUS",
    "endpointRef",
  );
  if (endpointsResult.errorCode) return blocked([endpointsResult.errorCode], { sourceEvidence });

  const matchingEndpoints = endpointsResult.value.filter(
    (endpoint) => endpoint.endpointKey === canonicalEndpointKey && recordIsCurrent(endpoint, evaluatedNow),
  );
  const blockingEndpoints = matchingEndpoints.filter(
    (endpoint) => ["inactive", "disabled", "revoked"].includes(endpoint.status)
      || ["blocked", "unavailable"].includes(endpoint.executionReadiness),
  );
  if (blockingEndpoints.length > 0) {
    return blocked(["CANONICAL_ENDPOINT_DENIED"], {
      sourceEvidence,
      aliasEvidence: summarizeAlias(selectedAlias),
      endpointEvidence: blockingEndpoints.map(summarizeEndpoint),
    });
  }
  const activeEndpoints = matchingEndpoints.filter(
    (endpoint) => ["active", "ready", "enabled"].includes(endpoint.status)
      && ["ready", "active", "enabled"].includes(endpoint.executionReadiness),
  );
  if (activeEndpoints.length === 0) {
    return blocked(["CANONICAL_ENDPOINT_UNAVAILABLE"], {
      sourceEvidence,
      aliasEvidence: summarizeAlias(selectedAlias),
    });
  }
  if (activeEndpoints.length > 1) {
    return blocked(["CANONICAL_ENDPOINT_AMBIGUOUS"], {
      sourceEvidence,
      aliasEvidence: summarizeAlias(selectedAlias),
      endpointEvidence: activeEndpoints.map(summarizeEndpoint),
    });
  }
  const selectedEndpoint = activeEndpoints[0];
  if (!selectedEndpoint.schemaPresent) {
    return blocked(["ENDPOINT_SCHEMA_MISSING"], {
      sourceEvidence,
      aliasEvidence: summarizeAlias(selectedAlias),
      endpointEvidence: summarizeEndpoint(selectedEndpoint),
    });
  }

  const certificationsResult = normalizeList(
    snapshot.certifications,
    normalizeCertification,
    binding,
    ENDPOINT_CERTIFICATION_LIMITS.maxCertifications,
    "CERTIFICATION_EVIDENCE_LIMIT_EXCEEDED",
    "CERTIFICATION_REFERENCE_AMBIGUOUS",
    "certificationRef",
  );
  if (certificationsResult.errorCode) return blocked([certificationsResult.errorCode], { sourceEvidence });

  const currentCertifications = certificationsResult.value.filter(
    (certification) => certification.endpointKey === canonicalEndpointKey
      && recordIsCurrent(certification, evaluatedNow),
  );
  const explicitDenials = currentCertifications.filter(
    (certification) => certification.revokedAt
      || ["revoked", "suspended", "inactive"].includes(certification.status)
      || (["certified", "active"].includes(certification.status) && !certification.dispatchAllowed),
  );
  if (explicitDenials.length > 0) {
    return blocked(["RUNTIME_CERTIFICATION_DENIED"], {
      sourceEvidence,
      aliasEvidence: summarizeAlias(selectedAlias),
      endpointEvidence: summarizeEndpoint(selectedEndpoint),
      certificationEvidence: explicitDenials.map(summarizeCertification),
    });
  }

  const futureCertifications = currentCertifications.filter(
    (certification) => ["certified", "active"].includes(certification.status)
      && certification.dispatchAllowed
      && certification.certifiedAt
      && certification.certifiedAt.getTime() > evaluatedNow.getTime(),
  );
  if (futureCertifications.length > 0) {
    return blocked(["RUNTIME_CERTIFICATION_FROM_FUTURE"], {
      sourceEvidence,
      aliasEvidence: summarizeAlias(selectedAlias),
      endpointEvidence: summarizeEndpoint(selectedEndpoint),
      certificationEvidence: futureCertifications.map(summarizeCertification),
    });
  }

  const activeCertifications = currentCertifications.filter(
    (certification) => ["certified", "active"].includes(certification.status)
      && certification.dispatchAllowed
      && !certification.revokedAt
      && (!certification.certifiedAt || certification.certifiedAt.getTime() <= evaluatedNow.getTime()),
  );
  if (activeCertifications.length === 0) {
    return blocked(["RUNTIME_CERTIFICATION_MISSING"], {
      sourceEvidence,
      aliasEvidence: summarizeAlias(selectedAlias),
      endpointEvidence: summarizeEndpoint(selectedEndpoint),
    });
  }
  if (activeCertifications.length > 1) {
    return blocked(["RUNTIME_CERTIFICATION_AMBIGUOUS"], {
      sourceEvidence,
      aliasEvidence: summarizeAlias(selectedAlias),
      endpointEvidence: summarizeEndpoint(selectedEndpoint),
      certificationEvidence: activeCertifications.map(summarizeCertification),
    });
  }

  const selectedCertification = activeCertifications[0];
  return deepFreeze({
    status: "resolved",
    decision: "allow",
    reasonCodes: ["ENDPOINT_CERTIFICATION_RESOLVED"],
    sourceEvidence,
    configuredEndpointKey: binding.configuredEndpointKey,
    canonicalEndpointKey,
    aliasApplied: Boolean(selectedAlias),
    aliasEvidence: summarizeAlias(selectedAlias),
    endpointEvidence: summarizeEndpoint(selectedEndpoint),
    certificationEvidence: summarizeCertification(selectedCertification),
    endpointResolved: true,
    certificationSatisfied: true,
    dispatchCertified: true,
    applyCertified: selectedCertification.applyAllowed,
    authorityGranted: false,
    executionAuthorized: false,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  });
}

export const _testingEndpointCertificationDecision = deepFreeze({
  bindingsMatch,
  normalizeAlias,
  normalizeBinding,
  normalizeCertification,
  normalizeEndpoint,
  recordIsCurrent,
  summarizeAlias,
  summarizeCertification,
  summarizeEndpoint,
});
