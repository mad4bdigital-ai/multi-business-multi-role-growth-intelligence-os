import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBrandCoreMaterializedAssetRef,
  materializeWorkspaceBrandCoreAsset,
  materializeWorkspaceBrandCoreAssetTransaction,
} from "./workspaceBrandCoreAssetMaterialization.js";

const workspaceAssetFoundationSql = readFileSync(
  new URL("./migrations/193_sprint67_workspace_resource_authority_foundation.sql", import.meta.url),
  "utf8"
);
assert.match(workspaceAssetFoundationSql, /asset_type enum\([^\n]*'external_ref'/, "Brand Core reference materialization must use a workspace_assets asset_type admitted by the canonical foundation schema");
assert.doesNotMatch(workspaceAssetFoundationSql, /asset_type enum\([^\n]*'brand_core'/, "tests must not rely on an undeclared brand_core workspace asset type");
assert.match(workspaceAssetFoundationSql, /UNIQUE KEY uq_workspace_asset_ref \(tenant_id, asset_type, asset_ref\)/, "Brand Core materialization must respect the canonical tenant-wide workspace asset identity key");

const canonicalSchemaSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const brandCoreSchema = canonicalSchemaSql.match(/CREATE TABLE IF NOT EXISTS `brand_core` \(([\s\S]*?)\) ENGINE=InnoDB/)?.[1] || "";
assert(brandCoreSchema, "canonical schema must declare brand_core");
for (const canonicalColumn of ["brand_key", "asset_key", "doc_key", "doc_id", "file_id", "google_doc_id", "status", "created_at", "updated_at"]) {
  assert.match(brandCoreSchema, new RegExp(`\\\`${canonicalColumn}\\\``), `brand_core schema must expose ${canonicalColumn}`);
}
for (const legacyColumn of ["brand_name", "google_drive_link", "asset_type", "document_name", "validation_status", "active_status"]) {
  assert.doesNotMatch(brandCoreSchema, new RegExp(`\\\`${legacyColumn}\\\``), `canonical bootstrap schema must not require legacy brand_core.${legacyColumn}`);
}

const materializationRuntimeSource = readFileSync(new URL("./workspaceBrandCoreAssetMaterialization.js", import.meta.url), "utf8");
const canonicalBrandLookupSql = materializationRuntimeSource.match(/`SELECT target_key, brand_name, normalized_brand_name[\s\S]*?FROM brands[\s\S]*?LIMIT 2 FOR UPDATE`/)?.[0] || "";
assert(canonicalBrandLookupSql, "Brand Core materialization must expose one bounded canonical Brand identity query after shared authority resolution");
assert.doesNotMatch(canonicalBrandLookupSql, /\bstatus\b/, "Brand Core local Brand identity readback must not re-project the legacy brands.status column after shared authority already validated Brand lifecycle");
const brandCoreLookupSql = materializationRuntimeSource.match(/`SELECT bc\.\*[\s\S]*?FROM brand_core bc[\s\S]*?LIMIT 3 FOR UPDATE`/)?.[0] || "";
assert(brandCoreLookupSql, "Brand Core materialization must expose one bounded schema-compatible source query");
assert.match(brandCoreLookupSql, /LOWER\(COALESCE\(bc\.brand_key,''\)\)/, "Brand Core lookup must scope through the canonical brand_key column");
assert.match(
  brandCoreLookupSql,
  /WHERE LOWER\(COALESCE\(bc\.brand_key,''\)\) = LOWER\(\?\)/,
  "Brand Core lookup must use only the canonical Brand target key."
);
assert.doesNotMatch(
  brandCoreLookupSql,
  /\bIN\s*\(/,
  "Brand Core lookup must not widen Brand authority through display-name aliases."
);
for (const undeclaredColumn of ["brand_name", "google_drive_link", "asset_type", "document_name", "validation_status", "active_status"]) {
  assert.doesNotMatch(brandCoreLookupSql, new RegExp(`\\b${undeclaredColumn}\\b`), `Brand Core SQL must not explicitly require optional legacy ${undeclaredColumn}`);
}
assert.doesNotMatch(materializationRuntimeSource, /information_schema/i, "Brand Core materialization must not introduce a parallel schema preflight query");

const containerFoundationSql = readFileSync(
  new URL("./migrations/319_sprint69_dynamic_container_authority_foundation.sql", import.meta.url),
  "utf8"
);
assert.match(containerFoundationSql, /\('brand','Brand'.*JSON_ARRAY\('workspace'\)/, "Brand containers must remain children of Workspace containers");
assert.match(containerFoundationSql, /\('contains','Contains','containment',1,1,1/, "contains must contribute to both ancestry and inheritance");

function rootWorkspaceRow(overrides = {}) {
  return [{
    workspace_id: "workspace-root-a",
    tenant_id: "tenant-a",
    workspace_key: "workspace_root_a",
    display_name: "Workspace A",
    workspace_type: "workspace",
    workspace_ownership_type: "company",
    owner_user_id: null,
    ownership_revision: 7,
    bootstrap_status: "ready",
    tenant_status: "active",
    ...overrides,
  }];
}

function canonicalBrandLink() {
  return [{
    tenant_id: "tenant-a",
    brand_target_key: "brand-a",
    link_status: "active",
    brand_status: "active",
  }];
}

function ownerMembership() {
  return [{ user_id: "user-a", tenant_id: "tenant-a", role: "owner", status: "active", tenant_status: "active" }];
}

function brandRow() {
  return [{ target_key: "brand-a", brand_name: "Brand A", normalized_brand_name: "brand a", brand_status: "active" }];
}

function brandWorkspaceRow(overrides = {}) {
  return [{
    workspace_id: "workspace-brand-a",
    tenant_id: "tenant-a",
    workspace_key: "brand_workspace_a",
    workspace_type: "brand",
    workspace_ownership_type: null,
    bootstrap_status: "in_progress",
    linked_brand_key: "brand-a",
    ...overrides,
  }];
}

function brandTopologyRow(overrides = {}) {
  return [{
    brand_container_id: "container-brand-a",
    brand_container_key: "brand:brand-a",
    brand_subject_type: "brand_target_key",
    brand_subject_ref: "brand-a",
    workspace_container_id: "container-workspace-root-a",
    workspace_container_key: "workspace_root_a",
    workspace_subject_type: "workspace",
    workspace_subject_ref: "workspace-root-a",
    relationship_id: "relationship-root-a-brand-a",
    relationship_type_key: "contains",
    contributes_to_ancestry: 1,
    contributes_to_inheritance: 1,
    ...overrides,
  }];
}

function closureRow(overrides = {}) {
  return [{
    tenant_id: "tenant-a",
    ancestor_container_id: "container-workspace-root-a",
    descendant_container_id: "container-brand-a",
    shortest_depth: 1,
    longest_depth: 1,
    path_count: 1,
    authority_epoch: 18,
    ...overrides,
  }];
}

function sourceRow(overrides = {}) {
  return [{
    id: 11,
    brand_key: "brand-a",
    asset_key: "positioning",
    doc_key: null,
    doc_id: "doc-123",
    file_id: null,
    google_doc_id: null,
    status: "active",
    created_at: "2026-08-01 10:00:00",
    updated_at: "2026-08-07 10:00:00",
    ...overrides,
  }];
}

function projectedAsset(stored) {
  if (!stored) return null;
  const metadata = JSON.parse(stored.metadata_json || "{}");
  return {
    ...stored,
    provenance_schema_version: metadata.schema_version || null,
    source_type: metadata.source_type || null,
    source_provider: metadata.source_provider || null,
    source_revision: metadata.source_revision || null,
    content_sha256: metadata.content_sha256 ?? null,
    content_identity: metadata.content_identity || null,
    ingestion_mode: metadata.ingestion_mode || null,
    source_locator_present: metadata.source_uri ? 1 : 0,
  };
}

function buildConnection({
  roots = rootWorkspaceRow(),
  brandLinks = canonicalBrandLink(),
  memberships = ownerMembership(),
  brands = brandRow(),
  brandWorkspaces = brandWorkspaceRow(),
  topology = brandTopologyRow(),
  closure = closureRow(),
  sources = sourceRow(),
  sourcesByCall = null,
} = {}) {
  const calls = [];
  let stored = null;
  let insertAttempts = 0;
  let persistedInserts = 0;
  let sourceCall = 0;
  return {
    calls,
    get stored() { return stored; },
    get insertAttempts() { return insertAttempts; },
    get persistedInserts() { return persistedInserts; },
    archiveStored() {
      if (stored) stored = { ...stored, lifecycle_status: "archived" };
    },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM workspace_registry wr") && sql.includes("JOIN tenants")) return [roots];
      if (sql.includes("FROM tenant_brand_links tbl")) return [brandLinks];
      if (sql.includes("FROM memberships m") && sql.includes("FOR UPDATE")) return [memberships];
      if (sql.includes("FROM memberships m") && sql.includes("LIMIT 1")) return [memberships];
      if (sql.includes("FROM v_workspace_resource_grant_effective")) return [[{ grant_id: "grant-edit", permission: "edit" }]];
      if (sql.includes("FROM brands")) return [brands];
      if (sql.includes("FROM workspace_registry") && sql.includes("workspace_type='brand'")) return [brandWorkspaces];
      if (sql.includes("FROM containers brand_container")) return [topology];
      if (sql.includes("FROM container_closure")) return [closure];
      if (sql.includes("FROM brand_core bc")) {
        const selected = sourcesByCall?.[sourceCall] || sourcesByCall?.at(-1) || sources;
        sourceCall += 1;
        return [selected];
      }
      if (sql.includes("INSERT INTO workspace_assets")) {
        insertAttempts += 1;
        if (!stored) {
          persistedInserts += 1;
          stored = {
            asset_id: params[0],
            tenant_id: params[1],
            vault_id: params[2],
            asset_type: params[3],
            asset_ref: params[4],
            display_name: params[5],
            brand_ref: params[6],
            site_ref: params[7],
            workflow_ref: params[8],
            session_ref: params[9],
            visibility: params[10],
            lifecycle_status: params[11],
            metadata_json: params[12],
            created_by: params[13],
            created_at: "2026-08-07 10:01:00",
            updated_at: "2026-08-07 10:01:00",
          };
        }
        return [{ affectedRows: stored.asset_id === params[0] ? 1 : 2 }];
      }
      if (sql.includes("UPDATE workspace_assets") && sql.includes("metadata_json=?")) {
        stored = { ...stored, metadata_json: params[0], updated_at: "2026-08-07 10:02:00" };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM workspace_assets r")) {
        const row = projectedAsset(stored);
        return [[row].filter((candidate) => candidate && candidate.asset_id === params[0])];
      }
      if (sql.includes("FROM workspace_assets") && sql.includes("asset_id=?") && sql.includes("tenant_id=?")) {
        return [[stored].filter((row) => row && row.asset_id === params[0] && row.tenant_id === params[1])];
      }
      if (sql.includes("FROM workspace_assets") && sql.includes("tenant_id=?") && sql.includes("asset_type=?") && sql.includes("asset_ref=?")) {
        return [[stored].filter((row) => row && row.tenant_id === params[0] && row.asset_type === params[1] && row.asset_ref === params[2])];
      }
      throw new Error(`Unexpected SQL in Brand Core materialization test: ${sql}`);
    },
  };
}

async function materialize(connection, sourceRef = "positioning") {
  return materializeWorkspaceBrandCoreAsset(connection, {
    workspaceId: "workspace-root-a",
    actorUserId: "user-a",
    brandRef: "Brand A",
    sourceRef,
  });
}

{
  const source = sourceRow()[0];
  const expectedAssetRef = buildBrandCoreMaterializedAssetRef("brand-a", source);
  const connection = buildConnection({ sources: [source] });
  const result = await materialize(connection);
  assert.equal(result.tenant_id, "tenant-a", "tenant authority must be derived from the selected root workspace");
  assert.equal(result.asset.brand_ref, "brand-a");
  assert.equal(result.asset.asset_type, "external_ref");
  assert.equal(result.asset.asset_ref, expectedAssetRef);
  assert.match(result.asset.asset_ref, /^brand_core:[0-9a-f]{64}$/);
  assert.equal(result.asset.source_type, "import");
  assert.equal(result.asset.source_provider, "brand_core");
  assert.equal(result.asset.source_revision, "2026-08-07 10:00:00");
  assert.equal(result.asset.content_sha256, null, "content hash must remain null when provider content was not fetched");
  assert.equal(result.asset.content_identity, `asset_ref:external_ref:${expectedAssetRef}`);
  assert.equal(result.source.source_ref, "asset_key:positioning");
  assert.equal(result.source.provider_content_fetched, false);
  assert.equal(result.workspace.workspace_id, "workspace-root-a");
  assert.equal(result.workspace.workspace_ownership_type, "company");
  assert.equal(result.workspace.brand_workspace_id, "workspace-brand-a");
  assert.equal(result.workspace.brand_container_id, "container-brand-a");
  assert.equal(result.workspace.containment_relationship_id, "relationship-root-a-brand-a");
  const metadata = JSON.parse(connection.stored.metadata_json);
  assert.equal(metadata.root_workspace_id, "workspace-root-a");
  assert.equal(metadata.root_workspace_ownership_type, "company");
  assert.equal(metadata.brand_workspace_id, "workspace-brand-a");
  assert.equal(metadata.brand_container_id, "container-brand-a");
  assert.equal(metadata.brand_container_relationship_id, "relationship-root-a-brand-a");
  assert.equal(metadata.brand_core_asset_ref, expectedAssetRef);
  assert.equal(metadata.brand_core_source_ref, "asset_key:positioning");
  assert.equal(metadata.source_provider, "brand_core");
  assert.equal(metadata.secrets_included, false);
  assert.equal(connection.calls.some((call) => /information_schema/i.test(call.sql)), false, "materialization must not introduce a parallel schema preflight query");
  const sourceLookupCall = connection.calls.find((call) => call.sql.includes("FROM brand_core bc"));
  assert(sourceLookupCall, "materialization must perform one canonical Brand Core source lookup");
  assert.equal(sourceLookupCall.params[0], "brand-a", "Brand Core source lookup must be scoped by the canonical Brand target key only");
  assert.match(sourceLookupCall.sql, /SELECT bc\.\*/, "Brand Core source read must remain schema-compatible without naming optional legacy columns");
  assert(connection.calls.some((call) => call.sql.includes("container_relationships") && call.sql.includes("relationship_type_key='contains'")), "materialization must prove canonical Workspace contains Brand topology");
  assert(connection.calls.some((call) => call.sql.includes("FROM container_closure") && call.sql.includes("FOR UPDATE")), "materialization must require the inherited containment path to be materialized");
  assert(connection.calls.some((call) => call.sql.includes("ON DUPLICATE KEY UPDATE asset_id=asset_id")), "materialization must delegate atomic identity persistence to the canonical asset repository");
  assert(connection.calls.some((call) => call.sql.includes("LIMIT 2 FOR UPDATE") && call.sql.includes("workspace_assets")), "materialization must read persisted lineage back under lock before commit");
}

{
  const legacySource = sourceRow({ status: "", active_status: "TRUE" })[0];
  const connection = buildConnection({ sources: [legacySource] });
  const result = await materialize(connection);
  assert.equal(result.source.source_validation_status, "true", "legacy active_status readiness must remain materializable when the deployed row exposes it");
  const sourceLookupCall = connection.calls.find((call) => call.sql.includes("FROM brand_core bc"));
  assert.match(sourceLookupCall.sql, /SELECT bc\.\*/, "legacy readiness must be preserved by reading the deployed Brand Core row without explicit optional-column dependencies");
  assert.doesNotMatch(sourceLookupCall.sql, /\bactive_status\b/, "legacy readiness compatibility must not make active_status a required SQL column");
}

{
  const source = sourceRow({
    asset_key: null,
    doc_key: null,
    doc_id: "legacy-doc-456",
    file_id: null,
    google_doc_id: null,
  })[0];
  const connection = buildConnection({ sources: [source] });
  const result = await materialize(connection, "https://docs.google.com/document/d/legacy-doc-456/edit");
  assert.equal(result.source.source_ref, "google_file:legacy-doc-456");
  assert.equal(result.asset.asset_ref, buildBrandCoreMaterializedAssetRef("brand-a", source));
  assert.equal(result.asset.asset_type, "external_ref");
}

{
  const source = sourceRow()[0];
  const brandAAssetRef = buildBrandCoreMaterializedAssetRef("brand-a", source);
  const brandBAssetRef = buildBrandCoreMaterializedAssetRef("brand-b", { ...source, brand_key: "brand-b" });
  assert.notEqual(brandAAssetRef, brandBAssetRef, "the same Brand Core source key must materialize to distinct workspace asset identities for different Brands in one tenant");
  assert.equal(brandAAssetRef, buildBrandCoreMaterializedAssetRef("BRAND-A", source), "Brand identity casing must not fork the deterministic materialization identity");
}

{
  const firstRow = sourceRow({ id: 11, asset_key: "positioning", doc_id: "doc-123" })[0];
  const secondRow = sourceRow({ id: 12, asset_key: "positioning", doc_id: "doc-456" })[0];
  assert.notEqual(
    buildBrandCoreMaterializedAssetRef("brand-a", firstRow),
    buildBrandCoreMaterializedAssetRef("brand-a", secondRow),
    "distinct Brand Core rows sharing an asset_key must retain distinct persisted workspace asset identities"
  );
}

{
  const connection = buildConnection({ roots: rootWorkspaceRow({ workspace_ownership_type: null }) });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_root_workspace_unclassified" && error?.status === 409);
  assert.equal(connection.insertAttempts, 0);
}

{
  const connection = buildConnection({ roots: rootWorkspaceRow({ workspace_type: "brand" }) });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_brand_workspace_not_root" && error?.status === 409);
  assert.equal(connection.insertAttempts, 0);
}

{
  const connection = buildConnection({ brandWorkspaces: brandWorkspaceRow({ workspace_ownership_type: "company" }) });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_brand_workspace_root_collision" && error?.status === 409);
  assert.equal(connection.insertAttempts, 0);
}

{
  const connection = buildConnection({ topology: brandTopologyRow({ workspace_subject_ref: "workspace-root-other" }) });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_brand_container_cross_workspace" && error?.status === 403);
  assert.equal(connection.insertAttempts, 0);
}

{
  const row = brandTopologyRow()[0];
  const connection = buildConnection({ topology: [row, { ...row, relationship_id: "relationship-other-parent" }] });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_brand_container_parent_ambiguous" && error?.status === 409);
  assert.equal(connection.insertAttempts, 0);
}

{
  const connection = buildConnection({ closure: [] });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_brand_container_closure_required" && error?.status === 409);
  assert.equal(connection.insertAttempts, 0);
}

{
  const connection = buildConnection({ closure: closureRow({ path_count: 2 }) });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_brand_container_path_ambiguous" && error?.status === 409);
  assert.equal(connection.insertAttempts, 0);
}

{
  const connection = buildConnection({ sources: sourceRow({ status: "inactive" }) });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_source_inactive" && error?.status === 409);
  assert.equal(connection.insertAttempts, 0);
}

for (const validationStatus of ["pending", "unknown"]) {
  const connection = buildConnection({
    sources: sourceRow({ status: "active", validation_status: validationStatus }),
  });
  await assert.rejects(
    materialize(connection),
    (error) => error?.code === "brand_core_source_inactive" && error?.status === 409
  );
  assert.equal(
    connection.insertAttempts,
    0,
    `${validationStatus} validation must fail before workspace asset persistence`
  );
}

{
  const rows = sourceRow();
  const connection = buildConnection({ sources: [rows[0], { ...rows[0], id: 12 }] });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_source_ambiguous" && error?.status === 409);
}

{
  const connection = buildConnection({ brandWorkspaces: [] });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_brand_workspace_required" && error?.status === 422);
}

{
  const connection = buildConnection();
  const first = await materialize(connection);
  const second = await materialize(connection);
  assert.equal(first.asset.asset_id, second.asset.asset_id, "retry must converge on the same canonical persisted asset");
  assert.equal(connection.persistedInserts, 1);
  assert.equal(connection.insertAttempts, 2);
}

{
  const connection = buildConnection();
  const [first, second] = await Promise.all([materialize(connection), materialize(connection)]);
  assert.equal(first.asset.asset_id, second.asset.asset_id, "concurrent materialization must converge through canonical asset serialization");
  assert.equal(connection.persistedInserts, 1);
  assert.equal(connection.insertAttempts, 2);
}

{
  const connection = buildConnection();
  await materialize(connection);
  connection.archiveStored();
  await assert.rejects(
    materialize(connection),
    (error) => error?.code === "brand_core_asset_materialize_readback_mismatch" && error?.status === 409
  );
  assert.equal(connection.stored.lifecycle_status, "archived", "materialization must not silently reactivate an archived workspace asset identity");
  assert.equal(connection.persistedInserts, 1);
}

{
  const connection = buildConnection({
    sourcesByCall: [
      sourceRow(),
      sourceRow({ updated_at: "2026-08-07 11:00:00" }),
    ],
  });
  await materialize(connection);
  await assert.rejects(
    materialize(connection),
    (error) => error?.code === "workspace_asset_identity_provenance_conflict" && error?.status === 409
  );
  assert.equal(connection.persistedInserts, 1, "revision conflict must not silently create or refresh a second authority row");
}

{
  let released = false;
  let committed = false;
  const rollbackError = Object.assign(new Error("simulated rollback interruption"), { code: "ER_CONNECTION_LOST" });
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { throw rollbackError; },
    release() { released = true; },
    async query(sql) {
      if (sql.includes("FROM workspace_registry wr") && sql.includes("JOIN tenants")) return [[]];
      throw new Error(`Unexpected SQL during rollback-failure regression: ${sql}`);
    },
  };
  const pool = { async getConnection() { return connection; } };
  await assert.rejects(
    materializeWorkspaceBrandCoreAssetTransaction({
      workspaceId: "workspace-missing",
      actorUserId: "user-a",
      brandRef: "brand-a",
      sourceRef: "positioning",
    }, { pool }),
    (error) => (
      error?.code === "brand_core_asset_materialize_rollback_failed" &&
      error?.status === 500 &&
      error?.details?.state === "indeterminate" &&
      error?.details?.original_code === "brand_core_materialize_root_workspace_not_found" &&
      error?.details?.rollback_code === "ER_CONNECTION_LOST" &&
      error?.cause?.code === "brand_core_materialize_root_workspace_not_found"
    )
  );
  assert.equal(committed, false, "rollback-failure regression must never commit");
  assert.equal(released, true, "connection must be released after rollback failure is classified as indeterminate");
}

console.log("workspace Brand Core asset materialization canonical root/container lifecycle tests passed");