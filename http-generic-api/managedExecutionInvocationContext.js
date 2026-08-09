import { managedError } from "./managedExecutionCore.js";
import { TenantPlatformPluginManagedRepairContract } from "./tenantPlatformPluginEligibility.js";

const TENANT_PLATFORM_PLUGIN_MANAGED_REPAIR_DRY_RUN_TOKEN = Symbol("tenant_platform_plugin_managed_repair_dry_run");

function isTenantPlatformPluginManagedRepairDryRunEnvelope(envelope = {}) {
  return envelope.execution_mode === "dry_run"
    && envelope.effect_class === TenantPlatformPluginManagedRepairContract.effect_class
    && envelope.capability_key === TenantPlatformPluginManagedRepairContract.capability_key
    && envelope.workflow_key === TenantPlatformPluginManagedRepairContract.workflow_key
    && envelope.resource_type === TenantPlatformPluginManagedRepairContract.resource_type;
}

export function createTenantPlatformPluginManagedRepairDryRunInvocationContext() {
  return Object.freeze({
    kind: "tenant_platform_plugin_managed_repair_dry_run",
    token: TENANT_PLATFORM_PLUGIN_MANAGED_REPAIR_DRY_RUN_TOKEN,
  });
}

export function assertManagedExecutionInvocationContext({ envelope = {}, invocationContext = null } = {}) {
  if (!isTenantPlatformPluginManagedRepairDryRunEnvelope(envelope)) return true;
  if (
    invocationContext?.kind !== "tenant_platform_plugin_managed_repair_dry_run"
    || invocationContext?.token !== TENANT_PLATFORM_PLUGIN_MANAGED_REPAIR_DRY_RUN_TOKEN
  ) {
    throw managedError(
      403,
      "managed_execution_dry_run_internal_executor_required",
      "Tenant Platform Plugin managed-repair dry-runs require the trusted internal executor invocation context.",
    );
  }
  return true;
}

export const _testingManagedExecutionInvocationContext = {
  isTenantPlatformPluginManagedRepairDryRunEnvelope,
};
