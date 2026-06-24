import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { metricResult } from "./tenantActivationSnapshot.js";
import { REQUIRED_READINESS_DIMENSIONS, evaluateActivationGuidanceContract, evaluateCredentialIntakeRetryPolicy } from "./platformDegradationPolicy.js";

assert.equal(metricResult({ key: "missing", state: "unavailable", value: 0 }).value, null);
assert.equal(metricResult({ key: "real_zero", state: "available", value: 0 }).value, 0);

const valid = evaluateActivationGuidanceContract({
  profile: "admin",
  managed_brands: [],
  tenant_dynamic_snapshot: { status: "ready", scope: { tenant_id: "tenant-1" }, metrics: { active_memberships: { value: 1, state: "available" } } },
  account_or_admin_capability_snapshot: { readiness_dimensions: [...REQUIRED_READINESS_DIMENSIONS] },
  assistant_instruction_pack: { presentation_contract: {
    require_dynamic_tenant_snapshot: true,
    require_brand_snapshot: true,
    require_skill_coverage_summary: true,
    minimum_activation_response_profile: "evidence",
    admin_is_tenant_intelligence_superset: true,
    never_report_healthy_from_connection_state_alone: true,
  } },
});
assert.equal(valid.ok, true);

const degraded = evaluateActivationGuidanceContract({
  profile: "tenant",
  managed_brands: [],
  tenant_dynamic_snapshot: { status: "degraded_data", scope: { tenant_id: "tenant-1" }, metrics: { devices_registered: { value: null, state: "unavailable" } } },
});
assert.equal(degraded.ok, false);
assert.equal(degraded.false_healthy_prevented, true);
assert.equal(evaluateCredentialIntakeRetryPolicy({ pagePreflightPassed: false }).allow_session_creation, false);
assert.equal(evaluateCredentialIntakeRetryPolicy({ pagePreflightPassed: true, priorPageRenderFailures: 1 }).allow_automatic_retry, false);

const activation = readFileSync("activationGuidanceService.js", "utf8");
assert(activation.includes("buildTenantActivationSnapshot"));
assert(activation.includes("tenant_dynamic_snapshot"));
assert(activation.includes("managed_brands"));
const tools = readFileSync("routes/gptToolsRoutes.js", "utf8");
assert(tools.includes("latest_active_session_fallback"));
const intake = readFileSync("routes/credentialIntakeRoutes.js", "utf8");
assert(intake.includes("credential_intake.page_render_failed"));
assert(intake.includes("superseded_by_new_session"));
assert(intake.includes("page_preflight"));

console.log("platform degradation prevention policy tests passed");
