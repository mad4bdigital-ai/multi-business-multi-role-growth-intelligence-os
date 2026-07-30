function safeText(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function httpError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

export function grantCoversOperations(existing = [], requested = []) {
  const allowed = new Set(parseArray(existing).map((item) => safeText(item, 64).toLowerCase()).filter(Boolean));
  return allowed.has("*") || requested.every((item) => allowed.has(safeText(item, 64).toLowerCase()));
}

export function mergeAllowedOperations(existing = [], requested = []) {
  const current = parseArray(existing).map((item) => safeText(item, 64).toLowerCase()).filter(Boolean);
  const additions = parseArray(requested).map((item) => safeText(item, 64).toLowerCase()).filter(Boolean);
  return [...new Set([...current, ...additions])];
}

async function verifySiteBinding(connection, { brandKey, resourceRef }) {
  const [rows] = await connection.query(
    `SELECT b.binding_id, b.site_id
       FROM brand_site_bindings b
       JOIN cms_sites s ON s.site_id = b.site_id
      WHERE b.target_key = ?
        AND b.status = 'active'
        AND s.platform_status = 'active'
        AND (s.site_id = ? OR s.normalized_domain = ? OR s.site_url = ?)
      LIMIT 1
      FOR UPDATE`,
    [brandKey, resourceRef, resourceRef, resourceRef]
  );
  return rows[0] || null;
}

async function verifyAssetBinding(connection, { tenantId, brandKey, resourceRef }) {
  const [rows] = await connection.query(
    `SELECT asset_id
       FROM workspace_assets
      WHERE tenant_id = ?
        AND brand_ref = ?
        AND lifecycle_status NOT IN ('archived','deleted')
        AND (asset_id = ? OR asset_ref = ?)
      LIMIT 1
      FOR UPDATE`,
    [tenantId, brandKey, resourceRef, resourceRef]
  );
  return rows[0] || null;
}

export async function assertRequestedResourceBelongsToBrand(connection, {
  tenantId,
  brandKey,
  workspace = null,
  requestedResourceType = null,
  requestedResourceRef = null,
} = {}) {
  const resourceType = safeText(requestedResourceType, 64).toLowerCase() || null;
  const resourceRef = safeText(requestedResourceRef, 255) || null;
  if (!resourceType && !resourceRef) {
    return { required: false, verified: true, resource_type: null, resource_ref: null, binding_source: "implicit_scope" };
  }
  if (!resourceType || !resourceRef) {
    throw httpError(400, "BRAND_SKILL_RESOURCE_BINDING_INCOMPLETE", "resource_type and resource_ref must be provided together.");
  }

  if (resourceType === "brand") {
    if (resourceRef !== brandKey) {
      throw httpError(403, "BRAND_SKILL_RESOURCE_BRAND_MISMATCH", "The requested brand resource does not match the selected brand.", {
        brand_key: brandKey,
        resource_ref: resourceRef,
      });
    }
    return { required: true, verified: true, resource_type: resourceType, resource_ref: resourceRef, binding_source: "brand_key" };
  }

  if (resourceType === "workspace") {
    const workspaceRefs = new Set([workspace?.workspace_id, workspace?.workspace_key].filter(Boolean).map(String));
    if (!workspaceRefs.has(resourceRef)) {
      throw httpError(403, "BRAND_SKILL_RESOURCE_BRAND_MISMATCH", "The requested workspace is not the workspace linked to the selected brand.", {
        brand_key: brandKey,
        resource_ref: resourceRef,
      });
    }
    return { required: true, verified: true, resource_type: resourceType, resource_ref: resourceRef, binding_source: "workspace_registry" };
  }

  try {
    if (resourceType === "site") {
      const binding = await verifySiteBinding(connection, { brandKey, resourceRef });
      if (!binding) {
        throw httpError(403, "BRAND_SKILL_RESOURCE_BRAND_MISMATCH", "The requested site is not actively bound to the selected brand.", {
          brand_key: brandKey,
          resource_ref: resourceRef,
        });
      }
      return { required: true, verified: true, resource_type: resourceType, resource_ref: resourceRef, binding_source: "brand_site_bindings", binding_id: binding.binding_id };
    }

    if (resourceType === "asset") {
      const binding = await verifyAssetBinding(connection, { tenantId, brandKey, resourceRef });
      if (!binding) {
        throw httpError(403, "BRAND_SKILL_RESOURCE_BRAND_MISMATCH", "The requested asset is not actively scoped to the selected brand.", {
          brand_key: brandKey,
          resource_ref: resourceRef,
        });
      }
      return { required: true, verified: true, resource_type: resourceType, resource_ref: resourceRef, binding_source: "workspace_assets", binding_id: binding.asset_id };
    }
  } catch (error) {
    if (error?.code?.startsWith?.("BRAND_SKILL_")) throw error;
    throw httpError(503, "BRAND_SKILL_RESOURCE_BINDING_UNAVAILABLE", "The canonical resource-to-brand binding could not be verified.", {
      brand_key: brandKey,
      resource_type: resourceType,
      resource_ref: resourceRef,
      cause_code: error?.code || null,
    });
  }

  throw httpError(403, "BRAND_SKILL_RESOURCE_BRAND_BINDING_UNSUPPORTED", "This resource type has no canonical brand-binding resolver for self-service activation.", {
    brand_key: brandKey,
    resource_type: resourceType,
    resource_ref: resourceRef,
  });
}
