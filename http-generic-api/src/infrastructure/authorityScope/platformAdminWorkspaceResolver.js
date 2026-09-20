import { PLATFORM_ADMIN_WORKSPACE_AUTHORITY } from "../../domain/authorityScope/platformAdminWorkspaceAuthority.generated.js";

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
  workspaceKey: PLATFORM_ADMIN_WORKSPACE_AUTHORITY.resolver.candidate_workspace_key,
  authorityScopeKey: PLATFORM_ADMIN_WORKSPACE_AUTHORITY.resolver.authority_scope_key,
  authorityScopeJsonPath: PLATFORM_ADMIN_WORKSPACE_AUTHORITY.json_paths.authority_scope_key,
  platformAdminJsonPath: PLATFORM_ADMIN_WORKSPACE_AUTHORITY.json_paths.platform_admin_workspace,
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


function canonicalIdentityState(row = {}) {
  const identity = PLATFORM_ADMIN_WORKSPACE_AUTHORITY.identity;
  const configState = parseConfigState(row.config_json);
  const exactId = cleanString(row.workspace_id) === identity.workspace_id;
  const exactSeedKey = cleanString(row.workspace_key) === identity.seed_workspace_key;
  const exactTenant = cleanString(row.tenant_id) === identity.tenant_id;
  const exactDisplay = cleanString(row.display_name) === identity.display_name;
  const exactType = cleanString(row.workspace_type) === identity.workspace_type;
  const ready = cleanString(row.bootstrap_status) === identity.bootstrap_status;
  const markerAuthority = cleanString(configState.value.authority_scope_key) === PLATFORM_ADMIN_WORKSPACE_AUTHORITY.resolver.authority_scope_key;
  const markerAdmin = markerEnabled(configState.value.platform_admin_workspace);
  return Object.freeze({
    exact_id: exactId,
    exact_seed_key: exactSeedKey,
    exact_tenant: exactTenant,
    exact_display_name: exactDisplay,
    exact_workspace_type: exactType,
    ready,
    config_valid: configState.valid,
    authority_scope_marker: markerAuthority,
    platform_admin_marker: markerAdmin,
    exact_identity: exactId && exactSeedKey && exactTenant && exactDisplay && exactType,
    exact_ready_authority: exactId && exactSeedKey && exactTenant && exactDisplay && exactType && ready && configState.valid && markerAuthority && markerAdmin,
  });
}

function parseConfigState(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { valid: true, value };
  if (!value) return { valid: true, value: {} };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { valid: true, value: parsed }
      : { valid: false, value: {} };
  } catch {
    return { valid: false, value: {} };
  }
}

export function classifyPlatformAdminWorkspaceReadiness(rows = []) {
  const relevant = Array.isArray(rows) ? rows.slice(0, 4) : [];
  const states = relevant.map((row) => ({ row, state: canonicalIdentityState(row) }));
  const exactSelectors = states.filter(({ state }) => state.exact_id || state.exact_seed_key);
  const markerCandidates = states.filter(({ row }) => matchesCanonicalPlatformAdminWorkspace(row));
  const readyAuthorities = states.filter(({ state }) => state.exact_ready_authority);

  let status = "canonical_missing";
  if (exactSelectors.some(({ state }) => !state.exact_identity || !state.config_valid
      || !state.authority_scope_marker || !state.platform_admin_marker)) {
    status = "canonical_identity_conflict";
  } else if (markerCandidates.length > 1 || readyAuthorities.length > 1) {
    status = "canonical_ambiguous";
  } else if (readyAuthorities.length === 1 && markerCandidates.length === 1) {
    status = "ready";
  } else if (exactSelectors.length === 1 && exactSelectors[0].state.exact_identity
      && !exactSelectors[0].state.ready) {
    status = "canonical_not_ready";
  } else if (exactSelectors.length > 0 || markerCandidates.length > 0) {
    status = "canonical_identity_conflict";
  }

  const canonical = readyAuthorities.length === 1 ? readyAuthorities[0].row : null;
  return Object.freeze({
    contract: "mad4b.platform-admin-workspace-readiness.v1",
    status,
    ready: status === "ready",
    workspace: canonical ? Object.freeze({
      workspace_id: canonical.workspace_id,
      tenant_id: canonical.tenant_id,
      workspace_key: canonical.workspace_key,
      workspace_type: canonical.workspace_type,
      bootstrap_status: canonical.bootstrap_status,
    }) : null,
    relevant_row_count: relevant.length,
    exact_selector_count: exactSelectors.length,
    marker_candidate_count: markerCandidates.length,
    ready_authority_count: readyAuthorities.length,
    database_read_performed: false,
    database_mutation_performed: false,
    provider_access_performed: false,
    production_access_performed: false,
    secrets_included: false,
  });
}

export async function inspectCanonicalPlatformAdminWorkspaceReadiness({ executor, tenantId } = {}) {
  const normalizedTenantId = cleanString(tenantId);
  if (!executor || typeof executor.query !== "function") {
    return Object.freeze({
      contract: "mad4b.platform-admin-workspace-readiness.v1",
      status: "runtime_database_unavailable",
      ready: false,
      workspace: null,
      relevant_row_count: 0,
      exact_selector_count: 0,
      marker_candidate_count: 0,
      ready_authority_count: 0,
      database_read_performed: false,
      database_mutation_performed: false,
      provider_access_performed: false,
      production_access_performed: false,
      secrets_included: false,
    });
  }
  if (!normalizedTenantId) return classifyPlatformAdminWorkspaceReadiness([]);
  const identity = PLATFORM_ADMIN_WORKSPACE_AUTHORITY.identity;
  try {
    const [result] = await executor.query(
      `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status, config_json
         FROM workspace_registry
        WHERE tenant_id=?
          AND (
            workspace_id=?
            OR workspace_key IN (?,?)
            OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'${PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.authorityScopeJsonPath}'))=?
            OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'${PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.platformAdminJsonPath}'))='true'
          )
        ORDER BY workspace_id
        LIMIT 4`,
      [
        normalizedTenantId,
        identity.workspace_id,
        identity.seed_workspace_key,
        PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.workspaceKey,
        PLATFORM_ADMIN_WORKSPACE_MARKER_CONTRACT.authorityScopeKey,
      ],
    );
    const classified = classifyPlatformAdminWorkspaceReadiness(Array.isArray(result) ? result : []);
    return Object.freeze({ ...classified, database_read_performed: true });
  } catch {
    return Object.freeze({
      contract: "mad4b.platform-admin-workspace-readiness.v1",
      status: "runtime_database_unavailable",
      ready: false,
      workspace: null,
      relevant_row_count: 0,
      exact_selector_count: 0,
      marker_candidate_count: 0,
      ready_authority_count: 0,
      database_read_performed: true,
      database_mutation_performed: false,
      provider_access_performed: false,
      production_access_performed: false,
      secrets_included: false,
    });
  }
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
