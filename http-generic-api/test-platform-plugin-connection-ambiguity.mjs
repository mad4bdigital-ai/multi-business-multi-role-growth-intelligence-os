import assert from "node:assert/strict";
import { resolvePlatformPluginExecution } from "./platformPluginResolver.js";

function makeConnection({
  connectionId,
  userId = "user-1",
  tenantId = "tenant-1",
  secret = null,
} = {}) {
  return {
    connection_id: connectionId,
    tenant_id: tenantId,
    user_id: userId,
    app_key: "github",
    auth_type: "oauth2",
    status: "active",
    validation_status: "validated",
    last_validated_at: "2026-08-07T00:00:00.000Z",
    last_used_at: null,
    is_primary: 1,
    ...(secret ? { access_token: secret, refresh_token: `${secret}-refresh` } : {}),
  };
}

function makePool({ connections = [], credentialSource = "mixed" } = {}) {
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
      if (sql.includes("FROM user_app_connections")) return [connections];
      if (sql.includes("FROM v_effective_agent_skill_grants")) {
        return [[{ grant_id: "skill-grant-1", skill_key: "code.repository_automation" }]];
      }
      if (sql.includes("FROM platform_plugin_smoke_certifications")) {
        return [[{
          certification_id: "smoke-cert-1",
          mock_provider: "github",
          mock_resource: "repo",
          expected_origin: "https://api.github.com",
          url_origin: "https://api.github.com",
          url_path: "/repos/example/example",
          http_method: "GET",
          last_smoke_status: "success",
          last_response_status: 200,
          last_response_ok: 1,
          last_smoke_execution_log_id: 1,
          last_smoke_trace_id: "trace-smoke-1",
          certified_at: "2026-08-07T00:00:00.000Z",
          certification_status: "certified",
        }]];
      }
      return [[]];
    },
  };
}

async function resolveWith({ connections, credentialSource = "mixed" }) {
  const pool = makePool({ connections, credentialSource });
  const result = await resolvePlatformPluginExecution({
    pool,
    pluginKey: "github",
    actionKey: "github.repo.read",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
    principalClass: "tenant",
    decisionTraceWriter: async () => ({
      evidence_id: "test-evidence",
      evidence_sha256: "test-sha256",
    }),
  });
  return { pool, result };
}

function assertAmbiguous({ result, scope, forbiddenValues = [] }) {
  assert.equal(result.allowed, false);
  assert.equal(result.mode, "preview_only");
  assert.equal(result.credential_resolution.ok, false);
  assert.equal(result.credential_resolution.reason, "connection_selection_ambiguous");
  assert.equal(result.credential_resolution.denial_code, "AMBIGUOUS_CONNECTION_SELECTION");
  assert.equal(result.credential_resolution.resolution_state, "ambiguous");
  assert.equal(result.credential_resolution.usability_state, "not_evaluated");
  assert.equal(result.credential_resolution.credential_source, null);
  assert.equal(result.credential_resolution.ambiguous_scope, scope);
  assert.equal(result.credential_resolution.candidate_count, 2);
  assert.equal(Object.hasOwn(result.credential_resolution, "connection_id"), false);
  assert.equal(Object.hasOwn(result.credential_resolution, "connection_status"), false);
  assert.equal(Object.hasOwn(result.credential_resolution, "validation_status"), false);
  assert(result.security_decision.denied_gates.includes("credential"));
  assert.equal(result.execution.will_execute, false);
  assert.equal(result.secrets_included, false);
  assert.equal(result.credential_lookup.secrets_included, false);
  const serialized = JSON.stringify(result);
  for (const value of forbiddenValues) assert.equal(serialized.includes(value), false);
}

{
  const rows = [
    makeConnection({ connectionId: "conn-user-a", secret: "secret-user-a" }),
    makeConnection({ connectionId: "conn-user-b", secret: "secret-user-b" }),
  ];
  const forward = await resolveWith({ connections: rows });
  const reversed = await resolveWith({ connections: [...rows].reverse() });
  assertAmbiguous({
    result: forward.result,
    scope: "user_connection",
    forbiddenValues: ["conn-user-a", "conn-user-b", "secret-user-a", "secret-user-b"],
  });
  assertAmbiguous({
    result: reversed.result,
    scope: "user_connection",
    forbiddenValues: ["conn-user-a", "conn-user-b", "secret-user-a", "secret-user-b"],
  });
  assert.deepEqual(forward.result.credential_resolution, reversed.result.credential_resolution);
  const connectionQuery = forward.pool.calls.find((call) => call.sql.includes("FROM user_app_connections"));
  assert(connectionQuery);
  assert.deepEqual(connectionQuery.params, ["github", "tenant-1", "user-1"]);
  assert.doesNotMatch(connectionQuery.sql, /access_token|refresh_token|password|api_key|secret/i);
}

{
  const tenantRows = [
    makeConnection({ connectionId: "conn-tenant-a", userId: null, secret: "secret-tenant-a" }),
    makeConnection({ connectionId: "conn-tenant-b", userId: null, secret: "secret-tenant-b" }),
  ];
  const { result } = await resolveWith({ connections: tenantRows });
  assertAmbiguous({
    result,
    scope: "tenant_connection",
    forbiddenValues: ["conn-tenant-a", "conn-tenant-b", "secret-tenant-a", "secret-tenant-b"],
  });
}

{
  const only = makeConnection({ connectionId: "conn-only" });
  const { result } = await resolveWith({ connections: [only], credentialSource: "user_connection" });
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "dispatch_ready");
  assert.equal(result.credential_resolution.ok, true);
  assert.equal(result.credential_resolution.resolution_state, "resolved");
  assert.equal(result.credential_resolution.credential_source, "user_connection");
  assert.equal(result.credential_resolution.connection_id, "conn-only");
  assert.equal(result.execution.will_execute, true);
}

{
  const { result } = await resolveWith({ connections: [], credentialSource: "user_connection" });
  assert.equal(result.allowed, false);
  assert.equal(result.credential_resolution.ok, false);
  assert.equal(result.credential_resolution.reason, "dedicated_connection_required");
  assert.equal(result.credential_resolution.denial_code, "DEDICATED_CONNECTION_REQUIRED");
  assert.equal(result.credential_resolution.resolution_state, "missing");
  assert.equal(result.execution.will_execute, false);
}

console.log("platform plugin connection ambiguity tests passed");
