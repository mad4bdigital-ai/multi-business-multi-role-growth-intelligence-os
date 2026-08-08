import assert from "node:assert/strict";
import { loadTenantPlatformPluginOwnershipScopedConnections } from "./platformPluginConnectionOwnership.js";
import { resolvePlatformPluginExecution } from "./platformPluginResolver.js";

function brandConnection(id = "conn-brand-1") {
  return {
    connection_id: id,
    tenant_id: "tenant-1",
    app_key: "github",
    auth_type: "oauth2",
    status: "active",
    validation_status: "validated",
    last_validated_at: "2026-08-08T12:00:00.000Z",
    last_used_at: null,
    is_primary: 1,
    workspace_id: "workspace-brand-1",
    owner_scope_type: "brand",
    owner_scope_ref: "brand-1",
    brand_id: "brand-1",
    ownership_status: "active",
    ownership_resolution_status: "classified",
    access_token: `secret-${id}`,
  };
}

function makePool({ membershipRole = "owner", grantPermissions = [], connectionRows = [brandConnection()] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const statement = String(sql);
      calls.push({ sql: statement, params });

      if (statement.includes("FROM app_integrations")) {
        return [[{
          app_key: "github",
          display_name: "GitHub",
          description: "Repository automation",
          auth_type: "oauth2",
          mcp_server_info: null,
          docs_url: "https://docs.example/github",
          category: "code",
          default_action_grants: '[{"action_key":"github.repo.read","auto_approve":true}]',
          status: "active",
        }]];
      }
      if (statement.includes("FROM app_integration_action_bindings")) {
        return [[{
          binding_id: "bind-github-read",
          app_key: "github",
          action_key: "github.repo.read",
          binding_role: "primary_api",
          credential_source: "mixed",
          exposure_default: "curated_exports",
          status: "active",
          notes: null,
        }]];
      }
      if (statement.includes("FROM app_integration_tool_bindings")) return [[]];
      if (statement.includes("FROM tenant_integration_policies")) {
        return [[{
          tenant_id: "tenant-1",
          app_key: "github",
          source_mode: "dedicated",
          fallback_allowed: 0,
          required_for_device_install: 0,
          status: "active",
          source: "test",
        }]];
      }
      if (statement.includes("FROM workspace_registry")) {
        return [[{
          workspace_id: "workspace-brand-1",
          tenant_id: "tenant-1",
          workspace_type: "brand",
          workspace_ownership_type: "company",
          owner_user_id: null,
          linked_brand_key: "brand-1",
          bootstrap_status: "ready",
          ownership_revision: 12,
        }]];
      }
      if (statement.includes("FROM memberships")) {
        if (!membershipRole) return [[]];
        return [[{
          user_id: "user-1",
          tenant_id: "tenant-1",
          role: membershipRole,
          status: "active",
        }]];
      }
      if (statement.includes("FROM v_workspace_resource_grant_effective")) {
        return [grantPermissions.map((permission, index) => ({
          grant_id: `brand-grant-${index + 1}`,
          tenant_id: "tenant-1",
          grantee_user_id: "user-1",
          resource_ref: "brand-1",
          permission,
          grant_status: "active",
          membership_role: membershipRole,
        }))];
      }
      if (statement.includes("FROM v_context_kernel_connection_ownership_compatibility")) {
        return [connectionRows];
      }
      if (statement.includes("FROM v_effective_agent_skill_grants")) {
        return [[{ grant_id: "skill-grant-1", skill_key: "code.repository_automation" }]];
      }
      if (statement.includes("FROM platform_plugin_smoke_certifications")) {
        return [[{
          certification_id: "smoke-cert-1",
          mock_provider: "github",
          mock_resource: "repository",
          expected_origin: "https://example.invalid",
          url_origin: "https://example.invalid",
          url_path: "/repository",
          http_method: "GET",
          last_smoke_status: "success",
          last_response_status: 200,
          last_response_ok: 1,
          last_smoke_execution_log_id: 1,
          last_smoke_trace_id: "trace-1",
          certified_at: "2026-08-08T12:00:00.000Z",
          certification_expires_at: null,
          certification_status: "certified",
        }]];
      }
      if (statement.includes("FROM app_action_grants")) return [[]];
      return [[]];
    },
  };
}

{
  const pool = makePool({ membershipRole: "owner" });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "workspace-brand-1",
    userId: "user-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.credential_scope, "tenant_connection");
  assert.equal(result.owner_scope_type, "brand");
  assert.equal(result.owner_scope_ref, "brand-1");
  assert.equal(result.brand_connections_included, true);
  assert.equal(result.brand_authority_source, "tenant_owner_membership");
  assert.equal(result.connections.length, 1);
  assert.equal(result.connections[0].connection_id, "conn-brand-1");
  assert.equal(result.connections[0].user_id, null);
  assert.equal(JSON.stringify(result).includes("secret-conn-brand-1"), false);

  const scopedCall = pool.calls.find((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility"));
  assert.deepEqual(scopedCall.params, ["tenant-1", "workspace-brand-1", "github", "brand-1", "brand-1"]);
  assert.match(scopedCall.sql, /owner_scope_type = 'brand'/);
  assert.match(scopedCall.sql, /BINARY v\.owner_scope_ref <=> BINARY \?/);
  assert.match(scopedCall.sql, /BINARY v\.brand_id <=> BINARY \?/);
}

{
  const pool = makePool({ membershipRole: "viewer", grantPermissions: [] });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "workspace-brand-1",
    userId: "user-1",
  });

  assert.equal(result.ok, false);
  assert.equal(result.denial_code, "BRAND_CONNECTION_AUTHORITY_REQUIRED");
  assert.equal(result.row_count, 0);
  assert.equal(result.secrets_included, false);
  assert.equal(pool.calls.some((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility")), false);
}

{
  const pool = makePool({ membershipRole: "viewer", grantPermissions: ["operate"] });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "workspace-brand-1",
    userId: "user-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.brand_authority_source, "workspace_resource_grant");
  assert.equal(result.owner_scope_type, "brand");
  assert.equal(result.owner_scope_ref, "brand-1");
  assert.equal(result.connections[0].connection_id, "conn-brand-1");
}

{
  const pool = makePool({
    membershipRole: "owner",
    connectionRows: [brandConnection("conn-brand-a"), brandConnection("conn-brand-b")],
  });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    workspaceId: "workspace-brand-1",
    userId: "user-1",
    agentId: "agent-1",
    principalClass: "tenant",
    decisionTraceWriter: null,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.execution.will_execute, false);
  assert.equal(result.connection_ownership_resolution.owner_scope_type, "brand");
  assert.equal(result.connection_ownership_resolution.brand_connections_included, true);
  assert.equal(result.credential_resolution.resolution_state, "ambiguous");
  assert.equal(result.credential_resolution.denial_code, "AMBIGUOUS_CONNECTION_SELECTION");
  assert.equal(result.credential_resolution.ambiguous_scope, "tenant_connection");
  assert.equal(result.credential_resolution.candidate_count, 2);
  assert.equal(Object.hasOwn(result.credential_resolution, "connection_id"), false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("conn-brand-a"), false);
  assert.equal(serialized.includes("conn-brand-b"), false);
  assert.equal(serialized.includes("secret-conn-brand-a"), false);
  assert.equal(serialized.includes("secret-conn-brand-b"), false);
}

console.log("platform plugin brand connection ownership regression passed");
