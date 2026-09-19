import { PLATFORM_TOPOLOGY_CONTRACT } from "../../domain/authorityScope/platformTopologyVerification.js";

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== "function") {
    throw new TypeError("Platform Admin Workspace resolution requires a query-capable executor.");
  }
}

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function markerEnabled(value) {
  if (value === true || value === 1) return true;
  return String(value ?? "").trim().toLowerCase() === "true";
}

function normalizeTenantIds(values = []) {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

export const PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT = Object.freeze({
  workspaceKey: PLATFORM_TOPOLOGY_CONTRACT.adminWorkspaceKey,
  authorityScopeKey: PLATFORM_TOPOLOGY_CONTRACT.authorityScopeKey,
  authorityScopeJsonPath: "$.authority_scope_key",
  platformAdminJsonPath: "$.platform_admin_workspace",
});

export function matchesCanonicalPlatformAdminWorkspace(row = {}) {
  const config = parseConfig(row.config_json);
  const authorityScopeKey = cleanString(row.authority_scope_key ?? config.authority_scope_key);
  const platformAdminMarker = row.platform_admin_workspace ?? config.platform_admin_workspace;
  return cleanString(row.workspace_key) === PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.workspaceKey
    || authorityScopeKey === PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.authorityScopeKey
    || markerEnabled(platformAdminMarker);
}

export async function readCanonicalPlatformAdminWorkspaceCandidates({
  executor,
  tenantIds = [],
  requireReady = false,
  limit = null,
} = {}) {
  requireExecutor(executor);
  const normalizedTenantIds = normalizeTenantIds(tenantIds);
  if (!normalizedTenantIds.length) return [];

  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : null;
  const readinessClause = requireReady ? " AND bootstrap_status='ready'" : "";
  const limitClause = safeLimit ? ` LIMIT ${safeLimit}` : "";
  const sql = `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status, config_json
     FROM workspace_registry
    WHERE tenant_id IN (${placeholders(normalizedTenantIds)})
      AND (
        workspace_key=?
        OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'${PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.authorityScopeJsonPath}'))=?
        OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'${PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.platformAdminJsonPath}'))='true'
      )${readinessClause}
    ORDER BY workspace_id${limitClause}`;
  const params = [
    ...normalizedTenantIds,
    PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.workspaceKey,
    PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.authorityScopeKey,
  ];
  const [result] = await executor.query(sql, params);
  const rows = Array.isArray(result) ? result : [];
  return rows.filter((row) => matchesCanonicalPlatformAdminWorkspace(row)
    && (!requireReady || cleanString(row.bootstrap_status) === "ready"));
}

export async function resolveCanonicalPlatformAdminWorkspace({
  executor,
  tenantId,
  requireReady = true,
} = {}) {
  requireExecutor(executor);
  const normalizedTenantId = cleanString(tenantId);
  if (!normalizedTenantId) return null;

  const candidates = await readCanonicalPlatformAdminWorkspaceCandidates({
    executor,
    tenantIds: [normalizedTenantId],
    requireReady,
    limit: 2,
  });
  if (candidates.length > 1) {
    const error = new Error("More than one canonical Platform Admin Workspace matched.");
    error.code = "platform_admin_workspace_ambiguous";
    error.status = 503;
    error.details = { candidateCount: candidates.length };
    throw error;
  }
  if (candidates.length === 0) return null;
  const [candidate] = candidates;
  return candidate;
}

export const _testingPlatformAdminWorkspaceResolver = Object.freeze({
  cleanString,
  parseConfig,
  markerEnabled,
  normalizeTenantIds,
  placeholders,
});
