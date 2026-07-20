const TENANT_TOOL_CAPABILITY_PREFIX = "tenant_tool.";

export const TENANT_TOOL_EXPORTABLE_MANIFEST_STATUSES = Object.freeze([
  "shadow_ready",
  "active",
  "certified",
]);

const EXPORTABLE_STATUS_SET = new Set(TENANT_TOOL_EXPORTABLE_MANIFEST_STATUSES);

export function normalizeTenantToolKey(toolKey) {
  return String(toolKey || "").trim();
}

export function buildTenantToolManifestBlocks(rows = []) {
  const blocked = new Map();
  for (const row of rows || []) {
    const toolKey = normalizeTenantToolKey(row?.tool_key);
    if (!toolKey) continue;
    const manifestStatus = String(row?.manifest_status || row?.status || "unknown").trim().toLowerCase();
    if (!EXPORTABLE_STATUS_SET.has(manifestStatus)) {
      blocked.set(toolKey, manifestStatus || "unknown");
    }
  }
  return blocked;
}

export async function loadTenantToolManifestBlocks(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A SQL pool is required to resolve Tenant tool capability manifests.");
  }

  const [rows] = await pool.query(
    `SELECT
       SUBSTRING(capability_key, CHAR_LENGTH(?) + 1) AS tool_key,
       status AS manifest_status
     FROM platform_capability_compiled_manifests
     WHERE is_current = 1
       AND LEFT(capability_key, CHAR_LENGTH(?)) = ?`,
    [
      TENANT_TOOL_CAPABILITY_PREFIX,
      TENANT_TOOL_CAPABILITY_PREFIX,
      TENANT_TOOL_CAPABILITY_PREFIX,
    ]
  );
  return buildTenantToolManifestBlocks(rows);
}

export function filterTenantToolsByManifest(rows = [], blockedManifests = new Map()) {
  return (rows || []).filter((row) => !blockedManifests.has(normalizeTenantToolKey(row?.tool_key)));
}

export function assertTenantToolManifestAllows(callerType, toolKey, blockedManifests = new Map()) {
  if (callerType !== "tenant") return;
  const normalizedToolKey = normalizeTenantToolKey(toolKey);
  if (!normalizedToolKey || !blockedManifests.has(normalizedToolKey)) return;

  const manifestStatus = blockedManifests.get(normalizedToolKey) || "blocked";
  const error = new Error("This Tenant tool is blocked by the current capability manifest.");
  error.status = 403;
  error.code = "tenant_tool_capability_blocked";
  error.details = {
    tool_key: normalizedToolKey,
    manifest_status: manifestStatus,
  };
  throw error;
}
