import assert from "node:assert/strict";
import fs from "node:fs/promises";

// frontend-surface-operation: POST /me/workspaces/{tenant_id}/brands

const routeSource = await fs.readFile(new URL("./routes/workspaceResourceRoutes.js", import.meta.url), "utf8");
const lifecycleSource = await fs.readFile(new URL("./workspaceBrandLifecycle.js", import.meta.url), "utf8");
const topologySource = await fs.readFile(new URL("./workspaceBrandRootTopology.js", import.meta.url), "utf8");

assert.match(routeSource, /RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_create/);
assert.match(routeSource, /router\.post\("\/me\/workspaces\/:tenant_id\/brands"/);
assert.match(routeSource, /root_workspace_id/);
assert.match(routeSource, /readWorkspaceBrandRootScope/);
assert.match(routeSource, /withContainerAuthorityMutation/);
assert.match(routeSource, /mutationType:\s*"workspace_brand_create"/);
assert.match(routeSource, /rebuildClosure:\s*false/);
assert.match(routeSource, /rebuildContainerClosure/);
assert.match(routeSource, /verifyWorkspaceBrandRootTopology/);
assert.match(routeSource, /invalidateContainerAuthorityCache/);
assert.match(routeSource, /secrets_included: false/);

assert.match(lifecycleSource, /async function requireOwnerAuthority/);
assert.match(lifecycleSource, /LIMIT 2 FOR UPDATE/);
assert.match(lifecycleSource, /OWNER_ROLES\.has/);
assert.match(lifecycleSource, /async function ensureTenantBrandLink/);
assert.match(lifecycleSource, /workspace_owner_brand_create/);
assert.match(lifecycleSource, /async function ensureCreatorBrandGrant/);
assert.match(lifecycleSource, /INSERT INTO workspace_resource_grants/);
assert.match(lifecycleSource, /permission='admin' AND status='active'/);
assert.match(lifecycleSource, /async function ensureBrandWorkspace/);
assert.match(lifecycleSource, /workspace_registry/);
assert.match(lifecycleSource, /FOR UPDATE/);

assert.match(topologySource, /workspace_ownership_type/);
assert.match(topologySource, /ROOT_WORKSPACE_OWNERSHIP_TYPES/);
assert.match(topologySource, /workspace_type=brand/);
assert.match(topologySource, /root_workspace_id/);
assert.match(topologySource, /container_relationship_type_registry/);
assert.match(topologySource, /contributes_to_ancestry=1/);
assert.match(topologySource, /contributes_to_inheritance=1/);
assert.match(topologySource, /container_closure/);
assert.match(topologySource, /shortest_depth/);
assert.match(topologySource, /path_count/);
assert.match(topologySource, /workspace_brand_root_topology_conflict/);
assert.match(topologySource, /legacy_projection/);

console.log("workspace Brand Create Root Workspace operation governance evidence passed");
