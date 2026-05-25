import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activatePrivatePlatformPluginContribution,
  resolvePrivatePlatformPluginContribution,
} from "./platformPluginContribution.js";

const baseContributionRow = {
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
  manifest_json: '{"description":"CRM draft"}',
  protocol_bindings_json: '[{"protocol":"rest","transport_surface":"tenant_connection"}]',
  action_bindings_json: '[{"action_key":"crm.contact.list","risk_level":"read_only"}]',
  credential_policy_json: '{"allowed_scopes":["tenant_connection"],"fallback_allowed":false}',
  validation_report_json: '{"intake":"accepted","secrets_included":false}',
  notes: "draft contribution",
  created_by: "user-1",
  updated_by: "user-1",
  submitted_at: null,
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
};

function makePool({ privateEnabled = true, ownerTenant = "tenant-1" } = {}) {
  const calls = [];
  let currentPrivateEnabled = privateEnabled;
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("UPDATE platform_plugin_contributions")) {
        currentPrivateEnabled = true;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM platform_plugin_contributions")) {
        return [[{ ...baseContributionRow, private_execution_enabled: currentPrivateEnabled ? 1 : 0, owner_tenant_id: ownerTenant }]];
      }
      if (sql.includes("INSERT INTO execution_log")) return [{ affectedRows: 1, insertId: 44 }];
      if (sql.includes("FROM execution_log")) return [[{ id: 44, execution_status: "success", execution_trace_id_writeback: params[0] }]];
      return [[]];
    },
  };
}

{
  const pool = makePool({ privateEnabled: false });
  const result = await activatePrivatePlatformPluginContribution({
    pool,
    contributionId: "contrib-1",
    tenantId: "tenant-1",
    userId: "user-1",
    notes: "owner accepts private execution risk",
  });
  assert.equal(result.ok, true);
  assert.equal(result.private_runtime.executable_within_owner_scope, true);
  assert.equal(result.private_runtime.promotion_required_for_other_users, true);
  assert.equal(result.private_runtime.platform_base_mutated, false);
  assert.equal(result.execution_log.ok, true);
  assert(pool.calls.some((call) => call.sql.includes("UPDATE platform_plugin_contributions")), "private activation must update contribution only");
}

{
  const pool = makePool({ privateEnabled: true });
  const result = await resolvePrivatePlatformPluginContribution({
    pool,
    contributionId: "contrib-1",
    actionKey: "crm.contact.list",
    tenantId: "tenant-1",
    userId: "user-1",
    requestedCredentialScope: "tenant_connection",
  });
  assert.equal(result.ok, true);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "owner_scoped_private_runtime");
  assert.equal(result.execution.will_execute, true);
  assert.equal(result.execution.promotion_required_for_other_users, true);
  assert.equal(result.execution.platform_base_mutated, false);
  assert.equal(result.secrets_included, false);
}

{
  const pool = makePool({ privateEnabled: true, ownerTenant: "other-tenant" });
  const result = await resolvePrivatePlatformPluginContribution({
    pool,
    contributionId: "contrib-1",
    actionKey: "crm.contact.list",
    tenantId: "tenant-1",
    userId: "user-1",
    requestedCredentialScope: "tenant_connection",
  });
  assert.equal(result.allowed, false);
  assert(result.reason.includes("owner_scope_mismatch"));
}

{
  const pool = makePool({ privateEnabled: true });
  const result = await resolvePrivatePlatformPluginContribution({
    pool,
    contributionId: "contrib-1",
    actionKey: "crm.contact.list",
    tenantId: "tenant-1",
    userId: "user-1",
    requestedCredentialScope: "platform_managed",
  });
  assert.equal(result.allowed, false);
  assert(result.reason.includes("credential_scope_not_allowed_by_contribution_policy"));
}

{
  const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
  assert(routes.includes("/platform/plugins/contributions/activate-private"), "private activation route must be mounted");
  assert(routes.includes("/platform/plugins/contributions/resolve-private"), "private resolver route must be mounted");
  const migration = readFileSync("migrations/126_sprint64_platform_plugin_private_runtime.sql", "utf8");
  assert(migration.includes("private_execution_enabled"), "migration must add private runtime flag");
  assert(migration.includes("platform_plugin_contribution_private_activate"), "migration must register activation tool");
  assert(migration.includes("platform_plugin_contribution_private_resolve"), "migration must register resolver tool");
}

console.log("platform plugin private runtime tests passed");
