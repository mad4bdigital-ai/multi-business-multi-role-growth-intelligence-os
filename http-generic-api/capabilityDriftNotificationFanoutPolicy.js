import { createHash } from "node:crypto";

export const CAPABILITY_DRIFT_NOTIFICATION_FANOUT_POLICY = Object.freeze({
  policy_key: "capability_drift_notification_fanout_v1",
  escalation_policy_key: "capability_drift_age_escalation_v1",
  minimum_blocker_age_hours: 24,
  allowed_severities: Object.freeze(["high", "critical"]),
  max_tenant_targets: 1000,
  channel: "in_app",
  recipient_scope: "active_tenant_members",
});

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function parseEvidence(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export function buildCapabilityDriftTenantNotificationKey(alertKey, severity, tenantId) {
  const tenantHash = sha256(tenantId).slice(0, 24);
  return `${String(alertKey || "")}:${String(severity || "")}:open:t:${tenantHash}`.slice(0, 255);
}

export function capabilityDriftNotificationEligible(item = {}) {
  const evidence = parseEvidence(item.evidence ?? item.evidence_json);
  const escalation = evidence.age_escalation && typeof evidence.age_escalation === "object"
    ? evidence.age_escalation
    : {};
  const blockerAgeHours = Number(escalation.blocker_age_hours);
  return item.source_type === "v_platform_capability_gaps"
    && CAPABILITY_DRIFT_NOTIFICATION_FANOUT_POLICY.allowed_severities.includes(String(item.severity || "").toLowerCase())
    && ["open", "acknowledged", "investigating"].includes(String(item.lifecycle_status || "").toLowerCase())
    && item.verification_state === "verified"
    && Boolean(item.source_record_id)
    && escalation.policy_key === CAPABILITY_DRIFT_NOTIFICATION_FANOUT_POLICY.escalation_policy_key
    && Number.isFinite(blockerAgeHours)
    && blockerAgeHours >= CAPABILITY_DRIFT_NOTIFICATION_FANOUT_POLICY.minimum_blocker_age_hours;
}

export function evaluateCapabilityDriftTenantTargets(rows = []) {
  const tenantIds = [...new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row?.tenant_id || "").trim())
      .filter(Boolean)
  )].sort();
  const cap = CAPABILITY_DRIFT_NOTIFICATION_FANOUT_POLICY.max_tenant_targets;
  if (tenantIds.length > cap) {
    return {
      policy_key: CAPABILITY_DRIFT_NOTIFICATION_FANOUT_POLICY.policy_key,
      status: "skipped_fail_closed",
      reason: "active_tenant_target_cap_exceeded",
      max_targets: cap,
      observed_min_count: tenantIds.length,
      target_count: 0,
      tenant_ids: [],
      external_send: false,
    };
  }
  return {
    policy_key: CAPABILITY_DRIFT_NOTIFICATION_FANOUT_POLICY.policy_key,
    status: tenantIds.length ? "ready" : "no_active_targets",
    reason: tenantIds.length ? null : "no_active_tenants_with_active_memberships",
    max_targets: cap,
    observed_min_count: tenantIds.length,
    target_count: tenantIds.length,
    tenant_ids: tenantIds,
    external_send: false,
  };
}
