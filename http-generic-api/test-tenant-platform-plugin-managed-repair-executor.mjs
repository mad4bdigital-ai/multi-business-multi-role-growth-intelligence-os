import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { normalizeManagedExecutionEnvelope } from "./managedExecutionCore.js";
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
assert.equal(preview.managed_execution.internal_service, "createManagedExecutionRun");
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
assert.equal(binding.managed_execution.internal_service, "createManagedExecutionRun");
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
assert.equal(binding.managed_execution.managed_execution_input.input_json.execution_mode, "dry_run");
assert.equal(binding.managed_execution.managed_execution_input.input_json.apply_allowed, false);
assert.equal(Object.prototype.hasOwnProperty.call(binding.managed_execution.managed_execution_input.input_json, "secrets_included"), false);
assert.doesNotThrow(() => normalizeManagedExecutionEnvelope(binding.managed_execution.managed_execution_input));
const normalizedBindingInput = normalizeManagedExecutionEnvelope(binding.managed_execution.managed_execution_input);
assert.equal(normalizedBindingInput.input_json.execution_mode, "dry_run");
assert.equal(normalizedBindingInput.input_json.apply_allowed, false);
assert.equal(
  binding.managed_execution.idempotency_key_sha256,
  createHash("sha256").update(binding.managed_execution.managed_execution_input.idempotency_key).digest("hex"),
);
assert.equal(binding.managed_execution.resource_identity.authority_or_grant_created, false);
assert.match(binding.managed_execution.resource_identity.resource_ref, /^platform_plugin_operation:[0-9a-f]{64}$/);
assert.equal(binding.safety.managed_execution_run_created, false);
assert.equal(binding.mutation_executed, false);
assert.equal(JSON.stringify(binding).includes("tenant-spoofed"), false);
assert.equal(JSON.stringify(binding).includes("user-spoofed"), false);
assert.equal(JSON.stringify(binding).includes("workspace-spoofed"), false);

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
