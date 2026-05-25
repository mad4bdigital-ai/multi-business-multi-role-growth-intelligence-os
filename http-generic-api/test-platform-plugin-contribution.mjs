import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPlatformPluginContribution,
  getPlatformPluginContribution,
  listPlatformPluginContributions,
} from "./platformPluginContribution.js";

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
  manifest_json: '{"description":"CRM draft"}',
  protocol_bindings_json: '[{"protocol":"rest"}]',
  action_bindings_json: '[{"action_key":"crm.contact.list"}]',
  credential_policy_json: '{"allowed_scopes":["tenant_connection"]}',
  validation_report_json: '{"intake":"accepted","secrets_included":false}',
  notes: "draft contribution",
  created_by: "user-1",
  updated_by: "user-1",
  submitted_at: null,
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
};

function makePool({ existingBase = false, basePluginExists = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM tenants")) return [[{ tenant_id: "tenant-1", status: "active" }]];
      if (sql.includes("FROM users")) return [[{ user_id: "user-1", status: "active" }]];
      if (sql.includes("FROM app_integrations") && sql.includes("app_key = ?")) {
        if (params[0] === "tenant.custom_crm") return existingBase ? [[{ app_key: "tenant.custom_crm" }]] : [[]];
        if (params[0] === "github") return basePluginExists ? [[{ app_key: "github" }]] : [[]];
        return [[]];
      }
      if (sql.includes("INSERT INTO platform_plugin_contributions")) return [{ affectedRows: 1 }];
      if (sql.includes("FROM platform_plugin_contributions") && sql.includes("contribution_id = ?")) return [[contributionRow]];
      if (sql.includes("FROM platform_plugin_contributions")) return [[contributionRow]];
      if (sql.includes("INSERT INTO execution_log")) return [{ affectedRows: 1, insertId: 43 }];
      if (sql.includes("FROM execution_log")) return [[{ id: 43, execution_status: "success", execution_trace_id_writeback: params[0] }]];
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await createPlatformPluginContribution({
    pool,
    tenantId: "tenant-1",
    userId: "user-1",
    ownerScope: "tenant",
    pluginKey: "tenant.custom_crm",
    displayName: "Tenant Custom CRM",
    pluginType: "rest_api",
    manifest: { description: "CRM draft" },
    protocolBindings: [{ protocol: "rest" }],
    actionBindings: [{ action_key: "crm.contact.list" }],
    credentialPolicy: { allowed_scopes: ["tenant_connection"] },
    notes: "draft contribution",
    rawPayload: { plugin_key: "tenant.custom_crm", display_name: "Tenant Custom CRM" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.contribution.plugin_key, "tenant.custom_crm");
  assert.equal(result.contribution.owner_scope, "tenant");
  assert.equal(result.execution_log.ok, true);
  assert.equal(result.secrets_included, false);
  assert(pool.calls.some((call) => call.sql.includes("INSERT INTO platform_plugin_contributions")), "contribution must be inserted");
  assert(pool.calls.some((call) => call.sql.includes("INSERT INTO execution_log")), "contribution creation must write execution evidence");
}

{
  const pool = makePool();
  const list = await listPlatformPluginContributions({ pool, tenantId: "tenant-1", limit: 10 });
  assert.equal(list.ok, true);
  assert.equal(list.count, 1);
  assert.equal(list.contributions[0].plugin_key, "tenant.custom_crm");
  const get = await getPlatformPluginContribution({ pool, contributionId: "contrib-1" });
  assert.equal(get.ok, true);
  assert.equal(get.contribution.contribution_id, "contrib-1");
}

{
  const pool = makePool();
  await assert.rejects(
    () => createPlatformPluginContribution({
      pool,
      tenantId: "tenant-1",
      userId: "user-1",
      pluginKey: "tenant.custom_crm",
      displayName: "Tenant Custom CRM",
      rawPayload: { credentials: { api_token: "secret" } },
    }),
    /Secrets are not accepted/
  );
}

{
  const pool = makePool({ existingBase: true });
  await assert.rejects(
    () => createPlatformPluginContribution({
      pool,
      tenantId: "tenant-1",
      userId: "user-1",
      pluginKey: "tenant.custom_crm",
      displayName: "Tenant Custom CRM",
    }),
    /already exists in Platform Base/
  );
}

{
  const pool = makePool({ basePluginExists: false });
  await assert.rejects(
    () => createPlatformPluginContribution({
      pool,
      tenantId: "tenant-1",
      userId: "user-1",
      pluginKey: "tenant.github_variant",
      displayName: "Tenant GitHub Variant",
      basePluginKey: "github",
    }),
    /base_plugin_key does not exist/
  );
}

{
  const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
  assert(routes.includes("/platform/plugins/contributions"), "contribution routes must be mounted");
  assert(routes.includes("createPlatformPluginContribution"), "route must call contribution service");
  const migration = readFileSync("migrations/125_sprint64_platform_plugin_contributions.sql", "utf8");
  assert(migration.includes("platform_plugin_contributions"), "migration must create contribution table");
  assert(migration.includes("platform_plugin_contribution_create"), "migration must register contribution create tool");
  assert(migration.includes("no_secrets"), "contribution tools must be tagged no_secrets");
}

console.log("platform plugin contribution tests passed");
