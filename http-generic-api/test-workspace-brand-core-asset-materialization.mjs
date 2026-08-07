import assert from "node:assert/strict";
import { materializeWorkspaceBrandCoreAsset } from "./workspaceBrandCoreAssetMaterialization.js";

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
  brandLinks = canonicalBrandLink(),
  memberships = ownerMembership(),
  brands = brandRow(),
  workspaces = workspaceRow(),
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
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM tenant_brand_links tbl")) return [brandLinks];
      if (sql.includes("FROM memberships m") && sql.includes("FOR UPDATE")) return [memberships];
      if (sql.includes("FROM memberships m") && sql.includes("LIMIT 1")) return [memberships];
      if (sql.includes("FROM v_workspace_resource_grant_effective")) return [[{ grant_id: "grant-edit", permission: "edit" }]];
      if (sql.includes("FROM brands") && sql.includes("WHERE target_key=?")) return [brands];
      if (sql.includes("FROM workspace_registry")) return [workspaces];
      if (sql.includes("FROM brand_core")) {
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
  assert.equal(result.asset.asset_type, "brand_core");
  assert.equal(result.asset.asset_ref, "asset_key:positioning");
  assert.equal(result.asset.source_type, "import");
  assert.equal(result.asset.source_provider, "brand_core");
  assert.equal(result.asset.source_revision, "2026-08-07 10:00:00");
  assert.equal(result.asset.content_sha256, null, "content hash must remain null when provider content was not fetched");
  assert.equal(result.asset.content_identity, "asset_ref:brand_core:asset_key:positioning");
  assert.equal(result.source.provider_content_fetched, false);
  assert.equal(result.workspace.workspace_id, "workspace-brand-a");
  const metadata = JSON.parse(connection.stored.metadata_json);
  assert.equal(metadata.brand_workspace_id, "workspace-brand-a");
  assert.equal(metadata.brand_core_source_ref, "asset_key:positioning");
  assert.equal(metadata.source_provider, "brand_core");
  assert.equal(metadata.secrets_included, false);
  assert(connection.calls.some((call) => call.sql.includes("ON DUPLICATE KEY UPDATE asset_id=asset_id")), "materialization must delegate atomic identity persistence to the canonical asset repository");
  assert(connection.calls.some((call) => call.sql.includes("LIMIT 2 FOR UPDATE") && call.sql.includes("workspace_assets")), "materialization must read persisted lineage back under lock before commit");
  assert(!connection.calls.some((call) => call.sql.includes("information_schema")), "materialization must not depend on a parallel provenance schema migration");
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
  assert.equal(result.source.source_ref, "google_file:legacy-doc-456");
  assert.equal(result.asset.asset_ref, "google_file:legacy-doc-456");
  assert.equal(result.asset.asset_type, "brand_core");
}

{
  const connection = buildConnection({ sources: sourceRow({ status: "inactive", validation_status: "invalid", active_status: "FALSE" }) });
  await assert.rejects(materialize(connection), (error) => error?.code === "brand_core_source_inactive" && error?.status === 409);
  assert.equal(connection.insertAttempts, 0);
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

console.log("workspace Brand Core asset materialization canonical lifecycle tests passed");
