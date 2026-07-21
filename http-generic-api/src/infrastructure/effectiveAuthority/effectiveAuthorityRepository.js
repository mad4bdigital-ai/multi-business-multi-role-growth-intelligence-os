function requirePool(pool) {
  if (!pool || typeof pool.execute !== "function") {
    throw new TypeError("Effective authority repository requires a SQL pool with execute().");
  }
  return pool;
}

function mapCapability(row) {
  if (!row) return null;
  return {
    capability_key: row.capability_key,
    display_name: row.display_name,
    resource_type: row.resource_type,
    operation_key: row.operation_key,
    risk_class: row.risk_class,
    default_execution_mode: row.default_execution_mode,
    requires_connection: row.requires_connection,
    requires_workspace_authority: row.requires_workspace_authority,
    requires_approval: row.requires_approval,
    requires_audit_evidence: row.requires_audit_evidence,
    requires_readback: row.requires_readback,
    schema_version: row.schema_version,
    status: row.status,
  };
}

export function createEffectiveAuthorityRepository({ resolvePool }) {
  if (typeof resolvePool !== "function") {
    throw new TypeError("Effective authority repository requires a lazy resolvePool function.");
  }

  async function findCapabilityByKey(capabilityKey) {
    const pool = requirePool(await resolvePool());
    const [rows] = await pool.execute(
      `SELECT capability_key,display_name,resource_type,operation_key,risk_class,
              default_execution_mode,requires_connection,requires_workspace_authority,
              requires_approval,requires_audit_evidence,requires_readback,schema_version,status
         FROM platform_semantic_capabilities
        WHERE capability_key = ?
        LIMIT 1`,
      [String(capabilityKey || "").trim()]
    );
    return mapCapability(rows?.[0]);
  }

  async function listConnectorInventory({ scope, limit, afterSystemId = null }) {
    const pool = requirePool(await resolvePool());
    const where = ["cs.status <> 'archived'"];
    const params = [];

    if (scope.scopeType === "tenant") {
      where.push("cs.tenant_id = ?");
      params.push(scope.tenantId);
    }
    if (afterSystemId) {
      where.push("cs.system_id > ?");
      params.push(afterSystemId);
    }

    params.push(limit + 1);
    const [rows] = await pool.execute(
      `SELECT cs.system_id,cs.tenant_id,cs.system_key,cs.display_name,
              cs.provider_family,cs.connector_family,cs.status,
              COUNT(DISTINCT CASE
                WHEN i.status = 'active'
                 AND (i.expires_at IS NULL OR i.expires_at > NOW())
                THEN i.installation_id ELSE NULL END) AS active_installation_count
         FROM connected_systems cs
         LEFT JOIN installations i
           ON i.system_id = cs.system_id
          AND i.tenant_id = cs.tenant_id
        WHERE ${where.join(" AND ")}
        GROUP BY cs.system_id,cs.tenant_id,cs.system_key,cs.display_name,
                 cs.provider_family,cs.connector_family,cs.status
        ORDER BY cs.system_id ASC
        LIMIT ?`,
      params
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      rows: pageRows,
      hasMore,
      nextSystemId: hasMore ? pageRows.at(-1)?.system_id || null : null,
    };
  }

  return Object.freeze({
    findCapabilityByKey,
    listConnectorInventory,
  });
}

export const _testingEffectiveAuthorityRepository = Object.freeze({
  mapCapability,
});
