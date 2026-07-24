function requirePool(pool) {
  if (!pool || typeof pool.execute !== "function") {
    throw new TypeError(
      "Effective authority reconciliation repository requires a SQL pool with execute()."
    );
  }
  return pool;
}

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeLimit(value, fallback = 50, maximum = 200) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`Reconciliation limit must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function mapScope(row = {}) {
  const scopeType = cleanString(row.scope_type);
  const tenantId = cleanString(row.tenant_id);
  if (!new Set(["platform", "tenant"]).has(scopeType)) {
    throw new TypeError(`Unsupported effective-authority scope type: ${scopeType || "missing"}.`);
  }
  if (scopeType === "tenant" && !tenantId) {
    throw new TypeError("Tenant effective-authority scope requires tenant_id.");
  }
  return Object.freeze({
    scopeId: cleanString(row.scope_id),
    scopeKey: cleanString(row.scope_key),
    scopeType,
    tenantId: scopeType === "platform" ? null : tenantId,
    version: Number(row.version || 1),
    status: cleanString(row.status) || "active",
    updatedAt: row.updated_at || null,
  });
}

export function createEffectiveAuthorityReconciliationRepository({ resolvePool }) {
  if (typeof resolvePool !== "function") {
    throw new TypeError(
      "Effective authority reconciliation repository requires a lazy resolvePool function."
    );
  }

  async function listScopes({ limit = 50, afterScopeKey = null } = {}) {
    const boundedLimit = normalizeLimit(limit);
    const cursor = cleanString(afterScopeKey);
    const pool = requirePool(await resolvePool());
    const [rows] = await pool.execute(
      `SELECT scope_id,scope_key,scope_type,tenant_id,status,version,updated_at
         FROM authority_scope_registry
        WHERE status = 'active'
          AND scope_type IN ('platform','tenant')
          AND (? IS NULL OR scope_key > ?)
        ORDER BY scope_key ASC
        LIMIT ?`,
      [cursor, cursor, boundedLimit + 1]
    );
    const normalizedRows = (Array.isArray(rows) ? rows : []).map(mapScope);
    const hasMore = normalizedRows.length > boundedLimit;
    const scopes = hasMore ? normalizedRows.slice(0, boundedLimit) : normalizedRows;
    return Object.freeze({
      scopes: Object.freeze(scopes),
      page: Object.freeze({
        hasMore,
        nextScopeKey: hasMore ? scopes.at(-1)?.scopeKey || null : null,
      }),
    });
  }

  return Object.freeze({ listScopes });
}

export const _testingEffectiveAuthorityReconciliationRepository = Object.freeze({
  mapScope,
  normalizeLimit,
});
