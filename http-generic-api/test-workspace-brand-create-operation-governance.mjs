import assert from "node:assert/strict";
import fs from "node:fs/promises";

// frontend-surface-operation: POST /me/workspaces/{tenant_id}/brands

const routeSource = await fs.readFile(new URL("./routes/workspaceResourceRoutes.js", import.meta.url), "utf8");
const lifecycleSource = await fs.readFile(new URL("./workspaceBrandLifecycle.js", import.meta.url), "utf8");

assert.match(routeSource, /RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_create/);
assert.match(routeSource, /router\.post\("\/me\/workspaces\/:tenant_id\/brands"/);
assert.match(routeSource, /await connection\.beginTransaction\(\); \/\/ MUTATION_TRANSACTION: workspace_brand_create/);
assert.match(routeSource, /createWorkspaceBrand\(connection,/);
assert.match(routeSource, /await connection\.commit\(\)/);
assert.match(routeSource, /await connection\.rollback\(\)/);
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

console.log("workspace Brand Create operation governance evidence passed");
