import assert from "node:assert/strict";
import {
  _testingPlatformPluginConnectionOwnership,
  loadTenantPlatformPluginOwnershipScopedConnections,
} from "./platformPluginConnectionOwnership.js";
import { resolvePlatformPluginExecution } from "./platformPluginResolver.js";

function ownershipRow({ id = "conn-1", workspaceId = "workspace-1", ownerScopeType = "company_workspace" } = {}) {
  return {
    connection_id: id,
    tenant_id: "tenant-1",
    app_key: "github",
    auth_type: "oauth2",
    status: "active",
    validation_status: "validated",
    last_validated_at: "2026-08-07T12:00:00.000Z",
    last_used_at: null,
    is_primary: 1,
    workspace_id: workspaceId,
    owner_scope_type: ownerScopeType,
    owner_scope_ref: workspaceId,
    brand_id: null,
    ownership_status: "active",
    ownership_resolution_status: "classified",
    access_token: `secret-${id}`,
  };
}

function makeOwnershipPool({
  workspaceOwnershipType = "company",
  workspaceOwnerUserId = null,
  workspaceRows = null,
  connectionRows = [ownershipRow()],
  credentialSource = "mixed",
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM app_integrations")) {
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
      if (sql.includes("FROM app_integration_action_bindings")) {
        return [[{
          binding_id: "bind-github-read",
          app_key: "github",
          action_key: "github.repo.read",
          binding_role: "primary_api",
          credential_source: credentialSource,
          exposure_default: "curated_exports",
          status: "active",
          notes: null,
        }]];
      }
      if (sql.includes("FROM app_integration_tool_bindings")) return [[]];
      if (sql.includes("FROM tenant_integration_policies")) {
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
      if (sql.includes("FROM workspace_registry")) {
        if (Array.isArray(workspaceRows)) return [workspaceRows];
        return [[{
          workspace_id: "workspace-1",
          tenant_id: "tenant-1",
          workspace_ownership_type: workspaceOwnershipType,
          owner_user_id: workspaceOwnerUserId,
          ownership_revision: 7,
        }]];
      }
      if (sql.includes("FROM v_context_kernel_connection_ownership_compatibility")) {
        return [connectionRows];
      }
      if (sql.includes("FROM v_effective_agent_skill_grants")) {
        return [[{ grant_id: "skill-grant-1", skill_key: "code.repository_automation" }]];
      }
      if (sql.includes("FROM platform_plugin_smoke_certifications")) {
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
          certified_at: "2026-08-07T12:00:00.000Z",
          certification_expires_at: null,
          certification_status: "certified",
        }]];
      }
      if (sql.includes("FROM app_action_grants")) return [[]];
      return [[]];
    },
  };
}

{
  const sql = _testingPlatformPluginConnectionOwnership.OWNERSHIP_SCOPED_CONNECTION_SQL;
  assert.match(sql, /v_context_kernel_connection_ownership_compatibility/);
  assert.match(sql, /v\.tenant_id = \?/);
  assert.match(sql, /v\.workspace_id = \?/);
  assert.match(sql, /v\.owner_scope_type = \?/);
  assert.match(sql, /v\.owner_scope_ref = \?/);
  assert.match(sql, /v\.brand_id IS NULL/);
  assert.match(sql, /ownership_resolution_status = 'classified'/);
  assert.match(sql, /connection_owner_user_id/);
  assert.doesNotMatch(sql, /access_token|refresh_token|password|api_key|encrypted_credentials|secret/i);
}

{
  const pool = makeOwnershipPool({
    workspaceOwnershipType: "personal",
    workspaceOwnerUserId: "user-1",
    connectionRows: [ownershipRow({ id: "conn-personal", ownerScopeType: "personal_workspace" })],
  });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.credential_scope, "user_connection");
  assert.equal(result.owner_scope_type, "personal_workspace");
  assert.equal(result.brand_connections_included, false);
  assert.equal(result.connections.length, 1);
  assert.equal(result.connections[0].connection_id, "conn-personal");
  assert.equal(result.connections[0].user_id, "user-1");
  assert.equal(JSON.stringify(result).includes("secret-conn-personal"), false);
  const scopedCall = pool.calls.find((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility"));
  assert.deepEqual(scopedCall.params, [
    "tenant-1", "workspace-1", "github", "personal_workspace", "workspace-1", "personal_workspace", "user-1",
  ]);
}

{
  const pool = makeOwnershipPool({
    workspaceOwnershipType: "personal",
    workspaceOwnerUserId: "other-user",
    connectionRows: [ownershipRow({ id: "conn-forbidden", ownerScopeType: "personal_workspace" })],
  });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.denial_code, "CONNECTION_OWNERSHIP_SCOPE_DENIED");
  assert.equal(result.row_count, 0);
  assert.equal(pool.calls.some((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility")), false);
}

{
  const pool = makeOwnershipPool({
    workspaceOwnershipType: "company",
    connectionRows: [ownershipRow({ id: "conn-company", ownerScopeType: "company_workspace" })],
  });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.credential_scope, "tenant_connection");
  assert.equal(result.owner_scope_type, "company_workspace");
  assert.equal(result.connections[0].user_id, null);
  assert.equal(result.connections[0].workspace_id, "workspace-1");
}

{
  const pool = makeOwnershipPool({ workspaceRows: [] });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "workspace-other",
    userId: "user-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.denial_code, "CONNECTION_OWNERSHIP_SCOPE_DENIED");
  assert.equal(result.row_count, 0);
  assert.equal(result.secrets_included, false);
}

{
  const pool = makeOwnershipPool({ workspaceOwnershipType: "legacy" });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.denial_code, "CONNECTION_OWNERSHIP_SCOPE_DENIED");
}

{
  const pool = makeOwnershipPool({
    workspaceOwnershipType: "company",
    connectionRows: [ownershipRow({ id: "conn-company", ownerScopeType: "company_workspace" })],
  });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    agentId: "agent-1",
    principalClass: "tenant",
    decisionTraceWriter: null,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.execution.will_execute, true);
  assert.equal(result.credential_resolution.credential_source, "tenant_connection");
  assert.equal(result.credential_resolution.connection_id, "conn-company");
  assert.equal(result.credential_lookup.ownership_scoped, true);
  assert.equal(result.connection_ownership_resolution.workspace_ownership_type, "company");
  assert.equal(result.connection_ownership_resolution.owner_scope_type, "company_workspace");
  assert.equal(result.connection_ownership_resolution.brand_connections_included, false);
  assert.equal(result.audit.read_model_tables.includes("v_context_kernel_connection_ownership_compatibility"), true);
  assert.equal(JSON.stringify(result).includes("secret-conn-company"), false);
}

{
  const pool = makeOwnershipPool({
    workspaceOwnershipType: "personal",
    workspaceOwnerUserId: "user-1",
    connectionRows: [ownershipRow({ id: "conn-personal", ownerScopeType: "personal_workspace" })],
  });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    agentId: "agent-1",
    principalClass: "tenant",
    decisionTraceWriter: null,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.credential_resolution.credential_source, "user_connection");
  assert.equal(result.credential_resolution.connection_id, "conn-personal");
}

{
  const pool = makeOwnershipPool({
    workspaceOwnershipType: "company",
    connectionRows: [ownershipRow({ id: "conn-company", ownerScopeType: "company_workspace" })],
  });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    agentId: "agent-1",
    principalClass: "tenant",
    requestedCredentialScope: "user_connection",
    decisionTraceWriter: null,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.execution.will_execute, false);
  assert.equal(result.credential_resolution.resolution_state, "scope_denied");
  assert.equal(result.credential_resolution.denial_code, "CONNECTION_OWNERSHIP_SCOPE_MISMATCH");
  assert.equal(result.credential_resolution.required_credential_scope, "tenant_connection");
  assert.equal(Object.hasOwn(result.credential_resolution, "connection_id"), false);
}

{
  const rows = [
    ownershipRow({ id: "conn-company-a", ownerScopeType: "company_workspace" }),
    ownershipRow({ id: "conn-company-b", ownerScopeType: "company_workspace" }),
  ];
  const pool = makeOwnershipPool({ workspaceOwnershipType: "company", connectionRows: rows });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    agentId: "agent-1",
    principalClass: "tenant",
    decisionTraceWriter: null,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.credential_resolution.denial_code, "AMBIGUOUS_CONNECTION_SELECTION");
  assert.equal(result.credential_resolution.ambiguous_scope, "tenant_connection");
  assert.equal(result.credential_resolution.candidate_count, 2);
  assert.equal(Object.hasOwn(result.credential_resolution, "connection_id"), false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("conn-company-a"), false);
  assert.equal(serialized.includes("conn-company-b"), false);
  assert.equal(serialized.includes("secret-conn-company-a"), false);
  assert.equal(serialized.includes("secret-conn-company-b"), false);
}

console.log("platform plugin connection ownership tests passed");
