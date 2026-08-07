import assert from "node:assert/strict";
import { materializeWorkspaceBrandCoreAsset } from "./workspaceBrandCoreAssetMaterialization.js";

const REQUIRED_COLUMNS = [
  "workspace_id","source_type","source_ref","source_ref_sha256","source_revision",
  "source_updated_at","source_validation_status","provenance_sha256","content_sha256",
];

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
  return [{ target_key: "brand-a", brand_name: "Brand A", normalized_brand_name: "brand a", status: "active" }];
}

function workspaceRow() {
  return [{
    workspace_id: "workspace-brand-a",
    tenant_id: "tenant-a",
    workspace_key: "brand_workspace_a",
    workspace_type: "brand",
    bootstrap_status: "in_progress",
    linked_brand_key: "brand-a",
  }];
}

function sourceRow(overrides = {}) {
  return [{
    id: 11,
    brand_key: "brand-a",
    brand_name: "Brand A",
    asset_key: "positioning",
    doc_key: null,
    doc_id: "doc-123",
    file_id: null,
    google_doc_id: null,
    google_drive_link: "https://docs.google.com/document/d/doc-123/edit",
    asset_type: "Brand Positioning",
    document_name: "Brand A Positioning",
    status: "active",
    validation_status: "validated",
    active_status: "TRUE",
    created_at: "2026-08-01 10:00:00",
    updated_at: "2026-08-07 10:00:00",
    ...overrides,
  }];
}

function buildConnection({
  schemaColumns = REQUIRED_COLUMNS,
  brandLinks = canonicalBrandLink(),
  memberships = ownerMembership(),
  brands = brandRow(),
  workspaces = workspaceRow(),
  sources = sourceRow(),
  readbackOverride = null,
} = {}) {
  const calls = [];
  let inserted = null;
  return {
    calls,
    get inserted() { return inserted; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM information_schema.columns")) {
        return [schemaColumns.map((column_name) => ({ column_name }))];
      }
      if (sql.includes("FROM tenant_brand_links tbl")) return [brandLinks];
      if (sql.includes("FROM memberships m") && sql.includes("FOR UPDATE")) return [memberships];
      if (sql.includes("FROM v_workspace_resource_grant_effective")) return [[{ grant_id: "grant-edit", permission: "edit" }]];
      if (sql.includes("FROM brands") && sql.includes("WHERE target_key=?")) return [brands];
      if (sql.includes("FROM workspace_registry")) return [workspaces];
      if (sql.includes("FROM brand_core")) return [sources];
      if (sql.includes("INSERT INTO workspace_assets")) {
        inserted = {
          asset_id: params[0],
          tenant_id: params[1],
          workspace_id: params[2],
          asset_type: params[3],
          asset_ref: params[4],
          display_name: params[5],
          brand_ref: params[6],
          visibility: "restricted",
          lifecycle_status: "active",
          source_type: "brand_core",
          source_ref: params[7],
          source_ref_sha256: params[8],
          source_revision: params[9],
          source_updated_at: params[10],
          source_validation_status: params[11],
          provenance_sha256: params[12],
          content_sha256: null,
          created_by: params[14],
          created_at: "2026-08-07 10:01:00",
          updated_at: "2026-08-07 10:01:00",
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM workspace_assets") && sql.includes("source_ref_sha256=?")) {
        return [[readbackOverride || inserted].filter(Boolean)];
      }
      throw new Error(`Unexpected SQL in Brand Core materialization test: ${sql}`);
    },
  };
}

async function materialize(connection, sourceRef = "positioning") {
  return materializeWorkspaceBrandCoreAsset(connection, {
    tenantId: "tenant-a",
    actorUserId: "user-a",
    brandRef: "Brand A",
    sourceRef,
  });
}

{
  const connection = buildConnection();
  const result = await materialize(connection);
  assert.equal(result.asset.brand_ref, "brand-a");
  assert.equal(result.asset.workspace_id, "workspace-brand-a");
  assert.equal(result.asset.source_type, "brand_core");
  assert.equal(result.asset.source_ref, "asset_key:positioning");
  assert.match(result.asset.source_ref_sha256, /^[0-9a-f]{64}$/);
  assert.match(result.asset.provenance_sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.asset.content_sha256, null, "content hash must remain null when content was not fetched or hashed");
  assert.equal(result.source.provider_content_fetched, false);
  assert(connection.calls.some((call) => call.sql.includes("LIMIT 2 FOR UPDATE") && call.sql.includes("workspace_assets")), "materialization must read persisted provenance back under lock before commit");
}

{
  const connection = buildConnection({
    sources: sourceRow({
      asset_key: null,
      doc_key: null,
      doc_id: null,
      file_id: null,
      google_doc_id: null,
      google_drive_link: "https://docs.google.com/document/d/legacy-doc-456/edit",
      document_name: "Legacy Positioning",
    }),
  });
  const result = await materialize(connection, "https://docs.google.com/document/d/legacy-doc-456/edit");
  assert.equal(result.asset.source_ref, "google_file:legacy-doc-456");
  assert.equal(result.asset.asset_ref, "legacy-doc-456");
  assert.equal(result.asset.asset_type, "doc");
}

{
  const connection = buildConnection({ schemaColumns: REQUIRED_COLUMNS.slice(0, -1) });
  await assert.rejects(
    materialize(connection),
    (error) => error?.code === "workspace_asset_provenance_schema_required" && error?.status === 503
  );
  assert(!connection.calls.some((call) => call.sql.includes("INSERT INTO workspace_assets")), "missing migration must fail before persistence");
}

{
  const connection = buildConnection({ sources: sourceRow({ status: "inactive", validation_status: "invalid", active_status: "FALSE" }) });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_source_inactive" && error?.status === 409);
  assert(!connection.calls.some((call) => call.sql.includes("INSERT INTO workspace_assets")));
}

{
  const rows = sourceRow();
  const connection = buildConnection({ sources: [rows[0], { ...rows[0], id: 12 }] });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_source_ambiguous" && error?.status === 409);
}

{
  const connection = buildConnection({ workspaces: [] });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_materialize_workspace_required" && error?.status === 422);
}

{
  const connection = buildConnection();
  const first = await materialize(connection);
  const second = await materialize(connection);
  assert.equal(first.asset.source_ref_sha256, second.asset.source_ref_sha256, "retry must converge on the same provenance identity");
  assert.equal(first.asset.brand_ref, second.asset.brand_ref);
}

{
  const base = buildConnection();
  await materialize(base);
  const bad = { ...base.inserted, provenance_sha256: "0".repeat(64) };
  const connection = buildConnection({ readbackOverride: bad });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_asset_materialize_readback_mismatch" && error?.status === 409);
}

console.log("workspace Brand Core asset materialization tests passed");
