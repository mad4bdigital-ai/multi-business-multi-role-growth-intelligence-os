import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { extractGoogleFileId } from "./resolvers/brandReferenceResolver.js";
import { resolveWorkspaceAssetBrandRef } from "./workspaceAssetBrandAuthority.js";
import { parseWorkspaceAssetMetadata } from "./workspaceAssetProvenance.js";
import { createResourceRepository } from "./src/infrastructure/resourceApi/resourceRepository.js";

const ROOT_WORKSPACE_OWNERSHIP_TYPES = new Set(["personal", "company"]);

function materializationError(status, code, message, details = undefined) {
  return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value) {
  return text(value).toLowerCase();
}

function requireExactlyOne(rows, {
  missingStatus = 404,
  missingCode,
  missingMessage,
  ambiguousCode,
  ambiguousMessage,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw materializationError(missingStatus, missingCode, missingMessage);
  }
  if (rows.length !== 1) {
    throw materializationError(409, ambiguousCode, ambiguousMessage, { count: rows.length });
  }
  const [resolved] = rows;
  return resolved;
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
  return text(row.validation_status || row.active_status || row.status, 64).toLowerCase();
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

export function buildBrandCoreMaterializedAssetRef(canonicalBrandRef, source = {}) {
  const brandIdentity = lower(canonicalBrandRef);
  const canonicalSourceRef = canonicalBrandCoreSourceRef(source);
  const sourceRowId = text(source.id, 64);
  if (!brandIdentity || !canonicalSourceRef || !sourceRowId) return "";
  const digest = createHash("sha256")
    .update(`brand_core_asset_v2\0${brandIdentity}\0${sourceRowId}\0${canonicalSourceRef}`, "utf8")
    .digest("hex");
  return `brand_core:${digest}`;
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

function materializedAssetInput({ rootWorkspace, brandWorkspace, topology, canonicalBrandRef, source }) {
  const canonicalSourceRef = canonicalBrandCoreSourceRef(source);
  const canonicalAssetRef = buildBrandCoreMaterializedAssetRef(canonicalBrandRef, source);
  if (!canonicalSourceRef || !canonicalAssetRef) {
    throw materializationError(422, "brand_core_source_identity_unverifiable", "Brand Core source does not expose a stable materialization identity.");
  }
  const validationStatus = sourceValidationStatus(source);
  return {
    asset_type: "external_ref",
    asset_ref: canonicalAssetRef,
    display_name: text(source.asset_key || source.doc_key || canonicalSourceRef, 255),
    brand_ref: canonicalBrandRef,
    visibility: "restricted",
    lifecycle_status: "active",
    source_type: "import",
    source_provider: "brand_core",
    source_uri: `brand-core:${canonicalBrandRef}:${canonicalSourceRef}`,
    source_revision: sourceRevision(source) || null,
    content_sha256: null,
    metadata_json: {
      materialization_source: "brand_core",
      root_workspace_id: text(rootWorkspace.workspace_id, 64),
      root_workspace_key: text(rootWorkspace.workspace_key, 255),
      root_workspace_ownership_type: lower(rootWorkspace.workspace_ownership_type),
      workspace_container_id: text(topology.workspace_container_id, 64),
      brand_workspace_id: text(brandWorkspace.workspace_id, 64),
      brand_workspace_key: text(brandWorkspace.workspace_key, 255),
      brand_container_id: text(topology.brand_container_id, 64),
      brand_container_key: text(topology.brand_container_key, 255),
      brand_container_relationship_id: text(topology.relationship_id, 64),
      brand_core_row_id: source.id,
      brand_core_asset_ref: canonicalAssetRef,
      brand_core_source_ref: canonicalSourceRef,
      brand_core_asset_type: null,
      source_validation_status: validationStatus || null,
      source_updated_at: source.updated_at || null,
      provider_content_fetched: false,
      secrets_included: false,
    },
  };
}

async function resolveRootWorkspace(connection, workspaceId, actorUserId) {
  const workspaceRef = text(workspaceId, 64);
  if (!workspaceRef) {
    throw materializationError(400, "brand_core_materialize_workspace_required", "A root workspace_id is required.");
  }
  const [rows] = await connection.query(
    `SELECT wr.workspace_id, wr.tenant_id, wr.workspace_key, wr.display_name, wr.workspace_type,
            wr.workspace_ownership_type, wr.owner_user_id, wr.ownership_revision,
            wr.bootstrap_status, t.status AS tenant_status
       FROM workspace_registry wr
       JOIN tenants t ON t.tenant_id=wr.tenant_id
      WHERE wr.workspace_id=?
      LIMIT 2 FOR UPDATE`,
    [workspaceRef]
  );
  const workspace = requireExactlyOne(rows, {
    missingCode: "brand_core_materialize_root_workspace_not_found",
    missingMessage: "Root workspace was not found.",
    ambiguousCode: "brand_core_materialize_root_workspace_ambiguous",
    ambiguousMessage: "Root workspace identity resolved ambiguously.",
  });
  if (lower(workspace.tenant_status) !== "active") {
    throw materializationError(409, "brand_core_materialize_root_workspace_inactive", "Root workspace tenant is not active.");
  }
  const ownershipType = lower(workspace.workspace_ownership_type);
  if (!ROOT_WORKSPACE_OWNERSHIP_TYPES.has(ownershipType)) {
    throw materializationError(
      409,
      "brand_core_materialize_root_workspace_unclassified",
      "Materialization requires a root workspace classified as personal or company."
    );
  }
  if (lower(workspace.workspace_type) === "brand") {
    throw materializationError(
      409,
      "brand_core_materialize_brand_workspace_not_root",
      "A workspace_type=brand row is a child operational Brand workspace and cannot be used as the root workspace."
    );
  }
  if (ownershipType === "personal") {
    const ownerUserId = text(workspace.owner_user_id, 64);
    if (!ownerUserId) {
      throw materializationError(409, "brand_core_materialize_personal_owner_missing", "Personal root workspace requires an owner user.");
    }
    if (ownerUserId !== text(actorUserId, 64)) {
      throw materializationError(
        403,
        "brand_core_materialize_personal_owner_mismatch",
        "Personal root workspace owner does not match the signed-in user."
      );
    }
  }
  return workspace;
}

async function resolveCanonicalBrand(connection, tenantId, actorUserId, requestedBrandRef) {
  const canonicalBrandRef = await resolveWorkspaceAssetBrandRef(connection, {
    tenantId,
    actorId: actorUserId,
    brandRef: requestedBrandRef,
  });
  const [brandRows] = await connection.query(
    `SELECT target_key, brand_name, normalized_brand_name
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

async function resolveBrandOperationalWorkspace(connection, tenantId, canonicalBrandRef) {
  const [rows] = await connection.query(
    `SELECT workspace_id, tenant_id, workspace_key, workspace_type, workspace_ownership_type,
            bootstrap_status, linked_brand_key
       FROM workspace_registry
      WHERE tenant_id=? AND workspace_type='brand' AND linked_brand_key=?
      LIMIT 3 FOR UPDATE`,
    [tenantId, canonicalBrandRef]
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw materializationError(
      rows?.length ? 409 : 422,
      rows?.length ? "brand_core_materialize_brand_workspace_ambiguous" : "brand_core_materialize_brand_workspace_required",
      rows?.length
        ? "Brand child operational workspace resolved ambiguously."
        : "Canonical Brand child operational workspace is required before materializing Brand Core assets."
    );
  }
  const [workspace] = rows;
  if (lower(workspace.workspace_type) !== "brand" || text(workspace.linked_brand_key) !== canonicalBrandRef) {
    throw materializationError(409, "brand_core_materialize_brand_workspace_mismatch", "Brand child operational workspace does not match canonical Brand authority.");
  }
  if (text(workspace.workspace_ownership_type)) {
    throw materializationError(
      409,
      "brand_core_materialize_brand_workspace_root_collision",
      "workspace_type=brand must remain a child operational workspace and cannot carry personal/company root ownership."
    );
  }
  return workspace;
}

async function resolveBrandContainerTopology(connection, { rootWorkspace, canonicalBrandRef }) {
  const tenantId = text(rootWorkspace.tenant_id, 64);
  const [rows] = await connection.query(
    `SELECT brand_container.container_id AS brand_container_id,
            brand_container.container_key AS brand_container_key,
            brand_container.canonical_subject_type AS brand_subject_type,
            brand_container.canonical_subject_ref AS brand_subject_ref,
            workspace_container.container_id AS workspace_container_id,
            workspace_container.container_key AS workspace_container_key,
            workspace_container.canonical_subject_type AS workspace_subject_type,
            workspace_container.canonical_subject_ref AS workspace_subject_ref,
            relationship.relationship_id,
            relationship.relationship_type_key,
            relationship_type.contributes_to_ancestry,
            relationship_type.contributes_to_inheritance
       FROM containers brand_container
       JOIN container_relationships relationship
         ON relationship.tenant_id=brand_container.tenant_id
        AND relationship.to_container_id=brand_container.container_id
       JOIN container_relationship_type_registry relationship_type
         ON relationship_type.relationship_type_key=relationship.relationship_type_key
       JOIN containers workspace_container
         ON workspace_container.container_id=relationship.from_container_id
        AND workspace_container.tenant_id=relationship.tenant_id
      WHERE brand_container.tenant_id=?
        AND brand_container.container_type_key='brand'
        AND brand_container.canonical_subject_type='brand_target_key'
        AND LOWER(brand_container.canonical_subject_ref)=LOWER(?)
        AND brand_container.status='active'
        AND relationship.relationship_type_key='contains'
        AND relationship.status='active'
        AND (relationship.valid_from IS NULL OR relationship.valid_from<=UTC_TIMESTAMP())
        AND (relationship.valid_until IS NULL OR relationship.valid_until>UTC_TIMESTAMP())
        AND relationship_type.status='active'
        AND relationship_type.relationship_class='containment'
        AND relationship_type.contributes_to_ancestry=1
        AND workspace_container.container_type_key='workspace'
        AND workspace_container.status='active'
      LIMIT 4 FOR UPDATE`,
    [tenantId, canonicalBrandRef]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw materializationError(
      422,
      "brand_core_materialize_brand_container_parent_required",
      "Canonical Brand container requires exactly one active Workspace contains parent before materialization."
    );
  }
  if (rows.length !== 1) {
    throw materializationError(
      409,
      "brand_core_materialize_brand_container_parent_ambiguous",
      "Canonical Brand container resolves to multiple active Workspace containment parents.",
      { count: rows.length }
    );
  }
  const [topology] = rows;
  if (
    lower(topology.workspace_subject_type) !== "workspace" ||
    text(topology.workspace_subject_ref, 64) !== text(rootWorkspace.workspace_id, 64)
  ) {
    throw materializationError(
      403,
      "brand_core_materialize_brand_container_cross_workspace",
      "Canonical Brand container is owned by a different root workspace."
    );
  }
  if (
    lower(topology.brand_subject_type) !== "brand_target_key" ||
    lower(topology.brand_subject_ref) !== lower(canonicalBrandRef)
  ) {
    throw materializationError(409, "brand_core_materialize_brand_container_mismatch", "Brand container canonical subject does not match Brand authority.");
  }
  if (Number(topology.contributes_to_inheritance || 0) !== 1) {
    throw materializationError(
      409,
      "brand_core_materialize_brand_container_inheritance_disabled",
      "Workspace-to-Brand containment must contribute to inheritance."
    );
  }

  const [closureRows] = await connection.query(
    `SELECT tenant_id, ancestor_container_id, descendant_container_id, shortest_depth,
            longest_depth, path_count, authority_epoch
       FROM container_closure
      WHERE tenant_id=? AND ancestor_container_id=? AND descendant_container_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, topology.workspace_container_id, topology.brand_container_id]
  );
  const closure = requireExactlyOne(closureRows, {
    missingStatus: 409,
    missingCode: "brand_core_materialize_brand_container_closure_required",
    missingMessage: "Workspace-to-Brand containment is not materialized in container_closure.",
    ambiguousCode: "brand_core_materialize_brand_container_closure_ambiguous",
    ambiguousMessage: "Workspace-to-Brand closure resolved ambiguously.",
  });
  if (Number(closure.shortest_depth) !== 1 || Number(closure.path_count || 0) !== 1) {
    throw materializationError(
      409,
      "brand_core_materialize_brand_container_path_ambiguous",
      "Brand container must have one direct canonical containment path from the selected root workspace.",
      { shortest_depth: Number(closure.shortest_depth), path_count: Number(closure.path_count || 0) }
    );
  }
  return { ...topology, closure };
}

async function resolveBrandCoreSource(connection, brand, sourceLookup) {
  const candidates = sourceLookupCandidates(sourceLookup);
  if (!candidates.length) {
    throw materializationError(400, "brand_core_source_ref_required", "source_ref is required for Brand Core materialization.");
  }
  const canonicalBrandKey = text(brand.target_key, 255);
  if (!canonicalBrandKey) {
    throw materializationError(422, "brand_core_brand_identity_unverifiable", "Canonical Brand target key is required for Brand Core source lookup.");
  }
  const sourceConditions = candidates.map(() => `(
    asset_key=? OR doc_key=? OR doc_id=? OR file_id=? OR google_doc_id=?
  )`).join(" OR ");
  const sourceParams = candidates.flatMap((candidate) => [candidate, candidate, candidate, candidate, candidate]);
  const [rows] = await connection.query(
    `SELECT bc.*
       FROM brand_core bc
      WHERE LOWER(COALESCE(bc.brand_key,'')) = LOWER(?)
        AND (${sourceConditions})
      ORDER BY bc.updated_at DESC, bc.id DESC
      LIMIT 3 FOR UPDATE`,
    [canonicalBrandKey, ...sourceParams]
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
  if (!canonicalBrandCoreSourceRef(source) || !text(source.id, 64)) {
    throw materializationError(422, "brand_core_source_identity_unverifiable", "Brand Core source does not expose a stable row and source identity for materialization.");
  }
  return source;
}

async function persistMaterializedAsset(connection, {
  tenantId,
  actorUserId,
  rootWorkspace,
  brandWorkspace,
  topology,
  canonicalBrandRef,
  source,
}) {
  const repository = createResourceRepository({ pool: connection, transactionConnection: true });
  const member = await repository.findMembership(actorUserId, tenantId);
  if (!member || member.status !== "active" || member.tenant_status !== "active") {
    throw materializationError(403, "active_membership_required", "Active workspace membership required.");
  }

  const input = materializedAssetInput({ rootWorkspace, brandWorkspace, topology, canonicalBrandRef, source });
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
  const expectedAssetRef = buildBrandCoreMaterializedAssetRef(canonicalBrandRef, source);
  if (
    text(lineage.asset_type) !== input.asset_type ||
    text(lineage.asset_ref) !== expectedAssetRef ||
    text(lineage.brand_ref) !== canonicalBrandRef ||
    lower(lineage.lifecycle_status) !== "active" ||
    text(metadata.root_workspace_id) !== text(rootWorkspace.workspace_id, 64) ||
    lower(metadata.root_workspace_ownership_type) !== lower(rootWorkspace.workspace_ownership_type) ||
    text(metadata.workspace_container_id) !== text(topology.workspace_container_id, 64) ||
    text(metadata.brand_workspace_id) !== text(brandWorkspace.workspace_id, 64) ||
    text(metadata.brand_container_id) !== text(topology.brand_container_id, 64) ||
    text(metadata.brand_container_relationship_id) !== text(topology.relationship_id, 64) ||
    text(metadata.brand_core_row_id, 64) !== text(source.id, 64) ||
    text(metadata.brand_core_asset_ref) !== expectedAssetRef ||
    text(metadata.brand_core_source_ref) !== expectedSourceRef ||
    text(metadata.source_provider) !== "brand_core" ||
    text(metadata.source_type) !== "import" ||
    text(metadata.source_revision) !== text(input.source_revision, 255) ||
    metadata.content_sha256 !== null ||
    metadata.provider_content_fetched !== false ||
    metadata.secrets_included !== false
  ) {
    throw materializationError(409, "brand_core_asset_materialize_readback_mismatch", "Materialized asset lineage does not match canonical Root Workspace → Brand Container → Brand Core authority.");
  }

  const context = {
    tenantId,
    member,
    auth: { mode: "user_jwt", user_id: actorUserId, tenant_id: tenantId, is_admin: false },
  };
  const asset = await repository.getResource("assets", assetId, context);
  if (
    !asset ||
    text(asset.asset_id) !== text(assetId, 64) ||
    asset.source_provider !== "brand_core" ||
    lower(asset.lifecycle_status) !== "active"
  ) {
    throw materializationError(409, "brand_core_asset_materialize_projection_invalid", "Canonical asset projection did not match the active persisted Brand Core materialization.");
  }
  return asset;
}

export async function materializeWorkspaceBrandCoreAsset(connection, {
  workspaceId,
  actorUserId,
  brandRef,
  sourceRef,
}) {
  const workspaceRef = text(workspaceId, 64);
  const actor = text(actorUserId, 64);
  const requestedBrand = text(brandRef, 512);
  if (!workspaceRef || !actor || !requestedBrand) {
    throw materializationError(400, "brand_core_materialize_identity_required", "root workspace, signed-in user, and brand reference are required.");
  }

  const rootWorkspace = await resolveRootWorkspace(connection, workspaceRef, actor);
  const tenantId = text(rootWorkspace.tenant_id, 64);
  const { brand, canonicalBrandRef } = await resolveCanonicalBrand(connection, tenantId, actor, requestedBrand);
  const brandWorkspace = await resolveBrandOperationalWorkspace(connection, tenantId, canonicalBrandRef);
  const topology = await resolveBrandContainerTopology(connection, { rootWorkspace, canonicalBrandRef });
  const source = await resolveBrandCoreSource(connection, brand, sourceRef);
  const asset = await persistMaterializedAsset(connection, {
    tenantId,
    actorUserId: actor,
    rootWorkspace,
    brandWorkspace,
    topology,
    canonicalBrandRef,
    source,
  });
  return {
    tenant_id: tenantId,
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
      workspace_id: rootWorkspace.workspace_id,
      workspace_key: rootWorkspace.workspace_key,
      workspace_ownership_type: lower(rootWorkspace.workspace_ownership_type),
      brand_workspace_id: brandWorkspace.workspace_id,
      brand_workspace_key: brandWorkspace.workspace_key,
      brand_container_id: topology.brand_container_id,
      brand_container_key: topology.brand_container_key,
      containment_relationship_id: topology.relationship_id,
      brand_ref: canonicalBrandRef,
    },
  };
}

export async function materializeWorkspaceBrandCoreAssetTransaction({
  workspaceId,
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
      workspaceId,
      actorUserId,
      brandRef,
      sourceRef,
    });
    if (
      !result?.tenant_id ||
      !result?.workspace?.workspace_id ||
      !result?.workspace?.brand_container_id ||
      !result?.asset?.asset_id ||
      result.asset.source_provider !== "brand_core" ||
      !result.asset.content_identity
    ) {
      throw materializationError(409, "brand_core_asset_materialize_readback_missing", "Brand Core materialization did not produce an exact canonical Root Workspace and asset projection.");
    } // MUTATION_READBACK: workspace_brand_core_asset_materialize
    await connection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
        transactionStarted = false;
      } catch (rollbackError) {
        const failure = materializationError(
          500,
          "brand_core_asset_materialize_rollback_failed",
          "Brand Core materialization rollback could not be verified.",
          {
            original_code: error?.code || null,
            rollback_code: rollbackError?.code || null,
            state: "indeterminate",
          }
        );
        failure.cause = error;
        throw failure;
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}
