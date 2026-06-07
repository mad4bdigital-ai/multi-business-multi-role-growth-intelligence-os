import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAdminWorkspaceAuthorityRoutes, _testingAdminWorkspaceAuthorityRoutes } from "./routes/adminWorkspaceAuthorityRoutes.js";

const routeSource = readFileSync("routes/adminWorkspaceAuthorityRoutes.js", "utf8");
const indexSource = readFileSync("routes/index.js", "utf8");
const migration = readFileSync("migrations/202_sprint68_admin_workspace_authority_tools.sql", "utf8");

assert(indexSource.includes("buildAdminWorkspaceAuthorityRoutes"), "admin workspace authority routes must be mounted");
assert(routeSource.includes('/admin/workspace-authority/reconciliation'), "reconciliation route must exist");
assert(routeSource.includes('/admin/workspace-authority/repair'), "repair route must exist");
assert(routeSource.includes("requireBackendApiKey"), "admin workspace authority routes must parse backend API key before principal guard");
assert(routeSource.includes("const adminGuard = [requireBackend, requireAdmin]"), "admin workspace authority routes must compose backend and admin guards");
assert(routeSource.includes('router.get("/admin/workspace-authority/reconciliation", ...adminGuard'), "reconciliation route must use backend+admin guard");
assert(routeSource.includes('router.post("/admin/workspace-authority/repair", ...adminGuard'), "repair route must use backend+admin guard");
assert(routeSource.includes("dry_run"), "repair route must default to dry-run behavior");
assert(routeSource.includes("workspace_authority_reconciliation_failed"), "reconciliation route must use stable error code");
assert(routeSource.includes("workspace_authority_repair_failed"), "repair route must use stable error code");
assert(routeSource.includes("v_workspace_authority_reconciliation_summary"), "routes must read reconciliation summary view");
assert(routeSource.includes("v_connections_without_workspace_membership"), "repair must cover connection membership mismatch");
assert(routeSource.includes("v_cms_grants_without_workspace_membership"), "repair must cover CMS membership mismatch");
assert(routeSource.includes("v_active_memberships_missing_workspace_grants"), "repair must cover missing workspace grants");
assert(routeSource.includes("v_cms_publish_grants_missing_resource_grants"), "repair must cover missing CMS publish resource grants");
assert(!routeSource.includes("encrypted_credentials"), "admin authority routes must not expose secrets");

assert.equal(Object.keys(_testingAdminWorkspaceAuthorityRoutes.DETAIL_VIEWS).length, 4, "all reconciliation detail views must be registered");

assert(migration.includes("admin_workspace_authority_reconciliation"), "admin reconciliation tool must be registered");
assert(migration.includes("admin_workspace_authority_repair"), "admin repair tool must be registered");
assert(migration.includes("dry_run_default"), "repair tool must advertise dry-run default");
assert(migration.includes("state_changing") && migration.includes("no_secrets"), "repair tool must be state-changing no-secret surface");

console.log("admin workspace authority route tests passed");
