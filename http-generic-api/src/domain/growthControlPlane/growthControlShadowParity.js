import { createHash } from "node:crypto";

export const GROWTH_CONTROL_SHADOW_CLASSIFICATIONS = Object.freeze([
  "match",
  "expected_semantic_translation",
  "policy_difference",
  "privilege_expansion",
  "adaptive_error",
  "missing_evidence",
  "unclassified_mismatch",
  "not_comparable"
]);

const CLASSIFICATION_POLICY = Object.freeze({
  match: Object.freeze({ severity: "info", action: "accept_shadow_match", blocksCutover: false }),
  expected_semantic_translation: Object.freeze({ severity: "low", action: "accept_shadow_match", blocksCutover: false }),
  policy_difference: Object.freeze({ severity: "medium", action: "require_human_review", blocksCutover: false }),
  privilege_expansion: Object.freeze({ severity: "critical", action: "block_rollout", blocksCutover: true }),
  adaptive_error: Object.freeze({ severity: "high", action: "block_rollout", blocksCutover: true }),
  missing_evidence: Object.freeze({ severity: "high", action: "block_rollout", blocksCutover: true }),
  unclassified_mismatch: Object.freeze({ severity: "high", action: "block_rollout", blocksCutover: true }),
  not_comparable: Object.freeze({ severity: "info", action: "skip_not_comparable", blocksCutover: false })
});

function normalizeJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Shadow parity values must contain finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, normalizeJsonValue(value[key])])
    );
  }
  throw new TypeError("Shadow parity values must be JSON-compatible.");
}

export function canonicalizeShadowValue(value) {
  return JSON.stringify(normalizeJsonValue(value));
}

export function hashShadowValue(value) {
  return createHash("sha256").update(canonicalizeShadowValue(value), "utf8").digest("hex");
}

function readPath(value, path) {
  if (!path) return { found: value !== undefined, value };
  const segments = String(path).split(".").filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (current == null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: current !== undefined, value: current };
}

function hasPrivilegeExpansion(growthValue, legacyValue, privilegePaths = []) {
  for (const path of privilegePaths) {
    const growth = readPath(growthValue, path);
    const legacy = readPath(legacyValue, path);
    if (!growth.found || !legacy.found) continue;
    if (typeof growth.value === "boolean" && typeof legacy.value === "boolean" && growth.value && !legacy.value) {
      return true;
    }
    if (Array.isArray(growth.value) && Array.isArray(legacy.value)) {
      const legacySet = new Set(legacy.value.map((item) => canonicalizeShadowValue(item)));
      if (growth.value.some((item) => !legacySet.has(canonicalizeShadowValue(item)))) return true;
    }
    if (typeof growth.value === "number" && typeof legacy.value === "number" && growth.value > legacy.value) {
      return true;
    }
  }
  return false;
}

function policyFor(classification) {
  const policy = CLASSIFICATION_POLICY[classification];
  if (!policy) throw new TypeError(`Unsupported shadow parity classification: ${classification}`);
  return policy;
}

function boundedPaths(paths) {
  return [...new Set((Array.isArray(paths) ? paths : []).map(String).filter(Boolean))].sort().slice(0, 64);
}

export function compareGrowthControlShadowParity({
  mapping = null,
  growthValue,
  legacyValue,
  growthPresent = growthValue !== undefined,
  legacyPresent = legacyValue !== undefined
} = {}) {
  if (!mapping) {
    const policy = policyFor("not_comparable");
    return Object.freeze({
      classification: "not_comparable",
      ...policy,
      explanationCode: "mapping_not_registered",
      growthHash: growthPresent ? hashShadowValue(growthValue) : null,
      legacyHash: null,
      normalizedGrowthHash: null,
      normalizedLegacyHash: null,
      comparedPaths: [],
      providerApplyAllowed: false,
      externalWriteAllowed: false,
      mutationAllowed: false,
      enforcementCutover: false,
      secretsIncluded: false,
      rawPayloadIncluded: false,
      promptIncluded: false
    });
  }

  const growthProjection = readPath(growthValue, mapping.growthPath || "");
  const legacyProjection = readPath(legacyValue, mapping.legacyPath || "");
  if (!growthPresent || !legacyPresent || !growthProjection.found || !legacyProjection.found) {
    const policy = policyFor("missing_evidence");
    return Object.freeze({
      classification: "missing_evidence",
      ...policy,
      explanationCode: !growthPresent || !growthProjection.found ? "growth_evidence_missing" : "legacy_evidence_missing",
      growthHash: growthPresent && growthProjection.found ? hashShadowValue(growthProjection.value) : null,
      legacyHash: legacyPresent && legacyProjection.found ? hashShadowValue(legacyProjection.value) : null,
      normalizedGrowthHash: null,
      normalizedLegacyHash: null,
      comparedPaths: boundedPaths([mapping.growthPath, mapping.legacyPath]),
      providerApplyAllowed: false,
      externalWriteAllowed: false,
      mutationAllowed: false,
      enforcementCutover: false,
      secretsIncluded: false,
      rawPayloadIncluded: false,
      promptIncluded: false
    });
  }

  const growthHash = hashShadowValue(growthProjection.value);
  const legacyHash = hashShadowValue(legacyProjection.value);
  const normalizeGrowth = typeof mapping.normalizeGrowth === "function" ? mapping.normalizeGrowth : (value) => value;
  const normalizeLegacy = typeof mapping.normalizeLegacy === "function" ? mapping.normalizeLegacy : (value) => value;
  const normalizedGrowth = normalizeGrowth(growthProjection.value);
  const normalizedLegacy = normalizeLegacy(legacyProjection.value);
  const normalizedGrowthHash = hashShadowValue(normalizedGrowth);
  const normalizedLegacyHash = hashShadowValue(normalizedLegacy);

  let classification;
  let explanationCode;
  if (growthHash === legacyHash) {
    classification = "match";
    explanationCode = "canonical_values_match";
  } else if (normalizedGrowthHash === normalizedLegacyHash) {
    classification = "expected_semantic_translation";
    explanationCode = "registered_normalization_matches";
  } else if (hasPrivilegeExpansion(normalizedGrowth, normalizedLegacy, mapping.privilegePaths)) {
    classification = "privilege_expansion";
    explanationCode = "registered_privilege_path_expanded";
  } else if (mapping.expectedDifference === "policy_difference") {
    classification = "policy_difference";
    explanationCode = "registered_policy_difference";
  } else {
    classification = "unclassified_mismatch";
    explanationCode = "canonical_values_differ";
  }

  const policy = policyFor(classification);
  return Object.freeze({
    classification,
    ...policy,
    explanationCode,
    growthHash,
    legacyHash,
    normalizedGrowthHash,
    normalizedLegacyHash,
    comparedPaths: boundedPaths([mapping.growthPath, mapping.legacyPath, ...(mapping.privilegePaths || [])]),
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    enforcementCutover: false,
    secretsIncluded: false,
    rawPayloadIncluded: false,
    promptIncluded: false
  });
}

export const _testingGrowthControlShadowParity = Object.freeze({
  normalizeJsonValue,
  readPath,
  hasPrivilegeExpansion,
  policyFor
});
