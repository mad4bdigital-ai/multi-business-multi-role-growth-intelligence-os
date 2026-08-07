import { randomUUID } from "node:crypto";

const OWNER_ROLES = new Set(["owner", "admin"]);
const BRAND_ASSET_PERMISSIONS = new Set(["admin", "manage", "edit"]);
const BRAND_ASSET_PERMISSION_RANK = new Map([["admin", 3], ["manage", 2], ["edit", 1]]);
const ASSET_TYPES = new Set([
  "drive_file",
  "drive_folder",
  "drive_shortcut",
  "doc",
  "sheet",
  "image",
  "report",
  "session",
  "knowledge",
  "approval",
  "external_ref",
]);
const VISIBILITIES = new Set(["workspace", "restricted", "private", "public"]);
const INITIAL_STATUSES = new Set(["active", "draft"]);
const SOURCE_TYPES = new Set(["manual", "import", "provider", "generated", "external"]);
const SECRET_QUERY_KEY = /^(?:access[_-]?token|api[_-]?key|secret|signature|sig|credential|authorization|auth|password|passwd|key)$/i;

function lifecycleError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

function normalizedString(value, max = 512) {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  return normalized.length <= max ? normalized : "";
}

function containsCredentialLikeUrlMaterial(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return true;
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY_KEY.test(key)) return true;
    }
    return false;
  } catch {
    return /(?:^|[?&;\s])(access[_-]?token|api[_-]?key|secret|signature|credential|authorization|password|passwd)=/i.test(raw);
  }
}

function normalizeBrandRef(value) {
  return normalizedString(value, 255).replace(/^brand:/i, "").trim();
}

function requireAssetType(value) {
  const normalized = normalizedString(value, 64).toLowerCase();
  if (!ASSET_TYPES.has(normalized)) {
    throw lifecycleError(400, "workspace_asset_type_invalid", "A supported asset_type is required.");
  }
  return normalized;
}

function requireAssetRef(value) {
  const normalized = normalizedString(value, 512);
  if (!normalized) {
    throw lifecycleError(400, "workspace_asset_ref_required", "asset_ref is required and must not exceed 512 characters.");
  }
  if (containsCredentialLikeUrlMaterial(normalized)) {
    throw lifecycleError(400, "workspace_asset_ref_secret_material_forbidden", "asset_ref must not contain credentials, signed tokens, or secret query parameters.");
  }
  return normalized;
}

function requireBrandRef(value) {
  const normalized = normalizeBrandRef(value);
  if (!normalized) {
    throw lifecycleError(400, "workspace_asset_brand_ref_required", "brand_ref is required for Brand Asset creation.");
  }
  return normalized;
}

function normalizeDisplayName(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 255) {
    throw lifecycleError(400, "workspace_asset_display_name_invalid", "display_name must not exceed 255 characters.");
  }
  return normalized;
}

function normalizeVisibility(value) {
  const normalized = normalizedString(value || "restricted", 32).toLowerCase();
  if (!VISIBILITIES.has(normalized)) {
    throw lifecycleError(400, "workspace_asset_visibility_invalid", "visibility is not supported.");
  }
  return normalized;
}

function normalizeInitialStatus(value) {
  const normalized = normalizedString(value || "active", 32).toLowerCase();
  if (!INITIAL_STATUSES.has(normalized)) {
    throw lifecycleError(400, "workspace_asset_status_invalid", "New Brand Assets may start only as active or draft.");
  }
  return normalized;
}

function normalizeSha256(value) {
  if (value == null || value === "") return null;
  const normalized = normalizedString(value, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw lifecycleError(400, "workspace_asset_checksum_invalid", "content_sha256 must be a 64-character hexadecimal SHA-256 digest.");
  }
  return normalized;
}

function normalizeSourceType(value) {
  const normalized = normalizedString(value, 32).toLowerCase();
  if (!SOURCE_TYPES.has(normalized)) {
    throw lifecycleError(400, "workspace_asset_source_type_invalid", "source_type must be one of manual, import, provider, generated, or external.");
  }
  return normalized;
}

function normalizeOptionalProvenanceString(value, max = 512) {
  if (value == null || value === "") return null;
  const normalized = normalizedString(value, max);
  if (!normalized) {
    throw lifecycleError(400, "workspace_asset_provenance_invalid", "Asset provenance field is invalid or exceeds its allowed length.");
  }
  if (containsCredentialLikeUrlMaterial(normalized)) {
    throw lifecycleError(400, "workspace_asset_provenance_secret_material_forbidden", "Asset provenance must not contain credentials, signed tokens, or secret query parameters.");
  }
  return normalized;
}

function normalizeSourceUri(value) {
  const normalized = normalizeOptionalProvenanceString(value, 1024);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return normalized;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return normalized;
  }
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeProvenanceProjection(metadata = {}) {
  return {
    schema_version: metadata.schema_version || "workspace-asset-provenance-v1",
    source_type: metadata.source_type || null,
    source_provider: metadata.source_provider || null,
    source_uri: metadata.source_uri || null,
    source_revision: metadata.source_revision || null,
    content_sha256: metadata.content_sha256 || null,
    content_identity: metadata.content_identity || null,
    ingestion_mode: metadata.ingestion_mode || null,
  };
}

function buildProvenance({ sourceType, sourceProvider, sourceUri, sourceRevision, contentSha256, assetType, assetRef, tenantId, brandTargetKey, actorUserId }) {
  return {
    schema_version: "workspace-asset-provenance-v1",
    source_type: sourceType,
    source_provider: sourceProvider,
    source_uri: sourceUri,
    source_revision: sourceRevision,
    content_sha256: contentSha256,
    content_identity: contentSha256 ? `sha256:${contentSha256}` : `asset_ref:${assetType}:${assetRef}`,
    ingestion_mode: sourceType === "manual" || sourceType === "generated" ? "create" : "import",
    tenant_id: tenantId,
    brand_target_key: brandTargetKey,
    created_by_user_id: actorUserId,
    secrets_included: false,
  };
}

async function requireActiveActorMembership(connection, tenantId, actorUserId) {
  const [rows] = await connection.query(
    `SELECT m.user_id, m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.user_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, actorUserId]
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw lifecycleError(rows?.length ? 409 : 403, "workspace_asset_actor_membership_invalid", "Active workspace membership did not resolve exactly once.", [{ count: rows?.length || 0 }]);
  }
  const [membership] = rows;
  if (String(membership.status || "").toLowerCase() !== "active" || String(membership.tenant_status || "").toLowerCase() !== "active") {
    throw lifecycleError(403, "active_membership_required", "Active workspace membership required.");
  }
  return membership;
}

async function resolveTenantBrand(connection, tenantId, requestedBrandRef) {
  const lookup = requireBrandRef(requestedBrandRef);
  const [rows] = await connection.query(
    `SELECT tbl.link_id, tbl.tenant_id, tbl.brand_target_key, tbl.status AS link_status,
            b.brand_name, b.normalized_brand_name, b.target_key, b.status AS brand_status
       FROM tenant_brand_links tbl
       JOIN brands b ON b.target_key=tbl.brand_target_key
      WHERE tbl.tenant_id=? AND tbl.status='active' AND b.status='active'
        AND (b.target_key=? OR LOWER(COALESCE(b.normalized_brand_name,''))=LOWER(?) OR LOWER(COALESCE(b.brand_name,''))=LOWER(?))
      LIMIT 3 FOR UPDATE`,
    [tenantId, lookup, lookup, lookup]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw lifecycleError(404, "workspace_asset_brand_not_found", "Brand is not available in this workspace.");
  }
  if (rows.length !== 1) {
    throw lifecycleError(409, "workspace_asset_brand_ambiguous", "Brand reference is ambiguous in this workspace.", [{ count: rows.length }]);
  }
  const [brand] = rows;
  return brand;
}

async function requireBrandWorkspaceBinding(connection, tenantId, brandTargetKey) {
  const [rows] = await connection.query(
    `SELECT workspace_id, tenant_id, workspace_key, workspace_type, bootstrap_status, linked_brand_key
       FROM workspace_registry
      WHERE tenant_id=? AND workspace_type='brand' AND linked_brand_key=?
      LIMIT 3 FOR UPDATE`,
    [tenantId, brandTargetKey]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw lifecycleError(409, "workspace_asset_brand_workspace_missing", "Brand Workspace binding is missing.");
  }
  if (rows.length !== 1) {
    throw lifecycleError(409, "workspace_asset_brand_workspace_ambiguous", "Brand Workspace binding is ambiguous.", [{ count: rows.length }]);
  }
  const [brandWorkspace] = rows;
  return brandWorkspace;
}

async function requireBrandAssetAuthority(connection, tenantId, actorUserId, membership, brandTargetKey) {
  if (OWNER_ROLES.has(String(membership.role || "").toLowerCase())) {
    return { mode: "workspace_owner", permission: String(membership.role || "").toLowerCase() };
  }
  const [grantRows] = await connection.query(
    `SELECT grant_id, permission, status, expires_at
       FROM workspace_resource_grants
      WHERE tenant_id=? AND grantee_user_id=? AND resource_type='brand' AND resource_ref=?
        AND status='active' AND (expires_at IS NULL OR expires_at>NOW())
      ORDER BY updated_at DESC
      LIMIT 20 FOR UPDATE`,
    [tenantId, actorUserId, brandTargetKey]
  );
  const eligible = (grantRows || [])
    .filter((row) => BRAND_ASSET_PERMISSIONS.has(String(row.permission || "").toLowerCase()))
    .sort((left, right) => (BRAND_ASSET_PERMISSION_RANK.get(String(right.permission || "").toLowerCase()) || 0) - (BRAND_ASSET_PERMISSION_RANK.get(String(left.permission || "").toLowerCase()) || 0));
  if (eligible.length === 0) {
    throw lifecycleError(403, "workspace_asset_brand_authority_required", "Brand admin, manage, or edit authority is required.");
  }
  const selected = eligible[0];
  return {
    mode: "brand_grant",
    permission: String(selected.permission || "").toLowerCase(),
    grant_id: selected.grant_id,
    effective_grant_count: eligible.length,
  };
}

async function requireVaultOwnership(connection, tenantId, vaultId) {
  if (!vaultId) return null;
  const [rows] = await connection.query(
    `SELECT vault_id, tenant_id, status
       FROM workspace_vaults
      WHERE tenant_id=? AND vault_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, vaultId]
  );
  if (!Array.isArray(rows) || rows.length !== 1 || String(rows[0].status || "").toLowerCase() !== "active") {
    throw lifecycleError(409, "workspace_asset_vault_invalid", "vault_id must resolve exactly one active vault in this workspace.");
  }
  return rows[0];
}

function assertExistingAssetCompatible(existing, { brandTargetKey, provenance }) {
  if (String(existing.lifecycle_status || "").toLowerCase() === "deleted") {
    throw lifecycleError(409, "workspace_asset_identity_deleted", "Asset identity already exists in deleted state and cannot be silently reactivated.");
  }
  if (String(existing.brand_ref || "") !== brandTargetKey) {
    throw lifecycleError(409, "workspace_asset_identity_brand_conflict", "Asset identity already belongs to a different Brand.");
  }
  const metadata = parseMetadata(existing.metadata_json);
  for (const field of ["source_type", "source_provider", "source_uri", "source_revision", "content_sha256"]) {
    const existingValue = metadata[field] == null || metadata[field] === "" ? null : String(metadata[field]).toLowerCase();
    const requestedValue = provenance[field] == null || provenance[field] === "" ? null : String(provenance[field]).toLowerCase();
    if (existingValue && requestedValue && existingValue !== requestedValue) {
      const code = field === "content_sha256" ? "workspace_asset_identity_checksum_conflict" : "workspace_asset_identity_provenance_conflict";
      throw lifecycleError(409, code, `Asset identity already has incompatible ${field} provenance.`);
    }
  }
  return metadata;
}

async function readAssetExactly(connection, tenantId, assetType, assetRef) {
  const [rows] = await connection.query(
    `SELECT asset_id, tenant_id, vault_id, asset_type, asset_ref, display_name, brand_ref, site_ref,
            workflow_ref, session_ref, visibility, lifecycle_status, metadata_json, created_by, created_at, updated_at
       FROM workspace_assets
      WHERE tenant_id=? AND asset_type=? AND asset_ref=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, assetType, assetRef]
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw lifecycleError(409, "workspace_asset_create_readback_invalid", "Persisted asset readback did not resolve exactly once.", [{ count: rows?.length || 0 }]);
  }
  const [asset] = rows;
  return asset;
}

function safeAssetProjection(row) {
  const metadata = parseMetadata(row.metadata_json);
  return {
    asset_id: row.asset_id,
    tenant_id: row.tenant_id,
    vault_id: row.vault_id,
    asset_type: row.asset_type,
    asset_ref: row.asset_ref,
    display_name: row.display_name,
    brand_ref: row.brand_ref,
    site_ref: row.site_ref,
    workflow_ref: row.workflow_ref,
    session_ref: row.session_ref,
    visibility: row.visibility,
    lifecycle_status: row.lifecycle_status,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    provenance: safeProvenanceProjection(metadata),
  };
}

export async function createWorkspaceAsset(connection, {
  tenantId,
  actorUserId,
  assetType,
  assetRef,
  brandRef,
  displayName,
  vaultId,
  visibility,
  lifecycleStatus,
  sourceType,
  sourceProvider,
  sourceUri,
  sourceRevision,
  contentSha256,
}) {
  const tenant = normalizedString(tenantId, 36);
  const actor = normalizedString(actorUserId, 36);
  if (!tenant || !actor) {
    throw lifecycleError(400, "workspace_asset_create_identity_required", "Workspace and signed-in user identity are required.");
  }
  const type = requireAssetType(assetType);
  const ref = requireAssetRef(assetRef);
  const name = normalizeDisplayName(displayName);
  const requestedBrandRef = requireBrandRef(brandRef);
  const normalizedVaultId = normalizeOptionalProvenanceString(vaultId, 36);
  const normalizedVisibility = normalizeVisibility(visibility);
  const status = normalizeInitialStatus(lifecycleStatus);
  const normalizedSourceType = normalizeSourceType(sourceType);
  const normalizedSourceProvider = normalizeOptionalProvenanceString(sourceProvider, 128);
  const normalizedSourceUri = normalizeSourceUri(sourceUri);
  const normalizedSourceRevision = normalizeOptionalProvenanceString(sourceRevision, 255);
  const checksum = normalizeSha256(contentSha256);

  const membership = await requireActiveActorMembership(connection, tenant, actor);
  const brand = await resolveTenantBrand(connection, tenant, requestedBrandRef);
  const brandWorkspace = await requireBrandWorkspaceBinding(connection, tenant, brand.target_key);
  const authority = await requireBrandAssetAuthority(connection, tenant, actor, membership, brand.target_key);
  await requireVaultOwnership(connection, tenant, normalizedVaultId);

  const provenance = buildProvenance({
    sourceType: normalizedSourceType,
    sourceProvider: normalizedSourceProvider,
    sourceUri: normalizedSourceUri,
    sourceRevision: normalizedSourceRevision,
    contentSha256: checksum,
    assetType: type,
    assetRef: ref,
    tenantId: tenant,
    brandTargetKey: brand.target_key,
    actorUserId: actor,
  });

  const [existingRows] = await connection.query(
    `SELECT asset_id, tenant_id, vault_id, asset_type, asset_ref, display_name, brand_ref, site_ref,
            workflow_ref, session_ref, visibility, lifecycle_status, metadata_json, created_by, created_at, updated_at
       FROM workspace_assets
      WHERE tenant_id=? AND asset_type=? AND asset_ref=?
      LIMIT 2 FOR UPDATE`,
    [tenant, type, ref]
  );
  if (existingRows.length > 1) {
    throw lifecycleError(409, "workspace_asset_identity_ambiguous", "Asset identity resolves to multiple persisted rows.", [{ count: existingRows.length }]);
  }

  let created = false;
  if (existingRows.length === 1) {
    const existingMetadata = assertExistingAssetCompatible(existingRows[0], {
      brandTargetKey: brand.target_key,
      provenance,
    });
    const needsProvenanceBackfill = ["source_type", "source_provider", "source_uri", "source_revision", "content_sha256", "content_identity"]
      .some((field) => !existingMetadata[field] && provenance[field]);
    if (needsProvenanceBackfill) {
      const mergedMetadata = { ...provenance, ...existingMetadata };
      for (const [key, value] of Object.entries(provenance)) {
        if ((mergedMetadata[key] == null || mergedMetadata[key] === "") && value != null) mergedMetadata[key] = value;
      }
      await connection.query(
        `UPDATE workspace_assets
            SET metadata_json=?, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=? AND asset_id=? AND brand_ref=?`,
        [JSON.stringify(mergedMetadata), tenant, existingRows[0].asset_id, brand.target_key]
      );
    }
  } else {
    const assetId = randomUUID();
    await connection.query(
      `INSERT INTO workspace_assets
        (asset_id, tenant_id, vault_id, asset_type, asset_ref, display_name, brand_ref, visibility, lifecycle_status, metadata_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [assetId, tenant, normalizedVaultId, type, ref, name, brand.target_key, normalizedVisibility, status, JSON.stringify(provenance), actor]
    );
    created = true;
  }

  const readback = await readAssetExactly(connection, tenant, type, ref);
  if (String(readback.brand_ref || "") !== brand.target_key || String(readback.lifecycle_status || "").toLowerCase() === "deleted") {
    throw lifecycleError(409, "workspace_asset_create_readback_invalid", "Persisted asset readback does not match the authorized Brand.");
  }
  const readbackMetadata = parseMetadata(readback.metadata_json);
  for (const field of ["source_type", "source_provider", "source_uri", "source_revision", "content_sha256"]) {
    const requestedValue = provenance[field];
    if (requestedValue != null && requestedValue !== "" && String(readbackMetadata[field] ?? "").toLowerCase() !== String(requestedValue).toLowerCase()) {
      throw lifecycleError(409, "workspace_asset_provenance_readback_invalid", `Persisted asset ${field} provenance readback does not match the request.`);
    }
  }

  return {
    created,
    asset: safeAssetProjection(readback),
    brand: {
      target_key: brand.target_key,
      brand_name: brand.brand_name,
    },
    brand_workspace: {
      workspace_id: brandWorkspace.workspace_id,
      workspace_key: brandWorkspace.workspace_key,
      linked_brand_key: brandWorkspace.linked_brand_key,
      bootstrap_status: brandWorkspace.bootstrap_status,
    },
    authority,
  };
}

export const _testingWorkspaceAssetLifecycle = {
  ASSET_TYPES,
  VISIBILITIES,
  INITIAL_STATUSES,
  SOURCE_TYPES,
  BRAND_ASSET_PERMISSIONS,
  normalizeBrandRef,
  normalizeSha256,
  normalizeSourceUri,
  containsCredentialLikeUrlMaterial,
  parseMetadata,
  safeProvenanceProjection,
  assertExistingAssetCompatible,
};
