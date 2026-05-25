import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { upsertPlatformPluginPolicy } from "./platformPluginPolicy.js";

function makePool({ tenantActive = true, pluginStatus = "active" } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM tenants")) {
        return tenantActive ? [[{ tenant_id: "tenant-1", display_name: "Tenant One", status: "active" }]] : [[]];
      }
      if (sql.includes("FROM app_integrations")) {
        return [[{ app_key: "google_drive", display_name: "Google Drive", status: pluginStatus }]];
      }
      if (sql.includes("INSERT INTO tenant_integration_policies")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM `registry_surfaces_catalog`")) {
        return [[{
          surface_id: "surface.operations_log_unified_sheet",
          logical_surface_key: "surface.operations_log_unified_sheet",
          surface_name: "Execution Log Unified",
          surface_type: "registry",
          surface_scope: "runtime",
          storage_type: "workbook_sheet",
          active_status: "active",
          authority_status: "authoritative",
          required_for_execution: "TRUE",
          resolution_rule: "sql_primary",
          owner_layer: "runtime_audit",
          schema_ref: null,
          schema_version: null,
          binding_mode: "sql_runtime_authority",
          sheet_role: "append_only_log",
          source_surface_id: null,
          source_surface_role: null,
          retired_replacement_surface_id: null,
          backend_type: "sql",
          backend_adapter: "executionEvidenceLogger",
          authority_model: "sql_runtime_authority",
          portability_class: "runtime_evidence",
          repair_candidate_types: null,
          repair_priority: "medium",
          updated_at: "2026-05-25T00:00:00.000Z",
        }]];
      }
      if (sql.includes("FROM tenant_integration_policies")) {
        return [[{
          tenant_id: "tenant-1",
          app_key: "google_drive",
          source_mode: "managed",
          fallback_allowed: 1,
          required_for_device_install: 0,
          notes: "managed Google Drive overlay",
          status: "active",
          source: "platform_plugin_policy_upsert",
          created_by: "user-1",
          updated_by: "user-1",
          created_at: "2026-05-25T00:00:00.000Z",
          updated_at: "2026-05-25T00:00:00.000Z",
        }]];
      }
      if (sql.includes("INSERT INTO execution_log")) {
        return [{ insertId: 42, affectedRows: 1 }];
      }
      if (sql.includes("FROM execution_log")) {
        return [[{ id: 42, execution_status: "success", execution_trace_id_writeback: params[0] }]];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await upsertPlatformPluginPolicy({
    pool,
    tenantId: "tenant-1",
    pluginKey: "google_drive",
    sourceMode: "managed",
    fallbackAllowed: true,
    requiredForDeviceInstall: false,
    notes: "managed Google Drive overlay",
    userId: "user-1",
    rawPayload: { tenant_id: "tenant-1", plugin_key: "google_drive", source_mode: "managed" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.policy.plugin_key, "google_drive");
  assert.equal(result.policy.source_mode, "managed");
  assert.equal(result.policy.fallback_allowed, true);
  assert.equal(result.readback.ok, true);
  assert.equal(result.execution_log.ok, true);
  assert.equal(result.secrets_included, false);
  assert(pool.calls.some((call) => call.sql.includes("INSERT INTO tenant_integration_policies")), "policy upsert must write tenant overlay");
  assert(pool.calls.some((call) => call.sql.includes("INSERT INTO execution_log")), "policy upsert must write execution evidence");
}

{
  const pool = makePool();
  await assert.rejects(
    () => upsertPlatformPluginPolicy({
      pool,
      tenantId: "tenant-1",
      pluginKey: "google_drive",
      rawPayload: { api_token: "secret" },
    }),
    /Secrets are not accepted/
  );
}

{
  const pool = makePool({ tenantActive: false });
  await assert.rejects(
    () => upsertPlatformPluginPolicy({ pool, tenantId: "tenant-1", pluginKey: "google_drive" }),
    /Active tenant not found/
  );
}

{
  const pool = makePool({ pluginStatus: "deprecated" });
  await assert.rejects(
    () => upsertPlatformPluginPolicy({ pool, tenantId: "tenant-1", pluginKey: "google_drive" }),
    /not active or beta/
  );
}

{
  const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
  assert(routes.includes("/platform/plugins/install-policy"), "policy upsert route must be mounted");
  assert(routes.includes("upsertPlatformPluginPolicy"), "policy route must call policy service");
  const migration = readFileSync("migrations/121_sprint64_platform_plugin_policy_upsert_tool.sql", "utf8");
  assert(migration.includes("platform_plugin_policy_upsert"), "tool registry migration must register policy upsert tool");
  assert(migration.includes("no_secrets"), "policy upsert tool must be tagged no_secrets");
}

console.log("platform plugin policy tests passed");
