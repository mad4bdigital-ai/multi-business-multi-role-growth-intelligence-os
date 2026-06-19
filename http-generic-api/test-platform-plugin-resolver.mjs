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
      if (sql.includes("FROM app_integration_tool_bindings")) return [[]];
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
          validation_status: "validated",
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
}

{
  const pool = makePool({ withConnection: true, withSkill: true, tenantDedicated: false });
  const result = await resolvePlatformPluginExecution({ pool, pluginKey: "github", actionKey: "github.unknown", tenantId: "tenant-1" });
  assert.equal(result.allowed, false);
  assert(result.reason.includes("action_binding_not_found"));
}

{
  const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
  assert(routes.includes("/platform/plugins/resolve"), "resolver route must be mounted");
  assert(routes.includes("resolvePlatformPluginExecution"), "resolver route must call resolver service");
  const migration = readFileSync("migrations/120_sprint64_platform_plugin_resolver_tool.sql", "utf8");
  assert(migration.includes("platform_plugin_resolve"), "tool registry migration must register resolver tool");
  assert(migration.includes("preview_only"), "resolver tool must be tagged preview-only");
}

console.log("platform plugin resolver tests passed");
