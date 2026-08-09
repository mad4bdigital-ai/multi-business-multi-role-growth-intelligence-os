// frontend-surface-operation: POST /me/workspaces/{workspace_id}/brands/{brand_key}/assets/materialize-brand-core
// frontend-state-change-proof: POST /me/workspaces/{workspace_id}/brands/{brand_key}/assets/materialize-brand-core

import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("./routes/resourceApiRoutes.js", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("./workspaceBrandCoreAssetMaterialization.js", import.meta.url), "utf8");
const repository = fs.readFileSync(new URL("./src/infrastructure/resourceApi/resourceRepository.js", import.meta.url), "utf8");
const containerFoundation = fs.readFileSync(new URL("./migrations/319_sprint69_dynamic_container_authority_foundation.sql", import.meta.url), "utf8");
const connectionOwnershipFoundation = fs.readFileSync(new URL("./migrations/20260730_context_kernel_connection_ownership_persistence.sql", import.meta.url), "utf8");

assert(route.includes("const requireUserJwt = createUserJwtMiddleware();"), "materialization must use canonical User JWT middleware");
assert(route.includes('"/me/workspaces/:workspace_id/brands/:brand_key/assets/materialize-brand-core"'));
assert(!route.includes('"/me/workspaces/:tenant_id/assets/materialize-brand-core"'), "materialization must not accept a caller-supplied tenant as its workspace authority");
assert(route.includes("workspaceId: req.params.workspace_id"));
assert(route.includes("brandRef: req.params.brand_key"));
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
assert(service.includes("resolveRootWorkspace"), "tenant scope must be derived from an exact personal/company Root Workspace");
assert(service.includes("ROOT_WORKSPACE_OWNERSHIP_TYPES"));
assert(service.includes('new Set(["personal", "company"])'));
assert(service.includes("resolveWorkspaceAssetBrandRef"), "Brand mutation authority must remain on the canonical existing grant helper");
assert(service.includes("resolveBrandOperationalWorkspace"), "workspace_type=brand must remain an exact child operational workspace binding");
assert(service.includes("resolveBrandContainerTopology"), "materialization must prove Workspace → Brand container topology");
assert(service.includes("FROM containers brand_container"));
assert(service.includes("JOIN container_relationships relationship"));
assert(service.includes("relationship.relationship_type_key='contains'"));
assert(service.includes("relationship_type.contributes_to_ancestry=1"));
assert(service.includes("contributes_to_inheritance"));
assert(service.includes("FROM container_closure"));
assert(service.includes("shortest_depth"));
assert(service.includes("path_count"));
assert(service.includes("brand_core_materialize_brand_container_cross_workspace"));
assert(service.includes("brand_core_materialize_brand_container_parent_ambiguous"));
assert(service.includes("brand_core_materialize_brand_workspace_root_collision"));
assert(service.includes("FROM brand_core"));
assert(service.includes("FROM workspace_registry"));
assert(service.includes("createResourceRepository"));
assert(service.includes("repository.insertAsset"), "Brand Core materialization must delegate persistence to canonical Resource API asset lifecycle");
assert(service.includes('source_type: "import"'));
assert(service.includes('source_provider: "brand_core"'));
assert(service.includes("content_sha256: null"));
assert(service.includes("root_workspace_id"));
assert(service.includes("brand_workspace_id"));
assert(service.includes("brand_container_id"));
assert(service.includes("brand_container_relationship_id"));
assert(service.includes("LIMIT 2 FOR UPDATE"));
assert(service.includes("brand_core_asset_materialize_readback_mismatch"));
assert(service.includes("provider_content_fetched: false"), "materialization must not claim provider content fetch");
assert(!service.includes("INSERT INTO containers"), "materialization must not self-heal missing Brand container topology during a consequential write");
assert(!service.includes("INSERT INTO container_relationships"), "materialization must not invent Workspace → Brand ownership during a consequential write");
assert(!service.includes("information_schema"), "materialization must not require a parallel provenance schema");

assert.match(containerFoundation, /\('brand','Brand'.*JSON_ARRAY\('workspace'\)/, "Brand container registry must allow Workspace parents");
assert.match(containerFoundation, /\('contains','Contains','containment',1,1,1/, "contains must be the inheritance-bearing canonical containment edge");
assert.match(containerFoundation, /\('connections','Connections'/, "Brand containers must share the generic connections dimension");
assert.match(containerFoundation, /\('assets','Assets'/, "Brand containers must share the generic assets dimension");
assert.match(containerFoundation, /\('brand_core','Brand Core'/, "Brand containers must expose the Brand Core dimension");
assert.match(connectionOwnershipFoundation, /workspace_ownership_type[\s\S]*ENUM\('personal','company'\)/, "Root Workspace ownership classification must stay separate from workspace_type");

assert(repository.includes("buildWorkspaceAssetProvenance"));
assert(repository.includes("assertWorkspaceAssetIdentityCompatible"));
assert(repository.includes("ON DUPLICATE KEY UPDATE asset_id=asset_id"));
assert(repository.includes("WHERE tenant_id=? AND asset_type=? AND asset_ref=?"));
assert(repository.includes("LIMIT 2 FOR UPDATE"));
assert(repository.includes("workspace_asset_provenance_readback_mismatch"));

console.log("Brand Core asset materialization Root Workspace/Brand Container governance evidence passed");