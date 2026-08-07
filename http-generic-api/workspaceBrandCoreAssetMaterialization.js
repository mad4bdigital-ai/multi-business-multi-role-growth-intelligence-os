import { getPool } from "./db.js";
import { extractGoogleFileId } from "./resolvers/brandReferenceResolver.js";
import { resolveWorkspaceAssetBrandRef } from "./workspaceAssetBrandAuthority.js";
import { parseWorkspaceAssetMetadata } from "./workspaceAssetProvenance.js";
import { createResourceRepository } from "./src/infrastructure/resourceApi/resourceRepository.js";

function materializationError(status, code, message, details = undefined) {
  return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value) {
  return text(value).toLowerCase();
}

function sourceActive(row = {}) {
  const values = [row.status, row.validation_status, row.active_status]
    .map(lower)
    .filter(Boolean);
  if (!values.length) return false;
  if (values.some((value) => ["inactive", "disabled", "archived", "deleted", "invalid", "failed", "false", "0", "no"].includes(value))) {
    return false;
  }
  return values.some((value) => ["active", "validated", "ready", "approved", "published", "true", "1", "yes"].includes(value));
}

function sourceValidationStatus(row = {}) {
  return text(row.validation_status || row.status || row.active_status, 64).toLowerCase();
}

function sourceFileId(row = {}) {
  return text(
    row.doc_id ||
    row.file_id ||
    row.google_doc_id ||
    extractGoogleFileId(row.google_drive_link),
    255
  );
}

function canonicalBrandCoreSourceRef(row = {}) {
  const assetKey = text(row.asset_key, 255);
  if (assetKey) return `asset_key:${assetKey}`;
  const docKey = text(row.doc_key, 255);
  if (docKey) return `doc_key:${docKey}`;
  const fileId = sourceFileId(row);
  if (fileId) return `google_file:${fileId}`;
  return "";
}

function sourceLookupCandidates(value) {
  const raw = text(value, 512);
  if (!raw) return [];
  const extracted = text(extractGoogleFileId(raw), 255);
  return [...new Set([raw, extracted].filter(Boolean))];
}

function sourceRevision(row = {}) {
  return text(row.updated_at || row.created_at, 255);
}

function materializedAssetInput({ workspace, canonicalBrandRef, source }) {
  const canonicalSourceRef = canonicalBrandCoreSourceRef(source);
  if (!canonicalSourceRef) {
    throw materializationError(422, "brand_core_source_identity_unverifiable", "Brand Core source does not expose a stable materialization identity.");
  }
  const validationStatus = sourceValidationStatus(source);
  return {
    asset_type: "external_ref",
    asset_ref: canonicalSourceRef,
    display_name: text(source.document_name || source.asset_key || source.doc_key || canonicalSourceRef, 255),
    brand_ref: canonicalBrandRef,
    visibility: "restricted",
    lifecycle_status: "active",
    source_type: "import",
    source_provider: "brand_core",
    source_uri: `brand-core:${canonicalSourceRef}`,
    source_revision: sourceRevision(source) || null,
    content_sha256: null,
    metadata_json: {
      materialization_source: "brand_core",
      brand_workspace_id: text(workspace.workspace_id, 64),
      brand_workspace_key: text(workspace.workspace_key, 255),
      brand_core_row_id: source.id,
      brand_core_source_ref: canonicalSourceRef,
      brand_core_asset_type: text(source.asset_type, 255) || null,
      source_validation_status: validationStatus || null,
      source_updated_at: source.updated_at || null,
      provider_content_fetched: false,
      secrets_included: false,
    },
  };
}

async function resolveCanonicalBrand(connection, tenantId, actorUserId, requestedBrandRef) {
  const canonicalBrandRef = await resolveWorkspaceAssetBrandRef(connection, {
    tenantId,
    actorId: actorUserId,
    brandRef: requestedBrandRef,
  });
  const [brandRows] = await connection.query(
    `SELECT target_key, brand_name, normalized_brand_name, status
       FROM brands
      WHERE target_key=?
      LIMIT 2 FOR UPDATE`,
    [canonicalBrandRef]
  );
  if (!Array.isArray(brandRows) || brandRows.length !== 1) {
    throw materializationError(409, "brand_core_materialize_brand_invalid", "Canonical Brand identity did not resolve exactly once.");
  }
  const [brand] = brandRows;
  return { brand, canonicalBrandRef };
}

async function resolveBrandWorkspace(connection, tenantId, canonicalBrandRef) {
  const [rows] = await connection.query(
    `SELECT workspace_id, tenant_id, workspace_key, workspace_type, bootstrap_status, linked_brand_key
       FROM workspace_registry
      WHERE tenant_id=? AND workspace_type='brand' AND linked_brand_key=?
      LIMIT 3 FOR UPDATE`,
    [tenantId, canonicalBrandRef]
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw materializationError(
      rows?.length ? 409 : 422,
      rows?.length ? "brand_core_materialize_workspace_ambiguous" : "brand_core_materialize_workspace_required",
      rows?.length ? "Brand Workspace authority resolved ambiguously." : "Canonical Brand Workspace is required before materializing Brand Core assets."
    );
  }
  const [workspace] = rows;
  if (lower(workspace.workspace_type) !== "brand" || text(workspace.linked_brand_key) !== canonicalBrandRef) {
    throw materializationError(409, "brand_core_materialize_workspace_mismatch", "Brand Workspace does not match canonical Brand authority.");
  }
  return workspace;
}

async function resolveBrandCoreSource(connection, brand, sourceLookup) {
  const candidates = sourceLookupCandidates(sourceLookup);
  if (!candidates.length) {
    throw materializationError(400, "brand_core_source_ref_required", "source_ref is required for Brand Core materialization.");
  }
  const brandRefs = [...new Set([
    text(brand.target_key, 255),
    text(brand.brand_name, 255),
    text(brand.normalized_brand_name, 255),
  ].filter(Boolean).map((value) => value.toLowerCase()))];
  const sourceConditions = candidates.map(() => `(
    asset_key=? OR doc_key=? OR doc_id=? OR file_id=? OR google_doc_id=? OR google_drive_link=?
  )`).join(" OR ");
  const sourceParams = candidates.flatMap((candidate) => [candidate, candidate, candidate, candidate, candidate, candidate]);
  const brandPlaceholders = brandRefs.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT id, brand_key, brand_name, asset_key, doc_key, doc_id, file_id, google_doc_id,
            google_drive_link, asset_type, document_name, status, validation_status,
            active_status, created_at, updated_at
       FROM brand_core
      WHERE (LOWER(COALESCE(brand_key,'')) IN (${brandPlaceholders})
         OR LOWER(COALESCE(brand_name,'')) IN (${brandPlaceholders}))
        AND (${sourceConditions})
      ORDER BY updated_at DESC, id DESC
      LIMIT 3 FOR UPDATE`,
    [...brandRefs, ...brandRefs, ...sourceParams]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw materializationError(404, "brand_core_source_not_found", "Brand Core source did not resolve inside the canonical Brand.");
  }
  if (rows.length !== 1) {
    throw materializationError(409, "brand_core_source_ambiguous", "Brand Core source resolved to multiple rows; materialization fails closed.", { count: rows.length });
  }
  const [source] = rows;
  if (!sourceActive(source)) {
    throw materializationError(409, "brand_core_source_inactive", "Brand Core source is not active and validated for materialization.");
  }
  if (!canonicalBrandCoreSourceRef(source)) {
    throw materializationError(422, "brand_core_source_identity_unverifiable", "Brand Core source does not expose a stable materialization identity.");
  }
  return source;
}

async function persistMaterializedAsset(connection, {
  tenantId,
  actorUserId,
  workspace,
  canonicalBrandRef,
  source,
}) {
  const repository = createResourceRepository({ pool: connection, transactionConnection: true });
  const member = await repository.findMembership(actorUserId, tenantId);
  if (!member || member.status !== "active" || member.tenant_status !== "active") {
    throw materializationError(403, "active_membership_required", "Active workspace membership required.");
  }

  const input = materializedAssetInput({ workspace, canonicalBrandRef, source });
  const assetId = await repository.insertAsset({ tenantId, actorId: actorUserId, input });

  const [lineageRows] = await connection.query(
    `SELECT asset_id, tenant_id, asset_type, asset_ref, brand_ref, lifecycle_status, metadata_json, created_by
       FROM workspace_assets
      WHERE asset_id=? AND tenant_id=?
      LIMIT 2 FOR UPDATE`,
    [assetId, tenantId]
  );
  if (!Array.isArray(lineageRows) || lineageRows.length !== 1) {
    throw materializationError(409, "brand_core_asset_materialize_readback_invalid", "Materialized asset did not resolve exactly once before commit.");
  }
  const [lineage] = lineageRows;
  const metadata = parseWorkspaceAssetMetadata(lineage.metadata_json);
  const expectedSourceRef = canonicalBrandCoreSourceRef(source);
  if (
    text(lineage.asset_type) !== input.asset_type ||
    text(lineage.asset_ref) !== expectedSourceRef ||
    text(lineage.brand_ref) !== canonicalBrandRef ||
    text(metadata.brand_workspace_id) !== text(workspace.workspace_id, 64) ||
    text(metadata.brand_core_source_ref) !== expectedSourceRef ||
    text(metadata.source_provider) !== "brand_core" ||
    text(metadata.source_type) !== "import" ||
    text(metadata.source_revision) !== text(input.source_revision, 255) ||
    metadata.content_sha256 !== null ||
    metadata.provider_content_fetched !== false ||
    metadata.secrets_included !== false
  ) {
    throw materializationError(409, "brand_core_asset_materialize_readback_mismatch", "Materialized asset lineage does not match canonical Brand Core authority.");
  }

  const context = {
    tenantId,
    member,
    auth: { mode: "user_jwt", user_id: actorUserId, tenant_id: tenantId, is_admin: false },
  };
  const asset = await repository.getResource("assets", assetId, context);
  if (!asset || text(asset.asset_id) !== text(assetId, 64) || asset.source_provider !== "brand_core") {
    throw materializationError(409, "brand_core_asset_materialize_projection_invalid", "Canonical asset projection did not match the persisted Brand Core materialization.");
  }
  return asset;
}

export async function materializeWorkspaceBrandCoreAsset(connection, {
  tenantId,
  actorUserId,
  brandRef,
  sourceRef,
}) {
  const tenant = text(tenantId, 64);
  const actor = text(actorUserId, 64);
  const requestedBrand = text(brandRef, 512);
  if (!tenant || !actor || !requestedBrand) {
    throw materializationError(400, "brand_core_materialize_identity_required", "tenant, signed-in user, and brand_ref are required.");
  }
  const { brand, canonicalBrandRef } = await resolveCanonicalBrand(connection, tenant, actor, requestedBrand);
  const workspace = await resolveBrandWorkspace(connection, tenant, canonicalBrandRef);
  const source = await resolveBrandCoreSource(connection, brand, sourceRef);
  const asset = await persistMaterializedAsset(connection, {
    tenantId: tenant,
    actorUserId: actor,
    workspace,
    canonicalBrandRef,
    source,
  });
  return {
    asset,
    source: {
      source_type: asset.source_type,
      source_provider: asset.source_provider,
      source_ref: canonicalBrandCoreSourceRef(source),
      source_revision: asset.source_revision,
      source_validation_status: sourceValidationStatus(source),
      content_sha256: asset.content_sha256,
      content_identity: asset.content_identity,
      provider_content_fetched: false,
    },
    workspace: {
      workspace_id: workspace.workspace_id,
      workspace_key: workspace.workspace_key,
      brand_ref: canonicalBrandRef,
    },
  };
}

export async function materializeWorkspaceBrandCoreAssetTransaction({
  tenantId,
  actorUserId,
  brandRef,
  sourceRef,
}, { pool = getPool() } = {}) {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_brand_core_asset_materialize
    transactionStarted = true;
    const result = await materializeWorkspaceBrandCoreAsset(connection, {
      tenantId,
      actorUserId,
      brandRef,
      sourceRef,
    });
    if (
      !result?.asset?.asset_id ||
      result.asset.source_provider !== "brand_core" ||
      !result.asset.content_identity
    ) {
      throw materializationError(409, "brand_core_asset_materialize_readback_missing", "Brand Core materialization did not produce an exact canonical asset projection.");
    } // MUTATION_READBACK: workspace_brand_core_asset_materialize
    await connection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const _testingWorkspaceBrandCoreAssetMaterialization = {
  sourceActive,
  sourceValidationStatus,
  sourceFileId,
  canonicalBrandCoreSourceRef,
  sourceLookupCandidates,
  sourceRevision,
  materializedAssetInput,
};
