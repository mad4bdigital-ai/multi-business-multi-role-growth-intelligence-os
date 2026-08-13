import assert from "node:assert/strict";
import { consumeRemoteMcpGovernedSurface } from "./remoteMcpGovernedSurfaceConsumer.js";

const baseContract = {
  context: {
    tenant_id: "tenant-a",
    workspace_id: "workspace-a",
    principal_id: "user-a",
    context_hash: "ctx-a",
  },
  capability_manifest: {
    revision: "cap-1",
    capabilities: [{ key: "workspace.read", state: "available" }],
  },
  authority_preflight: {
    preflight_id: "pf-1",
    decision: "allow",
    allowed: true,
  },
  plan: {
    plan_id: "plan-1",
    effect: "read",
  },
  approval_or_delegation: {
    status: "not_required",
  },
  final_authority: {
    decision: "allow",
    allowed: true,
    authority_revision: "auth-1",
  },
  durable_execution: {
    status: "not_started",
  },
  adapter: {
    key: "platform_read_model",
  },
  readback: {
    status: "verified",
    verified: true,
  },
  readiness: {
    ready: true,
    checks: { schema_ready: true },
  },
};

{
  let resolverCalls = 0;
  const result = await consumeRemoteMcpGovernedSurface({
    toolName: "list_accessible_workspaces",
    authentication: { user_id: "user-a", client_id: "client-a" },
    resolveGovernedSurface: async (request) => {
      resolverCalls += 1;
      assert.equal(request.authority_requested_from_surface, false);
      assert.equal(request.provider_execution_requested_from_surface, false);
      return {
        ...baseContract,
        surface_projection: {
          tool_name: "list_accessible_workspaces",
          result: {
            workspaces: [
              {
                workspace_id: "workspace-a",
                display_name: "Workspace A",
                role: "member",
                access_token: "must-not-leak",
              },
            ],
            raw_rows: [{ tenant_id: "tenant-b" }],
          },
        },
      };
    },
  });
  assert.equal(resolverCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.result.count, 1);
  assert.equal(result.result.workspaces[0].workspace_id, "workspace-a");
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(result).includes("tenant-b"), false);
  assert.equal(result.authority_created_by_surface, false);
  assert.equal(result.connection_selected_by_surface, false);
  assert.equal(result.provider_executed_by_surface, false);
}

{
  const result = await consumeRemoteMcpGovernedSurface({
    toolName: "list_accessible_workspaces",
    authentication: { user_id: "user-a" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_GOVERNED_SURFACE_CONTRACT_REQUIRED");
}

{
  const result = await consumeRemoteMcpGovernedSurface({
    toolName: "list_accessible_brands",
    toolArguments: { workspace_id: "workspace-a" },
    authentication: { user_id: "user-a" },
    resolveGovernedSurface: async () => ({
      ...baseContract,
      final_authority: {
        decision: "deny",
        allowed: false,
        blockers: [{ code: "TENANT_SCOPE_DENIED", public_message: "Denied" }],
      },
      surface_projection: {
        tool_name: "list_accessible_brands",
        result: { workspace_id: "workspace-a", brands: [] },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_GOVERNED_SURFACE_DENIED");
  assert(result.blockers.some((entry) => entry.code === "TENANT_SCOPE_DENIED"));
}

{
  const result = await consumeRemoteMcpGovernedSurface({
    toolName: "list_accessible_brands",
    toolArguments: { workspace_id: "workspace-a" },
    authentication: { user_id: "user-a" },
    resolveGovernedSurface: async () => ({
      ...baseContract,
      surface_projection: {
        tool_name: "list_accessible_brands",
        result: {
          workspace_id: "workspace-b",
          brands: [{ brand_ref: "brand:other", permission: "view" }],
        },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_SURFACE_BINDING_MISMATCH");
}

{
  let resolverCalled = false;
  const result = await consumeRemoteMcpGovernedSurface({
    toolName: "apply_change",
    resolveGovernedSurface: async () => {
      resolverCalled = true;
      return baseContract;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_WRITE_SURFACE_NOT_ENABLED");
  assert.equal(resolverCalled, false);
}

console.log(JSON.stringify({
  ok: true,
  gate: "remote_mcp_governed_surface_consumer",
  authoritative_contract_required: true,
  readiness_required: true,
  tenant_binding_enforced: true,
  write_surface_disabled: true,
  local_authority_created: false,
  local_connection_selector_created: false,
}));
