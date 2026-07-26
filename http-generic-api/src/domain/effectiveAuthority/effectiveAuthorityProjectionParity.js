const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeReasonCodes(reasonCodes, label) {
  const source = reasonCodes ?? [];
  if (!Array.isArray(source)) {
    throw new TypeError(`${label} must be an array.`);
  }

  const normalized = source.map((reasonCode, index) => {
    const value = requireString(reasonCode, `${label}[${index}]`).toUpperCase();
    if (!REASON_CODE_PATTERN.test(value)) {
      throw new TypeError(`${label}[${index}] must be a stable uppercase reason code.`);
    }
    return value;
  });

  return Object.freeze([...new Set(normalized)].sort());
}

function normalizeProjection(projection, label) {
  const source = requireObject(projection, label);
  const surfaceKey = requireString(source.surfaceKey, `${label}.surfaceKey`);
  if (!Array.isArray(source.resources)) {
    throw new TypeError(`${label}.resources must be an array.`);
  }

  const reasonsByResourceId = new Map();
  source.resources.forEach((resource, index) => {
    const item = requireObject(resource, `${label}.resources[${index}]`);
    const resourceId = requireString(
      item.resourceId,
      `${label}.resources[${index}].resourceId`
    );
    if (reasonsByResourceId.has(resourceId)) {
      throw new TypeError(`${label} contains duplicate resourceId '${resourceId}'.`);
    }
    reasonsByResourceId.set(
      resourceId,
      normalizeReasonCodes(
        item.reasonCodes,
        `${label}.resources[${index}].reasonCodes`
      )
    );
  });

  return Object.freeze({
    surfaceKey,
    resourceIds: Object.freeze([...reasonsByResourceId.keys()].sort()),
    reasonsByResourceId,
  });
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareProjection(reference, candidate) {
  const referenceIds = new Set(reference.resourceIds);
  const candidateIds = new Set(candidate.resourceIds);
  const missingResourceIds = reference.resourceIds.filter((id) => !candidateIds.has(id));
  const extraResourceIds = candidate.resourceIds.filter((id) => !referenceIds.has(id));
  const reasonMismatches = reference.resourceIds
    .filter((id) => candidateIds.has(id))
    .map((resourceId) => {
      const referenceReasonCodes = reference.reasonsByResourceId.get(resourceId);
      const candidateReasonCodes = candidate.reasonsByResourceId.get(resourceId);
      if (arraysEqual(referenceReasonCodes, candidateReasonCodes)) return null;
      return Object.freeze({
        resourceId,
        referenceReasonCodes,
        candidateReasonCodes,
      });
    })
    .filter(Boolean);

  return Object.freeze({
    referenceSurfaceKey: reference.surfaceKey,
    candidateSurfaceKey: candidate.surfaceKey,
    aligned:
      missingResourceIds.length === 0 &&
      extraResourceIds.length === 0 &&
      reasonMismatches.length === 0,
    missingResourceIds: Object.freeze(missingResourceIds),
    extraResourceIds: Object.freeze(extraResourceIds),
    reasonMismatches: Object.freeze(reasonMismatches),
  });
}

export function compareEffectiveAuthorityProjectionParity({ reference, candidates } = {}) {
  const normalizedReference = normalizeProjection(reference, "reference");
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array.");
  }

  const surfaceKeys = new Set([normalizedReference.surfaceKey]);
  const normalizedCandidates = candidates.map((candidate, index) => {
    const normalized = normalizeProjection(candidate, `candidates[${index}]`);
    if (surfaceKeys.has(normalized.surfaceKey)) {
      throw new TypeError(`Duplicate projection surfaceKey '${normalized.surfaceKey}'.`);
    }
    surfaceKeys.add(normalized.surfaceKey);
    return normalized;
  });

  normalizedCandidates.sort((left, right) => left.surfaceKey.localeCompare(right.surfaceKey));
  const comparisons = normalizedCandidates.map((candidate) =>
    compareProjection(normalizedReference, candidate)
  );

  return Object.freeze({
    referenceSurfaceKey: normalizedReference.surfaceKey,
    aligned: comparisons.every((comparison) => comparison.aligned),
    comparisons: Object.freeze(comparisons),
  });
}
