import { getPool } from "./db.js";

function text(value, max = 512) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function jsonArray(value) {
  if (Array.isArray(value)) return value.map((item) => text(item, 191)).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => text(item, 191)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const PERMISSION_RANK = Object.freeze({
  view: 1,
  comment: 2,
  edit: 3,
  operate: 4,
  manage: 5,
  admin: 6,
  owner: 7,
});

function permissionAllows(permission, mutationRequired = false) {
  const normalized = text(permission, 32)?.toLowerCase() || "";
  const rank = PERMISSION_RANK[normalized] || 0;
  const minimum = mutationRequired ? PERMISSION_RANK.edit : PERMISSION_RANK.view;
  return rank >= minimum;
}

function contextFromArgs(args = {}) {
  const value = args?.authority_context || args?.resource_authority || {};
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ownerReferences(context = {}, resourceUri = null) {
  const pairs = [];
  const push = (resourceType, resourceRef) => {
    const type = text(resourceType, 64);
    const ref = text(resourceRef, 255);
    if (!type || !ref) return;
    if (!pairs.some((entry) => entry.resource_type === type && entry.resource_ref === ref)) {
      pairs.push({ resource_type: type, resource_ref: ref });
    }
  };
  for (const item of Array.isArray(context.owner_refs) ? context.owner_refs.slice(0, 20) : []) {
    push(item?.resource_type, item?.resource_ref);
  }
  push("workspace", context.workspace_id);
  push("workspace", context.workspace_key);
  push("brand", context.brand_key);
  push("brand", context.brand_ref);
  push("asset", resourceUri);
  push("app", context.source_system_id);
  return pairs.slice(0, 20);
}

function decision({ ok, required, reasonCode, context = {}, binding = null, ownerGrant = null }) {
  return {
    ok,
    required,
    reason_code: reasonCode,
    resource_type: context.resource_type || null,
    resource_uri: context.resource_uri || null,
    operation_mode: context.operation_mode || null,
    binding_id: binding?.binding_id || null,
    authority_source: binding?.authority_source || null,
    source_system_id: binding?.source_system_id || null,
    source_installation_id: binding?.source_installation_id || null,
    owner_grant_id: ownerGrant?.grant_id || null,
    mutation_policy_declared: Boolean(ok && required && context.mutation_required),
    secrets_included: false,
  };
}

async function resolveOwnerGrant(pool, { tenantId, userId, references }) {
  if (!tenantId || !userId || !references.length) return null;
  const clauses = references.map(() => "(resource_type = ? AND BINARY resource_ref = BINARY ?)");
  const params = [tenantId, userId];
  for (const reference of references) params.push(reference.resource_type, reference.resource_ref);
  const [rows] = await pool.query(
    `SELECT grant_id, resource_type, resource_ref, permission
       FROM v_workspace_resource_grant_effective
      WHERE BINARY tenant_id = BINARY ?
        AND BINARY grantee_user_id = BINARY ?
        AND (${clauses.join(" OR ")})
      ORDER BY FIELD(permission, 'owner','admin','manage','operate','edit','comment','view')
      LIMIT 1`,
    params,
  );
  return rows?.[0] || null;
}

export async function resolveDynamicResourceAuthority({
  callerType = "tenant",
  principal = {},
  toolKey = "",
  args = {},
  mutationRequired = false,
  pool = null,
} = {}) {
  const context = contextFromArgs(args);
  const normalizedToolKey = text(toolKey, 128) || "";
  const isAdmin = callerType === "admin" || principal?.is_admin === true;
  const required = normalizedToolKey === "admin_control"
    && (!isAdmin || mutationRequired === true || context.required === true);

  if (!required) {
    return decision({ ok: true, required: false, reasonCode: "dynamic_resource_authority_not_required" });
  }

  const principalTenantId = text(principal?.tenant_id, 64);
  const principalUserId = text(principal?.user_id, 64);
  const requestedTenantId = text(context.tenant_id, 64);
  const requestedUserId = text(context.user_id || context.owner_user_id, 64);
  if (!isAdmin && requestedTenantId && requestedTenantId !== principalTenantId) {
    return decision({ ok: false, required: true, reasonCode: "resource_authority_tenant_override_forbidden" });
  }
  if (!isAdmin && requestedUserId && requestedUserId !== principalUserId) {
    return decision({ ok: false, required: true, reasonCode: "resource_authority_user_override_forbidden" });
  }

  const tenantId = isAdmin ? (requestedTenantId || principalTenantId) : principalTenantId;
  const userId = isAdmin ? (requestedUserId || principalUserId) : principalUserId;
  const workspaceId = text(context.workspace_id, 64);
  const resourceType = text(context.resource_type, 128);
  const resourceUri = text(context.resource_uri, 512);
  const operationMode = text(context.operation_mode || context.mode, 191);
  const sourceSystemId = text(context.source_system_id || context.system_id, 64);
  const sourceInstallationId = text(context.source_installation_id || context.installation_id, 64);
  const normalizedContext = {
    resource_type: resourceType,
    resource_uri: resourceUri,
    operation_mode: operationMode,
    mutation_required: mutationRequired === true,
  };

  if (!resourceType || !resourceUri || !operationMode) {
    return decision({ ok: false, required: true, reasonCode: "resource_authority_context_required", context: normalizedContext });
  }
  if (!isAdmin && (!tenantId || !userId)) {
    return decision({ ok: false, required: true, reasonCode: "resource_authority_principal_required", context: normalizedContext });
  }

  const effectivePool = pool || getPool();
  let rows;
  try {
    [rows] = await effectivePool.query(
      `SELECT b.binding_id, b.tenant_id, b.workspace_id, b.user_id,
              b.resource_type, b.resource_uri, b.permission_level,
              b.allowed_modes_json, b.authority_source,
              b.source_system_id, b.source_installation_id,
              s.status AS source_system_status,
              s.tenant_id AS source_system_tenant_id,
              i.status AS source_installation_status,
              i.tenant_id AS source_installation_tenant_id,
              i.expires_at AS source_installation_expires_at
         FROM platform_resource_authority_bindings b
         LEFT JOIN connected_systems s ON BINARY s.system_id = BINARY b.source_system_id
         LEFT JOIN installations i ON BINARY i.installation_id = BINARY b.source_installation_id
                                  AND BINARY i.system_id = BINARY b.source_system_id
        WHERE b.status = 'active'
          AND (b.expires_at IS NULL OR b.expires_at > NOW())
          AND BINARY b.resource_type = BINARY ?
          AND BINARY b.resource_uri = BINARY ?
          AND (b.tenant_id IS NULL OR BINARY b.tenant_id = BINARY ?)
          AND (b.workspace_id IS NULL OR BINARY b.workspace_id = BINARY ?)
          AND (b.user_id IS NULL OR BINARY b.user_id = BINARY ?)
          AND (? IS NULL OR BINARY b.source_system_id = BINARY ?)
          AND (? IS NULL OR BINARY b.source_installation_id = BINARY ?)
        ORDER BY b.user_id IS NOT NULL DESC,
                 b.workspace_id IS NOT NULL DESC,
                 b.tenant_id IS NOT NULL DESC,
                 b.updated_at DESC
        LIMIT 20`,
      [resourceType, resourceUri, tenantId, workspaceId, userId, sourceSystemId, sourceSystemId, sourceInstallationId, sourceInstallationId],
    );
  } catch {
    return decision({ ok: false, required: true, reasonCode: "resource_authority_registry_unavailable", context: normalizedContext });
  }

  for (const binding of rows || []) {
    if (!isAdmin && binding.tenant_id !== tenantId) continue;
    if (!jsonArray(binding.allowed_modes_json).includes(operationMode)) continue;
    if (!permissionAllows(binding.permission_level, mutationRequired)) continue;
    if (binding.source_system_id) {
      if (binding.source_system_status !== "active") continue;
      if (binding.tenant_id && binding.source_system_tenant_id !== binding.tenant_id) continue;
    }
    if (binding.source_installation_id) {
      if (binding.source_installation_status !== "active") continue;
      if (binding.tenant_id && binding.source_installation_tenant_id !== binding.tenant_id) continue;
      if (binding.source_installation_expires_at && new Date(binding.source_installation_expires_at).getTime() <= Date.now()) continue;
    }

    const references = ownerReferences(context, resourceUri);
    const ownerUserId = text(context.owner_user_id || userId, 64);
    const ownerGrantRequired = !isAdmin || Boolean(ownerUserId && references.length);
    let ownerGrant = null;
    if (ownerGrantRequired && binding.user_id !== ownerUserId) {
      try {
        ownerGrant = await resolveOwnerGrant(effectivePool, { tenantId, userId: ownerUserId, references });
      } catch {
        return decision({ ok: false, required: true, reasonCode: "resource_owner_grant_registry_unavailable", context: normalizedContext, binding });
      }
      if (!ownerGrant) continue;
    }
    if (ownerGrant && !permissionAllows(ownerGrant.permission, mutationRequired)) continue;

    return decision({ ok: true, required: true, reasonCode: "dynamic_resource_authority_granted", context: normalizedContext, binding, ownerGrant });
  }

  return decision({ ok: false, required: true, reasonCode: "dynamic_resource_authority_denied", context: normalizedContext });
}

export const _testingDynamicResourceAuthority = { text, jsonArray, ownerReferences, permissionAllows };
