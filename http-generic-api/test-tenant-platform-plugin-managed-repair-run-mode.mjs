import assert from "node:assert/strict";
import { _testingManagedExecutionRunService } from "./managedExecutionRunService.js";

const {
  managedExecutionRunMode,
  assertManagedExecutionReuseMode,
  assertGenericManagedExecutionStepMode,
} = _testingManagedExecutionRunService;

function managedRun(executionMode, options = {}) {
  const authoritySnapshot = {
    contract: "tenant-managed-execution-v1",
    capability_key: "resource_authority_route_family.tenant_platform_plugin_managed_repair",
    resource: {
      type: "platform_plugin_operation",
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

console.log("tenant Platform Plugin managed repair run-mode isolation tests passed");
