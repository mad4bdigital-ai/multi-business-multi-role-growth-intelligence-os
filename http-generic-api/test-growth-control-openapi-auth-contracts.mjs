import assert from "node:assert/strict";
import fs from "node:fs/promises";

const [adminOpenApi, tenantOpenApi, routeSource, runtimeGuardSource, adminPrincipalSource] = await Promise.all([
  fs.readFile(new URL("./openapi/growth-control-plane-admin-ui.openapi.yaml", import.meta.url), "utf8"),
  fs.readFile(new URL("./openapi/tenant-growth-control-plane.openapi.yaml", import.meta.url), "utf8"),
  fs.readFile(new URL("./routes/dynamicGrowthControlPlaneRoutes.js", import.meta.url), "utf8"),
  fs.readFile(new URL("./runtimeGuards.js", import.meta.url), "utf8"),
  fs.readFile(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8"),
]);

assert.match(
  adminOpenApi,
  /security:\n  - adminBearerAuth: \[\]\n  - backendApiKeyAuth: \[\]/,
  "Admin bearer and x-api-key transports must remain OpenAPI alternatives",
);
assert.doesNotMatch(
  adminOpenApi,
  /security:\n  - adminBearerAuth: \[\]\n    backendApiKeyAuth: \[\]/,
  "OpenAPI must not require both transports on the same request",
);
assert.match(routeSource, /const requireAdmin = \[requireBackendApiKey, requireAdminPrincipal\]/);
assert.match(runtimeGuardSource, /const headerApiKey = req\.headers\["x-api-key"\]/);
assert.match(runtimeGuardSource, /if \(bearerToken === expected\)/);
assert.match(runtimeGuardSource, /mode: "backend_api_key"/);
assert.match(adminPrincipalSource, /req\.auth\?\.is_admin === true/);

assert.match(tenantOpenApi, /effective tenant role is resolved from\n        authoritative membership readback/);
assert.match(tenantOpenApi, /stale JWT role claim cannot elevate/);
assert.match(tenantOpenApi, /effective role and field profile come from authoritative active\n        membership and workspace authorization readback/);
assert.doesNotMatch(tenantOpenApi, /Tenant, user, and role identity come from the token only/);

console.log("growth control OpenAPI auth contracts passed");
