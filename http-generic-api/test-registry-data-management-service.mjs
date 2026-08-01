import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingRegistryDataManagementService } from "./registryDataManagementService.js";
import { _testingRegistryDataManagementRoutes } from "./routes/registryDataManagementRoutes.js";

const serviceSource = readFileSync("registryDataManagementService.js", "utf8");
const routeSource = readFileSync("routes/registryDataManagementRoutes.js", "utf8");
const indexSource = readFileSync("routes/index.js", "utf8");
const migration = readFileSync("migrations/20260703_registry_data_management.sql", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

assert.equal(_testingRegistryDataManagementService.containsSecretLikeColumn("application_password"), true);
assert.equal(_testingRegistryDataManagementService.containsSecretLikeColumn("metadata_json"), false);
assert.deepEqual(_testingRegistryDataManagementService.asArray('["admin","tenant"]'), ["admin", "tenant"]);

const normalized = _testingRegistryDataManagementService.normalizeTableRegistration({
  table_key: "workspace_assets",
  enabled_surfaces_json: '["tenant"]',
  allowed_operations_json: '["list","create"]',
  primary_key_columns_json: '["asset_id"]',
  readable_columns_json: '["asset_id"]',
  writable_columns_json: '["display_name"]',
  default_values_json: '{"asset_id":"$uuid"}',
});
assert.deepEqual(normalized.enabledSurfaces, ["tenant"]);
assert.deepEqual(normalized.primaryKeyColumns, ["asset_id"]);
assert.equal(normalized.defaultValues.asset_id, "$uuid");

assert(routeSource.includes('router.get("/admin/data-tables"'), "admin catalog route must exist");
assert(routeSource.includes('router.post("/admin/data-tables/:table_key/rows"'), "admin create route must exist");
assert(routeSource.includes('router.get("/me/workspaces/:tenant_id/data-tables"'), "tenant catalog route must exist");
assert(routeSource.includes("tenant_data_table_write_role_required"), "tenant writes must require role gate");
assert(routeSource.includes("user_jwt_required"), "tenant routes must require user JWT");
assert(_testingRegistryDataManagementRoutes.WRITE_ROLES.has("operator"), "operators should be allowed to create/patch tenant rows");
assert(!_testingRegistryDataManagementRoutes.ARCHIVE_ROLES.has("operator"), "operators must not archive rows by default");

assert(serviceSource.includes("platform_data_table_registry"), "service must resolve registry rows from SQL");
assert(serviceSource.includes("secret_like_column_not_allowed"), "service must fail closed on secret-like columns");
assert(serviceSource.includes("unregistered_or_readonly_column"), "service must reject unregistered payload columns");
assert(serviceSource.includes("LIMIT ? OFFSET ?"), "list route must paginate with bounded limit and cursor");

assert(migration.includes("CREATE TABLE IF NOT EXISTS `platform_data_table_registry`"), "migration must create data table registry");
assert(migration.includes("'business_activity_types'"), "migration must seed admin business activity type table");
assert(migration.includes("'workspace_assets'"), "migration must seed tenant workspace assets table");
assert(!migration.includes("'brands'"), "migration must not expose brands through generic CRUD because it contains credential-like columns");
assert(!/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(migration), "migration must be additive and non-destructive");

const registryMount = "app.use(buildRegistryDataManagementRoutes({ ...deps, requireAdminPrincipal }));";
const firstRootProtectedTenantMount = "app.use(buildTenantPlatformPluginRoutes());";
assert(indexSource.includes("buildRegistryDataManagementRoutes"), "routes index must register registry data management routes");
assert.equal(indexSource.split(registryMount).length - 1, 1, "registry data management routes must mount exactly once");
assert(
  indexSource.indexOf(registryMount) < indexSource.indexOf(firstRootProtectedTenantMount),
  "registry data management routes must mount before root-level protected tenant routers"
);
assert(manifest.includes("node test-registry-data-management-service.mjs"), "test manifest must include registry data management test");

console.log("registry data management tests passed");
