import { createSecurityDecision, gateFromBoolean } from "../../domain/capability/securityDecision.js";
import {
  evaluatePolicyCompleteness,
  evaluatePrincipalTenantAuthorization,
  evaluateSkillGate,
  evaluateSurfaceExposure,
  evaluateTargetResourceOwnership,
} from "../../domain/capability/securityEvaluators.js";

export function buildPlatformPluginPreApprovalDecision(input = {}) {
  const selector = input.selector || {};
  const binding = input.binding || {};
  const credential = input.credential || {};
  const credentialGate = input.credentialDecisionEvaluated
    ? gateFromBoolean({
        key: "credential",
        ok: credential.ok,
        reason: credential.reason,
        denyCode: credential.denial_code || null,
      })
    : { key: "credential", required: true, state: "not_evaluated", reason: credential.reason };

  return createSecurityDecision({
    execution_mode: "dispatch",
    gates: [
      gateFromBoolean({
        key: "plugin_status",
        ok: input.pluginStatusActive,
        reason: input.pluginStatusActive ? "plugin_active" : "plugin_not_active",
      }),
      evaluatePrincipalTenantAuthorization({
        principalClass: input.principalClass,
        tenantId: input.tenantId,
        userId: input.userId,
      }),
      gateFromBoolean({
        key: "binding_state",
        ok: input.bindingState?.ok,
        reason: input.bindingState?.reason,
      }),
      evaluateSurfaceExposure({
        selectorType: selector.type,
        toolSurface: binding.tool_surface || null,
        exposureScope: binding.exposure_scope || null,
        principalClass: input.principalClass,
      }),
      gateFromBoolean({
        key: "canonical_policy",
        ok: input.canonicalPolicy?.ready,
        reason: input.canonicalPolicy?.reason,
      }),
      evaluatePolicyCompleteness({
        ready: input.canonicalPolicy?.ready,
        reason: input.canonicalPolicy?.reason,
      }),
      credentialGate,
      evaluateTargetResourceOwnership(input.targetAuthority),
      evaluateSkillGate(input.skill),
      gateFromBoolean({
        key: "smoke_certification",
        ok: input.smokeCertification?.certified,
        reason: input.smokeCertification?.reason,
      }),
    ],
  });
}

export function buildPlatformPluginSecurityDecision(input = {}) {
  const preApprovalDecision = input.preApprovalDecision || buildPlatformPluginPreApprovalDecision(input);
  return createSecurityDecision({
    execution_mode: "dispatch",
    approval_required: input.approvalRequired,
    gates: [
      ...preApprovalDecision.gates,
      gateFromBoolean({
        key: "approval",
        ok: !input.approvalRequired,
        required: input.baseApprovalRequired,
        reason: input.approvalRequired
          ? input.actionGrant?.reason
          : "action_grant_or_preview_policy_allows_dispatch",
      }),
    ],
  });
}
