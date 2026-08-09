import assert from "node:assert/strict";
import {
  normalizeManagedExecutionEnvelope,
  resolveManagedExecutionRunAuthority,
} from "./managedExecutionLifecycleService.js";

const base = {
  tenant_id: "tenant-1",
  user_id: "user-1",
  parent_ticket_id: "ticket-parent",
  workflow_key: "tenant_platform_plugin_managed_repair_v1",
  capability_key: "resource_authority_route_family.tenant_platform_plugin_managed_repair",
  resource_type: "platform_plugin_operation",
  resource_ref: `platform_plugin_operation:${"a".repeat(64)}`,
  effect_class: "managed_operation",
  idempotency_key: "tenant-platform-plugin-managed-repair:test-seam",
  workspace_id: "workspace-1",
  input_json: {
    execution_mode: "dry_run",
    apply_allowed: false,
  },
};

const envelope = normalizeManagedExecutionEnvelope(base);
const connection = { marker: "same-transaction-connection" };
const customAuthority = Object.freeze({
  capability: Object.freeze({
    capability_key: base.capability_key,
    runtime_status: "certified",
    dispatch_allowed: true,
    apply_allowed: false,
  }),
  resource_grant: Object.freeze({
    grant_id: "grant-1",
    permission: "operate",
    exact_resource: true,
  }),
  resolved_at: "2026-08-09T00:00:00.000Z",
  secrets_included: false,
});

let observed = null;
const resolved = await resolveManagedExecutionRunAuthority({
  connection,
  envelope,
  authorityResolver: async (args) => {
    observed = args;
    return customAuthority;
  },
});

assert.equal(observed.connection, connection);
assert.equal(observed.envelope, envelope);
assert.equal(resolved, customAuthority);
assert.equal(resolved.capability.apply_allowed, false);
assert.equal(resolved.secrets_included, false);

await assert.rejects(
  resolveManagedExecutionRunAuthority({
    connection,
    envelope,
    authorityResolver: null,
  }),
  (error) => error.code === "managed_execution_authority_resolver_invalid",
);

function genericAuthorityConnection() {
  return {
    async query(sql) {
      if (sql.includes("v_platform_capabilities_effective_evidence")) {
        return [[{
          capability_key: base.capability_key,
          operation_class: "managed_repair",
          risk_class: "C",
          runtime_status: "certified",
          exposure_scope: "tenant",
          resource_authority_required: 1,
          dispatch_allowed: 1,
          apply_allowed: 0,
          requires_audit_evidence: 1,
          requires_readback: 1,
          evidence_ref: "managed-repair-evidence",
        }]];
      }
      if (sql.includes("v_workspace_resource_grant_effective")) {
        return [[{
          grant_id: "grant-1",
          tenant_id: base.tenant_id,
          grantee_user_id: base.user_id,
          resource_type: base.resource_type,
          resource_ref: base.resource_ref,
          permission: "operate",
          grant_status: "active",
          source: "owner_assignment",
          granted_by: "owner-1",
          granted_at: "2026-08-01T00:00:00Z",
          expires_at: null,
        }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

await assert.rejects(
  resolveManagedExecutionRunAuthority({
    connection: genericAuthorityConnection(),
    envelope,
  }),
  (error) => error.code === "managed_execution_capability_apply_blocked",
);

console.log("managed execution authority resolver seam tests passed");
