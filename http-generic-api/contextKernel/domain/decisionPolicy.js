import { deepFreeze, normalizeDecisionInput } from "./model.js";

export const DecisionStatus = deepFreeze({
  RESOLVED: "resolved",
  INTERPRETATION_REQUIRED: "interpretation_required",
  BLOCKED: "blocked",
});

export const DecisionReason = deepFreeze({
  EXPLICIT_REFERENCE: "explicit_reference",
  VERIFIED_PIN: "verified_pin",
  EXACT_BINDING: "exact_binding",
  LOW_RISK_FALLBACK: "low_risk_fallback",
  SINGLE_AUTHORIZED_CANDIDATE: "single_authorized_candidate",
  MULTIPLE_AUTHORIZED_CANDIDATES: "multiple_authorized_candidates",
  NO_AUTHORIZED_CANDIDATES: "no_authorized_candidates",
  REFERENCE_NOT_AUTHORIZED: "reference_not_authorized",
  EFFECTIVE_SUBJECT_REQUIRED: "effective_subject_required",
  FALLBACK_SELECTION_FORBIDDEN: "fallback_selection_forbidden",
  PIN_NOT_VERIFIED: "pin_not_verified",
  PIN_EXPIRED: "context_pin_expired",
  PIN_REVISION_CONFLICT: "context_revision_conflict",
});

const FALLBACK_ALLOWED_RISKS = new Set(["read", "low"]);

function compareNullable(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

export function compareContextCandidates(left, right) {
  return (
    compareNullable(left.tenantRef, right.tenantRef) ||
    compareNullable(left.workspaceRef, right.workspaceRef) ||
    compareNullable(left.candidateType, right.candidateType) ||
    compareNullable(left.resourceType, right.resourceType) ||
    compareNullable(left.resourceRef, right.resourceRef) ||
    compareNullable(left.connectionRef, right.connectionRef) ||
    compareNullable(left.stableRef, right.stableRef)
  );
}

export function sortContextCandidates(candidates) {
  return [...candidates].sort(compareContextCandidates);
}

function principalCanSeeTenant(principal, tenantRef) {
  const refs = principal?.authorizedTenantRefs ?? [];
  return refs.includes("*") || refs.includes(tenantRef);
}

export function enumerateAuthorizedCandidates({ principal, effectiveSubject = null, candidates }) {
  if (!principal || !Array.isArray(candidates)) {
    throw new TypeError("principal and candidates are required.");
  }
  const visible = candidates.filter((candidate) => {
    if (!principalCanSeeTenant(principal, candidate.tenantRef)) return false;
    if (effectiveSubject && candidate.tenantRef !== effectiveSubject.tenantRef) return false;
    if (effectiveSubject?.workspaceRef && candidate.workspaceRef !== effectiveSubject.workspaceRef) return false;
    return true;
  });
  return deepFreeze(sortContextCandidates(visible));
}

function blocked(reasonCode, candidates = []) {
  return deepFreeze({
    status: DecisionStatus.BLOCKED,
    reasonCodes: [reasonCode],
    selectedCandidate: null,
    candidates: sortContextCandidates(candidates),
  });
}

function resolved(reasonCode, candidate, candidates) {
  return deepFreeze({
    status: DecisionStatus.RESOLVED,
    reasonCodes: [reasonCode],
    selectedCandidate: candidate,
    candidates: sortContextCandidates(candidates),
  });
}

function selectExactReference(candidates, stableRef) {
  if (!stableRef) return null;
  const matches = candidates.filter((candidate) => candidate.stableRef === stableRef);
  return matches.length === 1 ? matches[0] : null;
}

function pinState(pin, now, currentContextRevision) {
  if (!pin) return { usable: false, reasonCode: null };
  if (!pin.verified) return { usable: false, reasonCode: DecisionReason.PIN_NOT_VERIFIED };
  if (pin.expiresAt && Date.parse(pin.expiresAt) <= now.getTime()) {
    return { usable: false, reasonCode: DecisionReason.PIN_EXPIRED };
  }
  if (
    typeof currentContextRevision !== "string" ||
    currentContextRevision.trim() === "" ||
    pin.contextRevision !== currentContextRevision
  ) {
    return { usable: false, reasonCode: DecisionReason.PIN_REVISION_CONFLICT };
  }
  return { usable: true, reasonCode: null };
}

export function resolveContextDecision({
  principal,
  effectiveSubject = null,
  candidates,
  operationIntent,
  operationKind = "read",
  riskClass = "read",
  explicitRef = null,
  verifiedPin = null,
  currentContextRevision = null,
  exactBindingRef = null,
  fallbackRef = null,
  allowLowRiskFallback = false,
  now = new Date(),
}) {
  const input = normalizeDecisionInput({ riskClass, operationKind, operationIntent });
  const authorizedCandidates = enumerateAuthorizedCandidates({ principal, effectiveSubject, candidates });

  if (input.operationKind === "mutation" && !effectiveSubject) {
    return blocked(DecisionReason.EFFECTIVE_SUBJECT_REQUIRED, authorizedCandidates);
  }

  if (explicitRef) {
    const selected = selectExactReference(authorizedCandidates, explicitRef);
    return selected
      ? resolved(DecisionReason.EXPLICIT_REFERENCE, selected, authorizedCandidates)
      : blocked(DecisionReason.REFERENCE_NOT_AUTHORIZED, authorizedCandidates);
  }

  if (verifiedPin) {
    const state = pinState(verifiedPin, now, currentContextRevision);
    if (!state.usable) return blocked(state.reasonCode, authorizedCandidates);
    const selected = selectExactReference(authorizedCandidates, verifiedPin.stableRef);
    return selected
      ? resolved(DecisionReason.VERIFIED_PIN, selected, authorizedCandidates)
      : blocked(DecisionReason.REFERENCE_NOT_AUTHORIZED, authorizedCandidates);
  }

  if (exactBindingRef) {
    const selected = selectExactReference(authorizedCandidates, exactBindingRef);
    return selected
      ? resolved(DecisionReason.EXACT_BINDING, selected, authorizedCandidates)
      : blocked(DecisionReason.REFERENCE_NOT_AUTHORIZED, authorizedCandidates);
  }

  if (fallbackRef) {
    if (!allowLowRiskFallback || !FALLBACK_ALLOWED_RISKS.has(input.riskClass)) {
      return blocked(DecisionReason.FALLBACK_SELECTION_FORBIDDEN, authorizedCandidates);
    }
    const selected = selectExactReference(authorizedCandidates, fallbackRef);
    return selected
      ? resolved(DecisionReason.LOW_RISK_FALLBACK, selected, authorizedCandidates)
      : blocked(DecisionReason.REFERENCE_NOT_AUTHORIZED, authorizedCandidates);
  }

  if (authorizedCandidates.length === 0) {
    return blocked(DecisionReason.NO_AUTHORIZED_CANDIDATES);
  }
  if (authorizedCandidates.length === 1) {
    return resolved(DecisionReason.SINGLE_AUTHORIZED_CANDIDATE, authorizedCandidates[0], authorizedCandidates);
  }

  return deepFreeze({
    status: DecisionStatus.INTERPRETATION_REQUIRED,
    reasonCodes: [DecisionReason.MULTIPLE_AUTHORIZED_CANDIDATES],
    selectedCandidate: null,
    candidates: authorizedCandidates,
  });
}
