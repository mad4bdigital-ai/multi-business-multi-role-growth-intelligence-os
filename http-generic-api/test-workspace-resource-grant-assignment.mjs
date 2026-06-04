import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingWorkspaceResourceRoutes } from "./routes/workspaceResourceRoutes.js";

const routeSource = readFileSync("routes/workspaceResourceRoutes.js", "utf8");
const migration = readFileSync("migrations/194_sprint67_workspace_resource_grant_assignment_tools.sql", "utf8");

assert(routeSource.includes('router.post("/me/workspaces/:tenant_id/resource-grants"'), "grant create route must exist");
assert(routeSource.includes('router.post("/me/workspaces/:tenant_id/resource-grants/:grant_id/revoke"'), "grant revoke route must exist");
assert(routeSource.includes("workspace_owner_required"), "grant assignment must require owner/admin");
assert(routeSource.includes("grantee_membership_required"), "grant assignment must require active grantee membership");
assert(routeSource.includes("workspace_resource_grant_create_failed"), "grant create route must use stable error code");
assert(routeSource.includes("workspace_resource_grant_revoke_failed"), "grant revoke route must use stable error code");
assert(!routeSource.includes("password"), "grant assignment routes must not handle raw passwords");

assert.equal(_testingWorkspaceResourceRoutes.normalizeResourceType("Brand"), "brand");
assert.equal(_testingWorkspaceResourceRoutes.normalizeResourceType("invalid"), "");
assert.equal(_testingWorkspaceResourceRoutes.normalizePermission("owner"), "admin", "self-service grant creation must not create owner permission");
assert.equal(_testingWorkspaceResourceRoutes.normalizePermission("edit"), "edit");
assert.equal(_testingWorkspaceResourceRoutes.normalizePermission("invalid"), "view");
assert.equal(_testingWorkspaceResourceRoutes.normalizeResourceRef("  site_1  "), "site_1");
assert(_testingWorkspaceResourceRoutes.OWNER_ROLES.has("owner"), "owner must be an assignment role");
assert(_testingWorkspaceResourceRoutes.OWNER_ROLES.has("admin"), "admin must be an assignment role");

assert(migration.includes("workspace_resource_grant_create"), "migration must register grant create tool");
assert(migration.includes("workspace_resource_grant_revoke"), "migration must register grant revoke tool");
assert(migration.includes("owner_required"), "assignment tools must be owner-required tagged");
assert(migration.includes("state_changing") && migration.includes("no_secrets"), "assignment tools must be state-changing no-secret surfaces");
assert(!migration.includes("'owner'"), "assignment tool schema must not expose owner permission enum");

console.log("workspace resource grant assignment tests passed");
