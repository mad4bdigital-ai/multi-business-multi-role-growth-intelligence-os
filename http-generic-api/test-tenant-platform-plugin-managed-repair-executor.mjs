import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildManagedAuthoritySnapshot,
  normalizeManagedExecutionEnvelope,
  resolveManagedExecutionGate,
} from "./managedExecutionCore.js";
import {
  assertManagedExecutionAuthorityStillEffective,
  resolveManagedExecutionAuthority,
} from "./managedExecutionAuthority.js";
import { TenantPlatformPluginManagedRepairContract } from "./tenantPlatformPluginEligibility.js";
import {
  bindTenantPlatformPluginManagedRepairToManagedExecution,
  previewTenantPlatformPluginManagedRepair,
} from "./tenantPlatformPluginManagedRepairExecutor.js";

function certificationBlockedResult(overrides = {}) {
  return {
    ok: true,
    allowed: false,
    plugin_key: "github",
    selector: { type: "action_key", value: "github_create_issue_comment" },
    requested_action_key: "github_create_issue_comment",
    requested_tool_key: null,
    plugin: { plugin_key: "github", status: "active" },
    binding: { action_key: "github_create_issue_comment", status: "active" },
    security_decision: {
      gates: [{
        key: "smoke_certification",
        required: true,
        state: "deny",
        reason: "smoke_certification_missing",
      }],
    },
    approval: { approval_required: false },
    execution: { will_execute: false },
    secrets_included: false,
    ...overrides,
  };
}

const authContext = {
  mode: "user_jwt",
  is_admin: false,
  tenant_id: "tenant-authenticated",
  user_id: "user-authenticated",
  workspace_id: "workspace-authenticated",
  tenant_role: "admin",
  source: "context_kernel_authorized_scope_and_workspace_ownership",
};

const preview = previewTenantPlatformPluginManagedRepair({
  authContext,
  resolverResult: certificationBlockedResult({
    tenant_id: "tenant-spoofed",
    user_id: "user-spoofed",
    workspace_id: "workspace-spoofed",
  }),
  requestId: "req-managed-repair-dry-run",
});

assert.equal(preview.ok, true);
assert.equal(preview.execution_mode, "dry_run");
assert.equal(preview.source_executor_implemented, true);
assert.equal(preview.executor_registered, false);
assert.equal(preview.activation_status, "source_only_unregistered");
assert.equal(preview.apply_allowed, false);
assert.equal(preview.dispatch_apply_allowed, false);
assert.equal(preview.principal.tenant_id, "tenant-authenticated");
assert.equal(preview.principal.user_id, "user-authenticated");
assert.equal(preview.principal.workspace_id, "workspace-authenticated");
assert.equal(preview.principal.source, "context_kernel_authorized_scope_and_workspace_ownership");
assert.equal(preview.affected_operation.plugin_key, "github");
assert.equal(preview.affected_operation.selector.type, "action_key");
assert.equal(preview.affected_operation.selector.value, "github_create_issue_comment");
assert.deepEqual(preview.repair_operations, ["certify_platform_plugin_operation"]);
assert.match(preview.preview_fingerprint_sha256, /^[0-9a-f]{64}$/);
assert.equal(preview.managed_execution.internal_service, "createTenantPlatformPluginManagedRepairDryRun");
assert.equal(preview.managed_execution.run_created, false);
assert.equal(preview.managed_execution.reason, "migration_1052_application_and_capability_certification_required");
assert.equal(preview.readback.route, "/tenant/platform/plugins/resolve");
assert.equal(preview.readback.workspace_id, "workspace-authenticated");
assert.equal(preview.readback.executed, false);
assert.equal(preview.safety.authority_or_credential_created, false);
assert.equal(preview.safety.migration_applied, false);
assert.equal(preview.safety.provider_call_executed, false);
assert.equal(preview.safety.external_write_executed, false);
assert.equal(preview.safety.production_mutation_executed, false);
assert.equal(preview.safety.managed_execution_run_created, false);
assert.equal(preview.mutation_executed, false);
assert.equal(preview.secrets_included, false);

const repeat = previewTenantPlatformPluginManagedRepair({
  authContext,
  resolverResult: certificationBlockedResult(),
  requestId: "different-request-id",
});
assert.equal(repeat.preview_fingerprint_sha256, preview.preview_fingerprint_sha256);

const binding = bindTenantPlatformPluginManagedRepairToManagedExecution({
  authContext,
  resolverResult: certificationBlockedResult({
    tenant_id: "tenant-spoofed",
    user_id: "user-spoofed",
    workspace_id: "workspace-spoofed",
  }),
  parentTicketId: "ticket-managed-repair-001",
  requestId: "transport-request-a",
  correlationId: "transport-correlation-a",
});

assert.equal(binding.ok, true);
assert.equal(binding.managed_execution.internal_service, "createTenantPlatformPluginManagedRepairDryRun");
assert.equal(binding.managed_execution.direct_http_route_allowed, false);
assert.equal(binding.managed_execution.execution_mode, "dry_run");
assert.equal(binding.managed_execution.run_creation_allowed, false);
assert.equal(binding.managed_execution.activation_status, "source_bound_activation_not_certified");
assert.equal(binding.managed_execution.run_created, false);
assert.equal(binding.managed_execution.mutation_executed, false);
assert.equal(binding.managed_execution.secrets_included, false);
assert.match(binding.managed_execution.managed_execution_input_hash, /^[0-9a-f]{64}$/);
assert.match(binding.managed_execution.idempotency_key_sha256, /^[0-9a-f]{64}$/);
assert.equal(binding.managed_execution.managed_execution_input.tenant_id, "tenant-authenticated");
assert.equal(binding.managed_execution.managed_execution_input.user_id, "user-authenticated");
assert.equal(binding.managed_execution.managed_execution_input.workspace_id, "workspace-authenticated");
assert.equal(binding.managed_execution.managed_execution_input.parent_ticket_id, "ticket-managed-repair-001");
assert.equal(binding.managed_execution.managed_execution_input.workflow_key, "tenant_platform_plugin_managed_repair_v1");
assert.equal(binding.managed_execution.managed_execution_input.capability_key, "resource_authority_route_family.tenant_platform_plugin_managed_repair");
assert.equal(binding.managed_execution.managed_execution_input.resource_type, "platform_plugin_operation");
assert.equal(binding.managed_execution.managed_execution_input.effect_class, "managed_operation");
assert.equal(binding.managed_execution.managed_execution_input.execution_mode, "dry_run");
assert.equal(binding.managed_execution.managed_execution_input.input_json.execution_mode, "dry_run");
assert.equal(binding.managed_execution.managed_execution_input.input_json.apply_allowed, false);
assert.equal(Object.prototype.hasOwnProperty.call(binding.managed_execution.managed_execution_input.input_json, "secrets_included"), false);
assert.doesNotThrow(() => normalizeManagedExecutionEnvelope(binding.managed_execution.managed_execution_input));
const normalizedBindingInput = normalizeManagedExecutionEnvelope(binding.managed_execution.managed_execution_input);
assert.equal(normalizedBindingInput.execution_mode, "dry_run");
assert.equal(normalizedBindingInput.input_json.execution_mode, "dry_run");
assert.equal(normalizedBindingInput.input_json.apply_allowed, false);
assert.equal(
  binding.managed_execution.idempotency_key_sha256,
  createHash("sha256").update(binding.managed_execution.managed_execution_input.idempotency_key).digest("hex"),
);
const stagedInputHash = binding.managed_execution.managed_execution_input_hash;
assert.equal(Object.isFrozen(binding.managed_execution.managed_execution_input), true);
assert.equal(Object.isFrozen(binding.managed_execution.managed_execution_input.input_json), true);
assert.equal(Object.isFrozen(binding.managed_execution.managed_execution_input.input_json.affected_operation), true);
assert.equal(Object.isFrozen(binding.managed_execution.managed_execution_input.input_json.affected_operation.selector), true);
assert.equal(Object.isFrozen(binding.managed_execution.managed_execution_input.input_json.repair_operations), true);
assert.throws(
  () => { binding.managed_execution.managed_execution_input.input_json.execution_mode = "apply"; },
  TypeError,
);
assert.throws(
  () => { binding.managed_execution.managed_execution_input.input_json.affected_operation.selector.value = "other_operation"; },
  TypeError,
);
assert.throws(
  () => { binding.managed_execution.managed_execution_input.input_json.repair_operations.push("unexpected_operation"); },
  TypeError,
);
assert.equal(binding.managed_execution.managed_execution_input.input_json.execution_mode, "dry_run");
assert.equal(binding.managed_execution.managed_execution_input.input_json.affected_operation.selector.value, "github_create_issue_comment");
assert.deepEqual(binding.managed_execution.managed_execution_input.input_json.repair_operations, ["certify_platform_plugin_operation"]);
assert.equal(binding.managed_execution.managed_execution_input_hash, stagedInputHash);
assert.equal(binding.managed_execution.resource_identity.authority_or_grant_created, false);
assert.match(binding.managed_execution.resource_identity.resource_ref, /^platform_plugin_operation:[0-9a-f]{64}$/);
assert.equal(binding.safety.managed_execution_run_created, false);
assert.equal(binding.mutation_executed, false);
assert.equal(JSON.stringify(binding).includes("tenant-spoofed"), false);
assert.equal(JSON.stringify(binding).includes("user-spoofed"), false);
assert.equal(JSON.stringify(binding).includes("workspace-spoofed"), false);

assert.throws(
  () => normalizeManagedExecutionEnvelope({
    ...binding.managed_execution.managed_execution_input,
    execution_mode: "live",
  }),
  (error) => error.code === "managed_execution_execution_mode_conflict",
);
assert.throws(
  () => normalizeManagedExecutionEnvelope({
    ...binding.managed_execution.managed_execution_input,
    execution_mode: "unexpected",
    input_json: { ...binding.managed_execution.managed_execution_input.input_json, execution_mode: "unexpected" },
  }),
  (error) => error.code === "managed_execution_execution_mode_invalid",
);

const bindingRepeat = bindTenantPlatformPluginManagedRepairToManagedExecution({
  authContext,
  resolverResult: certificationBlockedResult(),
  parentTicketId: "ticket-managed-repair-001",
  requestId: "transport-request-b",
  correlationId: "transport-correlation-b",
});
assert.equal(
  bindingRepeat.managed_execution.managed_execution_input.idempotency_key,
  binding.managed_execution.managed_execution_input.idempotency_key,
);
assert.equal(
  bindingRepeat.managed_execution.managed_execution_input_hash,
  binding.managed_execution.managed_execution_input_hash,
);
assert.equal(
  bindingRepeat.managed_execution.managed_execution_input.request_id,
  binding.managed_execution.managed_execution_input.idempotency_key,
);
assert.equal(
  bindingRepeat.managed_execution.managed_execution_input.correlation_id,
  binding.managed_execution.managed_execution_input.idempotency_key,
);

function managedRepairAuthorityConnection({
  capabilityOverrides = {},
  certificationOverrides = {},
  certificationRows = undefined,
  grantRows = undefined,
} = {}) {
  const defaultCertification = {
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
    last_evidence_ref: "ci://tenant-platform-plugin-managed-repair/dry-run-authority/exact-head",
    last_certified_at: "2026-08-09T12:00:00.000Z",
    expires_at: "2099-08-09T12:00:00.000Z",
    ...certificationOverrides,
  };
  const defaultGrantRows = [{
    grant_id: "grant-managed-repair-operate",
    tenant_id: authContext.tenant_id,
    grantee_user_id: authContext.user_id,
    resource_type: TenantPlatformPluginManagedRepairContract.resource_type,
    resource_ref: binding.managed_execution.resource_identity.resource_ref,
    permission: "operate",
    grant_status: "active",
    source: "owner_assignment",
    granted_by: "tenant-owner",
    granted_at: "2026-08-09T11:00:00.000Z",
    expires_at: null,
  }];
  return {
    async query(sql) {
      if (sql.includes("v_platform_capabilities_effective_evidence")) {
        return [[{
          capability_key: TenantPlatformPluginManagedRepairContract.capability_key,
          display_name: "Tenant Platform Plugin managed repair",
          operation_class: "managed_repair",
          risk_class: "C",
          runtime_status: "baseline_registered",
          exposure_scope: "internal",
          resource_authority_required: 1,
          dispatch_allowed: 0,
          apply_allowed: 0,
          requires_audit_evidence: 1,
          requires_readback: 1,
          evidence_ref: TenantPlatformPluginManagedRepairContract.authority_requirement_key,
          ...capabilityOverrides,
        }]];
      }
      if (sql.includes("runtime_dispatch_certification_registry")) {
        return [certificationRows === undefined ? [defaultCertification] : certificationRows];
      }
      if (sql.includes("v_workspace_resource_grant_effective")) {
        return [grantRows === undefined ? defaultGrantRows : grantRows];
      }
      throw new Error(`Unexpected managed repair authority query: ${sql}`);
    },
  };
}

const dryRunEnvelope = normalizeManagedExecutionEnvelope(binding.managed_execution.managed_execution_input);
const dryRunAuthority = await resolveManagedExecutionAuthority({
  connection: managedRepairAuthorityConnection(),
  envelope: dryRunEnvelope,
});
assert.equal(dryRunAuthority.capability.capability_key, TenantPlatformPluginManagedRepairContract.capability_key);
assert.equal(dryRunAuthority.capability.execution_mode, "dry_run");
assert.equal(dryRunAuthority.capability.base_dispatch_allowed, false);
assert.equal(dryRunAuthority.capability.base_apply_allowed, false);
assert.equal(dryRunAuthority.capability.dispatch_allowed, true);
assert.equal(dryRunAuthority.capability.apply_allowed, false);
assert.equal(dryRunAuthority.capability.dry_run_certification.certification_key, TenantPlatformPluginManagedRepairContract.dry_run_certification_key);
assert.equal(dryRunAuthority.capability.dry_run_certification.dispatch_allowed, true);
assert.equal(dryRunAuthority.capability.dry_run_certification.apply_allowed, false);
assert.equal(dryRunAuthority.capability.dry_run_certification.requires_dry_run, true);
assert.equal(dryRunAuthority.resource_grant.permission, "operate");
assert.equal(dryRunAuthority.resource_grant.exact_resource, true);

await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: managedRepairAuthorityConnection({ certificationRows: [] }),
    envelope: dryRunEnvelope,
  }),
  (error) => error.code === "managed_execution_dry_run_certification_required",
);
await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: managedRepairAuthorityConnection({
      certificationOverrides: { last_certified_at: "2019-01-01T00:00:00.000Z", expires_at: "2020-01-01T00:00:00.000Z" },
    }),
    envelope: dryRunEnvelope,
  }),
  (error) => error.code === "managed_execution_dry_run_certification_expired",
);
await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: managedRepairAuthorityConnection({
      certificationOverrides: { apply_allowed: 1 },
    }),
    envelope: dryRunEnvelope,
  }),
  (error) => error.code === "managed_execution_dry_run_certification_apply_must_be_blocked",
);
await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: managedRepairAuthorityConnection({
      certificationOverrides: { certification_status: "draft" },
    }),
    envelope: dryRunEnvelope,
  }),
  (error) => error.code === "managed_execution_dry_run_certification_not_active",
);
await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: managedRepairAuthorityConnection({ grantRows: [] }),
    envelope: dryRunEnvelope,
  }),
  (error) => error.code === "managed_execution_resource_grant_required",
);

const liveManagedRepairEnvelope = normalizeManagedExecutionEnvelope({
  ...binding.managed_execution.managed_execution_input,
  execution_mode: "live",
  input_json: { ...binding.managed_execution.managed_execution_input.input_json, execution_mode: "live" },
});
await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: managedRepairAuthorityConnection(),
    envelope: liveManagedRepairEnvelope,
  }),
  (error) => error.code === "managed_execution_capability_not_active",
);
const wrongWorkflowDryRunEnvelope = normalizeManagedExecutionEnvelope({
  ...binding.managed_execution.managed_execution_input,
  workflow_key: "other_managed_workflow",
});
await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: managedRepairAuthorityConnection(),
    envelope: wrongWorkflowDryRunEnvelope,
  }),
  (error) => error.code === "managed_execution_capability_not_active",
);

const dryRunGate = resolveManagedExecutionGate({
  access_decision: "ROUTE_TO_MANAGED_SERVICE",
  effect_class: TenantPlatformPluginManagedRepairContract.effect_class,
});
const dryRunSnapshot = buildManagedAuthoritySnapshot({
  envelope: dryRunEnvelope,
  access: {
    decision: "ROUTE_TO_MANAGED_SERVICE",
    reason: "managed_repair_dry_run",
    service_mode: "managed",
    resolved_at: "2026-08-09T12:10:00.000Z",
  },
  gate: dryRunGate,
  authority: dryRunAuthority,
});
assert.equal(dryRunSnapshot.execution_mode, "dry_run");
assert.equal(dryRunSnapshot.capability_authority.dry_run_certification.apply_allowed, false);
await assert.rejects(
  assertManagedExecutionAuthorityStillEffective({
    connection: managedRepairAuthorityConnection(),
    authoritySnapshot: dryRunSnapshot,
  }),
  (error) => error.code === "managed_execution_dry_run_dedicated_executor_required",
);
await assert.doesNotReject(
  assertManagedExecutionAuthorityStillEffective({
    connection: managedRepairAuthorityConnection(),
    authoritySnapshot: dryRunSnapshot,
    allowDryRunRevalidation: true,
  }),
);
await assert.rejects(
  assertManagedExecutionAuthorityStillEffective({
    connection: managedRepairAuthorityConnection({
      certificationOverrides: {
        last_evidence_ref: "ci://tenant-platform-plugin-managed-repair/dry-run-authority/rotated-evidence",
      },
    }),
    authoritySnapshot: dryRunSnapshot,
    allowDryRunRevalidation: true,
  }),
  (error) => error.code === "managed_execution_authority_drift" && error.details?.drift?.includes("dry_run_certification_evidence_changed"),
);

assert.throws(
  () => bindTenantPlatformPluginManagedRepairToManagedExecution({
    authContext,
    resolverResult: certificationBlockedResult(),
    parentTicketId: null,
  }),
  (error) => error.code === "tenant_managed_repair_parent_ticket_id_required",
);

assert.throws(
  () => previewTenantPlatformPluginManagedRepair({
    authContext: { ...authContext, mode: "backend_api", is_admin: true },
    resolverResult: certificationBlockedResult(),
  }),
  (error) => error.code === "tenant_managed_repair_user_jwt_required",
);

for (const field of ["tenant_id", "user_id", "workspace_id"]) {
  const incomplete = { ...authContext, [field]: null };
  assert.throws(
    () => previewTenantPlatformPluginManagedRepair({
      authContext: incomplete,
      resolverResult: certificationBlockedResult(),
    }),
    (error) => error.code === `tenant_managed_repair_${field}_context_required`,
  );
}

assert.throws(
  () => previewTenantPlatformPluginManagedRepair({
    authContext,
    resolverResult: certificationBlockedResult({
      binding: undefined,
      security_decision: {
        gates: [{
          key: "binding_state",
          required: true,
          state: "deny",
          reason: "action_binding_not_found",
        }],
      },
    }),
  }),
  (error) => error.code === "tenant_managed_repair_canonical_identity_required",
);

assert.throws(
  () => previewTenantPlatformPluginManagedRepair({
    authContext,
    resolverResult: certificationBlockedResult({
      security_decision: {
        gates: [{
          key: "target_authority",
          required: true,
          state: "deny",
          reason: "resource_authority_required",
        }],
      },
    }),
  }),
  (error) => error.code === "tenant_managed_repair_canonical_identity_required",
);

console.log("tenant Platform Plugin managed repair dry-run executor tests passed");
