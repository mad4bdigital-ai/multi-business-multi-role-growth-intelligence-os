import { createHash } from "node:crypto";

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

export const TenantPlatformPluginManagedRepairContract = Object.freeze({
  schema_version: "tenant_platform_plugin_managed_repair.v1",
  workflow_key: "tenant_platform_plugin_managed_repair_v1",
  capability_key: "resource_authority_route_family.tenant_platform_plugin_managed_repair",
  resource_type: "platform_plugin_operation",
  effect_class: "managed_operation",
  authority_requirement_key: "tenant_platform_plugin_managed_repair_authority",
  dry_run_certification_key: "tenant_platform_plugin_managed_repair_dry_run_v1",
  dry_run_certification_surface_key: "resource_authority_route_family.tenant_platform_plugin_managed_repair",
  dry_run_certification_target_key: "tenant_platform_plugin_managed_repair_v1",
  create_route: "/managed-execution-runs",
  reconcile_route_template: "/managed-execution-runs/{run_id}/reconcile",
  readback_route: "/tenant/platform/plugins/resolve",
  registry_source_migration: "1052_tenant_platform_plugin_managed_repair_authority.sql",
});

const MANAGED_REPAIR_BLOCKERS = new Set([
  "missing_action_binding",
  "missing_tool_binding",
  "missing_smoke_certification",
  "expired_smoke_certification",
]);

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
    if (reason === "action_binding_not_found") {
      return {
        blocker_code: "missing_action_binding",
        repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
        safe_action: "register_runtime_binding",
      };
    }
    if (reason === "tool_binding_not_found") {
      return {
        blocker_code: "missing_tool_binding",
        repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
        safe_action: "register_runtime_binding",
      };
    }
    return {
      blocker_code: reason || "binding_not_executable",
      repair_class: TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
      safe_action: "review_runtime_binding_state",
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

function canonicalRepairIdentity(result = {}, blockerCodes = []) {
  const pluginKey = String(result.plugin?.plugin_key || result.plugin_key || "").trim();
  const requestedSelectorType = String(
    result.selector?.type || (result.requested_action_key ? "action_key" : (result.requested_tool_key ? "tool_key" : ""))
  ).trim();
  const selectorValue = requestedSelectorType === "action_key"
    ? String(result.binding?.action_key || "").trim()
    : (requestedSelectorType === "tool_key" ? String(result.binding?.tool_key || "").trim() : "");
  if (!pluginKey || !requestedSelectorType || !selectorValue) return null;
  const operationIdentity = {
    plugin_key: pluginKey,
    selector: { type: requestedSelectorType, value: selectorValue },
  };
  const blockers = [...new Set(blockerCodes)].sort();
  const sha256 = createHash("sha256").update(JSON.stringify(operationIdentity)).digest("hex");
  return { ...operationIdentity, blockers, sha256 };
}

function unavailableManagedRepair(reason, details = {}) {
  return Object.freeze({
    schema_version: TenantPlatformPluginManagedRepairContract.schema_version,
    available: false,
    reason,
    ...details,
    mutation_executed: false,
    secrets_included: false,
  });
}

function buildManagedRepairProjection(result = {}, blockers = []) {
  const pluginStatus = normalize(result.plugin?.status);
  if (pluginStatus && !["active", "beta"].includes(pluginStatus)) {
    return unavailableManagedRepair("plugin_not_executable");
  }

  const eligibleBlockers = blockers.filter((blocker) => MANAGED_REPAIR_BLOCKERS.has(blocker.blocker_code));
  if (!eligibleBlockers.length) return unavailableManagedRepair("no_allowlisted_managed_repair_for_current_blockers");

  const identity = canonicalRepairIdentity(result, eligibleBlockers.map((blocker) => blocker.blocker_code));
  if (!identity) return unavailableManagedRepair("canonical_plugin_operation_identity_required");

  const repairOperations = [...new Set(eligibleBlockers.map((blocker) => blocker.safe_action).filter(Boolean))].sort();
  return unavailableManagedRepair("managed_repair_executor_not_registered", {
    mode: "staged_dry_run_candidate",
    affected_operation: Object.freeze({
      plugin_key: identity.plugin_key,
      selector: Object.freeze(identity.selector),
      identity_sha256: identity.sha256,
      blocker_codes: Object.freeze(identity.blockers),
    }),
    repair_operations: Object.freeze(repairOperations),
    activation_requirements: Object.freeze([
      "dedicated_executor_registered",
      "capability_dispatch_certified",
      "capability_specific_dry_run_enforcement",
      "jwt_bound_principal_injection",
      "workspace_context_persisted_for_readback",
    ]),
    registry_source_migration: TenantPlatformPluginManagedRepairContract.registry_source_migration,
  });
}

export function buildTenantPlatformPluginEligibility(result = {}) {
  const gates = Array.isArray(result.security_decision?.gates) ? result.security_decision.gates : [];
  const classifiedBlockers = gates
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

  const managedRepair = buildManagedRepairProjection(result, classifiedBlockers);
  const blockers = classifiedBlockers.map((blocker) => (
    managedRepair.available && MANAGED_REPAIR_BLOCKERS.has(blocker.blocker_code)
      ? { ...blocker, repair_class: TenantCapabilityRepairClass.MANAGED_REPAIR_AVAILABLE }
      : blocker
  ));

  return Object.freeze({
    schema_version: "tenant_capability_eligibility.v1",
    status: deriveEligibilityState(result),
    dispatch_ready: result.execution?.will_execute === true,
    blocker_count: blockers.length,
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze(blocker))),
    managed_repair: managedRepair,
    source: "platform_plugin_resolver",
    secrets_included: false,
  });
}
