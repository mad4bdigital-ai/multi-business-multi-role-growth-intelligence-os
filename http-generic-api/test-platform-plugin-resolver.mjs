import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePlatformPluginExecution } from "./platformPluginResolver.js";

function makePool({
  withConnection = true,
  withSkill = true,
  tenantDedicated = false,
  withActionGrant = false,
  runtimeOnly = false,
  withSmokeCertification = true,
  withToolBinding = false,
  toolSurface = "admin_platform_tool",
  toolExposureScope = "admin",
  validationStatus = "validated",
  credentialSource = "user_connection",
  authType = "oauth2",
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
          credential_source: "user_connection",
          exposure_default: runtimeOnly ? "runtime_only" : "curated_exports",
          status: "active",
          notes: null,
        }]];
      }
      if (sql.includes("FROM app_integration_tool_bindings")) {
        return withToolBinding ? [[{
          binding_id: "bind-credential-status-tool",
          app_key: "github",
          tool_key: "credential_effective_status",
          tool_surface: toolSurface,
          binding_role: "state_changing",
          credential_source: "user_connection",
          exposure_scope: toolExposureScope,
          status: "active",
          notes: null,
        }]] : [[]];
      }
      if (sql.includes("FROM tenant_integration_policies")) {
        return tenantDedicated ? [[{
          tenant_id: "tenant-1",
          app_key: "github",
          source_mode: "dedicated",
          fallback_allowed: 0,
          required_for_device_install: 0,
          status: "active",
          source: "test",
        }]] : [[]];
      }
      if (sql.includes("FROM user_app_connections")) {
        return withConnection ? [[{
          connection_id: "conn-1",
          tenant_id: "tenant-1",
          user_id: "user-1",
          app_key: "github",
          auth_type: "oauth2",
          status: "active",
          validation_status: validationStatus,
          last_validated_at: "2026-05-25T00:00:00.000Z",
          last_used_at: null,
          is_primary: 1,
        }]] : [[]];
      }
      if (sql.includes("FROM agent_skill_grants")) {
        return withSkill ? [[{
          grant_id: "skill-grant-1",
          skill_key: "code.repository_automation",
        }]] : [[]];
      }
      if (sql.includes("FROM app_action_grants")) {
        return withActionGrant ? [[{
          grant_id: "action-grant-1",
          grant_mode: "explicit",
          agent_id: null,
          expires_at: null,
        }]] : [[]];
      }
      if (sql.includes("FROM platform_plugin_smoke_certifications")) {
        return withSmokeCertification ? [[{
          certification_id: "smoke-cert-1",
          mock_provider: "crm",
          mock_resource: "contacts",
          expected_origin: "https://auth.mad4b.com",
          url_origin: "https://auth.mad4b.com",
          url_path: "/platform/mock-providers/crm/contacts",
          http_method: "GET",
          last_smoke_status: "success",
          last_response_status: 200,
          last_response_ok: 1,
          last_smoke_execution_log_id: 14132,
          last_smoke_trace_id: "trace-smoke-1",
          certified_at: "2026-05-27T12:26:50.000Z",
          certification_status: "certified",
        }]] : [[]];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool({ withConnection: true, withSkill: true, tenantDedicated: true });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "dispatch_ready");
  assert.equal(result.credential_resolution.credential_source, "user_connection");
  assert.equal(result.credential_lookup.attempted, true);
  assert.equal(result.credential_lookup.authorized, true);
  assert.equal(result.credential_lookup.reason, "authorization_and_scope_gates_passed");
  assert.equal(result.credential_lookup.row_count, 1);
  assert.equal(result.skill_resolution.granted, true);
  assert.equal(result.smoke_certification.certified, true);
  assert.equal(result.smoke_certification.certification.certification_id, "smoke-cert-1");
  assert.equal(result.smoke_certification.certification.last_response_status, 200);
  assert.equal(result.approval.approval_required, false);
  assert.equal(result.execution.will_execute, true);
  assert.equal(result.secrets_included, false);
}

{
  const pool = makePool({ withConnection: true, withSkill: true, tenantDedicated: true, runtimeOnly: true });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "preview_only");
  assert.equal(result.approval.approval_required, true);
  assert.equal(result.approval.grant.granted, false);
  assert.equal(result.execution.will_execute, false);
  assert.equal(result.execution.next_step, "action_grant_required_before_dispatch");
}

{
  const pool = makePool({ withConnection: true, withSkill: true, tenantDedicated: true, runtimeOnly: true, withActionGrant: true });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "dispatch_ready");
  assert.equal(result.approval.approval_required, false);
  assert.equal(result.approval.grant.granted, true);
  assert.equal(result.approval.grant.grant_id, "action-grant-1");
  assert.equal(result.execution.will_execute, true);
  assert.equal(result.execution.next_step, "dispatch_ready");
  assert.equal(result.secrets_included, false);
}

{
  const pool = makePool({ withConnection: true, withSkill: true, tenantDedicated: true, withSmokeCertification: false });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.mode, "preview_only");
  assert(result.reason.includes("smoke_certification_required"));
  assert.equal(result.smoke_certification.required, true);
  assert.equal(result.smoke_certification.certified, false);
  assert.equal(result.execution.will_execute, false);
}

{
  const pool = makePool({ withConnection: false, withSkill: true, tenantDedicated: true });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
  });
  assert.equal(result.allowed, false);
  assert(result.reason.includes("dedicated_connection_required"));
  assert.equal(result.credential_resolution.ok, false);
}

{
  const pool = makePool({ withConnection: true, withSkill: false, tenantDedicated: true });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
  });
  assert.equal(result.allowed, false);
  assert(result.reason.includes("skill_not_granted"));
  assert.equal(result.skill_resolution.granted, false);
  assert.equal(result.credential_lookup.attempted, false);
  assert.equal(result.credential_lookup.reason, "blocked_before_credential_lookup");
  assert.equal(pool.calls.some((call) => call.sql.includes("FROM user_app_connections")), false);
}

{
  const pool = makePool({ withConnection: true, withSkill: true, tenantDedicated: false });
  const result = await resolvePlatformPluginExecution({ pool, pluginKey: "github", actionKey: "github.unknown", tenantId: "tenant-1" });
  assert.equal(result.allowed, false);
  assert(result.reason.includes("action_binding_not_found"));
  assert.equal(result.credential_lookup.attempted, false);
  assert.equal(pool.calls.some((call) => call.sql.includes("FROM user_app_connections")), false);
}

{
  const pool = makePool({ withToolBinding: true });
  await assert.rejects(
    () => resolvePlatformPluginExecution({
      pool,
      pluginKey: "github",
      actionKey: "github.repo.read",
      toolKey: "credential_effective_status",
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      principalClass: "tenant",
    }),
    (err) => err?.code === "ambiguous_capability_selector" && err?.status === 400,
  );
}

{
  const pool = makePool({ withToolBinding: true });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    toolKey: "credential_effective_status",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
    principalClass: "tenant",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.mode, "preview_only");
  assert(result.reason.includes("admin_tool_forbidden"));
  assert(result.reason.includes("tool_canonical_policy_mapping_required"));
  assert.equal(result.credential_lookup.attempted, false);
  assert.equal(result.credential_lookup.reason, "blocked_before_credential_lookup");
  assert.equal(pool.calls.some((call) => call.sql.includes("FROM user_app_connections")), false);
  assert.equal(result.audit.read_model_tables.includes("user_app_connections"), false);
  assert.equal(result.smoke_certification.required, true);
  assert.notEqual(result.smoke_certification.reason, "no_action_requested");
  assert.equal(result.execution.will_execute, false);
}

{
  const pool = makePool({ withConnection: true, withSkill: true, tenantDedicated: true });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
    requestedCredentialScope: "none",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.credential_resolution.ok, false);
  assert.equal(result.credential_resolution.reason, "credential_scope_not_allowed");
  assert.equal(result.execution.will_execute, false);
}

{
  const pool = makePool({
    withConnection: true,
    withSkill: true,
    tenantDedicated: true,
    validationStatus: "pending_validation",
  });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.credential_resolution.ok, false);
  assert.equal(result.credential_resolution.reason, "credential_not_usable");
  assert.equal(result.execution.will_execute, false);
}

{
  const pool = makePool({ withConnection: true, withSkill: true, tenantDedicated: true });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: null,
    agentId: "agent-1",
    principalClass: "tenant",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.principal_scope.ok, false);
  assert.equal(result.principal_scope.reason, "tenant_principal_scope_required");
  assert.equal(result.credential_lookup.attempted, false);
  assert.equal(pool.calls.some((call) => call.sql.includes("FROM user_app_connections")), false);
}

{
  const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
  assert(routes.includes("/platform/plugins/resolve"), "resolver route must be mounted");
  assert(routes.includes("resolvePlatformPluginExecution"), "resolver route must call resolver service");
  assert(routes.includes('principalClass: "admin"'), "admin resolver must pass admin principal class");
  const tenantRoutes = readFileSync("routes/tenantPlatformPluginRoutes.js", "utf8");
  assert(tenantRoutes.includes('principalClass: "tenant"'), "tenant resolver must pass tenant principal class");
  const migration = readFileSync("migrations/120_sprint64_platform_plugin_resolver_tool.sql", "utf8");
  assert(migration.includes("platform_plugin_resolve"), "tool registry migration must register resolver tool");
  assert(migration.includes("preview_only"), "resolver tool must be tagged preview-only");
}

console.log("platform plugin resolver tests passed");
