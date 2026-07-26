function requirePool(pool) {
  if (!pool || typeof pool.execute !== "function") {
    throw new TypeError("Authority scope repository requires a SQL pool with execute().");
  }
  return pool;
}

function parseMetadata(value) {
  if (value == null || typeof value === "object") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapScope(row) {
  if (!row) return null;
  return {
    scopeId: row.scope_id,
    scopeKey: row.scope_key,
    scopeType: row.scope_type,
    tenantId: row.tenant_id,
    status: row.status,
    version: row.version,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAuthorityScopeRepository({ resolvePool }) {
  if (typeof resolvePool !== "function") {
    throw new TypeError("Authority scope repository requires a lazy resolvePool function.");
  }

  async function findByKey(scopeKey) {
    const pool = requirePool(await resolvePool());
    const [rows] = await pool.execute(
      `SELECT scope_id,scope_key,scope_type,tenant_id,status,version,metadata_json,created_at,updated_at
         FROM authority_scope_registry
        WHERE scope_key = ?
        LIMIT 1`,
      [String(scopeKey || "").trim()]
    );
    return mapScope(rows?.[0]);
  }

  async function findByTenantId(tenantId) {
    const pool = requirePool(await resolvePool());
    const [rows] = await pool.execute(
      `SELECT scope_id,scope_key,scope_type,tenant_id,status,version,metadata_json,created_at,updated_at
         FROM authority_scope_registry
        WHERE scope_type = 'tenant'
          AND tenant_id = ?
        LIMIT 1`,
      [String(tenantId || "").trim()]
    );
    return mapScope(rows?.[0]);
  }

  return Object.freeze({
    findByKey,
    findByTenantId,
  });
}

export const _testingAuthorityScopeRepository = Object.freeze({
  mapScope,
  parseMetadata,
});
