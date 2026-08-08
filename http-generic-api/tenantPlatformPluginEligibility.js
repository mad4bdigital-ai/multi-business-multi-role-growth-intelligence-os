export const TenantCapabilityEligibilityState = Object.freeze({
  READY: "ready",
  BLOCKED: "blocked",
  APPROVAL_REQUIRED: "approval_required",
  UNAVAILABLE: "unavailable",
  DEPRECATED: "deprecated",
});

export const TenantCapabilityRepairClass = Object.freeze({
  USER_ACTION_REQUIRED: "user_action_required",
  TENANT_ADMIN_ACTION_AVAILABLE: "tenant_admin_action_available",
  MANAGED_REPAIR_AVAILABLE: "managed_repair_available",
  PLATFORM_ADMIN_REQUIRED: "platform_admin_required",
  PROVIDER_EXTERNAL_ACTION_REQUIRED: "provider_external_action_required",
  NOT_REPAIRABLE: "not_repairable",
});

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function classifyBlocker(gate = {}) {
  const key = normalize(gate.key);
  const reason = normalize(gate.reason);

  if (key === "credential") {
    if (reason === "connection_selection_ambiguous") {
      return {
        blocker_code: "connection_selection_ambiguous",
        repair_class: TenantCapabilityRepairClass.TENANT_ADMIN_ACTION_AVAILABLE,
        safe_action: "resolve_connection_binding_ambiguity",
      };
    }
    if (["credential_required", "dedicated_connection_required", "credential_not_usable"].includes(reason)) {
      return {
        blocker_code: reason,
        repair_class: TenantCapabilityRepairClass.USER_ACTION_REQUIRED,
        safe_action: "credential_intake_or_oauth",
      };
    }
    if (["credential_scope_not_allowed", "connection_ownership_scope_mismatch"].includes(reason)) {
      return {
        blocker_code: reason,
        repair_class: TenantCapabilityRepairClass.TENANT_ADMIN_ACTION_AVAILABLE,
        safe_action: "review_connection_scope_binding",
      };
    }
  }

  if (key === "binding_state") {
    return {
      blocker_code: reason === "tool_binding_not_found" ? "missing_tool_binding" : "missing_action_binding",
      repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
      safe_action: "register_runtime_binding",
    };
  }

  if (key === "smoke_certification") {
    return {
      blocker_code: reason === "smoke_certification_expired" ? "expired_smoke_certification" : "missing_smoke_certification",
      repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
      safe_action: "certify_platform_plugin_operation",
    };
  }

  if (key === "approval") {
    return {
      blocker_code: "approval_required",
      repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
      safe_action: "obtain_governed_action_approval",
    };
  }

  if (key === "surface_exposure") {
    return {
      blocker_code: reason || "surface_not_tenant_visible",
      repair_class: TenantCapabilityRepairClass.NOT_REPAIRABLE,
      safe_action: null,
    };
  }

  if (key === "plugin_status") {
    return {
      blocker_code: reason || "plugin_unavailable",
      repair_class: TenantCapabilityRepairClass.NOT_REPAIRABLE,
      safe_action: null,
    };
  }

  if (key === "canonical_policy") {
    return {
      blocker_code: reason || "canonical_operation_mapping_required",
      repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
      safe_action: "register_canonical_operation_mapping",
    };
  }

  if (key === "skill") {
    return {
      blocker_code: reason || "skill_grant_required",
      repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
      safe_action: "grant_required_skill",
    };
  }

  if (key === "target_authority") {
    return {
      blocker_code: reason || "resource_authority_required",
      repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
      safe_action: "grant_exact_resource_authority",
    };
  }

  return {
    blocker_code: reason || `${key || "security_gate"}_blocked`,
    repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
    safe_action: null,
  };
}

function deriveEligibilityState(result = {}) {
  const pluginStatus = normalize(result.plugin?.status);
  if (pluginStatus === "deprecated") return TenantCapabilityEligibilityState.DEPRECATED;
  if (pluginStatus && !["active", "beta"].includes(pluginStatus)) return TenantCapabilityEligibilityState.UNAVAILABLE;
  if (result.execution?.will_execute === true) return TenantCapabilityEligibilityState.READY;
  if (result.allowed === true && result.approval?.approval_required === true) {
    return TenantCapabilityEligibilityState.APPROVAL_REQUIRED;
  }
  return TenantCapabilityEligibilityState.BLOCKED;
}

export function buildTenantPlatformPluginEligibility(result = {}) {
  const gates = Array.isArray(result.security_decision?.gates) ? result.security_decision.gates : [];
  const blockers = gates
    .filter((gate) => gate?.required !== false && ["deny", "not_evaluated"].includes(normalize(gate?.state)))
    .map((gate) => {
      const classification = classifyBlocker(gate);
      return {
        gate: String(gate.key || "security_gate"),
        blocker_code: classification.blocker_code,
        repair_class: classification.repair_class,
        safe_action: classification.safe_action,
      };
    });

  return Object.freeze({
    schema_version: "tenant_capability_eligibility.v1",
    status: deriveEligibilityState(result),
    dispatch_ready: result.execution?.will_execute === true,
    blocker_count: blockers.length,
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze(blocker))),
    source: "platform_plugin_resolver",
    secrets_included: false,
  });
}
