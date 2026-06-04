import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTenantLifecycleRoutes } from "./routes/tenantLifecycleRoutes.js";

const routeSource = readFileSync("routes/tenantLifecycleRoutes.js", "utf8");

assert(routeSource.includes("ensureWorkspaceMembershipDefaultGrant"), "lifecycle routes must create default workspace grants");
assert(routeSource.includes("workspace_resource_grants"), "default grants must be stored in workspace_resource_grants");
assert(routeSource.includes("'workspace', ?"), "default grants must target workspace resource type");
assert(routeSource.includes("invitation_accept"), "invitation acceptance must tag default grant source");
assert(routeSource.includes("access_request_approval"), "access request approval must tag default grant source");
assert(routeSource.includes("default_workspace_grant"), "responses must expose default grant evidence");
assert(routeSource.includes("default_workspace_membership_grant"), "default grant metadata must be explicit");
assert(!routeSource.includes("default_workspace_grant: null"), "default grant evidence must not be stubbed/null");

assert.equal(_testingTenantLifecycleRoutes.defaultWorkspacePermissionForRole("admin"), "admin");
assert.equal(_testingTenantLifecycleRoutes.defaultWorkspacePermissionForRole("editor"), "operate");
assert.equal(_testingTenantLifecycleRoutes.defaultWorkspacePermissionForRole("operator"), "operate");
assert.equal(_testingTenantLifecycleRoutes.defaultWorkspacePermissionForRole("viewer"), "view");
assert.equal(_testingTenantLifecycleRoutes.defaultWorkspacePermissionForRole("owner"), "view", "self-service lifecycle must still normalize owner role away");
assert.equal(_testingTenantLifecycleRoutes.defaultWorkspacePermissionForRole("invalid"), "view");

console.log("workspace lifecycle default resource grant tests passed");
