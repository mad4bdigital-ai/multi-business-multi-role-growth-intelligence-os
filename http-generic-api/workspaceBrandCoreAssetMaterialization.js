import { createHash, randomUUID } from "node:crypto";
import { extractGoogleFileId } from "./resolvers/brandReferenceResolver.js";
import { resolveWorkspaceAssetBrandRef } from "./workspaceAssetBrandAuthority.js";

const REQUIRED_PROVENANCE_COLUMNS = [
  "workspace_id",
  "source_type",
  "source_ref",
  "source_ref_sha256",
  "source_revision",
  "source_updated_at",
  "source_validation_status",
  "provenance_sha256",
  "content_sha256",
];

function materializationError(status, code, message, details = undefined) {
  return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value) {
  return text(value).toLowerCase();
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
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

function inferWorkspaceAssetType(row = {}) {
  const docId = text(row.doc_id || row.google_doc_id, 255);
  const fileId = text(row.file_id, 255);
  const link = lower(row.google_drive_link);
  if (docId || link.includes("docs.google.com/document")) return "doc";
  if (fileId || link.includes("drive.google.com")) return "drive_file";
  return "external_ref";
}

function assetLocator(row = {}, sourceRef = "") {
  return sourceFileId(row) || text(row.google_drive_link, 512) || sourceRef;
}

function sourceRevision(row = {}) {
  return text(row.updated_at || row.created_at, 191);
}

function canonicalProvenance({ tenantId, workspaceId, brandRef, sourceRef, revision, validationStatus }) {
  return JSON.stringify({
    schema: "workspace_asset_brand_core_provenance_v1",
    tenant_id: tenantId,
    workspace_id: workspaceId,
    brand_ref: brandRef,
    source_type: "brand_core",
    source_ref: sourceRef,
    source_revision: revision || null,
    source_validation_status: validationStatus || null,
  });
}

async function assertProvenanceSchema(connection) {
  const [rows] = await connection.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema=DATABASE()
        AND table_name='workspace_assets'
        AND column_name IN (${REQUIRED_PROVENANCE_COLUMNS.map(() => "?").join(",")})`,
    REQUIRED_PROVENANCE_COLUMNS
  );
  const present = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.column_name || "")));
  const missing = REQUIRED_PROVENANCE_COLUMNS.filter((column) => !present.has(column));
  if (missing.length) {
    throw materializationError(
      503,
      "workspace_asset_provenance_schema_required",
      "Workspace asset provenance schema migration is required before Brand Core materialization.",
      { migration: "1050_workspace_asset_provenance_content_identity.sql", missing_columns: missing }
    );
  }
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
  const canonicalSourceRef = canonicalBrandCoreSourceRef(source);
  if (!canonicalSourceRef) {
    throw materializationError(422, "brand_core_source_identity_unverifiable", "Brand Core source does not expose a stable materialization identity.");
  }
  return source;
}

async function materializeAsset(connection, {
  tenantId,
  actorUserId,
  workspace,
  canonicalBrandRef,
  source,
}) {
  const canonicalSourceRef = canonicalBrandCoreSourceRef(source);
  const sourceRefSha256 = sha256(canonicalSourceRef);
  const revision = sourceRevision(source);
  const validationStatus = sourceValidationStatus(source);
  const provenance = canonicalProvenance({
    tenantId,
    workspaceId: text(workspace.workspace_id, 64),
    brandRef: canonicalBrandRef,
    sourceRef: canonicalSourceRef,
    revision,
    validationStatus,
  });
  const provenanceSha256 = sha256(provenance);
  const assetType = inferWorkspaceAssetType(source);
  const locator = assetLocator(source, canonicalSourceRef);
  const displayName = text(source.document_name || source.asset_key || source.doc_key || canonicalSourceRef, 255);
  const candidateAssetId = randomUUID();

  await connection.query(
    `INSERT INTO workspace_assets
      (asset_id, tenant_id, workspace_id, asset_type, asset_ref, display_name, brand_ref,
       visibility, lifecycle_status, source_type, source_ref, source_ref_sha256,
       source_revision, source_updated_at, source_validation_status,
       provenance_sha256, content_sha256, metadata_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'restricted', 'active', 'brand_core', ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
       workspace_id=VALUES(workspace_id),
       asset_ref=VALUES(asset_ref),
       display_name=VALUES(display_name),
       source_revision=VALUES(source_revision),
       source_updated_at=VALUES(source_updated_at),
       source_validation_status=VALUES(source_validation_status),
       provenance_sha256=VALUES(provenance_sha256),
       metadata_json=VALUES(metadata_json),
       updated_at=NOW()`,
    [
      candidateAssetId,
      tenantId,
      text(workspace.workspace_id, 64),
      assetType,
      locator,
      displayName,
      canonicalBrandRef,
      canonicalSourceRef,
      sourceRefSha256,
      revision || null,
      source.updated_at || null,
      validationStatus || null,
      provenanceSha256,
      JSON.stringify({
        materialization_source: "brand_core",
        brand_core_row_id: source.id,
        source_asset_key: text(source.asset_key, 255) || null,
        source_document_name: text(source.document_name, 255) || null,
        provider_content_fetched: false,
        content_sha256_available: false,
        secrets_included: false,
      }),
      actorUserId,
    ]
  );

  const [readbackRows] = await connection.query(
    `SELECT asset_id, tenant_id, workspace_id, asset_type, asset_ref, display_name, brand_ref,
            visibility, lifecycle_status, source_type, source_ref, source_ref_sha256,
            source_revision, source_updated_at, source_validation_status,
            provenance_sha256, content_sha256, created_by, created_at, updated_at
       FROM workspace_assets
      WHERE tenant_id=? AND brand_ref=? AND source_type='brand_core' AND source_ref_sha256=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, canonicalBrandRef, sourceRefSha256]
  );
  if (!Array.isArray(readbackRows) || readbackRows.length !== 1) {
    throw materializationError(409, "brand_core_asset_materialize_readback_invalid", "Materialized asset did not resolve exactly once before commit.");
  }
  const [asset] = readbackRows;
  if (
    text(asset.workspace_id) !== text(workspace.workspace_id) ||
    text(asset.brand_ref) !== canonicalBrandRef ||
    text(asset.source_ref) !== canonicalSourceRef ||
    text(asset.source_ref_sha256) !== sourceRefSha256 ||
    text(asset.provenance_sha256) !== provenanceSha256
  ) {
    throw materializationError(409, "brand_core_asset_materialize_readback_mismatch", "Materialized asset provenance readback does not match the canonical source authority.");
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
  await assertProvenanceSchema(connection);
  const { brand, canonicalBrandRef } = await resolveCanonicalBrand(connection, tenant, actor, requestedBrand);
  const workspace = await resolveBrandWorkspace(connection, tenant, canonicalBrandRef);
  const source = await resolveBrandCoreSource(connection, brand, sourceRef);
  const asset = await materializeAsset(connection, {
    tenantId: tenant,
    actorUserId: actor,
    workspace,
    canonicalBrandRef,
    source,
  });
  return {
    asset,
    source: {
      source_type: "brand_core",
      source_ref: asset.source_ref,
      source_revision: asset.source_revision,
      source_validation_status: asset.source_validation_status,
      provenance_sha256: asset.provenance_sha256,
      content_sha256: asset.content_sha256,
      provider_content_fetched: false,
    },
    workspace: {
      workspace_id: workspace.workspace_id,
      workspace_key: workspace.workspace_key,
      brand_ref: canonicalBrandRef,
    },
  };
}

export const _testingWorkspaceBrandCoreAssetMaterialization = {
  sourceActive,
  sourceValidationStatus,
  sourceFileId,
  canonicalBrandCoreSourceRef,
  sourceLookupCandidates,
  inferWorkspaceAssetType,
  canonicalProvenance,
  sha256,
};
