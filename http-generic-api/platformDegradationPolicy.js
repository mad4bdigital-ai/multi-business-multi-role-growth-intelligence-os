export const REQUIRED_READINESS_DIMENSIONS = Object.freeze([
  "connected",
  "configured",
  "authenticated",
  "authorized",
  "skill_granted",
  "smoke_certified",
  "runtime_ready",
  "can_execute",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function evaluateActivationGuidanceContract(payload = {}) {
  const issues = [];
  const profile = payload.profile === "admin" ? "admin" : "tenant";
  const snapshot = record(payload.tenant_dynamic_snapshot);
  const presentation = record(payload.assistant_instruction_pack?.presentation_contract);
  const readiness = Array.isArray(payload.account_or_admin_capability_snapshot?.readiness_dimensions)
    ? payload.account_or_admin_capability_snapshot.readiness_dimensions
    : [];

  if (!Array.isArray(payload.managed_brands)) issues.push("managed_brands_snapshot_missing");
  for (const dimension of REQUIRED_READINESS_DIMENSIONS) {
    if (!readiness.includes(dimension)) issues.push(`readiness_dimension_missing:${dimension}`);
  }
  if (presentation.require_dynamic_tenant_snapshot !== true) issues.push("dynamic_tenant_snapshot_not_required_by_contract");
  if (presentation.require_brand_snapshot !== true) issues.push("brand_snapshot_not_required_by_contract");
  if (presentation.require_skill_coverage_summary !== true) issues.push("skill_summary_not_required_by_contract");
  if (presentation.minimum_activation_response_profile !== "evidence") issues.push("activation_response_profile_floor_not_evidence");
  if (presentation.never_report_healthy_from_connection_state_alone !== true) issues.push("false_healthy_guard_missing");
  if (profile === "admin" && presentation.admin_is_tenant_intelligence_superset !== true) issues.push("admin_superset_contract_missing");

  const tenantScoped = profile === "tenant" || Boolean(snapshot.scope?.tenant_id);
  if (tenantScoped) {
    if (!snapshot.metrics || typeof snapshot.metrics !== "object") issues.push("tenant_dynamic_metrics_missing");
    if (snapshot.status === "degraded_data") issues.push("tenant_snapshot_degraded_data");
    for (const [key, metric] of Object.entries(record(snapshot.metrics))) {
      if (metric?.state !== "available" && metric?.value === 0) issues.push(`false_zero_detected:${key}`);
    }
  }
  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "pass" : "degraded_contract",
    policy_key: "platform_degradation_prevention_v1",
    issues,
    false_healthy_prevented: issues.length > 0,
    evaluated_at: new Date().toISOString(),
    secrets_included: false,
  };
}

export function evaluateCredentialIntakeRetryPolicy({ priorPageRenderFailures = 0, pagePreflightPassed = false } = {}) {
  const failures = Math.max(0, Number(priorPageRenderFailures || 0));
  if (!pagePreflightPassed) return { allow_session_creation: false, allow_automatic_retry: false, reason: "credential_intake_page_preflight_required", escalation_required: failures > 0 };
  if (failures > 0) return { allow_session_creation: true, allow_automatic_retry: false, reason: "single_replacement_session_allowed_after_preflight", escalation_required: true };
  return { allow_session_creation: true, allow_automatic_retry: true, reason: "page_preflight_passed", escalation_required: false };
}
