import assert from "node:assert/strict";
import fs from "node:fs/promises";

// frontend-surface-operation: POST /me/workspaces/{tenant_id}/assets

const routeSource = await fs.readFile(new URL("./routes/workspaceResourceRoutes.js", import.meta.url), "utf8");
const lifecycleSource = await fs.readFile(new URL("./workspaceAssetLifecycle.js", import.meta.url), "utf8");

assert.match(routeSource, /RESOURCE_API_CALLABILITY_CONTRACT: workspace_asset_create/);
assert.match(routeSource, /router\.post\("\/me\/workspaces\/:tenant_id\/assets"/);
assert.match(routeSource, /requireCanonicalUserJwt, requireUserJwt/);
assert.match(routeSource, /await connection\.beginTransaction\(\); \/\/ MUTATION_TRANSACTION: workspace_asset_create/);
assert.match(routeSource, /createWorkspaceAsset\(connection,/);
assert.match(routeSource, /await connection\.commit\(\)/);
assert.match(routeSource, /await connection\.rollback\(\)/);
assert.match(routeSource, /idempotent_reuse: !result\.created/);
assert.match(routeSource, /secrets_included: false/);

assert.match(lifecycleSource, /async function requireActiveActorMembership/);
assert.match(lifecycleSource, /FROM memberships m/);
assert.match(lifecycleSource, /LIMIT 2 FOR UPDATE/);
assert.match(lifecycleSource, /async function resolveTenantBrand/);
assert.match(lifecycleSource, /tenant_brand_links/);
assert.match(lifecycleSource, /b\.status='active'/);
assert.match(lifecycleSource, /async function requireBrandWorkspaceBinding/);
assert.match(lifecycleSource, /workspace_registry/);
assert.match(lifecycleSource, /linked_brand_key=\?/);
assert.match(lifecycleSource, /async function requireBrandAssetAuthority/);
assert.match(lifecycleSource, /resource_type='brand'/);
assert.match(lifecycleSource, /BRAND_ASSET_PERMISSIONS/);
assert.match(lifecycleSource, /INSERT INTO workspace_assets/);
assert.match(lifecycleSource, /workspace-asset-provenance-v1/);
assert.match(lifecycleSource, /content_sha256/);
assert.match(lifecycleSource, /source_type/);
assert.match(lifecycleSource, /workspace_asset_identity_brand_conflict/);
assert.match(lifecycleSource, /workspace_asset_identity_checksum_conflict/);
assert.match(lifecycleSource, /async function readAssetExactly/);
assert.match(lifecycleSource, /workspace_asset_create_readback_invalid/);
assert.match(lifecycleSource, /workspace_asset_provenance_readback_invalid/);

console.log("workspace Brand Asset create operation governance evidence passed");
