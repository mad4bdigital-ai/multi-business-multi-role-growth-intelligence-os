import {
  EffectiveAuthorityError,
  assertNoSecretEvidence,
} from "./effectiveAuthority.js";

export const AUTHORITY_DRIFT_TERMINAL_STATUSES = Object.freeze([
  "resolved",
  "ignored",
]);

const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,190}$/;

function requireString(value, field, maximumLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_INPUT_INVALID",
      `${field} is required.`,
      400,
      { field }
    );
  }
  if (normalized.length > maximumLength) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_INPUT_INVALID",
      `${field} exceeds the maximum length.`,
      400,
      { field, maximumLength }
    );
  }
  return normalized;
}

function normalizeTimestamp(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_INPUT_INVALID",
      "transitionedAt must be a valid timestamp.",
      400,
      { field: "transitionedAt" }
    );
  }
  return parsed.toISOString();
}

export function normalizeAuthorityDriftLifecycleTransition({
  driftEventId,
  toStatus,
  reasonCode,
  note = null,
  actor,
  transitionedAt,
} = {}) {
  const normalizedTarget = requireString(toStatus, "toStatus", 32).toLowerCase();
  if (!AUTHORITY_DRIFT_TERMINAL_STATUSES.includes(normalizedTarget)) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_TARGET_INVALID",
      "Drift lifecycle target must be resolved or ignored.",
      400,
      { toStatus: normalizedTarget }
    );
  }

  const normalizedReasonCode = requireString(reasonCode, "reasonCode").toUpperCase();
  if (!REASON_CODE_PATTERN.test(normalizedReasonCode)) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_REASON_INVALID",
      "reasonCode must be a stable uppercase reason code.",
      400,
      { field: "reasonCode" }
    );
  }

  const normalizedNote = note === null || note === undefined
    ? null
    : requireString(note, "note", 1000);
  const normalizedActor = Object.freeze({
    principalType: requireString(actor?.principalType, "actor.principalType", 64),
    principalId: requireString(actor?.principalId, "actor.principalId", 191),
  });

  const transition = {
    driftEventId: requireString(driftEventId, "driftEventId", 64),
    fromStatus: "open",
    toStatus: normalizedTarget,
    reasonCode: normalizedReasonCode,
    note: normalizedNote,
    actor: normalizedActor,
    transitionedAt: normalizeTimestamp(transitionedAt),
    enforcementMode: "shadow_only",
    authorityGranted: false,
    providerCalls: false,
    credentialPayloadReads: false,
    externalWrites: false,
    secretsIncluded: false,
  };
  assertNoSecretEvidence(transition);
  return Object.freeze(transition);
}

export function assertAuthorityDriftLifecycleState(currentStatus, transition) {
  const normalizedCurrent = String(currentStatus ?? "").trim().toLowerCase();
  if (normalizedCurrent === transition.toStatus) return "idempotent";
  if (normalizedCurrent !== "open") {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_TRANSITION_INVALID",
      `Drift event cannot transition from ${normalizedCurrent || "unknown"} to ${transition.toStatus}.`,
      409,
      { currentStatus: normalizedCurrent || null, toStatus: transition.toStatus }
    );
  }
  return "apply";
}
