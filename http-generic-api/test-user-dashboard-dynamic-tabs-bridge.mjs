import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("tenantGrowthDashboardService.js", "utf8");
const routes = readFileSync("routes/tenantGrowthDashboardRoutes.js", "utf8");
const migration = readFileSync("migrations/20260704_user_dashboard_dynamic_tabs_aliases.sql", "utf8");
const index = readFileSync("routes/index.js", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

assert(service.includes("buildActivationTabManifest"), "tenant dashboard must reuse Dynamic Tabs manifests");
assert(service.includes("buildActivationDashboardManifest"), "tenant dashboard must reuse operational dashboard manifests");
assert(service.includes("PRODUCT_TAB_TO_OPERATIONAL_TAB"), "tenant product tabs must bridge to operational Dynamic Tabs");
assert(service.includes("activation_dynamic_tab_registry"), "tenant dashboard tab registry must be Dynamic Tabs-backed");
assert(service.includes("growth_dashboard_tab_profile_registry"), "tenant dashboard must support business/activity tab profiles");
assert(service.includes("details_are_cursor_loaded"), "dashboard contract must preserve cursor-loaded details");
assert(service.includes("missing_data_is_not_zero"), "dashboard must not treat unavailable data as zero");

assert(routes.includes('router.get("/me/dashboard"'), "user dashboard alias must exist");
assert(routes.includes('router.get("/me/workspaces/:tenant_id/dashboard"'), "workspace-scoped dashboard alias must exist");
assert(routes.includes("tenant_dashboard_scope_mismatch"), "workspace dashboard alias must fail closed on tenant mismatch");
assert(routes.includes('router.get("/tenant/dashboard"'), "legacy tenant dashboard route must be preserved");
assert(routes.includes("const userGuards = [requireTenantPrincipal]"), "user aliases must use user JWT principal instead of backend-only transport guard");

assert(migration.includes("user_dashboard_get"), "migration must register user dashboard catalog tool");
assert(migration.includes("/me/workspaces/{tenant_id}/dashboard"), "migration must register workspace dashboard path");
assert(migration.includes("dynamic_tabs"), "migration tags must identify Dynamic Tabs as the dashboard foundation");
assert(migration.includes("preview_only"), "dashboard action preview must remain preview-only");
assert(!/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(migration), "dashboard alias migration must be additive and non-destructive");

assert(index.includes("buildTenantGrowthDashboardRoutes"), "routes index must register tenant growth dashboard routes");
assert(index.includes("buildRegistryDataManagementRoutes"), "routes index must register registry data management routes");
assert(manifest.includes("node test-registry-data-management-service.mjs"), "manifest must include registry data management test");
assert(manifest.includes("node test-user-dashboard-dynamic-tabs-bridge.mjs"), "manifest must include user dashboard Dynamic Tabs bridge test");

console.log("user dashboard Dynamic Tabs bridge tests passed");
