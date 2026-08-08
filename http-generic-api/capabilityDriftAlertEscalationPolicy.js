const SEVERITY_WEIGHT = Object.freeze({ info: 1, low: 2, medium: 3, high: 4, critical: 5 });

export const CAPABILITY_DRIFT_ESCALATION_POLICY = Object.freeze({
  policy_key: "capability_drift_age_escalation_v1",
  high_after_hours: 24,
  critical_after_hours: 72,
});

function normalizeSeverity(value, fallback = "medium") {
  const normalized = String(value || "").trim().toLowerCase();
  return SEVERITY_WEIGHT[normalized] ? normalized : fallback;
}

function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function strongerSeverity(...values) {
  return values
    .map((value) => normalizeSeverity(value))
    .reduce((strongest, value) => SEVERITY_WEIGHT[value] > SEVERITY_WEIGHT[strongest] ? value : strongest, "info");
}

export function evaluateCapabilityDriftAgeEscalation({
  baseSeverity = "medium",
  currentSeverity = null,
  firstSeenAt = null,
  observedAt = new Date(),
} = {}) {
  const normalizedBase = normalizeSeverity(baseSeverity);
  const normalizedCurrent = normalizeSeverity(currentSeverity || normalizedBase, normalizedBase);
  const firstSeen = parseDate(firstSeenAt);
  const observed = parseDate(observedAt);
  const sourceFloorSeverity = strongerSeverity(normalizedBase, normalizedCurrent);

  if (!firstSeen || !observed || observed < firstSeen) {
    return {
      policy_key: CAPABILITY_DRIFT_ESCALATION_POLICY.policy_key,
      blocker_age_seconds: null,
      blocker_age_hours: null,
      base_severity: normalizedBase,
      previous_severity: normalizedCurrent,
      age_floor_severity: null,
      effective_severity: sourceFloorSeverity,
      age_escalated: false,
      next_escalation_at: null,
      timestamp_state: "invalid_or_future_first_seen",
    };
  }

  const ageSeconds = Math.max(0, Math.floor((observed.getTime() - firstSeen.getTime()) / 1000));
  const ageHours = ageSeconds / 3600;
  let ageFloorSeverity = null;
  let nextEscalationAt = null;

  if (ageHours >= CAPABILITY_DRIFT_ESCALATION_POLICY.critical_after_hours) {
    ageFloorSeverity = "critical";
  } else if (ageHours >= CAPABILITY_DRIFT_ESCALATION_POLICY.high_after_hours) {
    ageFloorSeverity = "high";
    nextEscalationAt = new Date(
      firstSeen.getTime() + CAPABILITY_DRIFT_ESCALATION_POLICY.critical_after_hours * 3600 * 1000
    ).toISOString();
  } else {
    nextEscalationAt = new Date(
      firstSeen.getTime() + CAPABILITY_DRIFT_ESCALATION_POLICY.high_after_hours * 3600 * 1000
    ).toISOString();
  }

  const effectiveSeverity = strongerSeverity(sourceFloorSeverity, ageFloorSeverity || "info");
  const ageEscalated = Boolean(
    ageFloorSeverity
    && SEVERITY_WEIGHT[effectiveSeverity] > SEVERITY_WEIGHT[sourceFloorSeverity]
  );

  return {
    policy_key: CAPABILITY_DRIFT_ESCALATION_POLICY.policy_key,
    blocker_age_seconds: ageSeconds,
    blocker_age_hours: Math.floor(ageHours * 100) / 100,
    base_severity: normalizedBase,
    previous_severity: normalizedCurrent,
    age_floor_severity: ageFloorSeverity,
    effective_severity: effectiveSeverity,
    age_escalated: ageEscalated,
    next_escalation_at: nextEscalationAt,
    timestamp_state: "valid",
  };
}
