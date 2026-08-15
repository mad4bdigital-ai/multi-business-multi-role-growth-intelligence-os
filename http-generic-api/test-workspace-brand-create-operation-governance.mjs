import assert from "node:assert/strict";
import fs from "node:fs/promises";

// frontend-surface-operation: POST /me/workspaces/{tenant_id}/brands

const routeSource = await fs.readFile(new URL("./routes/workspaceResourceRoutes.js", import.meta.url), "utf8");
const lifecycleSource = await fs.readFile(new URL("./workspaceBrandLifecycle.js", import.meta.url), "utf8");
const topologySource = await fs.readFile(new URL("./workspaceBrandRootTopology.js", import.meta.url), "utf8");
const repositorySource = await fs.readFile(new URL("./dynamicContainerAuthorityRepository.js", import.meta.url), "utf8");
const resolverSource = await fs.readFile(new URL("./dynamicContainerAuthorityResolver.js", import.meta.url), "utf8");

assert.match(routeSource, /RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_create/);
assert.match(routeSource, /router\.post\("\/me\/workspaces\/:tenant_id\/brands"/);
assert.match(routeSource, /root_workspace_id/);
assert.match(routeSource, /readWorkspaceBrandRootScope\(getPool\(\),/);
assert.match(routeSource, /withContainerAuthorityMutation\(\{/);
assert.match(routeSource, /mutationType: "workspace_brand_create"/);
assert.match(routeSource, /work: async \(connection, currentEpoch\) => \{ \/\/ MUTATION_TRANSACTION: workspace_brand_create/);
assert.match(routeSource, /createWorkspaceBrandWithRootTopology\(connection,/);
assert.match(routeSource, /rebuildContainerClosure\(connection, rootScope\.tenant_id, Number\(currentEpoch\) \+ 1\)/);
assert.match(routeSource, /verifyWorkspaceBrandRootTopology\(connection,/);
assert.match(routeSource, /MUTATION_READBACK: workspace_brand_create/);
assert.match(routeSource, /invalidateContainerAuthorityCache\(rootScope\.tenant_id\)/);
assert.match(routeSource, /next_operations: result\.next_operations/);
assert.match(routeSource, /secrets_included: false/);

assert.match(repositorySource, /export async function withContainerAuthorityMutation/);
assert.match(repositorySource, /await connection\.beginTransaction\(\)/);
assert.match(repositorySource, /await connection\.commit\(\)/);
assert.match(repositorySource, /await connection\.rollback\(\)/);
assert.match(repositorySource, /export async function rebuildContainerClosure/);
assert.match(resolverSource, /export function invalidateContainerAuthorityCache/);

assert.match(topologySource, /workspace_ownership_type/);
assert.match(topologySource, /owner_user_id/);
assert.match(topologySource, /workspace_brand_personal_owner_missing/);
assert.match(topologySource, /workspace_brand_personal_owner_mismatch/);
assert.match(topologySource, /config_json=\?/);
assert.match(topologySource, /root_workspace_id: rootWorkspaceId/);
assert.match(topologySource, /workspace_brand_root_relationship_noncanonical/);
assert.match(topologySource, /loadRootBrandPairRows/);
assert.match(topologySource, /verifyWorkspaceBrandRootTopology/);
assert.match(topologySource, /path_count/);

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

console.log("workspace Brand Create Root topology operation governance evidence passed");
