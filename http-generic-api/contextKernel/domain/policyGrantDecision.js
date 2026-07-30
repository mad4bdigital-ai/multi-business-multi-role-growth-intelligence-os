import { deepFreeze } from "./model.js";

export const POLICY_GRANT_LIMITS = deepFreeze({
  maxPolicies: 100,
  maxGrants: 100,
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,190}$/;
const EVIDENCE_EFFECTS = new Set(["allow", "deny"]);
const EVIDENCE_STATUSES = new Set(["active", "inactive", "revoked", "expired"]);

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

function normalizeReasonCode(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const normalized = requireString(value, "reasonCode");
  if (!REASON_CODE_PATTERN.test(normalized)) {
    throw new TypeError("reasonCode must be a stable uppercase reason code.");
  }
  return normalized;
}

function blocked(reasonCodes, details = {}) {
  return deepFreeze({
    status: "blocked",
    decision: "deny",
    reasonCodes: [...new Set(reasonCodes)].sort(),
    ...details,
    policySatisfied: false,
    grantSatisfied: false,
    authorityGranted: false,
    executionAuthorized: false,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  });
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
    operation: requireIdentifier(input.operation, "operation"),
    resourceType: requireIdentifier(input.resourceType, "resourceType"),
    resourceRef: requireIdentifier(input.resourceRef, "resourceRef"),
  };
}

function bindingsMatch(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function sourcePrefix(sourceType) {
  return sourceType === "policy" ? "POLICY" : "GRANT";
}

function normalizeEvidenceRecord(record, sourceType, binding) {
  const prefix = sourcePrefix(sourceType);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { errorCode: `${prefix}_EVIDENCE_MALFORMED` };
  }

  try {
    const referenceField = sourceType === "policy" ? "policyRef" : "grantRef";
    const reference = requireIdentifier(record[referenceField], `${sourceType}.${referenceField}`);
    const effect = String(record.effect || "").trim().toLowerCase();
    if (!EVIDENCE_EFFECTS.has(effect)) {
      return { errorCode: `${prefix}_EFFECT_UNSUPPORTED` };
    }
    const status = String(record.status || "").trim().toLowerCase();
    if (!EVIDENCE_STATUSES.has(status)) {
      return { errorCode: `${prefix}_STATUS_UNSUPPORTED` };
    }

    const recordBinding = normalizeBinding(record);
    if (!bindingsMatch(binding, recordBinding)) {
      return { errorCode: `${prefix}_EVIDENCE_BINDING_MISMATCH` };
    }

    const fallbackReasonCode = `${prefix}_${effect === "deny" ? "EXPLICIT_DENY" : "ALLOW_MATCHED"}`;
    return {
      value: {
        sourceType,
        reference,
        effect,
        status,
        reasonCode: normalizeReasonCode(record.reasonCode, fallbackReasonCode),
        revisionRef: optionalIdentifier(record.revisionRef, `${sourceType}.revisionRef`),
        validFrom: normalizeTimestamp(record.validFrom, `${sourceType}.validFrom`),
        validUntil: normalizeTimestamp(
          record.validUntil || record.expiresAt,
          `${sourceType}.validUntil`,
        ),
        revokedAt: normalizeTimestamp(record.revokedAt, `${sourceType}.revokedAt`),
      },
    };
  } catch {
    return { errorCode: `${prefix}_EVIDENCE_MALFORMED` };
  }
}

function recordIsActive(record, now) {
  if (record.status !== "active") return false;
  if (record.revokedAt) return false;
  if (record.validFrom && now.getTime() < record.validFrom.getTime()) return false;
  if (record.validUntil && now.getTime() >= record.validUntil.getTime()) return false;
  return true;
}

function summarizeEvidence(records) {
  return records
    .map((record) => ({
      reference: record.reference,
      effect: record.effect,
      reasonCode: record.reasonCode,
      revisionRef: record.revisionRef,
    }))
    .sort((left, right) => left.reference.localeCompare(right.reference));
}

function normalizeEvidenceList(records, sourceType, binding, maximumCount) {
  const prefix = sourcePrefix(sourceType);
  if (!Array.isArray(records)) {
    return { errorCode: `${prefix}_EVIDENCE_MALFORMED` };
  }
  if (records.length > maximumCount) {
    return { errorCode: `${prefix}_EVIDENCE_LIMIT_EXCEEDED` };
  }

  const normalized = [];
  const references = new Set();
  for (const record of records) {
    const result = normalizeEvidenceRecord(record, sourceType, binding);
    if (result.errorCode) return result;
    if (references.has(result.value.reference)) {
      return { errorCode: `${prefix}_REFERENCE_AMBIGUOUS` };
    }
    references.add(result.value.reference);
    normalized.push(result.value);
  }
  return { value: normalized };
}

export function evaluatePolicyGrantDecision({
  snapshot,
  principalType,
  principalRef,
  subjectType,
  subjectRef,
  tenantRef,
  workspaceRef = null,
  capabilityKey,
  operation,
  resourceType,
  resourceRef,
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
    operation,
    resourceType,
    resourceRef,
  });
  const evaluatedNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(evaluatedNow.getTime())) throw new TypeError("now must be a valid Date.");

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return blocked(["POLICY_GRANT_SNAPSHOT_MALFORMED"]);
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
    return blocked(["POLICY_GRANT_SNAPSHOT_MALFORMED"]);
  }

  if (!bindingsMatch(binding, snapshotBinding)) {
    return blocked(["POLICY_GRANT_SNAPSHOT_BINDING_MISMATCH"], { sourceEvidence });
  }
  if (capturedAt.getTime() > evaluatedNow.getTime()) {
    return blocked(["POLICY_GRANT_SNAPSHOT_FROM_FUTURE"], { sourceEvidence });
  }
  if (expiresAt.getTime() <= evaluatedNow.getTime()) {
    return blocked(["POLICY_GRANT_SNAPSHOT_STALE"], { sourceEvidence });
  }

  const policyResult = normalizeEvidenceList(
    snapshot.policies,
    "policy",
    binding,
    POLICY_GRANT_LIMITS.maxPolicies,
  );
  if (policyResult.errorCode) {
    return blocked([policyResult.errorCode], { sourceEvidence });
  }
  const grantResult = normalizeEvidenceList(
    snapshot.grants,
    "grant",
    binding,
    POLICY_GRANT_LIMITS.maxGrants,
  );
  if (grantResult.errorCode) {
    return blocked([grantResult.errorCode], { sourceEvidence });
  }

  const activePolicies = policyResult.value.filter((record) => recordIsActive(record, evaluatedNow));
  const activeGrants = grantResult.value.filter((record) => recordIsActive(record, evaluatedNow));
  const policyDenials = activePolicies.filter((record) => record.effect === "deny");
  const grantDenials = activeGrants.filter((record) => record.effect === "deny");
  const policyAllows = activePolicies.filter((record) => record.effect === "allow");
  const grantAllows = activeGrants.filter((record) => record.effect === "allow");

  if (policyDenials.length > 0 || grantDenials.length > 0) {
    return blocked([
      ...(policyDenials.length > 0 ? ["POLICY_EXPLICIT_DENY"] : []),
      ...(grantDenials.length > 0 ? ["GRANT_EXPLICIT_DENY"] : []),
      ...policyDenials.map((record) => record.reasonCode),
      ...grantDenials.map((record) => record.reasonCode),
    ], {
      sourceEvidence,
      policyEvidence: summarizeEvidence(policyDenials),
      grantEvidence: summarizeEvidence(grantDenials),
    });
  }

  if (policyAllows.length === 0) {
    return blocked(["POLICY_ALLOW_NOT_FOUND"], {
      sourceEvidence,
      policyEvidence: [],
      grantEvidence: summarizeEvidence(grantAllows),
    });
  }
  if (grantAllows.length === 0) {
    return blocked(["GRANT_ALLOW_NOT_FOUND"], {
      sourceEvidence,
      policyEvidence: summarizeEvidence(policyAllows),
      grantEvidence: [],
    });
  }

  return deepFreeze({
    status: "resolved",
    decision: "allow",
    reasonCodes: ["POLICY_GRANT_ALLOW_RESOLVED"],
    sourceEvidence,
    policyEvidence: summarizeEvidence(policyAllows),
    grantEvidence: summarizeEvidence(grantAllows),
    policySatisfied: true,
    grantSatisfied: true,
    authorityGranted: false,
    executionAuthorized: false,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  });
}

export const _testingPolicyGrantDecision = deepFreeze({
  bindingsMatch,
  normalizeBinding,
  normalizeEvidenceRecord,
  normalizeEvidenceList,
  recordIsActive,
  summarizeEvidence,
});
