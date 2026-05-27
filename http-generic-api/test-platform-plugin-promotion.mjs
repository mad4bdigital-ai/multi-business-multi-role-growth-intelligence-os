import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  certifyPlatformPluginContribution,
  promotePlatformPluginContribution,
} from "./platformPluginPromotion.js";

const baseContributionRow = {
  contribution_id: "contrib-1",
  plugin_key: "tenant.custom_crm_promoted",
  display_name: "Tenant Custom CRM Promoted",
  plugin_type: "rest_api",
  owner_scope: "tenant",
  owner_tenant_id: "tenant-1",
  owner_user_id: "user-1",
  target: "platform_base_candidate",
  base_plugin_key: null,
  status: "submitted",
  certification_status: "not_started",
  private_execution_enabled: 1,
  private_activated_at: "2026-05-25T00:00:00.000Z",
  manifest_json: '{"description":"CRM draft","docs_url":"https://docs.example.com/crm"}',
  protocol_bindings_json: '[{"protocol":"rest"}]',
  action_bindings_json: '[{"action_key":"crm.contact.list","risk_level":"read_only","method":"GET","path":"/contacts","credential_source":"tenant_connection"}]',
  credential_policy_json: '{"allowed_scopes":["tenant_connection"],"default_credential_source":"tenant_connection"}',
  validation_report_json: '{"intake":"accepted","secrets_included":false}',
  notes: "draft contribution",
};

function makePool({ existingBase = false, certified = false, smokeCertified = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT app_key FROM app_integrations")) return existingBase ? [[{ app_key: "tenant.custom_crm_promoted" }]] : [[]];
      if (sql.includes("FROM platform_plugin_contributions")) {
        return [[{ ...baseContributionRow, status: certified ? "certified" : baseContributionRow.status, certification_status: certified ? "certified" : baseContributionRow.certification_status }]];
      }
      if (sql.includes("INSERT INTO app_integrations")) return [{ affectedRows: 1, insertId: 10 }];
      if (sql.includes("INSERT INTO app_integration_action_bindings")) return [{ affectedRows: 1, insertId: 20 }];
      if (sql.includes("SELECT app_key, display_name, auth_type, category, status FROM app_integrations")) {
        return [[{ app_key: "tenant.custom_crm_promoted", display_name: "Tenant Custom CRM Promoted", auth_type: "api_key", category: "rest_api", status: "beta" }]];
      }
      if (sql.includes("SELECT action_key, binding_role, credential_source, exposure_default, status FROM app_integration_action_bindings")) {
        return [[{ action_key: "crm.contact.list", binding_role: "primary_api", credential_source: "tenant_connection", exposure_default: "runtime_only", status: "active" }]];
      }
      if (sql.includes("UPDATE platform_plugin_contributions")) return [{ affectedRows: 1 }];
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
      if (sql.includes("INSERT INTO execution_log")) return [{ affectedRows: 1, insertId: 46 }];
      if (sql.includes("FROM execution_log")) return [[{ id: 46, execution_status: "success", execution_trace_id_writeback: params[0] }]];
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await certifyPlatformPluginContribution({ pool, contributionId: "contrib-1", adminUserId: "admin-1", notes: "certify test" });
  assert.equal(result.ok, true);
  assert.equal(result.certification.ok, true);
  assert.equal(result.certification.auth_type, "api_key");
  assert.equal(result.promoted, false);
  assert.equal(result.platform_base_mutated, false);
  assert(pool.calls.some((call) => call.sql.includes("UPDATE platform_plugin_contributions")), "certification must update contribution report");
}

{
  const pool = makePool({ certified: true });
  const result = await promotePlatformPluginContribution({ pool, contributionId: "contrib-1", adminUserId: "admin-1", status: "beta", notes: "promote test" });
  assert.equal(result.ok, true);
  assert.equal(result.promoted, true);
  assert.equal(result.platform_base_mutated, true);
  assert.equal(result.app_integration.app_key, "tenant.custom_crm_promoted");
  assert.equal(result.action_bindings[0].credential_source, "tenant_connection");
  assert(pool.calls.some((call) => call.sql.includes("INSERT INTO app_integrations")), "promotion must insert Platform Base app_integrations row");
  assert(pool.calls.some((call) => call.sql.includes("INSERT INTO app_integration_action_bindings")), "promotion must insert action bindings");
}

{
  const pool = makePool({ certified: false });
  await assert.rejects(
    () => promotePlatformPluginContribution({ pool, contributionId: "contrib-1", adminUserId: "admin-1" }),
    /must be certified/
  );
}

{
  const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
  assert(routes.includes("/platform/plugins/contributions/certify"), "certify route must be mounted");
  assert(routes.includes("/platform/plugins/contributions/promote"), "promote route must be mounted");
  const migration = readFileSync("migrations/128_sprint64_platform_plugin_promotion.sql", "utf8");
  assert(migration.includes("platform_plugin_contribution_certify"), "certify tool must be registered");
  assert(migration.includes("platform_plugin_contribution_promote"), "promote tool must be registered");
}

console.log("platform plugin promotion tests passed");
