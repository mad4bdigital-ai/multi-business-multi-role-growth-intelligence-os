import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTenantLifecycleRoutes } from "./routes/tenantLifecycleRoutes.js";

const routeSource = readFileSync("routes/tenantLifecycleRoutes.js", "utf8");
const migration = readFileSync("migrations/199_sprint68_workspace_ownership_member_control_tools.sql", "utf8");

assert(routeSource.includes("normalizeManagedRole"), "managed owner/admin routes need a role normalizer that permits owner");
assert(routeSource.includes("last_workspace_owner_required"), "routes must guard against removing/demoting last owner");
assert(routeSource.includes('router.patch("/me/workspaces/:tenant_id/members/:user_id"'), "member update route must exist");
assert(routeSource.includes('router.post("/me/workspaces/:tenant_id/members/:user_id/remove"'), "member remove route must exist");
assert(routeSource.includes('router.post("/me/workspaces/:tenant_id/ownership/transfer"'), "ownership transfer route must exist");
assert(routeSource.includes("UPDATE workspace_resource_grants SET status='revoked'"), "member removal must revoke active resource grants");
assert(routeSource.includes("ensureWorkspaceMembershipDefaultGrant"), "role updates/transfers must refresh default workspace grants");
assert(routeSource.includes("demote_current_owner"), "ownership transfer must support previous owner demotion control");
assert(!routeSource.includes("password"), "member control routes must not handle raw passwords");

assert.equal(_testingTenantLifecycleRoutes.normalizeRole("owner"), "member", "self-service role normalization must still block owner");
assert.equal(_testingTenantLifecycleRoutes.normalizeManagedRole("owner"), "owner", "owner/admin managed role normalization must permit owner");
assert.equal(_testingTenantLifecycleRoutes.normalizeManagedRole("invalid"), "member");

assert(migration.includes("workspace_member_update"), "member update tenant tool must be registered");
assert(migration.includes("workspace_member_remove"), "member remove tenant tool must be registered");
assert(migration.includes("workspace_ownership_transfer"), "ownership transfer tenant tool must be registered");
assert(migration.includes("last_owner_guard"), "tools must be tagged with last-owner guard");
assert(migration.includes("state_changing") && migration.includes("no_secrets"), "tools must be state-changing no-secret surfaces");

console.log("workspace ownership member control tests passed");
