import { createHash, randomUUID } from "node:crypto";

const OWNER_ROLES = new Set(["owner", "admin"]);

function lifecycleError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

export function normalizeWorkspaceBrandName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

export function canonicalWorkspaceBrandTargetKey(tenantId, normalizedBrandName) {
  const tenant = String(tenantId || "").trim();
  const normalized = normalizeWorkspaceBrandName(normalizedBrandName);
  if (!tenant || !normalized) return "";
  const digest = createHash("sha256").update(`workspace-brand|${tenant}|${normalized}`).digest("hex");
  return `workspace_brand_${digest.slice(0, 32)}`;
}

function isBrandCoreReady(value) {
  if (value === true || value === 1) return true;
  return new Set(["true", "1", "yes", "ready"]).has(String(value ?? "").trim().toLowerCase());
}

function requireExactlyOne(rows, code, message) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw lifecycleError(rows?.length ? 409 : 404, code, message, [{ count: Array.isArray(rows) ? rows.length : 0 }]);
  }
  const [row] = rows;
  return row;
}

function requireDisplayName(value) {
  const displayName = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 255) {
    throw lifecycleError(400, "workspace_brand_name_invalid", "Brand display name must contain 2 to 255 characters.");
  }
  return displayName;
}

async function requireOwnerAuthority(connection, tenantId, actorUserId) {
  const [rows] = await connection.query(
    `SELECT m.user_id, m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.tenant_id=? AND m.user_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, actorUserId]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw lifecycleError(403, "active_membership_required", "Active workspace membership required.");
  }
  if (rows.length !== 1) {
    throw lifecycleError(409, "workspace_owner_authority_invalid", "Workspace owner authority did not resolve exactly once.", [{ count: rows.length }]);
  }
  const [authority] = rows;
  if (String(authority.status || "").toLowerCase() !== "active" || String(authority.tenant_status || "").toLowerCase() !== "active") {
    throw lifecycleError(403, "active_membership_required", "Active workspace membership required.");
  }
  if (!OWNER_ROLES.has(String(authority.role || "").toLowerCase())) {
    throw lifecycleError(403, "workspace_owner_required", "Workspace owner/admin role required.");
  }
  return authority;
}

async function findExistingTenantBrand(connection, tenantId, normalizedName, targetKey) {
  const [rows] = await connection.query(
    `SELECT tbl.link_id, tbl.status AS link_status, tbl.link_source,
            b.id, b.brand_name, b.normalized_brand_name, b.target_key, b.status, b.brand_core_ready
       FROM tenant_brand_links tbl
       JOIN brands b ON b.target_key = tbl.brand_target_key
      WHERE tbl.tenant_id=?
        AND tbl.status='active'
        AND (LOWER(COALESCE(b.normalized_brand_name,''))=LOWER(?) OR b.target_key=?)
      LIMIT 3 FOR UPDATE`,
    [tenantId, normalizedName, targetKey]
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (rows.length !== 1) {
    throw lifecycleError(409, "workspace_brand_identity_ambiguous", "Brand identity resolves to multiple active workspace links.", [{ count: rows.length }]);
  }
  const [brand] = rows;
  if (String(brand.status || "").toLowerCase() !== "active") {
    throw lifecycleError(409, "workspace_brand_inactive", "Existing workspace brand is not active.");
  }
  return brand;
}

async function ensureCanonicalBrand(connection, { displayName, normalizedName, targetKey }) {
  const [rows] = await connection.query(
    `SELECT id, brand_name, normalized_brand_name, target_key, status, brand_core_ready
       FROM brands
      WHERE target_key=?
      LIMIT 2 FOR UPDATE`,
    [targetKey]
  );
  if (rows.length > 1) {
    throw lifecycleError(409, "workspace_brand_identity_ambiguous", "Canonical brand target key did not resolve uniquely.");
  }
  if (rows.length === 1) {
    const [brand] = rows;
    if (normalizeWorkspaceBrandName(brand.normalized_brand_name || brand.brand_name) !== normalizedName) {
      throw lifecycleError(409, "workspace_brand_identity_collision", "Canonical brand target key conflicts with a different brand identity.");
    }
    if (String(brand.status || "").toLowerCase() !== "active") {
      throw lifecycleError(409, "workspace_brand_inactive", "Canonical brand exists but is not active.");
    }
    return { brand, created: false };
  }

  await connection.query(
    `INSERT INTO brands (brand_name, normalized_brand_name, target_key, status)
     VALUES (?, ?, ?, 'active')`,
    [displayName, normalizedName, targetKey]
  );
  const [readbackRows] = await connection.query(
    `SELECT id, brand_name, normalized_brand_name, target_key, status, brand_core_ready
       FROM brands
      WHERE target_key=?
      LIMIT 2 FOR UPDATE`,
    [targetKey]
  );
  const brand = requireExactlyOne(readbackRows, "workspace_brand_create_readback_invalid", "Created canonical brand did not resolve exactly once.");
  if (String(brand.status || "").toLowerCase() !== "active") {
    throw lifecycleError(409, "workspace_brand_create_readback_invalid", "Created canonical brand did not reach active state.");
  }
  return { brand, created: true };
}

async function ensureTenantBrandLink(connection, { tenantId, targetKey, actorUserId }) {
  const linkId = randomUUID();
  const metadata = JSON.stringify({
    authority_implied: true,
    authority_source: "workspace_owner_brand_create",
    created_by_user_id: actorUserId,
    secrets_included: false,
  });
  await connection.query(
    `INSERT INTO tenant_brand_links
      (link_id, tenant_id, brand_target_key, link_source, status, metadata_json)
     VALUES (?, ?, ?, 'workspace_owner_brand_create', 'active', ?)
     ON DUPLICATE KEY UPDATE
       link_source='workspace_owner_brand_create', metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP`,
    [linkId, tenantId, targetKey, metadata]
  );
  const [rows] = await connection.query(
    `SELECT link_id, tenant_id, brand_target_key, link_source, status
       FROM tenant_brand_links
      WHERE tenant_id=? AND brand_target_key=? AND status='active'
      LIMIT 2 FOR UPDATE`,
    [tenantId, targetKey]
  );
  return requireExactlyOne(rows, "workspace_brand_link_readback_invalid", "Workspace brand link did not resolve exactly once.");
}

async function ensureCreatorBrandGrant(connection, { tenantId, targetKey, actorUserId }) {
  const grantId = randomUUID();
  const metadata = JSON.stringify({
    reason: "workspace_brand_create",
    authority_source: "workspace_owner_brand_create",
    secrets_included: false,
  });
  await connection.query(
    `INSERT INTO workspace_resource_grants
      (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
     VALUES (?, ?, ?, 'brand', ?, 'admin', 'active', 'owner_assignment', ?, ?)
     ON DUPLICATE KEY UPDATE
       granted_by=VALUES(granted_by), metadata_json=VALUES(metadata_json), revoked_by=NULL, revoked_at=NULL, updated_at=NOW()`,
    [grantId, tenantId, actorUserId, targetKey, actorUserId, metadata]
  );
  const [rows] = await connection.query(
    `SELECT grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by
       FROM workspace_resource_grants
      WHERE tenant_id=? AND grantee_user_id=? AND resource_type='brand' AND resource_ref=? AND permission='admin' AND status='active'
      ORDER BY updated_at DESC
      LIMIT 2 FOR UPDATE`,
    [tenantId, actorUserId, targetKey]
  );
  return requireExactlyOne(rows, "workspace_brand_owner_grant_readback_invalid", "Brand creator grant did not resolve exactly once.");
}

export async function createWorkspaceBrand(connection, { tenantId, actorUserId, displayName }) {
  const tenant = String(tenantId || "").trim();
  const actor = String(actorUserId || "").trim();
  if (!tenant || !actor) {
    throw lifecycleError(400, "workspace_brand_create_identity_required", "Workspace and signed-in user identity are required.");
  }
  const canonicalDisplayName = requireDisplayName(displayName);
  const normalizedName = normalizeWorkspaceBrandName(canonicalDisplayName);
  const targetKey = canonicalWorkspaceBrandTargetKey(tenant, normalizedName);

  await requireOwnerAuthority(connection, tenant, actor);
  const existing = await findExistingTenantBrand(connection, tenant, normalizedName, targetKey);
  let brand;
  let created = false;
  if (existing) {
    brand = existing;
  } else {
    const canonical = await ensureCanonicalBrand(connection, {
      displayName: canonicalDisplayName,
      normalizedName,
      targetKey,
    });
    brand = canonical.brand;
    created = canonical.created;
  }

  const link = await ensureTenantBrandLink(connection, { tenantId: tenant, targetKey: brand.target_key, actorUserId: actor });
  const grant = await ensureCreatorBrandGrant(connection, { tenantId: tenant, targetKey: brand.target_key, actorUserId: actor });
  const brandCoreReady = isBrandCoreReady(brand.brand_core_ready);

  return {
    created,
    brand: {
      brand_name: brand.brand_name,
      normalized_brand_name: brand.normalized_brand_name,
      target_key: brand.target_key,
      status: brand.status,
      brand_core_ready: brand.brand_core_ready ?? null,
    },
    link,
    grant,
    next_steps: {
      brand_core_profile_required: !brandCoreReady,
      asset_attachment_available: true,
      member_invitation_available: false,
    },
  };
}

export const _testingWorkspaceBrandLifecycle = {
  OWNER_ROLES,
  requireDisplayName,
  isBrandCoreReady,
};
