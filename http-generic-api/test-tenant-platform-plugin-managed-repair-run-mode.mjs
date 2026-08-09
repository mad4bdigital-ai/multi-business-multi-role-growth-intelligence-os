import assert from "node:assert/strict";
import { _testingManagedExecutionAuthority } from "./managedExecutionAuthority.js";
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
const { resolveManagedRepairDryRunCertification } = _testingManagedExecutionAuthority;

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

const noncanonicalDryRunEnvelope = normalizeManagedExecutionEnvelope({
  ...canonicalDryRunEnvelope,
  workflow_key: "other_managed_workflow",
  idempotency_key: "noncanonical-dry-run-idempotency",
});
assert.throws(
  () => assertManagedExecutionInvocationContext({
    envelope: noncanonicalDryRunEnvelope,
    invocationContext: null,
  }),
  (error) => error.code === "managed_execution_dry_run_dedicated_executor_required",
);
assert.throws(
  () => assertManagedExecutionInvocationContext({
    envelope: noncanonicalDryRunEnvelope,
    invocationContext: trustedInvocationContext,
  }),
  (error) => error.code === "managed_execution_dry_run_dedicated_executor_required",
);

const liveEnvelope = normalizeManagedExecutionEnvelope({
  ...canonicalDryRunEnvelope,
  execution_mode: "live",
  input_json: { execution_mode: "live" },
});
assert.equal(assertManagedExecutionInvocationContext({ envelope: liveEnvelope, invocationContext: null }), true);

function certificationRow(overrides = {}) {
  return {
    certification_key: TenantPlatformPluginManagedRepairContract.dry_run_certification_key,
    surface_key: TenantPlatformPluginManagedRepairContract.dry_run_certification_surface_key,
    surface_family: "managed_execution",
    tool_or_action_key: TenantPlatformPluginManagedRepairContract.dry_run_certification_target_key,
    risk_class: "C",
    certification_status: "ci_certified",
    smoke_strategy: "bounded_evidence_readback",
    dispatch_allowed: 1,
    apply_allowed: 0,
    requires_resource_authority: 1,
    requires_dry_run: 1,
    requires_audit_evidence: 1,
    requires_readback: 1,
    last_evidence_ref: "ci://managed-repair/certification-window",
    last_certified_at: "2026-08-09T13:00:00.000Z",
    expires_at: "2026-08-09T15:00:00.000Z",
    ...overrides,
  };
}
function certificationConnection(row) {
  return {
    async query() {
      return [[row]];
    },
  };
}
const certificationNow = new Date("2026-08-09T14:00:00.000Z");
await assert.doesNotReject(
  resolveManagedRepairDryRunCertification({
    connection: certificationConnection(certificationRow()),
    now: certificationNow,
  }),
);
await assert.rejects(
  resolveManagedRepairDryRunCertification({
    connection: certificationConnection(certificationRow({
      last_certified_at: "2026-08-09T14:30:00.000Z",
      expires_at: "2026-08-09T15:00:00.000Z",
    })),
    now: certificationNow,
  }),
  (error) => error.code === "managed_execution_dry_run_certification_not_yet_valid",
);
await assert.rejects(
  resolveManagedRepairDryRunCertification({
    connection: certificationConnection(certificationRow({
      last_certified_at: "2026-08-09T15:00:00.000Z",
      expires_at: "2026-08-09T14:30:00.000Z",
    })),
    now: certificationNow,
  }),
  (error) => error.code === "managed_execution_dry_run_certification_window_invalid",
);
await assert.rejects(
  resolveManagedRepairDryRunCertification({
    connection: certificationConnection(certificationRow({
      last_certified_at: "2026-08-09T12:00:00.000Z",
      expires_at: "2026-08-09T13:30:00.000Z",
    })),
    now: certificationNow,
  }),
  (error) => error.code === "managed_execution_dry_run_certification_expired",
);

console.log("tenant Platform Plugin managed repair run-mode isolation tests passed");
