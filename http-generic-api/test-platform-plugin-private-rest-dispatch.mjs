import assert from "node:assert/strict";
import { dispatchPrivatePlatformPluginRestAction } from "./platformPluginPrivateRestDispatch.js";

const contributionRow = {
  contribution_id: "contrib-1",
  plugin_key: "tenant.custom_crm",
  display_name: "Tenant Custom CRM",
  plugin_type: "rest_api",
  owner_scope: "tenant",
  owner_tenant_id: "tenant-1",
  owner_user_id: "user-1",
  target: "tenant_private",
  base_plugin_key: null,
  status: "draft",
  certification_status: "not_started",
  private_execution_enabled: 1,
  private_activated_at: "2026-05-25T00:00:00.000Z",
  manifest_json: '{}',
  protocol_bindings_json: '[{"protocol":"rest"}]',
  action_bindings_json: '[{"action_key":"crm.contact.list","risk_level":"read_only","method":"GET","path":"/contacts"}]',
  credential_policy_json: '{"allowed_scopes":["tenant_connection"],"fallback_allowed":false}',
  validation_report_json: '{"intake":"accepted","secrets_included":false}',
  notes: "draft contribution",
  created_by: "user-1",
  updated_by: "user-1",
  submitted_at: null,
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
};

function makePool({ baseUrl = "https://api.example.com" } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM platform_plugin_contributions")) return [[contributionRow]];
      if (sql.includes("FROM user_app_connections")) return [[{
        connection_id: "conn-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        app_key: "tenant.custom_crm",
        auth_type: "api_key",
        status: "active",
        validation_status: "validated",
        api_base_url: baseUrl,
        account_metadata: '{"allowed_scopes":["tenant_connection"]}',
        is_primary: 1,
      }]];
      if (sql.includes("UPDATE user_app_connections")) return [{ affectedRows: 1 }];
      if (sql.includes("INSERT INTO execution_log")) return [{ affectedRows: 1, insertId: 45 }];
      if (sql.includes("FROM execution_log")) return [[{ id: 45, execution_status: "success", execution_trace_id_writeback: params[0] }]];
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await dispatchPrivatePlatformPluginRestAction({
    pool,
    contributionId: "contrib-1",
    actionKey: "crm.contact.list",
    tenantId: "tenant-1",
    userId: "user-1",
    requestedCredentialScope: "tenant_connection",
    dryRun: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "dry_run");
  assert.equal(result.request.url_origin, "https://api.example.com");
  assert.equal(result.execution_log.ok, true);
  assert.equal(result.secrets_included, false);
}

{
  const pool = makePool({ baseUrl: "http://api.example.com" });
  const result = await dispatchPrivatePlatformPluginRestAction({
    pool,
    contributionId: "contrib-1",
    actionKey: "crm.contact.list",
    tenantId: "tenant-1",
    userId: "user-1",
    requestedCredentialScope: "tenant_connection",
    dryRun: true,
  });
  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "https_required");
}

{
  const pool = makePool({ baseUrl: "https://127.0.0.1" });
  const result = await dispatchPrivatePlatformPluginRestAction({
    pool,
    contributionId: "contrib-1",
    actionKey: "crm.contact.list",
    tenantId: "tenant-1",
    userId: "user-1",
    requestedCredentialScope: "tenant_connection",
    dryRun: true,
  });
  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "blocked_host");
}

console.log("platform plugin private REST dispatch tests passed");
