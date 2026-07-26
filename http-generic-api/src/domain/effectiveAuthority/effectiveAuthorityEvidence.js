export const EFFECTIVE_AUTHORITY_EVIDENCE_MODES = Object.freeze([
  "disabled",
  "best_effort",
  "required",
]);

function finiteCount(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

export function normalizeEffectiveAuthorityEvidenceMode(value) {
  const normalized = String(value ?? "disabled").trim().toLowerCase() || "disabled";
  if (!EFFECTIVE_AUTHORITY_EVIDENCE_MODES.includes(normalized)) {
    throw new TypeError(
      `UEACP_SHADOW_EVIDENCE_MODE must be one of: ${EFFECTIVE_AUTHORITY_EVIDENCE_MODES.join(", ")}.`
    );
  }
  return normalized;
}

export function evaluateConnectorProjectionConsistency({
  scopeType = "tenant",
  registeredCount = 0,
  authorizedCount = 0,
  projectedCount = 0,
  executableCandidateCount = 0,
  observedCount = null,
} = {}) {
  const hasObservedCount = observedCount !== null && observedCount !== undefined;
  const countValues = {
    registeredCount: finiteCount(registeredCount),
    authorizedCount: finiteCount(authorizedCount),
    projectedCount: finiteCount(projectedCount),
    executableCandidateCount: finiteCount(executableCandidateCount),
  };
  if (hasObservedCount) countValues.observedCount = finiteCount(observedCount);
  const counts = Object.freeze(countValues);
  const issueCodes = [];

  if (counts.authorizedCount > counts.registeredCount) {
    issueCodes.push("AUTHORITY_AUTHORIZED_EXCEEDS_REGISTERED");
  }
  if (counts.projectedCount > counts.authorizedCount) {
    issueCodes.push("AUTHORITY_PROJECTED_EXCEEDS_AUTHORIZED");
  }
  if (counts.executableCandidateCount > counts.projectedCount) {
    issueCodes.push("AUTHORITY_EXECUTABLE_EXCEEDS_PROJECTED");
  }
  if (counts.authorizedCount > 0 && counts.projectedCount === 0) {
    issueCodes.push("AUTHORITY_AUTHORIZED_NOT_PROJECTED");
  }
  if (hasObservedCount && counts.observedCount !== counts.projectedCount) {
    issueCodes.push("AUTHORITY_OBSERVED_PROJECTION_MISMATCH");
  }
  if (hasObservedCount && counts.observedCount > counts.projectedCount) {
    issueCodes.push("AUTHORITY_OBSERVED_EXCEEDS_PROJECTED");
  }
  if (hasObservedCount && counts.projectedCount > 0 && counts.observedCount === 0) {
    issueCodes.push("AUTHORITY_PROJECTED_NOT_OBSERVED");
  }
  if (
    scopeType === "platform" &&
    counts.registeredCount > 0 &&
    counts.authorizedCount === 0
  ) {
    issueCodes.push("AUTHORITY_PROJECTION_DRIFT_CONNECTED_SYSTEMS");
  }

  const uniqueIssueCodes = Object.freeze([...new Set(issueCodes)]);
  return Object.freeze({
    projectionKey: "connector_inventory",
    status: uniqueIssueCodes.length ? "mismatch" : "match",
    driftDetected: uniqueIssueCodes.length > 0,
    issueCodes: uniqueIssueCodes,
    counts,
    ...(hasObservedCount ? { observationStatus: "observed" } : {}),
    enforcementMode: "shadow_only",
    authorityGranted: false,
    secretsIncluded: false,
  });
}
