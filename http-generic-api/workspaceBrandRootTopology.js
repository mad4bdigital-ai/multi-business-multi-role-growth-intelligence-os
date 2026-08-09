import { createHash } from "node:crypto";
import { createWorkspaceBrand } from "./workspaceBrandLifecycle.js";

const ROOT_WORKSPACE_OWNERSHIP_TYPES = new Set(["personal", "company"]);

function topologyError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

function text(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value) {
  return text(value).toLowerCase();
}

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function stableUuid(...parts) {
  const hex = createHash("sha256")
    .update(parts.map((value) => String(value ?? "")).join("|"))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function requireExactlyOne(rows, { missingCode, missingMessage, ambiguousCode, ambiguousMessage }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw topologyError(404, missingCode, missingMessage);
  }
  if (rows.length !== 1) {
    throw topologyError(409, ambiguousCode, ambiguousMessage, [{ count: rows.length }]);
  }
  const [row] = rows;
  return row;
}

function validateRootWorkspace(row, { actorUserId = null, expectedTenantId = null } = {}) {
  if (lower(row.tenant_status) !== "active") {
    throw topologyError(409, "workspace_brand_root_workspace_inactive", "Root workspace tenant is not active.");
  }
  if (expectedTenantId && text(row.tenant_id, 64) !== text(expectedTenantId, 64)) {
    throw topologyError(403, "workspace_brand_root_workspace_cross_tenant", "Root workspace does not belong to the requested tenant.");
  }
  const ownershipType = lower(row.workspace_ownership_type);
  if (!ROOT_WORKSPACE_OWNERSHIP_TYPES.has(ownershipType)) {
    throw topologyError(409, "workspace_brand_root_workspace_unclassified", "Brand creation requires a personal or company Root Workspace.");
  }
  if (lower(row.workspace_type) === "brand") {
    throw topologyError(409, "workspace_brand_child_workspace_not_root", "A workspace_type=brand row is an operational child workspace and cannot own a Brand.");
  }
  if (lower(row.bootstrap_status) !== "ready") {
    throw topologyError(409, "workspace_brand_root_workspace_not_ready", "Root workspace must be ready before Brand creation.");
  }
  if (ownershipType === "personal") {
    const ownerUserId = text(row.owner_user_id, 64);
    if (!ownerUserId) {
      throw topologyError(409, "workspace_brand_personal_owner_missing", "Personal Root Workspace requires an owner user.");
    }
    if (actorUserId && ownerUserId !== text(actorUserId, 64)) {
      throw topologyError(403, "workspace_brand_personal_owner_mismatch", "Personal Root Workspace owner does not match the signed-in user.");
    }
  }
  return row;
}

async function loadRootWorkspace(executor, rootWorkspaceId, { actorUserId = null, expectedTenantId = null, lock = false } = {}) {
  const workspaceId = text(rootWorkspaceId, 64);
  if (!workspaceId) {
    throw topologyError(400, "workspace_brand_root_workspace_required", "root_workspace_id is required.");
  }
  const lockClause = lock ? " FOR UPDATE" : "";
  const [rows] = await executor.query(
    `SELECT wr.workspace_id, wr.tenant_id, wr.workspace_key, wr.display_name, wr.workspace_type,
            wr.workspace_ownership_type, wr.owner_user_id, wr.ownership_revision,
            wr.bootstrap_status, t.status AS tenant_status
       FROM workspace_registry wr
       JOIN tenants t ON t.tenant_id=wr.tenant_id
      WHERE wr.workspace_id=?
      LIMIT 2${lockClause}`,
    [workspaceId]
  );
  const root = requireExactlyOne(rows, {
    missingCode: "workspace_brand_root_workspace_not_found",
    missingMessage: "Root workspace was not found.",
    ambiguousCode: "workspace_brand_root_workspace_ambiguous",
    ambiguousMessage: "Root workspace identity resolved ambiguously.",
  });
  return validateRootWorkspace(root, { actorUserId, expectedTenantId });
}

export async function readWorkspaceBrandRootScope(executor, { rootWorkspaceId, actorUserId = null } = {}) {
  return loadRootWorkspace(executor, rootWorkspaceId, { actorUserId, lock: false });
}

async function bindOperationalWorkspaceToRoot(connection, { tenantId, brandWorkspaceId, rootWorkspaceId, actorUserId }) {
  const [rows] = await connection.query(
    `SELECT workspace_id, tenant_id, workspace_type, workspace_ownership_type, linked_brand_key, config_json
       FROM workspace_registry
      WHERE tenant_id=? AND workspace_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, brandWorkspaceId]
  );
  const workspace = requireExactlyOne(rows, {
    missingCode: "workspace_brand_operational_workspace_missing",
    missingMessage: "Brand operational workspace was not found.",
    ambiguousCode: "workspace_brand_operational_workspace_ambiguous",
    ambiguousMessage: "Brand operational workspace resolved ambiguously.",
  });
  if (lower(workspace.workspace_type) !== "brand" || text(workspace.workspace_ownership_type, 32)) {
    throw topologyError(409, "workspace_brand_operational_workspace_invalid", "Brand operational workspace must remain an unclassified child binding.");
  }
  const config = parseJson(workspace.config_json, {});
  const existingRootWorkspaceId = text(config.root_workspace_id, 64);
  if (existingRootWorkspaceId && existingRootWorkspaceId !== rootWorkspaceId) {
    throw topologyError(409, "workspace_brand_root_topology_conflict", "Brand is already bound to a different Root Workspace.", [{ existing_root_workspace_id: existingRootWorkspaceId }]);
  }
  const nextConfig = {
    ...config,
    root_workspace_id: rootWorkspaceId,
    ownership_topology_source: "workspace_owner_brand_create",
    ownership_topology_revision: 1,
    ownership_topology_updated_by_user_id: actorUserId,
    secrets_included: false,
  };
  await connection.query(
    `UPDATE workspace_registry
        SET config_json=?, updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND workspace_id=?`,
    [JSON.stringify(nextConfig), tenantId, brandWorkspaceId]
  );
  return nextConfig;
}

async function requireContainsRegistry(connection) {
  const [rows] = await connection.query(
    `SELECT relationship_type_key, relationship_class, contributes_to_ancestry, contributes_to_inheritance, status
       FROM container_relationship_type_registry
      WHERE relationship_type_key='contains'
      LIMIT 2 FOR UPDATE`
  );
  const relationshipType = requireExactlyOne(rows, {
    missingCode: "workspace_brand_contains_registry_missing",
    missingMessage: "Canonical contains relationship type is unavailable.",
    ambiguousCode: "workspace_brand_contains_registry_ambiguous",
    ambiguousMessage: "Canonical contains relationship type resolved ambiguously.",
  });
  if (
    lower(relationshipType.status) !== "active" ||
    lower(relationshipType.relationship_class) !== "containment" ||
    Number(relationshipType.contributes_to_ancestry) !== 1 ||
    Number(relationshipType.contributes_to_inheritance) !== 1
  ) {
    throw topologyError(409, "workspace_brand_contains_registry_invalid", "Canonical contains relationship must contribute to ancestry and inheritance.");
  }
  return relationshipType;
}

async function ensureCanonicalContainer(connection, {
  tenantId,
  containerType,
  containerKey,
  subjectType,
  subjectRef,
  displayName,
  actorUserId,
  metadata,
}) {
  const [rows] = await connection.query(
    `SELECT container_id, tenant_id, container_key, container_type_key, canonical_subject_type, canonical_subject_ref, status
       FROM containers
      WHERE tenant_id=? AND canonical_subject_type=? AND canonical_subject_ref=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, subjectType, subjectRef]
  );
  if (rows.length > 1) {
    throw topologyError(409, "workspace_brand_container_identity_ambiguous", "Canonical container identity resolved ambiguously.", [{ subject_type: subjectType, subject_ref: subjectRef, count: rows.length }]);
  }
  if (rows.length === 1) {
    const [existing] = rows;
    if (lower(existing.container_type_key) !== containerType || lower(existing.status) !== "active") {
      throw topologyError(409, "workspace_brand_container_identity_conflict", "Canonical container exists with an incompatible type or lifecycle state.", [{ container_id: existing.container_id }]);
    }
    return existing;
  }
  const containerId = stableUuid("container", tenantId, containerType, containerKey);
  await connection.query(
    `INSERT INTO containers
      (container_id,tenant_id,container_key,container_type_key,canonical_subject_type,canonical_subject_ref,display_name,status,version,metadata_json,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,'active',1,?,?,?)`,
    [
      containerId,
      tenantId,
      containerKey,
      containerType,
      subjectType,
      subjectRef,
      displayName,
      JSON.stringify({ ...metadata, authority_implied: false, secrets_included: false }),
      actorUserId,
      actorUserId,
    ]
  );
  const [readbackRows] = await connection.query(
    `SELECT container_id, tenant_id, container_key, container_type_key, canonical_subject_type, canonical_subject_ref, status
       FROM containers
      WHERE tenant_id=? AND canonical_subject_type=? AND canonical_subject_ref=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, subjectType, subjectRef]
  );
  return requireExactlyOne(readbackRows, {
    missingCode: "workspace_brand_container_readback_missing",
    missingMessage: "Created canonical container was not readable.",
    ambiguousCode: "workspace_brand_container_readback_ambiguous",
    ambiguousMessage: "Created canonical container resolved ambiguously.",
  });
}

async function loadActiveBrandParents(connection, tenantId, brandContainerId) {
  const [rows] = await connection.query(
    `SELECT r.relationship_id, r.from_container_id, r.to_container_id, r.created_by,
            p.container_type_key AS parent_container_type,
            p.canonical_subject_type AS parent_subject_type,
            p.canonical_subject_ref AS parent_subject_ref,
            wr.workspace_type AS parent_workspace_type,
            wr.workspace_ownership_type AS parent_workspace_ownership_type
       FROM container_relationships r
       JOIN container_relationship_type_registry rt
         ON rt.relationship_type_key=r.relationship_type_key
        AND rt.status='active'
        AND rt.contributes_to_ancestry=1
        AND rt.contributes_to_inheritance=1
       JOIN containers p ON p.container_id=r.from_container_id AND p.status='active'
       LEFT JOIN workspace_registry wr
         ON p.canonical_subject_type='workspace'
        AND BINARY wr.workspace_id <=> BINARY p.canonical_subject_ref
      WHERE r.tenant_id=?
        AND r.to_container_id=?
        AND r.relationship_type_key='contains'
        AND r.status='active'
        AND (r.valid_from IS NULL OR r.valid_from<=UTC_TIMESTAMP())
        AND (r.valid_until IS NULL OR r.valid_until>UTC_TIMESTAMP())
      FOR UPDATE`,
    [tenantId, brandContainerId]
  );
  return Array.isArray(rows) ? rows : [];
}

async function archiveLegacyOperationalParent(connection, row) {
  await connection.query(
    `UPDATE container_relationships
        SET status='disabled', updated_at=UTC_TIMESTAMP()
      WHERE relationship_id=? AND status='active' AND created_by='legacy_projection'`,
    [row.relationship_id]
  );
  await connection.query(
    `UPDATE platform_graph_edges
        SET lifecycle_status='archived', updated_at=UTC_TIMESTAMP()
      WHERE source_table='container_relationships'
        AND source_pk=?
        AND lifecycle_status='active'`,
    [row.relationship_id]
  );
}

async function ensureRootBrandRelationship(connection, { tenantId, rootWorkspace, brandWorkspace, rootContainer, brandContainer, actorUserId }) {
  await requireContainsRegistry(connection);
  const parents = await loadActiveBrandParents(connection, tenantId, brandContainer.container_id);
  const desiredParents = parents.filter((row) => row.from_container_id === rootContainer.container_id);
  if (desiredParents.length > 1) {
    throw topologyError(409, "workspace_brand_root_topology_ambiguous", "Brand has duplicate active relationships from the selected Root Workspace.", [{ count: desiredParents.length }]);
  }
  for (const parent of parents) {
    if (parent.from_container_id === rootContainer.container_id) continue;
    const isLegacyOperationalParent =
      parent.created_by === "legacy_projection" &&
      lower(parent.parent_container_type) === "workspace" &&
      lower(parent.parent_workspace_type) === "brand" &&
      !text(parent.parent_workspace_ownership_type, 32) &&
      text(parent.parent_subject_ref, 64) === text(brandWorkspace.workspace_id, 64);
    if (isLegacyOperationalParent) {
      await archiveLegacyOperationalParent(connection, parent);
      continue;
    }
    throw topologyError(409, "workspace_brand_root_topology_conflict", "Brand already has a different active inheritance-bearing parent.", [{ relationship_id: parent.relationship_id, parent_container_id: parent.from_container_id }]);
  }
  if (desiredParents.length === 1) return desiredParents[0];

  const relationshipId = stableUuid("container-relationship", tenantId, rootContainer.container_id, brandContainer.container_id, "contains");
  const [existingRows] = await connection.query(
    `SELECT relationship_id, status, from_container_id, to_container_id, relationship_type_key
       FROM container_relationships
      WHERE relationship_id=?
      LIMIT 2 FOR UPDATE`,
    [relationshipId]
  );
  if (existingRows.length > 1) {
    throw topologyError(409, "workspace_brand_root_relationship_ambiguous", "Canonical Root-to-Brand relationship identity resolved ambiguously.");
  }
  if (existingRows.length === 1) {
    const [existing] = existingRows;
    if (
      lower(existing.status) !== "active" ||
      existing.from_container_id !== rootContainer.container_id ||
      existing.to_container_id !== brandContainer.container_id ||
      existing.relationship_type_key !== "contains"
    ) {
      throw topologyError(409, "workspace_brand_root_relationship_conflict", "Canonical Root-to-Brand relationship exists in an incompatible state.");
    }
    return existing;
  }
  const metadata = JSON.stringify({
    authority_source: "workspace_owner_brand_create",
    root_workspace_id: rootWorkspace.workspace_id,
    brand_workspace_id: brandWorkspace.workspace_id,
    authority_implied: false,
    secrets_included: false,
  });
  await connection.query(
    `INSERT INTO container_relationships
      (relationship_id,tenant_id,from_container_id,to_container_id,relationship_type_key,priority,conditions_json,valid_from,valid_until,status,version,created_by,approved_by,metadata_json)
     VALUES (?,?,?,?, 'contains',0,NULL,NULL,NULL,'active',1,?,?,?)`,
    [relationshipId, tenantId, rootContainer.container_id, brandContainer.container_id, actorUserId, actorUserId, metadata]
  );
  return {
    relationship_id: relationshipId,
    from_container_id: rootContainer.container_id,
    to_container_id: brandContainer.container_id,
    relationship_type_key: "contains",
    status: "active",
  };
}

async function ensureRootBrandContainers(connection, { rootWorkspace, brand, brandWorkspace, actorUserId }) {
  const tenantId = text(rootWorkspace.tenant_id, 64);
  const rootContainer = await ensureCanonicalContainer(connection, {
    tenantId,
    containerType: "workspace",
    containerKey: text(rootWorkspace.workspace_key, 255) || `workspace:${rootWorkspace.workspace_id}`,
    subjectType: "workspace",
    subjectRef: rootWorkspace.workspace_id,
    displayName: rootWorkspace.display_name || rootWorkspace.workspace_key || rootWorkspace.workspace_id,
    actorUserId,
    metadata: {
      projection_source: "workspace_registry",
      ownership_topology_source: "workspace_owner_brand_create",
      workspace_ownership_type: rootWorkspace.workspace_ownership_type,
    },
  });
  const brandContainer = await ensureCanonicalContainer(connection, {
    tenantId,
    containerType: "brand",
    containerKey: `brand:${brand.target_key}`,
    subjectType: "brand_target_key",
    subjectRef: brand.target_key,
    displayName: brand.brand_name || brand.target_key,
    actorUserId,
    metadata: {
      projection_source: "brands.target_key",
      ownership_topology_source: "workspace_owner_brand_create",
      root_workspace_id: rootWorkspace.workspace_id,
      brand_workspace_id: brandWorkspace.workspace_id,
    },
  });
  return { rootContainer, brandContainer };
}

export async function createWorkspaceBrandWithRootTopology(connection, {
  tenantId,
  rootWorkspaceId,
  actorUserId,
  displayName,
} = {}) {
  const tenant = text(tenantId, 64);
  const actor = text(actorUserId, 64);
  const root = await loadRootWorkspace(connection, rootWorkspaceId, {
    actorUserId: actor,
    expectedTenantId: tenant,
    lock: true,
  });
  const result = await createWorkspaceBrand(connection, {
    tenantId: root.tenant_id,
    actorUserId: actor,
    displayName,
  });
  await bindOperationalWorkspaceToRoot(connection, {
    tenantId: root.tenant_id,
    brandWorkspaceId: result.link.workspace_id,
    rootWorkspaceId: root.workspace_id,
    actorUserId: actor,
  });
  const { rootContainer, brandContainer } = await ensureRootBrandContainers(connection, {
    rootWorkspace: root,
    brand: result.brand,
    brandWorkspace: result.link,
    actorUserId: actor,
  });
  const relationship = await ensureRootBrandRelationship(connection, {
    tenantId: root.tenant_id,
    rootWorkspace: root,
    brandWorkspace: result.link,
    rootContainer,
    brandContainer,
    actorUserId: actor,
  });
  return {
    ...result,
    root_workspace: {
      workspace_id: root.workspace_id,
      tenant_id: root.tenant_id,
      workspace_key: root.workspace_key,
      workspace_ownership_type: root.workspace_ownership_type,
      owner_user_id: root.owner_user_id || null,
      ownership_revision: Number(root.ownership_revision || 0),
    },
    topology: {
      workspace_container_id: rootContainer.container_id,
      brand_container_id: brandContainer.container_id,
      relationship_id: relationship.relationship_id,
      relationship_type: "contains",
      closure_verified: false,
      secrets_included: false,
    },
  };
}

export async function verifyWorkspaceBrandRootTopology(connection, {
  tenantId,
  rootWorkspaceId,
  brandTargetKey,
  expectedRelationshipId = null,
} = {}) {
  const [parentRows] = await connection.query(
    `SELECT r.relationship_id, p.container_id AS workspace_container_id, b.container_id AS brand_container_id,
            p.canonical_subject_ref AS root_workspace_id, b.canonical_subject_ref AS brand_target_key
       FROM container_relationships r
       JOIN container_relationship_type_registry rt
         ON rt.relationship_type_key=r.relationship_type_key
        AND rt.status='active'
        AND rt.contributes_to_ancestry=1
        AND rt.contributes_to_inheritance=1
       JOIN containers p ON p.container_id=r.from_container_id AND p.status='active'
       JOIN containers b ON b.container_id=r.to_container_id AND b.status='active'
      WHERE r.tenant_id=?
        AND r.status='active'
        AND r.relationship_type_key='contains'
        AND p.container_type_key='workspace'
        AND p.canonical_subject_type='workspace'
        AND b.container_type_key='brand'
        AND b.canonical_subject_type='brand_target_key'
        AND b.canonical_subject_ref=?
      FOR UPDATE`,
    [tenantId, brandTargetKey]
  );
  if (!Array.isArray(parentRows) || parentRows.length !== 1) {
    throw topologyError(409, "workspace_brand_root_topology_readback_invalid", "Brand must resolve to exactly one active inheritance-bearing Workspace parent.", [{ count: Array.isArray(parentRows) ? parentRows.length : 0 }]);
  }
  const [parent] = parentRows;
  if (text(parent.root_workspace_id, 64) !== text(rootWorkspaceId, 64)) {
    throw topologyError(409, "workspace_brand_root_topology_readback_mismatch", "Brand active parent does not match the selected Root Workspace.");
  }
  if (expectedRelationshipId && parent.relationship_id !== expectedRelationshipId) {
    throw topologyError(409, "workspace_brand_root_relationship_readback_mismatch", "Brand Root relationship identity changed during creation.");
  }
  const [closureRows] = await connection.query(
    `SELECT ancestor_container_id, descendant_container_id, shortest_depth, longest_depth, path_count, authority_epoch
       FROM container_closure
      WHERE tenant_id=?
        AND ancestor_container_id=?
        AND descendant_container_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, parent.workspace_container_id, parent.brand_container_id]
  );
  const closure = requireExactlyOne(closureRows, {
    missingCode: "workspace_brand_root_closure_missing",
    missingMessage: "Direct Root-to-Brand closure path is missing.",
    ambiguousCode: "workspace_brand_root_closure_ambiguous",
    ambiguousMessage: "Root-to-Brand closure path resolved ambiguously.",
  });
  if (Number(closure.shortest_depth) !== 1 || Number(closure.longest_depth) !== 1 || Number(closure.path_count) !== 1) {
    throw topologyError(409, "workspace_brand_root_closure_invalid", "Root-to-Brand closure must be one direct unambiguous path.", [{ shortest_depth: closure.shortest_depth, longest_depth: closure.longest_depth, path_count: closure.path_count }]);
  }
  return {
    workspace_container_id: parent.workspace_container_id,
    brand_container_id: parent.brand_container_id,
    relationship_id: parent.relationship_id,
    relationship_type: "contains",
    closure_verified: true,
    closure_depth: 1,
    closure_path_count: 1,
    authority_epoch: Number(closure.authority_epoch || 0),
    secrets_included: false,
  };
}

export const _testingWorkspaceBrandRootTopology = Object.freeze({
  ROOT_WORKSPACE_OWNERSHIP_TYPES,
  stableUuid,
  validateRootWorkspace,
  parseJson,
});