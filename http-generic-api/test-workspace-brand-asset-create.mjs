import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWorkspaceAsset } from "./workspaceAssetLifecycle.js";

const BRAND_KEY = "workspace_brand_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_BRAND_KEY = "workspace_brand_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CHECKSUM_A = "a".repeat(64);
const CHECKSUM_B = "b".repeat(64);

function membership(role = "owner") {
  return [{ user_id: "user-a", tenant_id: "tenant-a", role, status: "active", tenant_status: "active" }];
}

function brandRows(targetKey = BRAND_KEY) {
  return [{
    link_id: "link-a",
    tenant_id: "tenant-a",
    brand_target_key: targetKey,
    link_status: "active",
    brand_name: "Acme Travel",
    normalized_brand_name: "acme travel",
    target_key: targetKey,
    brand_status: "active",
  }];
}

function brandWorkspace(targetKey = BRAND_KEY) {
  return [{
    workspace_id: "workspace-brand-a",
    tenant_id: "tenant-a",
    workspace_key: "brand_workspace_a",
    workspace_type: "brand",
    bootstrap_status: "in_progress",
    linked_brand_key: targetKey,
  }];
}

function buildConnection({
  membershipRows = membership(),
  tenantBrandRows = brandRows(),
  workspaceRows = brandWorkspace(),
  grantRows = [],
  vaultRows = [],
  existingAsset = null,
} = {}) {
  const queries = [];
  let assetState = existingAsset ? { ...existingAsset } : null;
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM memberships m\s+JOIN tenants t/.test(sql)) return [membershipRows];
      if (/FROM tenant_brand_links tbl\s+JOIN brands b/.test(sql)) return [tenantBrandRows];
      if (/FROM workspace_registry/.test(sql) && /linked_brand_key=\?/.test(sql)) return [workspaceRows];
      if (/FROM workspace_resource_grants/.test(sql)) return [grantRows];
      if (/FROM workspace_vaults/.test(sql)) return [vaultRows];
      if (/FROM workspace_assets/.test(sql) && /asset_type=\? AND asset_ref=\?/.test(sql)) {
        return [assetState ? [assetState] : []];
      }
      if (/INSERT INTO workspace_assets/.test(sql)) {
        assetState = {
          asset_id: params[0],
          tenant_id: params[1],
          vault_id: params[2],
          asset_type: params[3],
          asset_ref: params[4],
          display_name: params[5],
          brand_ref: params[6],
          site_ref: null,
          workflow_ref: null,
          session_ref: null,
          visibility: params[7],
          lifecycle_status: params[8],
          metadata_json: params[9],
          created_by: params[10],
          created_at: "2026-08-07T13:50:00Z",
          updated_at: "2026-08-07T13:50:00Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE workspace_assets/.test(sql) && /metadata_json=\?/.test(sql)) {
        assetState = { ...assetState, metadata_json: params[0], updated_at: "2026-08-07T13:51:00Z" };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in workspace Brand Asset test: ${sql}`);
    },
  };
}

function request(overrides = {}) {
  return {
    tenantId: "tenant-a",
    actorUserId: "user-a",
    assetType: "image",
    assetRef: "drive-file-123",
    brandRef: BRAND_KEY,
    displayName: "Hero image",
    visibility: "restricted",
    lifecycleStatus: "active",
    sourceType: "import",
    sourceProvider: "google_drive",
    sourceUri: "https://drive.google.com/file/d/drive-file-123",
    sourceRevision: "rev-7",
    contentSha256: CHECKSUM_A,
    ...overrides,
  };
}

function persistedAsset({
  brandRef = BRAND_KEY,
  checksum = CHECKSUM_A,
  sourceType = "import",
  lifecycleStatus = "active",
} = {}) {
  return {
    asset_id: "asset-existing",
    tenant_id: "tenant-a",
    vault_id: null,
    asset_type: "image",
    asset_ref: "drive-file-123",
    display_name: "Hero image",
    brand_ref: brandRef,
    site_ref: null,
    workflow_ref: null,
    session_ref: null,
    visibility: "restricted",
    lifecycle_status: lifecycleStatus,
    metadata_json: JSON.stringify({
      schema_version: "workspace-asset-provenance-v1",
      source_type: sourceType,
      source_provider: "google_drive",
      source_uri: "https://drive.google.com/file/d/drive-file-123",
      source_revision: "rev-7",
      content_sha256: checksum,
      content_identity: `sha256:${checksum}`,
      ingestion_mode: "import",
      tenant_id: "tenant-a",
      brand_target_key: brandRef,
      created_by_user_id: "user-a",
      secrets_included: false,
    }),
    created_by: "user-a",
    created_at: "2026-08-07T13:40:00Z",
    updated_at: "2026-08-07T13:40:00Z",
  };
}

{
  const connection = buildConnection();
  const result = await createWorkspaceAsset(connection, request());
  assert.equal(result.created, true);
  assert.equal(result.asset.brand_ref, BRAND_KEY);
  assert.equal(result.asset.asset_type, "image");
  assert.equal(result.asset.provenance.source_type, "import");
  assert.equal(result.asset.provenance.content_sha256, CHECKSUM_A);
  assert.equal(result.asset.provenance.content_identity, `sha256:${CHECKSUM_A}`);
  assert.equal(result.authority.mode, "workspace_owner");
  assert.equal(result.brand_workspace.linked_brand_key, BRAND_KEY);
  const sql = connection.queries.map((entry) => entry.sql).join("\n");
  assert.match(sql, /tenant_brand_links/);
  assert.match(sql, /workspace_registry/);
  assert.match(sql, /INSERT INTO workspace_assets/);
  assert.match(sql, /LIMIT 2 FOR UPDATE/);
}

{
  const connection = buildConnection({ existingAsset: persistedAsset() });
  const result = await createWorkspaceAsset(connection, request());
  assert.equal(result.created, false, "same durable identity and provenance must be idempotently reused");
  assert.equal(result.asset.asset_id, "asset-existing");
  assert.equal(connection.queries.some((entry) => /INSERT INTO workspace_assets/.test(entry.sql)), false);
}

{
  const connection = buildConnection({
    membershipRows: membership("member"),
    grantRows: [{ grant_id: "grant-edit", permission: "edit", status: "active", expires_at: null }],
  });
  const result = await createWorkspaceAsset(connection, request());
  assert.equal(result.created, true);
  assert.equal(result.authority.mode, "brand_grant");
  assert.equal(result.authority.permission, "edit");
  assert.equal(result.authority.grant_id, "grant-edit");
}

{
  const connection = buildConnection({ membershipRows: membership("member"), grantRows: [] });
  await assert.rejects(
    () => createWorkspaceAsset(connection, request()),
    (error) => error?.code === "workspace_asset_brand_authority_required"
  );
  assert.equal(connection.queries.some((entry) => /INSERT INTO workspace_assets/.test(entry.sql)), false, "plain membership must never mutate a Brand Asset");
}

{
  const connection = buildConnection({ tenantBrandRows: [] });
  await assert.rejects(
    () => createWorkspaceAsset(connection, request({ brandRef: OTHER_BRAND_KEY })),
    (error) => error?.code === "workspace_asset_brand_not_found"
  );
  assert.equal(connection.queries.some((entry) => /workspace_assets/.test(entry.sql)), false, "cross-tenant/missing Brand must fail before asset identity access");
}

{
  const connection = buildConnection({ existingAsset: persistedAsset({ brandRef: OTHER_BRAND_KEY }) });
  await assert.rejects(
    () => createWorkspaceAsset(connection, request()),
    (error) => error?.code === "workspace_asset_identity_brand_conflict"
  );
  assert.equal(connection.queries.some((entry) => /UPDATE workspace_assets|INSERT INTO workspace_assets/.test(entry.sql)), false);
}

{
  const connection = buildConnection({ existingAsset: persistedAsset({ checksum: CHECKSUM_B }) });
  await assert.rejects(
    () => createWorkspaceAsset(connection, request()),
    (error) => error?.code === "workspace_asset_identity_checksum_conflict"
  );
  assert.equal(connection.queries.some((entry) => /UPDATE workspace_assets|INSERT INTO workspace_assets/.test(entry.sql)), false);
}

{
  const connection = buildConnection({ existingAsset: persistedAsset({ lifecycleStatus: "deleted" }) });
  await assert.rejects(
    () => createWorkspaceAsset(connection, request()),
    (error) => error?.code === "workspace_asset_identity_deleted"
  );
}

{
  const connection = buildConnection();
  await assert.rejects(
    () => createWorkspaceAsset(connection, request({ contentSha256: "not-a-sha256" })),
    (error) => error?.code === "workspace_asset_checksum_invalid"
  );
  assert.equal(connection.queries.length, 0, "invalid checksum must fail before database authority resolution");
}

{
  const connection = buildConnection();
  await assert.rejects(
    () => createWorkspaceAsset(connection, request({ sourceType: "signed_url_secret" })),
    (error) => error?.code === "workspace_asset_source_type_invalid"
  );
  assert.equal(connection.queries.length, 0);
}

{
  const connection = buildConnection({ vaultRows: [] });
  await assert.rejects(
    () => createWorkspaceAsset(connection, request({ vaultId: "vault-other" })),
    (error) => error?.code === "workspace_asset_vault_invalid"
  );
  assert.equal(connection.queries.some((entry) => /INSERT INTO workspace_assets/.test(entry.sql)), false);
}

const routeSource = await fs.readFile(new URL("./routes/workspaceResourceRoutes.js", import.meta.url), "utf8");
assert.match(routeSource, /RESOURCE_API_CALLABILITY_CONTRACT: workspace_asset_create/);
assert.match(routeSource, /router\.post\("\/me\/workspaces\/:tenant_id\/assets"/);
assert.match(routeSource, /createWorkspaceAsset\(connection,/);
assert.match(routeSource, /await connection\.beginTransaction\(\); \/\/ MUTATION_TRANSACTION: workspace_asset_create/);
assert.match(routeSource, /idempotent_reuse: !result\.created/);
assert.match(routeSource, /await connection\.commit\(\)/);
assert.match(routeSource, /await connection\.rollback\(\)/);
assert.match(routeSource, /secrets_included: false/);

console.log("workspace Brand Asset create tests passed");
