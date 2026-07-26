import { gateFromBoolean } from "./securityDecision.js";

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function evaluatePrincipalTenantAuthorization({ principalClass = "admin", tenantId = null, userId = null } = {}) {
  const principal = normalize(principalClass) || "admin";
  const ok = principal !== "tenant" || (Boolean(tenantId) && Boolean(userId));
  return gateFromBoolean({
    key: "principal_scope",
    ok,
    reason: ok
      ? (principal === "tenant" ? "tenant_principal_scope_authorized" : "admin_principal_scope")
      : "tenant_principal_scope_required",
    denyCode: "PRINCIPAL_SCOPE_REQUIRED",
  });
}

export function evaluateSurfaceExposure({
  selectorType = "action_key",
  toolSurface = "",
  exposureScope = "",
  principalClass = "admin",
} = {}) {
  if (selectorType !== "tool_key") {
    return gateFromBoolean({ key: "surface_exposure", ok: true, reason: "action_surface" });
  }
  const normalizedToolSurface = normalize(toolSurface);
  const normalizedExposureScope = normalize(exposureScope);
  const adminOnly = normalizedToolSurface.includes("admin")
    || ["admin", "platform_admin", "platform"].includes(normalizedExposureScope);
  const tenantBlocked = normalize(principalClass) === "tenant" && adminOnly;
  return gateFromBoolean({
    key: "surface_exposure",
    ok: !tenantBlocked,
    reason: tenantBlocked ? "admin_tool_forbidden" : (adminOnly ? "admin_surface_allowed_for_admin_preview" : "surface_exposed"),
    denyCode: "SURFACE_EXPOSURE_DENIED",
  });
}

export function evaluateTargetResourceOwnership(targetAuthority = {}) {
  return gateFromBoolean({
    key: "target_authority",
    ok: targetAuthority.ok !== false,
    reason: targetAuthority.reason || (targetAuthority.ok === false ? "target_authority_denied" : "target_authority_passed"),
    denyCode: targetAuthority.denial_code || "TARGET_AUTHORITY_DENIED",
    notApplicable: targetAuthority.required === false || targetAuthority.state === "not_applicable",
  });
}

export function evaluateSkillGate(skill = {}) {
  return gateFromBoolean({
    key: "skill",
    ok: skill.granted !== false,
    reason: skill.reason || (skill.granted === false ? "skill_not_granted" : "skill_granted"),
    denyCode: "SKILL_NOT_GRANTED",
    notApplicable: skill.required === false,
  });
}

export function evaluatePolicyCompleteness({ ready = true, reason = "policy_complete", required = true } = {}) {
  return gateFromBoolean({
    key: "policy_completeness",
    ok: ready === true,
    required,
    reason: ready === true ? reason : (reason || "policy_incomplete"),
    denyCode: "POLICY_INCOMPLETE",
    notApplicable: required === false,
  });
}
