import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTenantPlatformPluginRoutes } from "./routes/tenantPlatformPluginRoutes.js";
import { createCredentialIntakeSessionRecord } from "./routes/credentialIntakeRoutes.js";

{
  assert.equal(_testingTenantPlatformPluginRoutes.boundedInt("20", 10, 1, 100), 20);
  assert.equal(_testingTenantPlatformPluginRoutes.boundedInt("999", 10, 1, 100), 100);
  assert.equal(_testingTenantPlatformPluginRoutes.bool("true"), true);
  assert.equal(_testingTenantPlatformPluginRoutes.bool("0"), false);
}

{
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM `app_integrations`")) {
        return [[{
          app_key: "github",
          display_name: "GitHub",
          auth_type: "api_key",
          category: "development",
          status: "active",
        }]];
      }
      if (sql.includes("INSERT INTO credential_intake_sessions")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await createCredentialIntakeSessionRecord({
    pool,
    userId: "user-1",
    tenantId: "tenant-1",
    appKey: "github",
    authType: "api_key",
    metadata: { source: "tenant_safe_credential_intake", purpose: "connect repository" },
    expiresInMinutes: 30,
    createdBy: "user-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.app_key, "github");
  assert.equal(result.auth_type, "api_key");
  assert.equal(result.secrets_included, false);
  assert.match(result.intake_url, /^\/credential-intake\//);
  const insert = calls.find((call) => call.sql.includes("INSERT INTO credential_intake_sessions"));
  assert(insert, "credential intake session must be persisted");
  assert.equal(insert.params[2], "user-1");
  assert.equal(insert.params[3], "tenant-1");
  assert.equal(insert.params[4], "github");
  assert.equal(JSON.parse(insert.params[12]).source, "tenant_safe_credential_intake");
}

{
  const pool = {
    async query(sql) {
      if (sql.includes("FROM `app_integrations`")) {
        return [[{ app_key: "disabled_app", auth_type: "api_key", status: "disabled" }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => createCredentialIntakeSessionRecord({
      pool,
      userId: "user-1",
      tenantId: "tenant-1",
      appKey: "disabled_app",
      authType: "api_key",
    }),
    (err) => err?.code === "app_not_active" && err?.status === 409,
  );
}

{
  const routes = readFileSync("routes/tenantPlatformPluginRoutes.js", "utf8");
  assert(routes.includes("/tenant/platform/plugins/catalog"), "tenant catalog route must be mounted");
  assert(routes.includes("/tenant/platform/plugins/install"), "tenant install route must be mounted");
  assert(routes.includes("/tenant/platform/plugins/resolve"), "tenant resolve route must be mounted");
  assert(routes.includes("/tenant/platform/plugins/credential-intake-sessions"), "tenant-safe credential intake route must be mounted");
  assert(routes.includes("tenant_connection_admin_required"), "tenant intake must require owner/admin role");
  assert(routes.includes("tenant_intake_field_not_allowed"), "tenant intake must reject non-allowlisted fields");
  assert(routes.includes("tenant_integration_policies"), "tenant intake must require active tenant plugin policy");
  assert(routes.includes("createCredentialIntakeSessionRecord"), "tenant intake must use shared governed session helper");
  assert(routes.includes("admin_tool_invoked: false"), "tenant intake must not claim raw admin tool dispatch");
  assert(routes.includes("requireTenantUserJwt"), "tenant routes must require user JWT");
  assert(routes.includes("tenantId: req.auth.tenant_id"), "tenant install/resolve must derive tenant_id from auth");
  assert(routes.includes("userId: req.auth.user_id"), "tenant install/resolve must derive user_id from auth");
  assert(!routes.includes("tenantId: input.tenant_id"), "tenant install must not trust body tenant_id");
  assert(!routes.includes("userId: input.user_id"), "tenant install must not trust body user_id");
}

{
  const index = readFileSync("routes/index.js", "utf8");
  assert(index.includes("buildTenantPlatformPluginRoutes"), "tenant Platform Plugin routes must be imported and mounted");
  const tenantMount = index.indexOf("app.use(buildTenantPlatformPluginRoutes())");
  const adminMount = index.indexOf("app.use(buildPlatformPluginRoutes");
  assert(tenantMount !== -1, "tenant Platform Plugin routes must be mounted");
  assert(adminMount !== -1, "admin Platform Plugin routes must be mounted");
  assert(tenantMount < adminMount, "tenant routes should mount before admin platform plugin routes");
}

console.log("tenant platform plugin route tests passed");
