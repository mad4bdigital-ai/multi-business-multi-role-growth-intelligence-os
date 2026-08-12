import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _testingWorkspaceResourceRoutes } from "./routes/workspaceResourceRoutes.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const readRepoFile = (relativePath) => readFileSync(resolve(testDir, relativePath), "utf8");
const migration = readRepoFile("migrations/193_sprint67_workspace_resource_authority_foundation.sql");
const brandListMigration = readRepoFile("migrations/229_sprint67_workspace_brands_list_tool.sql");
const routeSource = readRepoFile("routes/workspaceResourceRoutes.js");
const indexSource = readRepoFile("routes/index.js");

assert(migration.includes("CREATE TABLE IF NOT EXISTS workspace_resource_grants"), "resource grants table must exist");
assert(migration.includes("CREATE TABLE IF NOT EXISTS workspace_vaults"), "workspace vaults table must exist");
assert(migration.includes("CREATE TABLE IF NOT EXISTS workspace_assets"), "workspace assets table must exist");
assert(migration.includes("v_workspace_resource_grant_effective"), "effective grant view must exist");
assert(migration.includes("utf8mb4_uca1400_ai_ci"), "workspace resource tables must align with membership collation");
assert(migration.includes("workspace_resource_grants_list"), "tenant grant list tool must be registered");
assert(migration.includes("workspace_assets_list"), "tenant assets list tool must be registered");
assert(migration.includes("workspace_vaults_list"), "tenant vaults list tool must be registered");
assert(brandListMigration.includes("workspace_brands_list"), "tenant brand list tool must be registered");
assert(brandListMigration.includes("role_inheritance"), "brand list tool must expose role inheritance evidence");
assert(migration.includes("read_only") && migration.includes("no_secrets") && brandListMigration.includes("read_only") && brandListMigration.includes("no_secrets"), "resource tools must be read-only no-secret surfaces");

assert(indexSource.includes('import { buildWorkspaceResourceRoutes } from "./workspaceResourceRoutes.js";'), "workspace resource routes must be imported");
assert(indexSource.includes("app.use(buildWorkspaceResourceRoutes());"), "workspace resource routes must be mounted");

assert(routeSource.includes('/me/workspaces/:tenant_id/resource-grants'), "resource grants route must exist");
assert(routeSource.includes('/me/workspaces/:tenant_id/assets'), "assets route must exist");
assert(routeSource.includes('/me/workspaces/:tenant_id/brands'), "tenant-safe brands route must exist");
assert(routeSource.includes("diagnostic_counts_used_as_authority: false"), "brand route must reject diagnostic counts as authority");
assert(routeSource.includes('/me/workspaces/:tenant_id/vaults'), "vaults route must exist");
assert(routeSource.includes("active_membership_required"), "resource routes must require active membership");
assert(!routeSource.includes("password"), "resource routes must not handle raw passwords");

const params = [];
const clause = _testingWorkspaceResourceRoutes.optionalFilter({}, "resource_type", "brand", params);
assert.equal(clause, " AND resource_type = ?");
assert.deepEqual(params, ["brand"]);
assert.equal(_testingWorkspaceResourceRoutes.optionalFilter({}, "resource_ref", "", []), "");
assert.equal(_testingWorkspaceResourceRoutes.normalizeBrandLookupRef("brand:all_royal_egypt"), "all_royal_egypt");
assert.deepEqual(_testingWorkspaceResourceRoutes.brandLookupKeys("brand:all_royal_egypt"), ["brand:all_royal_egypt", "all_royal_egypt"]);
assert.equal(_testingWorkspaceResourceRoutes.isWorkspaceOwnerRole("owner"), true);
assert.equal(_testingWorkspaceResourceRoutes.isWorkspaceOwnerRole("member"), false);

console.log("workspace resource authority foundation tests passed");
