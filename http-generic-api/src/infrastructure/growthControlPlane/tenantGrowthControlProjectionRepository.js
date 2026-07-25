import { getPool } from "../../../db.js";

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function configVersionRow(row) {
  return Object.freeze({
    configVersionId: row.config_version_id,
    configKey: row.config_key,
    versionNumber: Number(row.version_number),
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    brandKey: row.brand_key,
    activityTypeKey: row.activity_type_key,
    activityBindingId: row.activity_binding_id,
    profileKey: row.profile_key,
    workflowKey: row.workflow_key,
    workflowVersion: row.workflow_version == null ? null : Number(row.workflow_version),
    workflowNodeId: row.workflow_node_id,
    planId: row.plan_id,
    executionId: row.execution_id,
    lifecycle: row.lifecycle,
    versionRevision: Number(row.version_revision),
    checksumSha256: row.checksum_sha256,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at
  });
}

function activityBindingRow(row) {
  return Object.freeze({
    activityBindingId: row.activity_binding_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    brandKey: row.brand_key,
    activityTypeKey: row.activity_type_key,
    activityPackKey: row.activity_pack_key,
    activityPackVersion: Number(row.activity_pack_version),
    markets: parseJsonArray(row.markets_json),
    locales: parseJsonArray(row.locales_json),
    channels: parseJsonArray(row.channels_json),
    objectives: parseJsonArray(row.objectives_json),
    allowedCapabilities: parseJsonArray(row.allowed_capabilities_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export function createTenantGrowthControlProjectionRepository({
  pool = null,
  resolvePool = async () => getPool()
} = {}) {
  if (pool != null && typeof pool.query !== "function") {
    throw new Error("The provided tenant Growth Control Plane SQL pool is invalid.");
  }

  async function executor() {
    const resolved = pool || await resolvePool();
    if (!resolved || typeof resolved.query !== "function") {
      throw new Error("A SQL pool is required for tenant Growth Control Plane projections.");
    }
    return resolved;
  }

  async function resolveTenantWorkspaceScope({ tenantId, userId, workspaceId, brandKey }) {
    const db = await executor();
    const [rows] = await db.query(
      `SELECT m.tenant_id,
              m.role AS tenant_role,
              wr.workspace_id,
              wr.workspace_key,
              wr.workspace_type,
              wr.bootstrap_status,
              wr.linked_brand_key
         FROM memberships m
         JOIN tenants t
           ON t.tenant_id = m.tenant_id
          AND t.status = 'active'
         JOIN workspace_registry wr
           ON wr.tenant_id = m.tenant_id
        WHERE m.user_id = ?
          AND m.tenant_id = ?
          AND m.status = 'active'
          AND wr.workspace_id = ?
          AND wr.linked_brand_key = ?
          AND wr.bootstrap_status IN ('ready','degraded')
        LIMIT 1`,
      [userId, tenantId, workspaceId, brandKey]
    );
    const row = rows?.[0];
    if (!row) return null;
    return Object.freeze({
      tenantId: row.tenant_id,
      tenantRole: row.tenant_role,
      workspaceId: row.workspace_id,
      workspaceKey: row.workspace_key,
      workspaceType: row.workspace_type,
      bootstrapStatus: row.bootstrap_status,
      brandKey: row.linked_brand_key
    });
  }

  async function listConfigurationVersions({ tenantId, workspaceId, brandKey, limit, offset }) {
    const db = await executor();
    const [rows] = await db.query(
      `SELECT config_version_id,
              config_key,
              version_number,
              scope_type,
              scope_key,
              tenant_id,
              workspace_id,
              brand_key,
              activity_type_key,
              activity_binding_id,
              profile_key,
              workflow_key,
              workflow_version,
              workflow_node_id,
              plan_id,
              execution_id,
              lifecycle,
              version_revision,
              checksum_sha256,
              effective_from,
              effective_to,
              created_at
         FROM growth_control_config_versions
        WHERE tenant_id = ?
          AND workspace_id = ?
          AND brand_key = ?
          AND lifecycle IN ('ready','active','deprecated','rolled_back')
        ORDER BY config_key ASC,
                 scope_key ASC,
                 version_number DESC,
                 config_version_id ASC
        LIMIT ? OFFSET ?`,
      [tenantId, workspaceId, brandKey, limit, offset]
    );
    return rows.map(configVersionRow);
  }

  async function listActivityBindings({ tenantId, workspaceId, brandKey, limit, offset }) {
    const db = await executor();
    const [rows] = await db.query(
      `SELECT activity_binding_id,
              tenant_id,
              workspace_id,
              brand_key,
              activity_type_key,
              activity_pack_key,
              activity_pack_version,
              markets_json,
              locales_json,
              channels_json,
              objectives_json,
              allowed_capabilities_json,
              status,
              created_at,
              updated_at
         FROM growth_control_brand_activity_bindings
        WHERE tenant_id = ?
          AND workspace_id = ?
          AND brand_key = ?
        ORDER BY activity_type_key ASC,
                 activity_pack_key ASC,
                 activity_pack_version DESC,
                 activity_binding_id ASC
        LIMIT ? OFFSET ?`,
      [tenantId, workspaceId, brandKey, limit, offset]
    );
    return rows.map(activityBindingRow);
  }

  return Object.freeze({
    resolveTenantWorkspaceScope,
    listConfigurationVersions,
    listActivityBindings
  });
}

export const _testingTenantGrowthControlProjectionRepository = Object.freeze({
  parseJsonArray,
  configVersionRow,
  activityBindingRow
});
