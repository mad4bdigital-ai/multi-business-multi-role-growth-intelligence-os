export const PLATFORM_PLACEHOLDER_TENANT_ID = "00000000-0000-0000-0000-000000000000";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function nonPlaceholderTenant(value) {
  const normalized = text(value);
  return normalized && normalized !== PLATFORM_PLACEHOLDER_TENANT_ID ? normalized : null;
}

export function buildTenantScopePredicate({ isAdmin = false, tenantId = null, column = "tenant_id" } = {}) {
  const safeColumn = String(column || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(safeColumn)) {
    const err = new Error(`Unsafe authority tenant column: ${safeColumn}`);
    err.code = "unsafe_authority_tenant_column";
    throw err;
  }
  const normalizedTenantId = nonPlaceholderTenant(tenantId);
  if (isAdmin && !normalizedTenantId) {
    return { sql: "1 = 1", params: [], scope_mode: "platform_global" };
  }
  if (normalizedTenantId) {
    return {
      sql: `${safeColumn} = ?`,
      params: [normalizedTenantId],
      scope_mode: isAdmin ? "explicit_tenant_diagnostic" : "signed_membership",
    };
  }
  return { sql: "1 = 0", params: [], scope_mode: "signed_membership_missing" };
}
