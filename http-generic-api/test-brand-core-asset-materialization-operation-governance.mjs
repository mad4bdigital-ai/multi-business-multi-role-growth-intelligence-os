// frontend-surface-operation: POST /me/workspaces/{tenant_id}/assets/materialize-brand-core
// frontend-state-change-proof: POST /me/workspaces/{tenant_id}/assets/materialize-brand-core

import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("./routes/resourceApiRoutes.js", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("./workspaceBrandCoreAssetMaterialization.js", import.meta.url), "utf8");
const repository = fs.readFileSync(new URL("./src/infrastructure/resourceApi/resourceRepository.js", import.meta.url), "utf8");

assert(route.includes("const requireUserJwt = createUserJwtMiddleware();"), "materialization must use canonical User JWT middleware");
assert(route.includes('"/me/workspaces/:tenant_id/assets/materialize-brand-core"'));
assert(route.includes("materializeWorkspaceBrandCoreAssetTransaction"), "transport route must delegate materialization transaction orchestration");
assert(!route.includes("../db.js"), "Resource API route must remain transport-only and must not import the database");
assert(!route.includes("MUTATION_TRANSACTION: workspace_brand_core_asset_materialize"), "transaction ownership must stay outside Resource API transport");
assert(route.includes("secrets_included: false"));

assert(service.includes("MUTATION_TRANSACTION: workspace_brand_core_asset_materialize"));
assert(service.includes("MUTATION_READBACK: workspace_brand_core_asset_materialize"));
assert(service.includes("await connection.beginTransaction()"));
assert(service.includes("await connection.commit()"));
assert(service.includes("await connection.rollback()"));
assert(service.includes("result.asset.source_provider !== \"brand_core\""));
assert(service.includes("result.asset.content_identity"));
assert(service.includes("resolveWorkspaceAssetBrandRef"), "Brand authority must be canonicalized before materialization");
assert(service.includes("FROM brand_core"));
assert(service.includes("FROM workspace_registry"));
assert(service.includes("createResourceRepository"));
assert(service.includes("repository.insertAsset"), "Brand Core materialization must delegate persistence to canonical Resource API asset lifecycle");
assert(service.includes('source_type: "import"'));
assert(service.includes('source_provider: "brand_core"'));
assert(service.includes("content_sha256: null"));
assert(service.includes("brand_workspace_id"));
assert(service.includes("LIMIT 2 FOR UPDATE"));
assert(service.includes("brand_core_asset_materialize_readback_mismatch"));
assert(service.includes("provider_content_fetched: false"), "materialization must not claim provider content fetch");
assert(!service.includes("information_schema"), "materialization must not require a parallel provenance schema");

assert(repository.includes("buildWorkspaceAssetProvenance"));
assert(repository.includes("assertWorkspaceAssetIdentityCompatible"));
assert(repository.includes("ON DUPLICATE KEY UPDATE asset_id=asset_id"));
assert(repository.includes("WHERE tenant_id=? AND asset_type=? AND asset_ref=?"));
assert(repository.includes("LIMIT 2 FOR UPDATE"));
assert(repository.includes("workspace_asset_provenance_readback_mismatch"));

console.log("Brand Core asset materialization canonical operation governance evidence passed");
