import { deepFreeze } from "./model.js";

export const SHADOW_PARITY_LIMITS = deepFreeze({
  maxIdentityRefsPerDimension: 200,
  maxReasonCodes: 200,
  maxReadinessDimensions: 100,
  maxDataQualityIssues: 100,
  maxUnsupportedSemantics: 100,
});

export const SHADOW_PARITY_IDENTITY_DIMENSIONS = deepFreeze([
  "resourceRefs",
  "capabilityKeys",
  "connectionRefs",
  "actionKeys",
]);

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const SIDE_EFFECT_FLAGS = Object.freeze([
  "executionPerformed",
  "providerCallMade",
  "automaticWritePerformed",
  "credentialPayloadRead",
  "secretsIncluded",
]);

function requireToken(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !TOKEN_PATTERN.test(normalized)) {
    throw new TypeError(`${fieldName} must be a stable token.`);
  }
  return normalized;
}

function normalizeTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${fieldName} must be a valid timestamp.`);
  return parsed;
}

function normalizeOptionalToken(value, fieldName, issues, issueCode) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return requireToken(value, fieldName);
  } catch {
    issues.push(issueCode);
    return null;
  }
}

function normalizeTokenList(value, fieldName, limit, issues) {
  if (!Array.isArray(value)) {
    issues.push(`${fieldName}_not_array`);
    return [];
  }
  if (value.length > limit) {
    issues.push(`${fieldName}_limit_exceeded`);
    return [];
  }
  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    try {
      const token = requireToken(value[index], `${fieldName}[${index}]`);
      if (seen.has(token)) {
        issues.push(`${fieldName}_duplicate_ref`);
        continue;
      }
      seen.add(token);
      normalized.push(token);
    } catch {
      issues.push(`${fieldName}_invalid_ref`);
    }
  }
  return normalized.sort();
}

function normalizeReadinessDimensions(value, issues) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push("readiness_dimensions_not_object");
    return {};
  }
  const entries = Object.entries(value);
  if (entries.length > SHADOW_PARITY_LIMITS.maxReadinessDimensions) {
    issues.push("readiness_dimensions_limit_exceeded");
    return {};
  }
  const result = {};
  for (const [rawKey, rawValue] of entries) {
    try {
      const key = requireToken(rawKey, "readinessDimensions.key");
      const state = requireToken(rawValue, `readinessDimensions.${key}`);
      result[key] = state;
    } catch {
      issues.push("readiness_dimension_invalid");
    }
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function emptyNormalization(expectedSource) {
  return {
    snapshot: null,
    issues: [`${expectedSource}_snapshot_not_object`],
    stale: false,
    unsupported: false,
    dataQualityDetected: true,
    sideEffectDetected: false,
  };
}

function normalizeSnapshot(snapshot, expectedSource, now) {
  const issues = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return emptyNormalization(expectedSource);
  }

  let source = null;
  let resolverKey = null;
  let evaluatedAt = null;
  let expiresAt = null;
  try {
    source = requireToken(snapshot.source, `${expectedSource}.source`).toLowerCase();
    resolverKey = requireToken(snapshot.resolverKey, `${expectedSource}.resolverKey`);
    evaluatedAt = normalizeTimestamp(snapshot.evaluatedAt, `${expectedSource}.evaluatedAt`);
    expiresAt = normalizeTimestamp(snapshot.expiresAt, `${expectedSource}.expiresAt`);
  } catch {
    issues.push(`${expectedSource}_snapshot_metadata_invalid`);
  }
  if (source && source !== expectedSource) issues.push(`${expectedSource}_source_mismatch`);
  if (!evaluatedAt) issues.push(`${expectedSource}_evaluated_at_required`);
  if (!expiresAt) issues.push(`${expectedSource}_expires_at_required`);

  const identitySetsInput = snapshot.identitySets;
  if (!identitySetsInput || typeof identitySetsInput !== "object" || Array.isArray(identitySetsInput)) {
    issues.push(`${expectedSource}_identity_sets_not_object`);
  }
  const identitySets = {};
  for (const dimension of SHADOW_PARITY_IDENTITY_DIMENSIONS) {
    identitySets[dimension] = normalizeTokenList(
      identitySetsInput?.[dimension],
      `${expectedSource}_${dimension}`,
      SHADOW_PARITY_LIMITS.maxIdentityRefsPerDimension,
      issues,
    );
  }

  const reasonCodes = normalizeTokenList(
    snapshot.reasonCodes,
    `${expectedSource}_reason_codes`,
    SHADOW_PARITY_LIMITS.maxReasonCodes,
    issues,
  );
  const dataQualityIssues = normalizeTokenList(
    snapshot.dataQualityIssues || [],
    `${expectedSource}_data_quality_issues`,
    SHADOW_PARITY_LIMITS.maxDataQualityIssues,
    issues,
  );
  const unsupportedSemantics = normalizeTokenList(
    snapshot.unsupportedSemantics || [],
    `${expectedSource}_unsupported_semantics`,
    SHADOW_PARITY_LIMITS.maxUnsupportedSemantics,
    issues,
  );
  const readinessDimensions = normalizeReadinessDimensions(snapshot.readinessDimensions, issues);
  const manifestRef = normalizeOptionalToken(
    snapshot.manifestRef,
    `${expectedSource}.manifestRef`,
    issues,
    `${expectedSource}_manifest_ref_invalid`,
  );
  const revisionRef = normalizeOptionalToken(
    snapshot.revisionRef,
    `${expectedSource}.revisionRef`,
    issues,
    `${expectedSource}_revision_ref_invalid`,
  );

  const sideEffectDetected = SIDE_EFFECT_FLAGS.some((flag) => snapshot[flag] === true);
  const stale = Boolean(
    (evaluatedAt && evaluatedAt.getTime() > now.getTime())
    || (expiresAt && expiresAt.getTime() <= now.getTime()),
  );

  return {
    snapshot: {
      source: source || expectedSource,
      resolverKey,
      authorityAllowed: snapshot.authorityAllowed === true,
      executionEligible: snapshot.executionEligible === true,
      identitySets,
      reasonCodes,
      readinessDimensions,
      dataQualityIssues,
      unsupportedSemantics,
      evaluatedAt: evaluatedAt?.toISOString() || null,
      expiresAt: expiresAt?.toISOString() || null,
      manifestRef,
      revisionRef,
    },
    issues,
    stale,
    unsupported: unsupportedSemantics.length > 0,
    dataQualityDetected: dataQualityIssues.length > 0 || issues.length > 0,
    sideEffectDetected,
  };
}

function compareTokenSets(legacyValues, effectiveValues) {
  const legacySet = new Set(legacyValues);
  const effectiveSet = new Set(effectiveValues);
  return {
    legacyOnly: legacyValues.filter((value) => !effectiveSet.has(value)),
    effectiveOnly: effectiveValues.filter((value) => !legacySet.has(value)),
    shared: legacyValues.filter((value) => effectiveSet.has(value)),
  };
}

function compareReadiness(legacy, effective) {
  const dimensions = [...new Set([...Object.keys(legacy), ...Object.keys(effective)])].sort();
  return dimensions
    .filter((dimension) => legacy[dimension] !== effective[dimension])
    .map((dimension) => ({
      dimension,
      legacyState: legacy[dimension] || null,
      effectiveState: effective[dimension] || null,
    }));
}

function addGrantDirectionClasses(classes, legacyHasMore, effectiveHasMore) {
  if (legacyHasMore) {
    classes.add("legacy_over_grant");
    classes.add("new_resolver_under_grant");
  }
  if (effectiveHasMore) {
    classes.add("legacy_under_grant");
    classes.add("new_resolver_over_grant");
  }
}

function baseSafety() {
  return {
    shadowMode: true,
    parityOnly: true,
    rolloutApproved: false,
    authorityGranted: false,
    executionAuthorized: false,
    executionPerformed: false,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  };
}

export function evaluateShadowAuthorityParity({ legacySnapshot, effectiveSnapshot, now = new Date() } = {}) {
  const evaluatedNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(evaluatedNow.getTime())) throw new TypeError("now must be a valid Date.");

  const legacy = normalizeSnapshot(legacySnapshot, "legacy", evaluatedNow);
  const effective = normalizeSnapshot(effectiveSnapshot, "effective", evaluatedNow);
  const mismatchClasses = new Set();
  const reasonCodes = new Set();

  if (legacy.sideEffectDetected || effective.sideEffectDetected) {
    reasonCodes.add("SHADOW_SIDE_EFFECT_INVARIANT_VIOLATED");
  }
  if (legacy.dataQualityDetected || effective.dataQualityDetected) {
    mismatchClasses.add("data_quality_mismatch");
    reasonCodes.add("SHADOW_PARITY_DATA_QUALITY_MISMATCH");
  }
  if (legacy.stale || effective.stale) {
    mismatchClasses.add("stale_projection");
    reasonCodes.add("SHADOW_PARITY_STALE_PROJECTION");
  }
  if (legacy.unsupported) {
    mismatchClasses.add("unsupported_legacy_semantics");
    reasonCodes.add("SHADOW_PARITY_UNSUPPORTED_LEGACY_SEMANTICS");
  }

  if (!legacy.snapshot || !effective.snapshot) {
    return deepFreeze({
      status: "blocked",
      parityStatus: "blocked",
      matched: false,
      mismatchClasses: [...mismatchClasses].sort(),
      reasonCodes: [...reasonCodes].sort(),
      legacyIssues: legacy.issues.sort(),
      effectiveIssues: effective.issues.sort(),
      securityRelevant: true,
      rolloutBlocked: true,
      evaluatedAt: evaluatedNow.toISOString(),
      ...baseSafety(),
    });
  }

  const identityDifferences = {};
  let legacyIdentityMore = false;
  let effectiveIdentityMore = false;
  for (const dimension of SHADOW_PARITY_IDENTITY_DIMENSIONS) {
    const difference = compareTokenSets(
      legacy.snapshot.identitySets[dimension],
      effective.snapshot.identitySets[dimension],
    );
    identityDifferences[dimension] = difference;
    legacyIdentityMore ||= difference.legacyOnly.length > 0;
    effectiveIdentityMore ||= difference.effectiveOnly.length > 0;
  }

  const legacyAuthorityMore = legacy.snapshot.authorityAllowed && !effective.snapshot.authorityAllowed;
  const effectiveAuthorityMore = effective.snapshot.authorityAllowed && !legacy.snapshot.authorityAllowed;
  const legacyExecutionMore = legacy.snapshot.executionEligible && !effective.snapshot.executionEligible;
  const effectiveExecutionMore = effective.snapshot.executionEligible && !legacy.snapshot.executionEligible;
  addGrantDirectionClasses(
    mismatchClasses,
    legacyIdentityMore || legacyAuthorityMore || legacyExecutionMore,
    effectiveIdentityMore || effectiveAuthorityMore || effectiveExecutionMore,
  );

  const reasonDifference = compareTokenSets(
    legacy.snapshot.reasonCodes,
    effective.snapshot.reasonCodes,
  );
  const readinessDifferences = compareReadiness(
    legacy.snapshot.readinessDimensions,
    effective.snapshot.readinessDimensions,
  );
  if (
    reasonDifference.legacyOnly.length > 0
    || reasonDifference.effectiveOnly.length > 0
    || readinessDifferences.length > 0
  ) {
    mismatchClasses.add("data_quality_mismatch");
    reasonCodes.add("SHADOW_PARITY_DECISION_EVIDENCE_MISMATCH");
  }

  if (legacy.sideEffectDetected || effective.sideEffectDetected) {
    mismatchClasses.add("data_quality_mismatch");
  }

  const matched = mismatchClasses.size === 0;
  if (matched) reasonCodes.add("SHADOW_PARITY_MATCHED");

  const securityRelevant = Boolean(
    mismatchClasses.has("legacy_over_grant")
    || mismatchClasses.has("new_resolver_over_grant")
    || legacy.sideEffectDetected
    || effective.sideEffectDetected,
  );

  return deepFreeze({
    status: matched ? "matched" : "mismatched",
    parityStatus: matched ? "pass" : "blocked",
    matched,
    mismatchClasses: [...mismatchClasses].sort(),
    reasonCodes: [...reasonCodes].sort(),
    securityRelevant,
    rolloutBlocked: !matched,
    evaluatedAt: evaluatedNow.toISOString(),
    legacy: legacy.snapshot,
    effective: effective.snapshot,
    legacyIssues: legacy.issues.sort(),
    effectiveIssues: effective.issues.sort(),
    identityDifferences,
    decisionDifferences: {
      authorityAllowed: {
        legacy: legacy.snapshot.authorityAllowed,
        effective: effective.snapshot.authorityAllowed,
      },
      executionEligible: {
        legacy: legacy.snapshot.executionEligible,
        effective: effective.snapshot.executionEligible,
      },
      reasonCodes: reasonDifference,
      readinessDimensions: readinessDifferences,
    },
    ...baseSafety(),
  });
}

export const _testingShadowAuthorityParityDecision = deepFreeze({
  addGrantDirectionClasses,
  compareReadiness,
  compareTokenSets,
  normalizeOptionalToken,
  normalizeReadinessDimensions,
  normalizeSnapshot,
  normalizeTokenList,
});
