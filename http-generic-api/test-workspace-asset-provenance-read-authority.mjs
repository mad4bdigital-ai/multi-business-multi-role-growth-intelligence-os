import assert from "node:assert/strict";
import { createResourceRepository } from "./src/infrastructure/resourceApi/resourceRepository.js";
import { buildWorkspaceAssetProvenance } from "./workspaceAssetProvenance.js";

const CHECKSUM_A = "a".repeat(64);
const CHECKSUM_B = "b".repeat(64);

function buildMutationExecutor() {
  const calls = [];
  const inserted = [];
  let assetState = null;
  return {
    calls,
    inserted,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM tenant_brand_links tbl")) {
        return [[{
          tenant_id: "tenant-a",
          brand_target_key: "brand-key",
          link_status: "active",
          brand_status: "active",
        }]];
      }
      if (sql.includes("FROM memberships m") && sql.includes("FOR UPDATE")) {
        return [[{
          user_id: "user-a",
          tenant_id: "tenant-a",
          role: "owner",
          status: "active",
          tenant_status: "active",
        }]];
      }
      if (sql.includes("FROM workspace_assets") && sql.includes("WHERE tenant_id=? AND asset_type=? AND asset_ref=?")) {
        return [assetState ? [assetState] : []];
      }
      if (sql.includes("INSERT INTO workspace_assets")) {
        inserted.push(params);
        assetState = {
          asset_id: params[0],
          tenant_id: params[1],
          asset_type: params[3],
          asset_ref: params[4],
          brand_ref: params[6],
          lifecycle_status: params[11],
          metadata_json: params[12],
          created_by: params[13],
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("UPDATE workspace_assets") && sql.includes("metadata_json=?")) {
        assetState = { ...assetState, metadata_json: params[0] };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM workspace_assets") && sql.includes("WHERE asset_id=? AND tenant_id=?")) {
        return [assetState ? [assetState] : []];
      }
      throw new Error(`Unexpected SQL in workspace asset provenance test: ${sql}`);
    },
  };
}

function assetInput(overrides = {}) {
  return {
    asset_id: "asset-a",
    asset_type: "image",
    asset_ref: "drive-file-123",
    display_name: "Hero image",
    brand_ref: "Brand Alias",
    visibility: "restricted",
    lifecycle_status: "active",
    source_type: "import",
    source_provider: "google_drive",
    source_uri: "https://drive.google.com/file/d/drive-file-123",
    source_revision: "rev-7",
    content_sha256: CHECKSUM_A,
    ...overrides,
  };
}

async function insert(executor, overrides = {}) {
  const repository = createResourceRepository({ pool: executor, transactionConnection: true });
  return repository.insertAsset({
    tenantId: "tenant-a",
    actorId: "user-a",
    input: assetInput(overrides),
  });
}

{
  const executor = buildMutationExecutor();
  const first = await insert(executor);
  const second = await insert(executor);
  assert.equal(first, "asset-a");
  assert.equal(second, "asset-a");
  assert.equal(executor.inserted.length, 1, "same durable identity and compatible provenance must reuse the existing row");
  const persistedMetadata = JSON.parse(executor.inserted[0][12]);
  assert.equal(persistedMetadata.source_type, "import");
  assert.equal(persistedMetadata.source_provider, "google_drive");
  assert.equal(persistedMetadata.content_sha256, CHECKSUM_A);
  assert.equal(persistedMetadata.content_identity, `sha256:${CHECKSUM_A}`);
  assert.equal(persistedMetadata.brand_target_key, "brand-key");
  assert.equal(persistedMetadata.secrets_included, false);
}

{
  const executor = buildMutationExecutor();
  await insert(executor);
  await assert.rejects(
    () => insert(executor, { content_sha256: CHECKSUM_B }),
    (error) => error?.code === "workspace_asset_identity_checksum_conflict" && error?.status === 409
  );
  assert.equal(executor.inserted.length, 1, "checksum conflict must fail closed without a duplicate insert");
}

{
  const executor = buildMutationExecutor();
  await insert(executor);
  await assert.rejects(
    () => insert(executor, { source_revision: "rev-8" }),
    (error) => error?.code === "workspace_asset_identity_provenance_conflict" && error?.status === 409
  );
  assert.equal(executor.inserted.length, 1, "provenance conflict must fail closed without a duplicate insert");
}

{
  const executor = buildMutationExecutor();
  await assert.rejects(
    () => insert(executor, { source_uri: "https://example.com/file?access_token=secret" }),
    (error) => error?.code === "workspace_asset_source_uri_sensitive" && error?.status === 400
  );
  assert.equal(executor.inserted.length, 0);
}

{
  const executor = buildMutationExecutor();
  await assert.rejects(
    () => insert(executor, { asset_ref: "" }),
    (error) => error?.code === "workspace_asset_ref_required" && error?.status === 400
  );
  assert.equal(executor.calls.length, 0, "missing durable asset identity must fail before authority or persistence queries");
}

{
  const calls = [];
  const executor = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [[]];
    },
  };
  const repository = createResourceRepository({ pool: executor, transactionConnection: true });
  const context = {
    tenantId: "tenant-a",
    member: { role: "member" },
    auth: { user_id: "user-a" },
  };
  await repository.listResource("assets", {}, context);
  assert.match(calls[0].sql, /v_workspace_resource_grant_effective g/);
  assert.match(calls[0].sql, /g\.resource_type='brand'/);
  assert.match(calls[0].sql, /ag\.resource_type='asset'/);
  assert.match(calls[0].sql, /LOWER\(g\.resource_ref\)=LOWER\(r\.brand_ref\)/);
  assert.match(calls[0].sql, /LOWER\(ag\.resource_ref\)=LOWER\(r\.asset_id\)/);
  assert.deepEqual(calls[0].params.slice(0, 5), ["tenant-a", "tenant-a", "user-a", "tenant-a", "user-a"]);
}

{
  const calls = [];
  const executor = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [[]];
    },
  };
  const repository = createResourceRepository({ pool: executor, transactionConnection: true });
  const context = {
    tenantId: "tenant-a",
    member: { role: "member" },
    auth: { user_id: "user-a" },
  };
  await repository.getResource("assets", "asset-a", context);
  assert.match(calls[0].sql, /v_workspace_resource_grant_effective g/);
  assert.deepEqual(calls[0].params, ["asset-a", "tenant-a", "tenant-a", "user-a", "tenant-a", "user-a"]);
}

{
  const calls = [];
  const executor = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [[]];
    },
  };
  const repository = createResourceRepository({ pool: executor, transactionConnection: true });
  const context = {
    tenantId: "tenant-a",
    member: { role: "owner" },
    auth: { user_id: "owner-a" },
  };
  await repository.listResource("assets", {}, context);
  assert.doesNotMatch(calls[0].sql, /v_workspace_resource_grant_effective/, "workspace owners retain full tenant asset read authority");
}

assert.throws(
  () => buildWorkspaceAssetProvenance({
    asset_ref: "x",
    source_type: "import",
    content_sha256: "not-a-sha",
  }, {
    tenantId: "tenant-a",
    brandRef: "brand-key",
    actorId: "user-a",
    assetType: "image",
    assetRef: "x",
  }),
  (error) => error?.code === "workspace_asset_checksum_invalid" && error?.status === 400
);

console.log("workspace asset provenance and read authority tests passed");
