import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPlatformPluginCatalog, normalizePlatformPlugin } from "./platformPluginCatalog.js";

function makePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM app_integrations")) {
        return [[
          {
            app_key: "github",
            display_name: "GitHub",
            description: "Repository automation",
            auth_type: "oauth2",
            mcp_server_info: null,
            docs_url: "https://docs.example/github",
            category: "code",
            default_action_grants: '["repo.read"]',
            status: "active",
          },
          {
            app_key: "filesystem.mcp",
            display_name: "Filesystem MCP",
            description: "MCP filesystem access",
            auth_type: "mcp",
            mcp_server_info: "{\"transport\":\"stdio\"}",
            docs_url: null,
            category: "local_device",
            default_action_grants: null,
            status: "beta",
          },
        ]];
      }
      if (sql.includes("FROM app_integration_action_bindings")) {
        return [[
          {
            binding_id: "bind-gh-read",
            app_key: "github",
            action_key: "github.repo.read",
            binding_role: "primary_api",
            credential_source: "user_connection",
            exposure_default: "curated_exports",
            status: "active",
          },
        ]];
      }
      if (sql.includes("FROM app_integration_tool_bindings")) {
        return [[
          {
            binding_id: "tool-mcp-files",
            app_key: "filesystem.mcp",
            tool_key: "connector_files",
            tool_surface: "device_tool",
            binding_role: "read_only",
            credential_source: "device_connector",
            exposure_scope: "tenant",
            status: "active",
          },
        ]];
      }
      if (sql.includes("FROM tenant_integration_policies")) {
        return [[
          {
            tenant_id: "tenant-1",
            app_key: "github",
            source_mode: "dedicated",
            fallback_allowed: 0,
            required_for_device_install: 0,
            status: "active",
            source: "test",
            updated_at: "2026-05-25T00:00:00.000Z",
          },
        ]];
      }
      if (sql.includes("FROM user_app_connections")) {
        return [[
          {
            tenant_id: "tenant-1",
            user_id: "user-1",
            app_key: "github",
            auth_type: "oauth2",
            status: "active",
            validation_status: "validated",
            connection_count: 1,
            last_validated_at: "2026-05-25T00:00:00.000Z",
            last_used_at: "2026-05-25T00:05:00.000Z",
          },
        ]];
      }
      return [[]];
    },
  };
}

{
  const plugin = normalizePlatformPlugin(
    { app_key: "github", display_name: "GitHub", auth_type: "oauth2", category: "code", status: "active" },
    { actionBindings: [{ credential_source: "user_connection" }], toolBindings: [], tenantPolicies: [], userConnectionSummary: [] }
  );
  assert.equal(plugin.plugin_key, "github");
  assert.equal(plugin.source, "platform_preset");
  assert(plugin.protocols.includes("oauth2"));
  assert(plugin.protocols.includes("rest"));
  assert(plugin.credential_resolver_policy.supported_scopes.includes("user_connection"));
  assert.equal(plugin.secrets_included, false);
}

{
  const pool = makePool();
  const catalog = await loadPlatformPluginCatalog({ pool, tenantId: "tenant-1", userId: "user-1", limit: 20 });
  assert.equal(catalog.ok, true);
  assert.equal(catalog.terminology.canonical_name, "Platform Plugin");
  assert.equal(catalog.totals.plugins, 2);
  const github = catalog.plugins.find((plugin) => plugin.plugin_key === "github");
  assert(github, "github plugin should be returned");
  assert.equal(github.tenant_policies[0].source_mode, "dedicated");
  assert.equal(github.tenant_policies[0].fallback_allowed, false);
  assert.equal(github.user_connection_summary[0].validation_status, "validated");
  const mcp = catalog.plugins.find((plugin) => plugin.plugin_key === "filesystem.mcp");
  assert(mcp.protocols.includes("mcp"), "MCP plugins should expose mcp protocol");
  assert(mcp.credential_resolver_policy.supported_scopes.includes("device_connector"));
  assert.equal(catalog.secrets_included, false);
  assert(pool.calls.some((call) => call.sql.includes("tenant_integration_policies")), "tenant overlays should be read when tenant_id is supplied");
  assert(pool.calls.some((call) => call.sql.includes("user_app_connections")), "user connection summary should be read when user_id is supplied");
}

{
  const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
  assert(routes.includes("/platform/plugins/catalog"), "route must expose platform plugin catalog");
  assert(routes.includes("requireAdminPrincipal"), "route must be admin protected");
  const migration = readFileSync("migrations/119_sprint64_platform_plugin_catalog_tool.sql", "utf8");
  assert(migration.includes("platform_plugin_catalog"), "tool registry migration must register the catalog tool");
  assert(migration.includes("read_only"), "catalog tool must be read-only tagged");
}

console.log("platform plugin catalog tests passed");
