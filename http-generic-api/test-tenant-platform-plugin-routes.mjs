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
  const routes = readFileSync("routes/tenantPlatformPluginRoutes.js", "utf8");
  assert(routes.includes("/tenant/platform/plugins/catalog"), "tenant catalog route must be mounted");
  assert(routes.includes("/tenant/platform/plugins/install"), "tenant install route must be mounted");
  assert(routes.includes("/tenant/platform/plugins/resolve"), "tenant resolve route must be mounted");
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
