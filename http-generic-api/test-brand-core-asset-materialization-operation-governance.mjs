// frontend-surface-operation: POST /me/workspaces/{tenant_id}/assets/materialize-brand-core
// frontend-state-change-proof: POST /me/workspaces/{tenant_id}/assets/materialize-brand-core

import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("./routes/brandCoreAssetMaterializationRoutes.js", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("./workspaceBrandCoreAssetMaterialization.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("./migrations/1050_workspace_asset_provenance_content_identity.sql", import.meta.url), "utf8");

assert(route.includes('createUserJwtMiddleware()'), "materialization must use canonical User JWT middleware");
assert(route.includes("MUTATION_TRANSACTION: workspace_brand_core_asset_materialize"));
assert(route.includes("MUTATION_READBACK: workspace_brand_core_asset_materialize"));
assert(route.includes("await connection.beginTransaction()"));
assert(route.includes("await connection.commit()"));
assert(route.includes("await connection.rollback()"));
assert(route.includes("secrets_included: false"));

assert(service.includes("resolveWorkspaceAssetBrandRef"), "Brand authority must be canonicalized before materialization");
assert(service.includes("v_workspace_asset_provenance_schema_readiness") || service.includes("information_schema.columns"));
assert(service.includes("FROM brand_core"));
assert(service.includes("FROM workspace_registry"));
assert(service.includes("source_ref_sha256"));
assert(service.includes("provenance_sha256"));
assert(service.includes("content_sha256"));
assert(service.includes("LIMIT 2 FOR UPDATE"));
assert(service.includes("provider_content_fetched: false"), "materialization must not claim provider content fetch");

assert(migration.includes("source_ref_sha256 CHAR(64)"));
assert(migration.includes("provenance_sha256 CHAR(64)"));
assert(migration.includes("content_sha256 CHAR(64)"));
assert(migration.includes("uq_workspace_asset_provenance"));
assert(migration.includes("v_workspace_asset_provenance_schema_readiness"));
assert(migration.includes("No provider calls"));

console.log("Brand Core asset materialization operation governance evidence passed");
