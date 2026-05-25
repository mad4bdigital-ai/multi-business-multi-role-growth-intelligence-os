import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installPlatformPluginForTenant } from "./platformPluginInstall.js";

function makePool({ existingConnection = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM app_integrations")) return [[{ app_key: "tenant.nagy_sample_crm_20260525", display_name: "Nagy Sample CRM Plugin", auth_type: "api_key", status: "beta" }]];
      if (sql.includes("FROM tenants")) return [[{ tenant_id: "tenant-1", display_name: "Tenant One", status: "active" }]];
      if (sql.includes("INSERT INTO tenant_integration_policies")) return [{ affectedRows: 1 }];
      if (sql.includes("FROM tenant_integration_policies")) return [[{ tenant_id: "tenant-1", app_key: "tenant.nagy_sample_crm_20260525", source_mode: "dedicated", fallback_allowed: 0, required_for_device_install: 0, notes: "install", status: "active", source: "platform_plugin_tenant_install", updated_at: "2026-05-25T00:00:00.000Z" }]];
      if (sql.includes("FROM user_app_connections")) return existingConnection ? [[{ connection_id: "conn-existing" }]] : [[]];
      if (sql.includes("INSERT INTO user_app_connections")) return [{ affectedRows: 1 }];
      if (sql.includes("UPDATE user_app_connections")) return [{ affectedRows: 1 }];
      if (sql.includes("INSERT INTO execution_log")) return [{ affectedRows: 1, insertId: 47 }];
      if (sql.includes("FROM execution_log")) return [[{ id: 47, execution_status: "success", execution_trace_id_writeback: params[0] }]];
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await installPlatformPluginForTenant({
    pool,
    tenantId: "tenant-1",
    userId: "user-1",
    pluginKey: "tenant.nagy_sample_crm_20260525",
    sourceMode: "dedicated",
    fallbackAllowed: false,
    notes: "install",
    connection: {
      connection_scope: "tenant_connection",
      api_base_url: "https://example.com",
      account_label: "CRM metadata only",
      account_metadata: { region: "test" },
    },
    rawPayload: { plugin_key: "tenant.nagy_sample_crm_20260525", connection: { api_base_url: "https://example.com" } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.plugin.status, "beta");
  assert.equal(result.install.tenant_policy.source_mode, "dedicated");
  assert.equal(result.install.connection.created, true);
  assert.equal(result.execution_log.ok, true);
  assert.equal(result.secrets_included, false);
  assert(pool.calls.some((call) => call.sql.includes("INSERT INTO tenant_integration_policies")), "install must write tenant policy");
  assert(pool.calls.some((call) => call.sql.includes("INSERT INTO user_app_connections")), "install may write no-secret connection metadata");
}

{
  const pool = makePool({ existingConnection: true });
  const result = await installPlatformPluginForTenant({
    pool,
    tenantId: "tenant-1",
    userId: "user-1",
    pluginKey: "tenant.nagy_sample_crm_20260525",
    connection: { connection_scope: "tenant_connection", api_base_url: "https://example.com" },
  });
  assert.equal(result.install.connection.updated, true);
  assert(pool.calls.some((call) => call.sql.includes("UPDATE user_app_connections")), "existing metadata connection must be updated");
}

{
  const pool = makePool();
  await assert.rejects(
    () => installPlatformPluginForTenant({
      pool,
      tenantId: "tenant-1",
      userId: "user-1",
      pluginKey: "tenant.nagy_sample_crm_20260525",
      rawPayload: { connection: { api_token: "secret" } },
    }),
    /Secrets are not accepted/
  );
}

{
  const pool = makePool();
  await assert.rejects(
    () => installPlatformPluginForTenant({
      pool,
      tenantId: "tenant-1",
      userId: "user-1",
      pluginKey: "tenant.nagy_sample_crm_20260525",
      connection: { connection_scope: "tenant_connection", api_base_url: "http://example.com" },
    }),
    /HTTPS/
  );
}

{
  const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
  assert(routes.includes("/platform/plugins/install"), "install route must be mounted");
  assert(routes.includes("installPlatformPluginForTenant"), "install route must call install service");
  const migration = readFileSync("migrations/129_sprint64_platform_plugin_tenant_install.sql", "utf8");
  assert(migration.includes("platform_plugin_install"), "install tool must be registered");
  assert(migration.includes("no_secrets"), "install tool must be tagged no_secrets");
}

console.log("platform plugin install tests passed");
