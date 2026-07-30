import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTenantLifecycleRoutes } from "./routes/tenantLifecycleRoutes.js";
import { validateDirectRouteCallabilityContracts } from "./scripts/resource-api-callability-contracts.mjs";

const migration = readFileSync("migrations/190_sprint66_workspace_lifecycle_foundation.sql", "utf8");
const routeSource = readFileSync("routes/tenantLifecycleRoutes.js", "utf8");
const indexSource = readFileSync("routes/index.js", "utf8");

assert(migration.includes("workspace_access_requests"), "migration must create workspace access request table");
assert(migration.includes("created_by varchar(36)"), "invitations must track creator");
assert(migration.includes("accepted_by varchar(36)"), "invitations must track accepter");
assert(migration.includes("workspace_invitation_create"), "migration must register invitation create tool");
assert(migration.includes("workspace_access_request_approve"), "migration must register access request approval tool");
assert(migration.includes("workspace_members_list"), "migration must register workspace members list tool");
assert(migration.includes("workspace_invitations_list"), "migration must register workspace invitations list tool");
assert(migration.includes("workspace_access_requests_list"), "migration must register workspace access requests list tool");
assert(migration.includes("no_secrets"), "lifecycle tools must be no-secret tagged");

assert(indexSource.includes('import { buildTenantLifecycleRoutes } from "./tenantLifecycleRoutes.js";'), "tenant lifecycle routes must be imported");
assert(indexSource.includes("app.use(buildTenantLifecycleRoutes());"), "tenant lifecycle routes must be mounted");

assert(routeSource.includes('router.post("/me/workspaces/:tenant_id/invitations"'), "owner invite route must exist");
assert(routeSource.includes('router.post("/me/invitations/accept"'), "invitation accept route must exist");
assert(routeSource.includes('router.post("/me/workspaces/:tenant_id/access-requests"'), "access request create route must exist");
assert(routeSource.includes('router.post("/me/workspaces/:tenant_id/access-requests/:request_id/approve"'), "access request approve route must exist");
assert(routeSource.includes("RESOURCE_API_CALLABILITY_CONTRACT: workspace_members_list"), "members list route must declare callability evidence");
assert(routeSource.includes('router.get("/me/workspaces/:tenant_id/members", requireUserJwt'), "members list route must exist");
assert(routeSource.includes("RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitations_list"), "invitations list route must declare callability evidence");
assert(routeSource.includes('router.get("/me/workspaces/:tenant_id/invitations", requireUserJwt'), "invitations list route must exist");
assert(routeSource.includes("RESOURCE_API_CALLABILITY_CONTRACT: workspace_access_requests_list"), "access requests list route must declare callability evidence");
assert(routeSource.includes('router.get("/me/workspaces/:tenant_id/access-requests", requireUserJwt'), "access requests list route must exist");
assert(routeSource.includes("workspace_owner_required"), "owner-only operations must be gated");
assert(routeSource.includes("invitation_email_mismatch"), "invite acceptance must require matching signed-in email");
assert(routeSource.includes("already_member"), "access requests must block existing active members");
assert(!routeSource.includes("password"), "tenant lifecycle route must not handle raw passwords");

assert.equal(_testingTenantLifecycleRoutes.normalizeEmail(" NagyXS@Gmail.com "), "nagyxs@gmail.com");
assert.equal(_testingTenantLifecycleRoutes.normalizeRole("owner"), "member", "self-service flows must not grant owner role");
assert.equal(_testingTenantLifecycleRoutes.normalizeRole("editor"), "editor");
assert(_testingTenantLifecycleRoutes.OWNER_ROLES.has("owner"), "owner role must be recognized");
assert(_testingTenantLifecycleRoutes.OWNER_ROLES.has("admin"), "admin role may manage lifecycle foundation");

const resourceManifest = JSON.parse(readFileSync("resource-api-coverage.manifest.json", "utf8"));
const mutationCallability = validateDirectRouteCallabilityContracts({ root: process.cwd(), manifest: resourceManifest });
assert.equal(mutationCallability.ok, true, JSON.stringify(mutationCallability.findings));
for (const toolKey of [
  "workspace_invitation_create",
  "workspace_invitation_accept",
  "workspace_access_request_create",
  "workspace_access_request_approve",
  "workspace_access_request_reject",
]) assert(mutationCallability.covered_tool_keys.includes(toolKey), `${toolKey} must have fail-closed mutation callability evidence`);
assert.equal((routeSource.match(/router\.get\("\/me\/access-requests"/g) || []).length, 1, "duplicate lifecycle routes must be removed");
assert.equal((routeSource.match(/router\.post\("\/me\/workspaces\/:tenant_id\/access-requests\/:request_id\/cancel"/g) || []).length, 1, "duplicate lifecycle routes must be removed");
assert(routeSource.includes("token_returned: false"), "invitation creation must not return the raw invitation token");
assert(routeSource.includes("workspace_access_request_create_readback_invalid"), "access request creation must return the persisted request identity");

console.log("workspace lifecycle foundation tests passed");
