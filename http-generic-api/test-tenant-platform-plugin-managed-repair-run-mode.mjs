import assert from "node:assert/strict";
import { normalizeManagedExecutionEnvelope } from "./managedExecutionCore.js";
import {
  assertManagedExecutionInvocationContext,
  createTenantPlatformPluginManagedRepairDryRunInvocationContext,
} from "./managedExecutionInvocationContext.js";
import { _testingManagedExecutionRunService } from "./managedExecutionRunService.js";
import { TenantPlatformPluginManagedRepairContract } from "./tenantPlatformPluginEligibility.js";

const {
  managedExecutionRunMode,
  assertManagedExecutionReuseMode,
  assertGenericManagedExecutionStepMode,
} = _testingManagedExecutionRunService;

function managedRun(executionMode, options = {}) {
  const authoritySnapshot = {
    contract: "tenant-managed-execution-v1",
    capability_key: TenantPlatformPluginManagedRepairContract.capability_key,
    resource: {
      type: TenantPlatformPluginManagedRepairContract.resource_type,
      ref: "platform_plugin_operation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    ...(executionMode ? { execution_mode: executionMode } : {}),
  };
  return {
    run_id: options.run_id || `run-${executionMode || "legacy"}`,
    execution_context_json: JSON.stringify({
      source: "managed_execution_lifecycle",
      contract: "tenant-managed-execution-v1",
      ...(options.topLevelMode ? { execution_mode: options.topLevelMode } : {}),
      authority_snapshot: authoritySnapshot,
    }),
  };
}

const liveRun = managedRun("live");
const dryRun = managedRun("dry_run", { topLevelMode: "dry_run" });
const legacyRun = managedRun(null);

assert.equal(managedExecutionRunMode(liveRun), "live");
assert.equal(managedExecutionRunMode(dryRun), "dry_run");
assert.equal(managedExecutionRunMode(legacyRun), "live");
assert.equal(
  assertManagedExecutionReuseMode({ run: liveRun, requestedMode: "live", reuseReason: "idempotency_key" }),
  "live",
);
assert.equal(
  assertManagedExecutionReuseMode({ run: dryRun, requestedMode: "dry_run", reuseReason: "active_scope" }),
  "dry_run",
);

assert.throws(
  () => assertManagedExecutionReuseMode({ run: liveRun, requestedMode: "dry_run", reuseReason: "idempotency_key" }),
  (error) => error.code === "managed_execution_idempotency_mode_conflict"
    && error.details?.existing_execution_mode === "live"
    && error.details?.requested_execution_mode === "dry_run",
);
assert.throws(
  () => assertManagedExecutionReuseMode({ run: dryRun, requestedMode: "live", reuseReason: "active_scope" }),
  (error) => error.code === "managed_execution_active_scope_mode_conflict"
    && error.details?.existing_execution_mode === "dry_run"
    && error.details?.requested_execution_mode === "live",
);
assert.throws(
  () => managedExecutionRunMode(managedRun("apply")),
  (error) => error.code === "managed_execution_existing_execution_mode_invalid",
);

assert.equal(assertGenericManagedExecutionStepMode({ execution_mode: "live" }), true);
assert.equal(assertGenericManagedExecutionStepMode({}), true);
assert.throws(
  () => assertGenericManagedExecutionStepMode({ execution_mode: "dry_run" }),
  (error) => error.code === "managed_execution_dry_run_step_executor_required",
);
assert.throws(
  () => assertGenericManagedExecutionStepMode({ execution_mode: "apply" }),
  (error) => error.code === "managed_execution_existing_execution_mode_invalid",
);

const canonicalDryRunEnvelope = normalizeManagedExecutionEnvelope({
  tenant_id: "tenant-authenticated",
  user_id: "user-authenticated",
  parent_ticket_id: "ticket-managed-repair-001",
  workflow_key: TenantPlatformPluginManagedRepairContract.workflow_key,
  capability_key: TenantPlatformPluginManagedRepairContract.capability_key,
  resource_type: TenantPlatformPluginManagedRepairContract.resource_type,
  resource_ref: "platform_plugin_operation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  effect_class: TenantPlatformPluginManagedRepairContract.effect_class,
  execution_mode: "dry_run",
  idempotency_key: "managed-repair-dry-run-idempotency",
  workspace_id: "workspace-authenticated",
  service_mode: "managed",
  input_json: {
    execution_mode: "dry_run",
    apply_allowed: false,
  },
});
assert.throws(
  () => assertManagedExecutionInvocationContext({ envelope: canonicalDryRunEnvelope, invocationContext: null }),
  (error) => error.code === "managed_execution_dry_run_internal_executor_required",
);
assert.throws(
  () => assertManagedExecutionInvocationContext({
    envelope: canonicalDryRunEnvelope,
    invocationContext: { kind: "tenant_platform_plugin_managed_repair_dry_run", token: Symbol("forged") },
  }),
  (error) => error.code === "managed_execution_dry_run_internal_executor_required",
);
const trustedInvocationContext = createTenantPlatformPluginManagedRepairDryRunInvocationContext();
assert.equal(Object.isFrozen(trustedInvocationContext), true);
assert.equal(
  assertManagedExecutionInvocationContext({
    envelope: canonicalDryRunEnvelope,
    invocationContext: trustedInvocationContext,
  }),
  true,
);
const liveEnvelope = normalizeManagedExecutionEnvelope({
  ...canonicalDryRunEnvelope,
  execution_mode: "live",
  input_json: { execution_mode: "live" },
});
assert.equal(assertManagedExecutionInvocationContext({ envelope: liveEnvelope, invocationContext: null }), true);

console.log("tenant Platform Plugin managed repair run-mode isolation tests passed");
